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
    // Filename format: "${hash(fr)}_${hash(target)}.mp3" (e.g. "card_abc_xyz.mp3")
    const nameWithoutExt = filename.replace('.mp3', '');
    const match = nameWithoutExt.match(/^(card_[a-z0-9]+)_([a-z0-9]+)$/);
    if (!match) {
      return res.status(404).send('Invalid audio filename format');
    }
    const [, cardId, targetHash] = match;

    const deckFiles = await fs.readdir(DECKS_DIR);
    let cardText = null;
    let targetLang = 'it';

    // Find the card whose fr-hash matches cardId and target-hash matches targetHash.
    // This uniquely identifies the exact target text and its language.
    for (const file of deckFiles) {
      if (!file.endsWith('.json')) continue;
      const deck = JSON.parse(await fs.readFile(path.join(DECKS_DIR, file), 'utf8'));
      const card = deck.cards.find(c => c.id === cardId && hashText(c.target) === targetHash);
      if (card) {
        cardText = card.target;
        targetLang = deck.targetLang;
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

  const { deckId, progress, excluded } = req.body;
  if (!deckId || !progress) {
    return res.status(400).json({ error: 'deckId and progress are required' });
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
