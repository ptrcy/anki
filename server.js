const express = require('express');
const fs = require('fs').promises;
const { existsSync, mkdirSync } = require('fs'); // Keep sync for startup/initialization
const path = require('path');
const { synthesizeText } = require('./tts-helper');

// DJB2 hash — mirrors the client-side hashText() in app.js
function hashText(text) {
  let hash = 5381;
  const s = (text || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
  }
  return Math.abs(hash & hash).toString(36);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const DATA_DIR = path.join(__dirname, 'data');
const DECKS_DIR = path.join(DATA_DIR, 'decks');
const SYNC_DIR = path.join(DATA_DIR, 'sync');
const AUDIO_DIR = path.join(__dirname, 'public', 'audio');

[DATA_DIR, DECKS_DIR, SYNC_DIR, AUDIO_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Middleware
app.use(express.json({ limit: '10mb' }));

// On-demand Audio Middleware
app.get('/audio/:filename', async (req, res, next) => {
  const { filename } = req.params;
  if (!filename.endsWith('.mp3')) return next();

  const filePath = path.join(AUDIO_DIR, filename);
  
  // If file exists, let express.static handle it
  if (existsSync(filePath)) {
    return next();
  }

  // If not, try to find the card in the decks to get the text
  console.log(`Generating on-demand audio for: ${filename}`);
  try {
    // Filename format: "${hash(fr)}_${hash(target)}_${targetLang}.mp3" (e.g. "card_abc_xyz_it.mp3")
    const nameWithoutExt = filename.replace('.mp3', '');
    const match = nameWithoutExt.match(/^(card_[a-z0-9]+)_([a-z0-9]+)_([a-z]{2})$/);
    if (!match) {
      return res.status(404).send('Invalid audio filename format');
    }
    const [, cardId, targetHash, targetLang] = match;

    const deckFiles = await fs.readdir(DECKS_DIR);
    let cardText = null;

    // Find the card whose fr-hash matches cardId, target-hash matches targetHash, and deck language matches targetLang.
    // This uniquely identifies the exact target text and its language.
    for (const file of deckFiles) {
      if (!file.endsWith('.json')) continue;
      const deck = JSON.parse(await fs.readFile(path.join(DECKS_DIR, file), 'utf8'));
      if (deck.targetLang.toLowerCase() !== targetLang.toLowerCase()) continue;
      const card = deck.cards.find(c => c.id === cardId && hashText(c.target) === targetHash);
      if (card) {
        cardText = card.target;
        break;
      }
    }

    if (cardText) {
      const success = await synthesizeText(cardText, targetLang, filePath);
      if (success) {
        return res.sendFile(filePath);
      }
    }
    
    res.status(404).send('Audio not found and could not be generated');
  } catch (err) {
    console.error('On-demand audio error:', err);
    next();
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Helper to make name a clean URL-friendly ID slug
function generateSlug(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]+/g, '-')     // replace non-alphanumeric with hyphen
    .replace(/(^-|-$)+/g, '');       // trim hyphens
}

// API Routes

// 1. List all decks metadata
app.get('/api/decks', async (req, res) => {
  try {
    const files = await fs.readdir(DECKS_DIR);
    const decks = [];

    // Use Promise.all to read files in parallel for better performance
    const deckPromises = files
      .filter(file => file.endsWith('.json'))
      .map(async (file) => {
        const filePath = path.join(DECKS_DIR, file);
        try {
          const fileContent = await fs.readFile(filePath, 'utf8');
          const deckData = JSON.parse(fileContent);
          return {
            id: path.basename(file, '.json'),
            name: deckData.name,
            targetLang: deckData.targetLang || 'it',
            cardCount: Array.isArray(deckData.cards) ? deckData.cards.length : 0
          };
        } catch (e) {
          console.error(`Error parsing deck file ${file}:`, e);
          return null;
        }
      });

    const results = await Promise.all(deckPromises);
    res.json(results.filter(d => d !== null));
  } catch (err) {
    console.error('Failed to read decks list:', err);
    res.status(500).json({ error: 'Failed to read decks list' });
  }
});

// 2. Get specific deck
app.get('/api/decks/:id', async (req, res) => {
  const deckId = req.params.id;
  if (!/^[a-z0-9-]+$/.test(deckId)) {
    return res.status(400).json({ error: 'Invalid deck ID' });
  }
  const filePath = path.join(DECKS_DIR, `${deckId}.json`);

  try {
    const deckContent = await fs.readFile(filePath, 'utf8');
    res.json(JSON.parse(deckContent));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Deck not found' });
    }
    console.error(`Failed to read deck file ${deckId}:`, err);
    res.status(500).json({ error: 'Failed to read deck file' });
  }
});

// Helper to check if file exists asynchronously
async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

// 3. Create/Upload new deck
app.post('/api/decks', async (req, res) => {
  const { name, targetLang, cards } = req.body;

  if (!name || !cards || !Array.isArray(cards)) {
    return res.status(400).json({ error: 'Invalid deck data. Name and cards list are required.' });
  }

  try {
    let baseSlug = generateSlug(name);
    if (!baseSlug) {
      baseSlug = 'deck';
    }

    let slug = baseSlug;
    let counter = 1;
    let filePath = path.join(DECKS_DIR, `${slug}.json`);

    // Avoid overwriting existing decks, create unique slug
    while (await fileExists(filePath)) {
      slug = `${baseSlug}-${counter}`;
      filePath = path.join(DECKS_DIR, `${slug}.json`);
      counter++;
    }

    const deckData = {
      name,
      targetLang: targetLang || 'it',
      cards,
      createdAt: new Date().toISOString()
    };

    await fs.writeFile(filePath, JSON.stringify(deckData, null, 2), 'utf8');
    res.status(201).json({ success: true, id: slug, name });
  } catch (err) {
    console.error('Failed to save deck:', err);
    res.status(500).json({ error: 'Failed to save deck' });
  }
});

// 4. Rename deck
app.put('/api/decks/:id', async (req, res) => {
  const deckId = req.params.id;
  if (!/^[a-z0-9-]+$/.test(deckId)) {
    return res.status(400).json({ error: 'Invalid deck ID' });
  }
  const filePath = path.join(DECKS_DIR, `${deckId}.json`);

  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const deck = JSON.parse(fileContent);
    deck.name = name.trim();
    await fs.writeFile(filePath, JSON.stringify(deck, null, 2), 'utf8');
    res.json({ success: true, name: deck.name });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Deck not found' });
    }
    console.error(`Failed to rename deck ${deckId}:`, err);
    res.status(500).json({ error: 'Failed to rename deck' });
  }
});

// 5. Delete deck
app.delete('/api/decks/:id', async (req, res) => {
  const deckId = req.params.id;
  if (!/^[a-z0-9-]+$/.test(deckId)) {
    return res.status(400).json({ error: 'Invalid deck ID' });
  }
  const filePath = path.join(DECKS_DIR, `${deckId}.json`);

  try {
    await fs.unlink(filePath);
    res.json({ success: true, message: 'Deck deleted successfully' });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Deck not found' });
    }
    console.error(`Failed to delete deck ${deckId}:`, err);
    res.status(500).json({ error: 'Failed to delete deck file' });
  }
});// 5b. Enrich deck (LLM Bulk Generator)
const { GoogleGenAI } = require('@google/genai');

const LANG_NAMES = {
  it: 'italien',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
  fr: 'français',
  pt: 'portugais',
  ja: 'japonais',
  ru: 'russe'
};

// Concurrency-limited parallel execution helper
async function promiseAllLimit(limit, items, iteratorFn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    results.push(p);
    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

app.post('/api/decks/:id/enrich', async (req, res) => {
  const deckId = req.params.id;
  if (!/^[a-z0-9-]+$/.test(deckId)) {
    return res.status(400).json({ error: 'Invalid deck ID' });
  }
  const { translationLang, includeGrammar, includeCloze, apiKey } = req.body;

  // Initialize unified SDK client.
  // If user provided a key, use Gemini Developer API (AI Studio).
  // Otherwise, use Vertex AI with VM's default credentials (requires no key).
  let aiClient;
  try {
    if (apiKey) {
      aiClient = new GoogleGenAI({ apiKey: apiKey });
    } else {
      aiClient = new GoogleGenAI({
        vertexai: true,
        project: 'gen-lang-client-0670059811',
        location: 'us-central1'
      });
    }
  } catch (err) {
    return res.status(400).json({ error: `Failed to initialize Gemini Client: ${err.message}` });
  }

  const filePath = path.join(DECKS_DIR, `${deckId}.json`);
  if (!existsSync(filePath)) {
    return res.status(404).json({ error: 'Deck not found' });
  }

  try {
    const deckContent = await fs.readFile(filePath, 'utf8');
    const deck = JSON.parse(deckContent);
    const cards = deck.cards || [];

    if (cards.length === 0) {
      return res.json({ success: true, message: 'Deck has no cards to enrich.' });
    }

    const targetLangName = LANG_NAMES[deck.targetLang] || deck.targetLang || 'italien';
    const translationLangName = LANG_NAMES[translationLang] || translationLang || 'français';

    console.log(`Starting bulk enrichment for deck [${deckId}] (${cards.length} cards) to ${translationLangName} using Gemini 2.5 Flash...`);

    // We will batch cards to avoid token limits and speed up calls.
    const batchSize = 50;
    const idChanges = {}; // oldId -> newId

    // Prepare batches
    const batches = [];
    for (let i = 0; i < cards.length; i += batchSize) {
      batches.push({
        batchIndex: Math.floor(i / batchSize) + 1,
        cards: cards.slice(i, i + batchSize)
      });
    }

    const totalBatches = batches.length;
    console.log(`Starting parallel enrichment with concurrency limit of 2 for ${totalBatches} batches...`);

    // Run parallel batches with a concurrency limit of 2
    const results = await promiseAllLimit(2, batches, async (batchObj) => {
      const batch = batchObj.cards;
      const batchInputs = batch.map(c => ({
        index: c.index,
        originalPrompt: c.fr,
        target: c.target
      }));

      const grammarInstruction = includeGrammar
        ? `Provide the grammatical classification of the target word/phrase in ${translationLangName} (e.g. "nom féminin", "nom masculin", "verbe", "adjectif", "adverbe", "expression").`
        : 'Return null for this field.';

      const clozeInstruction = includeCloze
        ? `Provide a natural example sentence in the target language (${deck.targetLang}) containing the target word/phrase, where the target word/phrase itself is replaced with "----" (representing a hidden word). The sentence must be simple and illustrative.`
        : 'Return null for this field.';

      const prompt = `You are an expert language teacher.
Enrich the following list of vocabulary cards. The target language is ${targetLangName} (which is the correct expression/sentence to learn) and the translation language is ${translationLangName} (which will be shown as the prompt to the user).

Input cards:
${JSON.stringify(batchInputs)}

For each input card, return an object containing:
1. "translation": A correct, natural, standard translation of the target text into ${translationLangName}. Improve or replace the originalPrompt translation (which might be in English or poor quality).
2. "grammar": ${grammarInstruction}
3. "cloze": ${clozeInstruction}

Return ONLY a valid JSON array of objects matching this schema:
[{ "index": number, "translation": string, "grammar": string|null, "cloze": string|null }]`;

      let attempt = 0;
      let batchResults = null;
      while (attempt < 3 && !batchResults) {
        try {
          const response = await aiClient.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
              responseMimeType: 'application/json'
            }
          });
          batchResults = JSON.parse(response.text);
        } catch (err) {
          attempt++;
          console.warn(`Attempt ${attempt} failed for batch ${batchObj.batchIndex}: ${err.message}`);
          if (attempt >= 3) throw err;
          // Exponential backoff to allow quotas to reset
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      return { batch, batchResults };
    });

    // Apply all batch results to the original cards in-place
    results.forEach(({ batch, batchResults }) => {
      if (!batchResults) return;
      batchResults.forEach(resItem => {
        const card = batch.find(c => c.index === resItem.index);
        if (card) {
          const oldId = card.id;

          // Replace/improve French translation
          card.fr = resItem.translation.trim();
          
          // Generate new unique ID
          card.id = 'card_' + hashText(card.fr);
          idChanges[oldId] = card.id;

          if (includeGrammar && resItem.grammar) {
            card.grammatical = resItem.grammar.trim();
          } else {
            delete card.grammatical;
          }

          if (includeCloze && resItem.cloze) {
            card.cloze = resItem.cloze.trim();
          } else {
            delete card.cloze;
          }
        }
      });
    });

    // After updating all cards in deck, save it
    await fs.writeFile(filePath, JSON.stringify(deck, null, 2), 'utf8');

    // Update all sync progress files on server in-place
    if (existsSync(SYNC_DIR)) {
      const syncFiles = await fs.readdir(SYNC_DIR);
      for (const file of syncFiles) {
        if (!file.endsWith('.json')) continue;
        const syncPath = path.join(SYNC_DIR, file);
        try {
          const syncData = JSON.parse(await fs.readFile(syncPath, 'utf8'));
          if (syncData.decks && syncData.decks[deckId]) {
            const deckSync = syncData.decks[deckId];
            const oldProgress = deckSync.progress || {};
            const oldExcluded = deckSync.excluded || [];
            const newProgress = {};
            const newExcluded = new Set();

            Object.entries(oldProgress).forEach(([oldId, progVal]) => {
              const newId = idChanges[oldId];
              if (newId) {
                newProgress[newId] = progVal;
              } else {
                newProgress[oldId] = progVal;
              }
            });

            oldExcluded.forEach(oldId => {
              const newId = idChanges[oldId];
              if (newId) {
                newExcluded.add(newId);
              } else {
                newExcluded.add(oldId);
              }
            });

            deckSync.progress = newProgress;
            deckSync.excluded = Array.from(newExcluded);
            await fs.writeFile(syncPath, JSON.stringify(syncData, null, 2), 'utf8');
          }
        } catch (err) {
          console.error(`Failed to update sync file ${file}:`, err);
        }
      }
    }

    res.json({ success: true, idChanges });

  } catch (err) {
    console.error(`Bulk enrichment failed for deck ${deckId}:`, err);
    res.status(500).json({ error: `Bulk enrichment failed: ${err.message}` });
  }
});

// 5. Load progress (Sync)
app.get('/api/sync', async (req, res) => {
  const rawCode = req.query.code;
  if (!rawCode) {
    return res.status(400).json({ error: 'Sync code is required' });
  }

  const code = rawCode.trim().toLowerCase();
  if (code.length < 3) {
    return res.status(400).json({ error: 'Sync code must be at least 3 characters long' });
  }

  const filePath = path.join(SYNC_DIR, `${encodeURIComponent(code)}.json`);

  try {
    const syncContent = await fs.readFile(filePath, 'utf8');
    res.json(JSON.parse(syncContent));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Aucune donnée pour ce code' });
    }
    console.error(`Failed to read sync progress for ${code}:`, err);
    res.status(500).json({ error: 'Failed to read sync progress' });
  }
});

// Simple in-memory locking for sync files to prevent race conditions
const syncLocks = new Map();

async function acquireLock(code) {
  while (syncLocks.has(code)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  syncLocks.set(code, true);
}

function releaseLock(code) {
  syncLocks.delete(code);
}

// 6. Save progress (Sync) — merges one deck's progress into the stored file
app.post('/api/sync', async (req, res) => {
  const rawCode = req.query.code;
  if (!rawCode) {
    return res.status(400).json({ error: 'Sync code is required' });
  }

  const code = rawCode.trim().toLowerCase();
  if (code.length < 3) {
    return res.status(400).json({ error: 'Sync code must be at least 3 characters long' });
  }

  const { deckId, progress, excluded, aiSettings } = req.body;
  const hasDeckPayload = deckId && progress;
  const hasAiPayload = aiSettings && typeof aiSettings === 'object';
  if (!hasDeckPayload && !hasAiPayload) {
    return res.status(400).json({ error: 'deckId+progress or aiSettings is required' });
  }

  await acquireLock(code);

  try {
    const filePath = path.join(SYNC_DIR, `${encodeURIComponent(code)}.json`);

    // Load existing sync data (or start fresh)
    let syncData = { decks: {} };
    try {
      const existingContent = await fs.readFile(filePath, 'utf8');
      const existing = JSON.parse(existingContent);
      // Migrate legacy format (flat progress) to per-deck structure
      syncData = existing.decks ? existing : { decks: {} };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Sync file ${code} found but error reading:`, err.message);
      }
    }

    if (hasDeckPayload) {
      // Merge incoming deck progress card-by-card
      const stored = (syncData.decks[deckId] || {});
      const storedProgress = stored.progress || {};
      const merged = { ...storedProgress };

      for (const [cardId, incoming] of Object.entries(progress)) {
        const existing = merged[cardId];
        const incomingTime = incoming.lastModified || 0;
        const existingTime = existing ? (existing.lastModified || 0) : -1;

        if (!existing || incomingTime > existingTime || (incomingTime === existingTime && incoming.reps > existing.reps)) {
          merged[cardId] = incoming;
        }
      }

      syncData.decks[deckId] = {
        progress: merged,
        excluded: Array.isArray(excluded) ? excluded.filter(s => typeof s === 'string') : (stored.excluded || [])
      };
    }

    if (hasAiPayload) {
      // Last-write-wins merge, same pattern as card progress
      const storedAi = syncData.aiSettings || {};
      const incomingTime = aiSettings.lastModified || 0;
      const storedTime = storedAi.lastModified || 0;

      if (incomingTime >= storedTime) {
        syncData.aiSettings = {
          enabled: !!aiSettings.enabled,
          apiKey: typeof aiSettings.apiKey === 'string' ? aiSettings.apiKey : (storedAi.apiKey || ''),
          model: typeof aiSettings.model === 'string' ? aiSettings.model : (storedAi.model || ''),
          baseUrl: typeof aiSettings.baseUrl === 'string' ? aiSettings.baseUrl : (storedAi.baseUrl || ''),
          lang: typeof aiSettings.lang === 'string' ? aiSettings.lang : (storedAi.lang || ''),
          lastModified: incomingTime || Date.now()
        };
      }
    }

    syncData._savedAt = new Date().toISOString();

    await fs.writeFile(filePath, JSON.stringify(syncData, null, 2), 'utf8');
    res.json({ success: true, _savedAt: syncData._savedAt });
  } catch (err) {
    console.error(`Failed to save sync progress for ${code}:`, err);
    res.status(500).json({ error: 'Failed to save sync progress' });
  } finally {
    releaseLock(code);
  }
});

// Catch-all for routing (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
