#!/usr/bin/env node
/**
 * Generates WaveNet MP3 audio for every card in every deck.
 * Output: public/audio/{cardId}.mp3
 * Idempotent — skips files that already exist.
 */

const fs = require('fs');
const path = require('path');

// Use environment variable or default relative path for VPS compatibility
process.env.GOOGLE_APPLICATION_CREDENTIALS = 
  process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../google-key.json');

const { synthesizeText, VOICE_MAP } = require('../tts-helper');

const DECKS_DIR  = path.join(__dirname, '../data/decks');
const AUDIO_DIR  = path.join(__dirname, '../public/audio');
const CONCURRENCY = 8;
const BATCH_DELAY_MS = 1000; // pause between batches to stay under quota

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function synthesize(card, lang, attempt = 0) {
  const safeCardId = String(card.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeCardId) return 'error';

  const outPath = path.join(AUDIO_DIR, `${safeCardId}.mp3`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return 'skipped';

  try {
    const success = await synthesizeText(card.target, lang, outPath);
    if (!success) throw new Error('synthesizeText failed');
    return 'generated';
  } catch (err) {
    const isRateLimit = err.code === 8 || (err.message && err.message.includes('RESOURCE_EXHAUSTED'));
    if (isRateLimit && attempt < 5) {
      const delay = (attempt + 1) * 3000;
      await sleep(delay);
      return synthesize(card, lang, attempt + 1);
    }
    throw err;
  }
}

async function runBatch(tasks) {
  return Promise.all(tasks.map(t => t()));
}

async function main() {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const deckFiles = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));

  let totalGenerated = 0;
  let totalSkipped   = 0;
  let totalErrors    = 0;

  for (const file of deckFiles) {
    let deck;
    try {
      deck = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, file), 'utf8'));
    } catch (e) {
      console.error(`Skipping invalid JSON deck file ${file}:`, e.message);
      continue;
    }

    const lang = (deck.targetLang || 'it').toLowerCase();
    const voice = VOICE_MAP[lang] || VOICE_MAP.it;

    // Filter valid cards with non-empty targets
    const cards = (deck.cards || []).filter(c => c && typeof c.target === 'string' && c.target.trim().length > 0);

    console.log(`\n[${file}] ${cards.length} cards — voice: ${voice.name}`);

    for (let i = 0; i < cards.length; i += CONCURRENCY) {
      const batch = cards.slice(i, i + CONCURRENCY);
      const tasks = batch.map(card => async () => {
        try {
          return await synthesize(card, lang);
        } catch (err) {
          console.error(`  ERROR ${card.id} "${String(card.target).slice(0, 40)}": ${err.message}`);
          return 'error';
        }
      });

      const results = await runBatch(tasks);
      const generated = results.filter(r => r === 'generated').length;
      const skipped   = results.filter(r => r === 'skipped').length;
      const errors    = results.filter(r => r === 'error').length;

      totalGenerated += generated;
      totalSkipped   += skipped;
      totalErrors    += errors;

      const done = Math.min(i + CONCURRENCY, cards.length);
      process.stdout.write(`  ${done}/${cards.length} — +${generated} generated, ${skipped} skipped, ${errors} errors\n`);

      if (i + CONCURRENCY < cards.length) await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`\nDone. Generated: ${totalGenerated} | Skipped: ${totalSkipped} | Errors: ${totalErrors}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
