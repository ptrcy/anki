/**
 * Pre-generates all audio files for every card in every deck.
 * Run once from the project root: node generate-audio.js
 * Skips files that already exist. Safe to re-run.
 */

const fs = require('fs');
const path = require('path');
const { synthesizeText } = require('./tts-helper');

const DECKS_DIR  = path.join(__dirname, 'data', 'decks');
const AUDIO_DIR  = path.join(__dirname, 'public', 'audio');

// Same DJB2 algorithm as app.js hashText()
function hashText(text) {
  let hash = 5381;
  const s = (text || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
  }
  return Math.abs(hash & hash).toString(36);
}

async function main() {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const deckFiles = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));

  // Collect all (cardId, target, targetLang, filename) tuples across all decks,
  // deduplicating by filename so the same audio isn't synthesized twice.
  const seen = new Set();
  const jobs = [];

  for (const file of deckFiles) {
    const deck = JSON.parse(fs.readFileSync(path.join(DECKS_DIR, file), 'utf8'));
    const lang = deck.targetLang || 'it';

    for (const card of deck.cards) {
      const filename = `${card.id}_${hashText(card.target)}.mp3`;
      if (seen.has(filename)) continue;
      seen.add(filename);
      jobs.push({ filename, text: card.target, lang, deck: file.replace('.json', '') });
    }
  }

  const total   = jobs.length;
  const toGen   = jobs.filter(j => !fs.existsSync(path.join(AUDIO_DIR, j.filename)));
  const skipped = total - toGen.length;

  console.log(`Total cards : ${total}`);
  console.log(`Already cached : ${skipped}`);
  console.log(`To generate    : ${toGen.length}`);
  if (toGen.length === 0) { console.log('Nothing to do.'); return; }
  console.log('');

  let done = 0, errors = 0;
  const CONCURRENCY = 5; // parallel TTS requests

  for (let i = 0; i < toGen.length; i += CONCURRENCY) {
    const batch = toGen.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async ({ filename, text, lang, deck }) => {
      const outPath = path.join(AUDIO_DIR, filename);
      const ok = await synthesizeText(text, lang, outPath);
      done++;
      if (ok) {
        process.stdout.write(`\r[${done}/${toGen.length}] ✓ ${filename}   `);
      } else {
        errors++;
        console.error(`\n✗ failed: ${filename} (${deck})`);
      }
    }));
  }

  console.log(`\n\nDone. Generated: ${done - errors}  Errors: ${errors}`);
}

main().catch(err => { console.error(err); process.exit(1); });
