const fs = require('fs');
const path = require('path');

function hashText(text) {
  let hash = 5381;
  const s = (text || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
  }
  return Math.abs(hash & hash).toString(36);
}

function getExpectedCardId(frText) {
  return 'card_' + hashText(frText);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const DECKS_DIR = path.join(DATA_DIR, 'decks');
const SYNC_DIR = path.join(DATA_DIR, 'sync');

console.log('=== Starting DB Validation ===\n');

// 1. Validate Decks
const decks = {};
if (fs.existsSync(DECKS_DIR)) {
  const deckFiles = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${deckFiles.length} deck files.`);

  deckFiles.forEach(file => {
    const filePath = path.join(DECKS_DIR, file);
    const deckId = path.basename(file, '.json');
    let deckErrors = 0;
    let deckWarnings = 0;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      decks[deckId] = data;

      if (!data.name) {
        console.warn(`[WARN] Deck [${deckId}]: Missing deck name`);
        deckWarnings++;
      }
      if (!data.targetLang) {
        console.warn(`[WARN] Deck [${deckId}]: Missing deck targetLang`);
        deckWarnings++;
      }
      
      if (!Array.isArray(data.cards)) {
        console.error(`[ERROR] Deck [${deckId}]: cards is not an array`);
        return;
      }

      const cardIds = new Set();
      const cardFrs = new Set();

      data.cards.forEach((card, idx) => {
        if (!card.fr || !card.target) {
          console.error(`[ERROR] Deck [${deckId}] Card #${idx}: missing fr or target:`, card);
          deckErrors++;
          return;
        }

        const expectedId = getExpectedCardId(card.fr);
        if (card.id !== expectedId) {
          console.error(`[ERROR] Deck [${deckId}] Card #${idx}: ID mismatch! Got: "${card.id}", Expected: "${expectedId}" (fr: "${card.fr}")`);
          deckErrors++;
        }

        if (cardIds.has(card.id)) {
          console.error(`[ERROR] Deck [${deckId}] Card #${idx}: Duplicate ID detected: "${card.id}" (fr: "${card.fr}")`);
          deckErrors++;
        }
        cardIds.add(card.id);

        const frNormalized = card.fr.trim().toLowerCase();
        if (cardFrs.has(frNormalized)) {
          console.warn(`[WARN] Deck [${deckId}] Card #${idx}: Duplicate French text: "${card.fr}"`);
          deckWarnings++;
        }
        cardFrs.add(frNormalized);
      });

      if (deckErrors > 0 || deckWarnings > 0) {
        console.log(`Deck [${deckId}]: Completed with ${deckErrors} errors, ${deckWarnings} warnings.\n`);
      }

    } catch (err) {
      console.error(`[FATAL] Deck [${deckId}]: Error reading/parsing deck: ${err.message}`);
    }
  });
} else {
  console.error('Decks directory not found!');
}

// 2. Validate Sync Files
if (fs.existsSync(SYNC_DIR)) {
  const syncFiles = fs.readdirSync(SYNC_DIR).filter(f => f.endsWith('.json'));
  console.log(`\nFound ${syncFiles.length} sync files.`);

  syncFiles.forEach(file => {
    const filePath = path.join(SYNC_DIR, file);
    const syncCode = decodeURIComponent(path.basename(file, '.json'));
    let syncErrors = 0;
    let syncWarnings = 0;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      if (!data.decks) {
        console.warn(`[WARN] Sync [${syncCode}]: Legacy or invalid sync format (no decks object)`);
        return;
      }

      Object.entries(data.decks).forEach(([deckId, deckSync]) => {
        const deck = decks[deckId];
        if (!deck) {
          console.warn(`[WARN] Sync [${syncCode}] Deck [${deckId}]: References non-existent deck`);
          syncWarnings++;
        }

        const progress = deckSync.progress || {};
        const excluded = deckSync.excluded || [];

        // Check each progress item
        Object.entries(progress).forEach(([cardId, cardProg]) => {
          if (deck) {
            const cardExists = deck.cards.some(c => c.id === cardId);
            if (!cardExists) {
              console.warn(`[WARN] Sync [${syncCode}] Deck [${deckId}]: Progress for cardId "${cardId}" references non-existent card`);
              syncWarnings++;
            }
          }

          // Check progress values
          if (typeof cardProg.ease !== 'number' || isNaN(cardProg.ease)) {
            console.error(`[ERROR] Sync [${syncCode}] Deck [${deckId}]: Card "${cardId}" has invalid ease:`, cardProg.ease);
            syncErrors++;
          }
          if (typeof cardProg.interval !== 'number' || isNaN(cardProg.interval)) {
            console.error(`[ERROR] Sync [${syncCode}] Deck [${deckId}]: Card "${cardId}" has invalid interval:`, cardProg.interval);
            syncErrors++;
          }
          if (typeof cardProg.dueAt !== 'number' || isNaN(cardProg.dueAt)) {
            console.error(`[ERROR] Sync [${syncCode}] Deck [${deckId}]: Card "${cardId}" has invalid dueAt:`, cardProg.dueAt);
            syncErrors++;
          }
        });

        // Check excluded items
        excluded.forEach(cardId => {
          if (deck) {
            const cardExists = deck.cards.some(c => c.id === cardId);
            if (!cardExists) {
              console.warn(`[WARN] Sync [${syncCode}] Deck [${deckId}]: Excluded cardId "${cardId}" does not exist in deck`);
              syncWarnings++;
            }
          }
        });
      });

      if (syncErrors > 0 || syncWarnings > 0) {
        console.log(`Sync [${syncCode}]: Completed with ${syncErrors} errors, ${syncWarnings} warnings.\n`);
      }

    } catch (err) {
      console.error(`[FATAL] Sync [${syncCode}]: Error reading/parsing sync file: ${err.message}`);
    }
  });
} else {
  console.error('Sync directory not found!');
}

console.log('\n=== DB Validation Completed ===');
