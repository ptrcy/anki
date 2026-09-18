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

// In-flight deduplication for on-demand audio generation
const pendingAudioGenerations = new Map();

// Strict FIFO queue per sync code to serialize writes and prevent race conditions / file clobbering
const syncQueues = new Map();

function enqueueSync(code, task) {
  const lastTask = syncQueues.get(code) || Promise.resolve();
  const nextTask = lastTask.then(() => task(), () => task());
  syncQueues.set(code, nextTask);
  nextTask.finally(() => {
    if (syncQueues.get(code) === nextTask) {
      syncQueues.delete(code);
    }
  });
  return nextTask;
}

// In-memory locking compatibility helpers
const syncLocks = new Map();

async function acquireLock(code, timeoutMs = 10000) {
  const start = Date.now();
  while (syncLocks.has(code)) {
    if (Date.now() - start > timeoutMs) {
      console.warn(`Sync lock timed out for code ${code} after ${timeoutMs}ms, breaking lock`);
      syncLocks.delete(code);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  syncLocks.set(code, Date.now());
}

function releaseLock(code) {
  syncLocks.delete(code);
}


// On-demand Audio Middleware
app.get('/audio/:filename', async (req, res, next) => {
  const { filename } = req.params;
  if (!filename || typeof filename !== 'string') return next();

  // Strict filename validation upfront to prevent path traversal
  const match = filename.match(/^(card_[a-z0-9]+)_([a-z0-9]+)_([a-z]{2})\.mp3$/i);
  if (!match) {
    if (!/^[a-zA-Z0-9_-]+\.mp3$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid audio filename format' });
    }
  }

  const safeFilename = path.basename(filename);
  const filePath = path.join(AUDIO_DIR, safeFilename);
  
  // If file exists, let express.static handle it
  if (existsSync(filePath)) {
    return next();
  }

  if (!match) {
    return res.status(404).json({ error: 'Audio file not found' });
  }

  // Deduplicate concurrent requests for the same missing audio file
  let genPromise = pendingAudioGenerations.get(safeFilename);
  if (!genPromise) {
    genPromise = (async () => {
      console.log(`Generating on-demand audio for: ${safeFilename}`);
      const [, cardId, targetHash, targetLang] = match;

      const deckFiles = await fs.readdir(DECKS_DIR);
      let cardText = null;

      // Find the card whose fr-hash matches cardId, target-hash matches targetHash, and deck language matches targetLang.
      for (const file of deckFiles) {
        if (!file.endsWith('.json')) continue;
        const deck = JSON.parse(await fs.readFile(path.join(DECKS_DIR, file), 'utf8'));
        if (!deck || !deck.targetLang || deck.targetLang.toLowerCase() !== targetLang.toLowerCase()) continue;
        if (!Array.isArray(deck.cards)) continue;
        const card = deck.cards.find(c => c && c.id === cardId && hashText(c.target) === targetHash);
        if (card) {
          cardText = card.target;
          break;
        }
      }

      if (cardText) {
        return await synthesizeText(cardText, targetLang, filePath);
      }
      return false;
    })();

    pendingAudioGenerations.set(safeFilename, genPromise);
    genPromise.finally(() => {
      pendingAudioGenerations.delete(safeFilename);
    });
  }

  try {
    const success = await genPromise;
    if (success && existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    return res.status(404).json({ error: 'Audio not found and could not be generated' });
  } catch (err) {
    console.error('On-demand audio error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Audio generation failed' });
    }
    next(err);
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
});// 5b. Enrich deck (LLM Bulk Generator - OpenAI-compatible API)
const OpenAI = require('openai');

function unwrapArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && parsed !== null) {
    const arr = Object.values(parsed).find(v => Array.isArray(v));
    if (arr) return arr;
  }
  return [parsed];
}

function extractJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response from AI model');
  }
  let s = rawText.trim();
  const codeBlockMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    s = codeBlockMatch[1].trim();
  }

  try {
    return unwrapArray(JSON.parse(s));
  } catch (e) {
    const firstArr = s.indexOf('[');
    const lastArr = s.lastIndexOf(']');
    if (firstArr !== -1 && lastArr > firstArr) {
      try {
        return unwrapArray(JSON.parse(s.slice(firstArr, lastArr + 1)));
      } catch (e2) {}
    }
    const firstObj = s.indexOf('{');
    const lastObj = s.lastIndexOf('}');
    if (firstObj !== -1 && lastObj > firstObj) {
      try {
        return unwrapArray(JSON.parse(s.slice(firstObj, lastObj + 1)));
      } catch (e3) {}
    }
    throw new Error(`Invalid JSON returned by model: ${e.message}`);
  }
}

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
    p.catch(() => {}); // prevent unhandled rejection during queue processing
    if (limit <= items.length) {
      const e = p.then(
        () => executing.splice(executing.indexOf(e), 1),
        () => executing.splice(executing.indexOf(e), 1)
      );
      executing.push(e);
      if (executing.length >= limit) {
        await Promise.race(executing).catch(() => {});
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
  const { translationLang, includeGrammar, includeCloze, apiKey, baseUrl, model } = req.body;

  // Resolve OpenAI-compatible API parameters (OpenRouter, OpenAI, Groq, local, etc.)
  const resolvedApiKey = (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '')
    ? apiKey.trim()
    : (process.env.ENRICH_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '');

  if (!resolvedApiKey) {
    return res.status(400).json({ error: 'Clé API requise pour enrichir le deck. Veuillez la renseigner dans la fenêtre d\'enrichissement.' });
  }

  const rawBaseUrl = (baseUrl && typeof baseUrl === 'string' && baseUrl.trim() !== '')
    ? baseUrl.trim()
    : (process.env.ENRICH_BASE_URL || process.env.OPENROUTER_BASE_URL || process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1');

  // Strip trailing slashes and /chat/completions if the user entered the endpoint path
  const cleanBaseUrl = rawBaseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');

  const resolvedModel = (model && typeof model === 'string' && model.trim() !== '')
    ? model.trim()
    : (process.env.ENRICH_MODEL || process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'google/gemini-2.5-flash');

  let aiClient;
  try {
    aiClient = new OpenAI({
      apiKey: resolvedApiKey,
      baseURL: cleanBaseUrl,
      defaultHeaders: {
        'X-Title': 'Anki Trainer Hub Deck Enrichment',
        'HTTP-Referer': 'https://github.com/ptrcy/anki'
      }
    });
  } catch (err) {
    return res.status(400).json({ error: `Failed to initialize OpenAI Client: ${err.message}` });
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

    console.log(`Starting bulk enrichment for deck [${deckId}] (${cards.length} cards) to ${translationLangName} using model "${resolvedModel}" at ${cleanBaseUrl}...`);

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
          const response = await aiClient.chat.completions.create({
            model: resolvedModel,
            messages: [
              {
                role: 'system',
                content: 'You are an expert language teacher and translator. You strictly output valid JSON without any conversation or commentary.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 4096
          });

          const content = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
          if (!content) throw new Error('Empty response from model');
          batchResults = extractJson(content);
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

    // Backup existing deck before updating
    const backupDir = path.join(DATA_DIR, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
    try {
      await fs.mkdir(backupDir, { recursive: true });
      await fs.copyFile(filePath, path.join(backupDir, `${deckId}.json`));
    } catch (bckErr) {
      console.warn(`Could not create backup for ${deckId}:`, bckErr.message);
    }

    // After updating all cards in deck, save it
    await fs.writeFile(filePath, JSON.stringify(deck, null, 2), 'utf8');

    // Update all sync progress files on server in-place serialized by sync queue
    if (existsSync(SYNC_DIR)) {
      const syncFiles = await fs.readdir(SYNC_DIR);
      for (const file of syncFiles) {
        if (!file.endsWith('.json')) continue;
        let code = file.slice(0, -5);
        try {
          code = decodeURIComponent(code);
        } catch {
          // ignore URI decode error
        }

        await enqueueSync(code, async () => {
          try {
            const syncPath = path.join(SYNC_DIR, file);
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
        });
      }
    }

    res.json({ success: true, idChanges });

  } catch (err) {
    console.error(`Bulk enrichment failed for deck ${deckId}:`, err);
    res.status(500).json({ error: `Bulk enrichment failed: ${err.message}` });
  }
});

// Rate limiting and brute-force protection for /api/sync
const syncRateLimits = new Map(); // ip -> { requests: [timestamps], blockedUntil: 0, failed404s: 0 }

function checkSyncRateLimit(req, res) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = syncRateLimits.get(ip);
  if (!entry) {
    entry = { requests: [], blockedUntil: 0, failed404s: 0 };
    syncRateLimits.set(ip, entry);
  }

  // Check if IP is currently blocked
  if (entry.blockedUntil > now) {
    const waitSec = Math.ceil((entry.blockedUntil - now) / 1000);
    res.status(429).json({ error: `Trop de requêtes. Réessayez dans ${waitSec}s.` });
    return false;
  }

  // Window: 60s
  entry.requests = entry.requests.filter(t => now - t < 60000);
  if (entry.requests.length >= 40) {
    entry.blockedUntil = now + 60000;
    res.status(429).json({ error: 'Limite de requêtes atteinte (max 40/min). Réessayez dans 1 minute.' });
    return false;
  }

  entry.requests.push(now);
  return true;
}

function recordSync404(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const entry = syncRateLimits.get(ip);
  if (entry) {
    entry.failed404s = (entry.failed404s || 0) + 1;
    if (entry.failed404s >= 10) {
      entry.blockedUntil = Date.now() + 15 * 60 * 1000; // 15m lockout on brute-force probe
      console.warn(`Blocked IP ${ip} for 15m due to repeated 404 sync probes`);
    }
  }
}

function recordSyncSuccess(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const entry = syncRateLimits.get(ip);
  if (entry) {
    entry.failed404s = 0;
  }
}

const SAFE_SYNC_CODE_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeSyncCode(rawCode) {
  if (typeof rawCode !== 'string') return null;
  const code = rawCode.trim().toLowerCase();
  if (!SAFE_SYNC_CODE_REGEX.test(code)) return null;
  if (FORBIDDEN_KEYS.has(code)) return null;
  return code;
}

// 5. Load progress (Sync)
app.get('/api/sync', async (req, res) => {
  if (!checkSyncRateLimit(req, res)) return;

  const code = sanitizeSyncCode(req.query.code);
  if (!code) {
    return res.status(400).json({ error: 'Sync code invalide (3-64 caractères alphanumériques)' });
  }

  const filePath = path.join(SYNC_DIR, `${encodeURIComponent(code)}.json`);

  try {
    const syncContent = await fs.readFile(filePath, 'utf8');
    const syncData = JSON.parse(syncContent);
    recordSyncSuccess(req);
    res.json(syncData);
  } catch (err) {
    if (err.code === 'ENOENT') {
      recordSync404(req);
      return res.status(404).json({ error: 'Aucune donnée pour ce code' });
    }
    console.error(`Failed to read sync progress for ${code}:`, err);
    res.status(500).json({ error: 'Failed to read sync progress' });
  }
});

// 6. Save progress (Sync) — merges one deck's progress into the stored file
app.post('/api/sync', async (req, res) => {
  if (!checkSyncRateLimit(req, res)) return;

  const code = sanitizeSyncCode(req.query.code);
  if (!code) {
    return res.status(400).json({ error: 'Sync code invalide (3-64 caractères alphanumériques)' });
  }

  const { deckId, progress, excluded, aiSettings } = req.body;
  const hasDeckPayload = deckId && progress && typeof progress === 'object';
  const hasAiPayload = aiSettings && typeof aiSettings === 'object';
  if (!hasDeckPayload && !hasAiPayload) {
    return res.status(400).json({ error: 'deckId+progress or aiSettings is required' });
  }

  // Security (Finding #3): Prototype pollution prevention and input validation
  const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,120}$/;
  if (hasDeckPayload) {
    if (typeof deckId !== 'string' || !SAFE_ID_REGEX.test(deckId) || FORBIDDEN_KEYS.has(deckId)) {
      return res.status(400).json({ error: 'deckId invalide' });
    }
  }

  return enqueueSync(code, async () => {
    try {
      const filePath = path.join(SYNC_DIR, `${encodeURIComponent(code)}.json`);

      // Load existing sync data (or start fresh)
      let syncData = { decks: {} };
      try {
        const existingContent = await fs.readFile(filePath, 'utf8');
        const existing = JSON.parse(existingContent);
        syncData = existing && typeof existing.decks === 'object' ? existing : { decks: {} };
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn(`Sync file ${code} found but error reading:`, err.message);
        }
      }

      if (hasDeckPayload) {
        const stored = (syncData.decks && syncData.decks[deckId]) || {};
        const storedProgress = stored.progress || {};
        const merged = Object.create(null);
        Object.assign(merged, storedProgress);

        for (const [cardId, incoming] of Object.entries(progress)) {
          if (!SAFE_ID_REGEX.test(cardId) || FORBIDDEN_KEYS.has(cardId)) continue;
          if (!incoming || typeof incoming !== 'object') continue;

          const existing = merged[cardId];
          const incomingTime = incoming.lastModified || 0;
          const existingTime = existing ? (existing.lastModified || 0) : -1;

          if (!existing || incomingTime > existingTime || (incomingTime === existingTime && incoming.reps > existing.reps)) {
            merged[cardId] = incoming;
          }
        }

        const incomingExcluded = Array.isArray(excluded) ? excluded.filter(s => typeof s === 'string' && SAFE_ID_REGEX.test(s) && !FORBIDDEN_KEYS.has(s)) : [];
        const storedExcluded = Array.isArray(stored.excluded) ? stored.excluded.filter(s => typeof s === 'string' && !FORBIDDEN_KEYS.has(s)) : [];
        const mergedExcluded = Array.from(new Set([...storedExcluded, ...incomingExcluded]));

        if (!syncData.decks) syncData.decks = {};
        syncData.decks[deckId] = {
          progress: { ...merged },
          excluded: mergedExcluded
        };
      }

      if (hasAiPayload) {
        const storedAi = syncData.aiSettings || {};
        const incomingTime = aiSettings.lastModified || 0;
        const storedTime = storedAi.lastModified || 0;

        if (incomingTime >= storedTime || (!storedTime && (aiSettings.apiKey || aiSettings.enabled))) {
          let incomingKey = typeof aiSettings.apiKey === 'string' ? aiSettings.apiKey : '';
          const shouldClearKey = aiSettings.clearKey === true;
          const resolvedKey = shouldClearKey ? '' : (incomingKey || storedAi.apiKey || '');
          const resolvedTime = incomingTime || Date.now();
          syncData.aiSettings = {
            enabled: !!aiSettings.enabled,
            apiKey: resolvedKey,
            model: typeof aiSettings.model === 'string' ? aiSettings.model.slice(0, 100) : (storedAi.model || ''),
            baseUrl: typeof aiSettings.baseUrl === 'string' ? aiSettings.baseUrl.slice(0, 200) : (storedAi.baseUrl || ''),
            lang: typeof aiSettings.lang === 'string' ? aiSettings.lang.slice(0, 10) : (storedAi.lang || ''),
            lastModified: resolvedTime
          };
        }
      }

      syncData._savedAt = new Date().toISOString();

      await fs.writeFile(filePath, JSON.stringify(syncData, null, 2), 'utf8');
      recordSyncSuccess(req);
      res.json({ success: true, _savedAt: syncData._savedAt });
    } catch (err) {
      console.error(`Failed to save sync progress for ${code}:`, err);
      res.status(500).json({ error: 'Failed to save sync progress' });
    }
  });
});

// Catch-all for routing (SPA fallback) - only for non-API, non-audio routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/audio/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (!res.headersSent) {
    if (req.path.startsWith('/api/') || req.path.startsWith('/audio/')) {
      return res.status(500).json({ error: err.message || 'Internal server error' });
    }
    return res.status(500).send('Internal server error');
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
