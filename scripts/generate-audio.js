#!/usr/bin/env node
/**
 * Generates WaveNet MP3 audio for every card in every deck.
 * Output: public/audio/{cardId}.mp3
 * Idempotent — skips files that already exist.
 */

// Use environment variable or default relative path for VPS compatibility
process.env.GOOGLE_APPLICATION_CREDENTIALS = 
  process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../google-key.json');

const { synthesizeText } = require('../tts-helper');
const fs = require('fs');
const path = require('path');

const DECKS_DIR  = path.join(__dirname, '../data/decks');
const AUDIO_DIR  = path.join(__dirname, '../public/audio');
const CONCURRENCY = 8;
const BATCH_DELAY_MS = 1000; // pause between batches to stay under quota

const VOICE_MAP = {
  it: { languageCode: 'it-IT', name: 'it-IT-Wavenet-B' },
  en: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
  es: { languageCode: 'es-ES', name: 'es-ES-Wavenet-C' },
  de: { languageCode: 'de-DE', name: 'de-DE-Wavenet-F' },
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-C' },
  pt: { languageCode: 'pt-PT', name: 'pt-PT-Wavenet-A' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-A' },
  ru: { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-A' },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function synthesize(card, voice, attempt = 0) {
  const outPath = path.join(AUDIO_DIR, `${card.id}.mp3`);
  if (fs.existsSync(outPath)) return 'skipped';

  try {
    const [response] = await client.synthesizeSpeech({
      input: { text: card.target },
      voice,
      audioConfig: { audioEncoding: 'MP3' },
    });
    fs.writeFileSync(outPath, response.audioContent, 'binary');
    return 'generated';
  } catch (err) {
    const isRateLimit = err.code === 8 || (err.message && err.message.includes('RESOURCE_EXHAUSTED'));
    if (isRateLimit && attempt < 5) {
      const delay = (attempt + 1) * 3000;
      await sleep(delay);
      return synthesize(card, voice, attempt + 1);
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
    const deck = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, file), 'utf8'));
    const voice = VOICE_MAP[deck.targetLang] || VOICE_MAP.it;

    // Skip obvious CSV header cards (single uppercase word in target)
    const cards = deck.cards.filter(c => c.target && c.target.trim().length > 3);

    console.log(`\n[${file}] ${cards.length} cards — voice: ${voice.name}`);

    for (let i = 0; i < cards.length; i += CONCURRENCY) {
      const batch = cards.slice(i, i + CONCURRENCY);
      const tasks = batch.map(card => async () => {
        try {
          return await synthesize(card, voice);
        } catch (err) {
          console.error(`  ERROR ${card.id} "${card.target.slice(0, 40)}": ${err.message}`);
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
