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

// Load all decks first
const deckFiles = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));
const decks = {};
deckFiles.forEach(file => {
  const filePath = path.join(DECKS_DIR, file);
  decks[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
});

// We will track the ID mappings for sync files: { [deckId]: { [oldId]: Set([newIds]) } }
const idMappings = {};

// 1. Specific Fixes for tds-it
if (decks['tds-it']) {
  console.log('Applying specific fixes to tds-it...');
  const deck = decks['tds-it'];

  // Apply fixes card by card based on original index values
  const originalCards = deck.cards;
  const fixedCards = [];

  const frenchConjugations = {
    'apre': 'il/elle ouvre',
    'parte': 'il/elle part',
    'si diverte': "il/elle s'amuse",
    'apriamo': 'nous ouvrons',
    'partiamo': 'nous partons',
    'ci divertiamo': 'nous nous amusons',
    'aprite': 'vous ouvrez',
    'partite': 'vous partez',
    'vi divertite': 'vous vous amusez',
    'aprono': 'ils/elles ouvrent',
    'partono': 'ils/elles partent',
    'si divertono': "ils/elles s'amusent"
  };

  originalCards.forEach(card => {
    const idx = card.index;

    // Remove the duplicate block 837 to 867
    if (idx >= 837 && idx <= 867) {
      return; // Skip/delete
    }

    const newCard = { ...card };

    // Swap reversed cards 805 to 816
    if (idx >= 805 && idx <= 816) {
      const temp = newCard.fr;
      newCard.fr = newCard.target;
      newCard.target = temp;
    }
    // Fix conjugation cards 817 to 828
    else if (idx >= 817 && idx <= 828) {
      const italianVerb = newCard.fr; // e.g. 'apre'
      const frenchTranslation = frenchConjugations[italianVerb];
      if (frenchTranslation) {
        newCard.fr = frenchTranslation;
        newCard.target = italianVerb;
      }
    }
    // Swap reversed cards 829 to 836
    else if (idx >= 829 && idx <= 836) {
      const temp = newCard.fr;
      newCard.fr = newCard.target;
      newCard.target = temp;
    }
    // Fix translations for 774 and 775
    else if (idx === 774) {
      newCard.target = 'Sono felice';
    }
    else if (idx === 775) {
      newCard.target = 'Piacere';
    }

    fixedCards.push(newCard);
  });

  deck.cards = fixedCards;
}

// 2. General Clean & Split for all decks
Object.entries(decks).forEach(([deckId, deck]) => {
  console.log(`\nCleaning and deduplicating deck [${deckId}]...`);
  const cards = deck.cards;
  const oldCardCount = cards.length;

  // Group cards by normalized French text
  const groups = {};
  cards.forEach(card => {
    const normFr = card.fr.trim().toLowerCase();
    if (!groups[normFr]) groups[normFr] = [];
    groups[normFr].push(card);
  });

  const finalCards = [];
  const deckMappings = {}; // oldId -> Set of newIds

  Object.values(groups).forEach(group => {
    // Within each group, deduplicate by normalized target text
    const uniqueInGroup = [];
    const seenTargets = new Set();

    group.forEach(card => {
      const normTarget = card.target.trim().toLowerCase();
      if (!seenTargets.has(normTarget)) {
        seenTargets.add(normTarget);
        uniqueInGroup.push(card);
      } else {
        // This is an exact duplicate, it will be discarded.
        // We still map its old ID to the survivor's ID.
        const survivor = uniqueInGroup.find(c => c.target.trim().toLowerCase() === normTarget);
        const oldId = card.id;
        const newId = getExpectedCardId(survivor.fr);
        if (!deckMappings[oldId]) deckMappings[oldId] = new Set();
        deckMappings[oldId].add(newId);
      }
    });

    // If there are multiple different translations for the same French text, make them unique
    if (uniqueInGroup.length > 1) {
      uniqueInGroup.forEach((card, i) => {
        const oldId = card.id;
        // Append counter to make fr unique
        card.fr = `${card.fr} (${i + 1})`;
        card.id = getExpectedCardId(card.fr);

        if (!deckMappings[oldId]) deckMappings[oldId] = new Set();
        deckMappings[oldId].add(card.id);
      });
    } else {
      // Just one card in group, update its ID if French text changed (due to trimming, etc.)
      const card = uniqueInGroup[0];
      const oldId = card.id;
      card.id = getExpectedCardId(card.fr);

      if (!deckMappings[oldId]) deckMappings[oldId] = new Set();
      deckMappings[oldId].add(card.id);
    }

    finalCards.push(...uniqueInGroup);
  });

  // Re-assign indices
  finalCards.forEach((card, idx) => {
    card.index = idx + 1;
  });

  deck.cards = finalCards;
  idMappings[deckId] = deckMappings;

  console.log(`  Cards: ${oldCardCount} -> ${deck.cards.length}`);
});

// Write fixed decks back
Object.entries(decks).forEach(([deckId, deck]) => {
  const filePath = path.join(DECKS_DIR, `${deckId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(deck, null, 2), 'utf8');
});

// 3. Fix Sync Files
if (fs.existsSync(SYNC_DIR)) {
  const syncFiles = fs.readdirSync(SYNC_DIR).filter(f => f.endsWith('.json'));
  console.log(`\nUpdating ${syncFiles.length} sync files...`);

  syncFiles.forEach(file => {
    const filePath = path.join(SYNC_DIR, file);
    const syncCode = decodeURIComponent(path.basename(file, '.json'));
    console.log(`  Updating Sync [${syncCode}]...`);

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!data.decks) return;

      Object.entries(data.decks).forEach(([deckId, deckSync]) => {
        const deck = decks[deckId];
        const mappings = idMappings[deckId] || {};

        const oldProgress = deckSync.progress || {};
        const oldExcluded = deckSync.excluded || [];

        const newProgress = {};
        const newExcluded = new Set();

        // Update progress keys
        Object.entries(oldProgress).forEach(([oldId, progVal]) => {
          const mappedIds = mappings[oldId];
          if (mappedIds) {
            mappedIds.forEach(newId => {
              // Only keep if the card exists in the deck
              if (deck && deck.cards.some(c => c.id === newId)) {
                newProgress[newId] = { ...progVal };
              }
            });
          } else {
            // No mapping, keep if it still exists in the deck
            if (deck && deck.cards.some(c => c.id === oldId)) {
              newProgress[oldId] = progVal;
            }
          }
        });

        // Update excluded list
        oldExcluded.forEach(oldId => {
          const mappedIds = mappings[oldId];
          if (mappedIds) {
            mappedIds.forEach(newId => {
              if (deck && deck.cards.some(c => c.id === newId)) {
                newExcluded.add(newId);
              }
            });
          } else {
            if (deck && deck.cards.some(c => c.id === oldId)) {
              newExcluded.add(oldId);
            }
          }
        });

        deckSync.progress = newProgress;
        deckSync.excluded = Array.from(newExcluded);
      });

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`  [ERROR] Failed to process sync file ${file}: ${err.message}`);
    }
  });
}

console.log('\n=== Database Clean and Fix Completed successfully! ===');
