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
const BACKUP_DIR = path.join(DATA_DIR, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));

function backupFile(srcPath) {
  if (!fs.existsSync(srcPath)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const destPath = path.join(BACKUP_DIR, path.basename(srcPath));
  fs.copyFileSync(srcPath, destPath);
}

function atomicWriteJson(filePath, data) {
  backupFile(filePath);
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function mergeProgress(existing, incoming) {
  if (!existing) return { ...incoming };
  const existingModified = existing.lastModified || existing.updatedAt || 0;
  const incomingModified = incoming.lastModified || incoming.updatedAt || 0;
  const existingReps = existing.reps || 0;
  const incomingReps = incoming.reps || 0;

  let chosen;
  if (incomingModified > existingModified) {
    chosen = { ...incoming };
  } else if (existingModified > incomingModified) {
    chosen = { ...existing };
  } else if (incomingReps >= existingReps) {
    chosen = { ...incoming };
  } else {
    chosen = { ...existing };
  }
  chosen.reps = Math.max(existingReps, incomingReps);
  if (existing.seen !== undefined || incoming.seen !== undefined) {
    chosen.seen = Math.max(existing.seen || 0, incoming.seen || 0);
  }
  return chosen;
}

// Load all decks first
const deckFiles = fs.readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));
const decks = {};
deckFiles.forEach(file => {
  const filePath = path.join(DECKS_DIR, file);
  decks[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
});

// We will track the ID mappings for sync files: { [deckId]: { [oldId]: Set([newIds]) } }
const idMappings = {};

// 1. Specific Fixes for tds-it (idempotent)
if (decks['tds-it']) {
  const deck = decks['tds-it'];
  const alreadyFixed = deck.cards.some(c => c.fr.includes('(1)')) ||
                       deck.cards.some(c => c.target === 'apre' && c.fr === 'il/elle ouvre');

  if (alreadyFixed) {
    console.log('tds-it specific fixes already applied, skipping raw index manipulation.');
  } else {
    console.log('Applying specific fixes to tds-it...');
    const originalCards = deck.cards;
    const fixedCards = [];
    const tdsMappings = {};

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

      // Remove duplicate block 837 to 867 but map old IDs to surviving card
      if (idx >= 837 && idx <= 867) {
        const survivor = originalCards.find(c => c.index < 837 && c.fr === card.fr && c.target === card.target);
        if (survivor) {
          if (!tdsMappings[card.id]) tdsMappings[card.id] = new Set();
          tdsMappings[card.id].add(survivor.id);
        }
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
    idMappings['tds-it'] = tdsMappings;
  }
}

// 2. General Clean & Split for all decks
Object.entries(decks).forEach(([deckId, deck]) => {
  console.log(`\nCleaning and deduplicating deck [${deckId}]...`);
  const cards = deck.cards;
  const oldCardCount = cards.length;

  // Group cards by normalized French text
  const groups = {};
  cards.forEach(card => {
    const normFr = (card.fr || '').trim().toLowerCase();
    if (!groups[normFr]) groups[normFr] = [];
    groups[normFr].push(card);
  });

  const finalCards = [];
  const deckMappings = idMappings[deckId] || {};

  Object.values(groups).forEach(group => {
    // 1. Within each group, separate unique targets and duplicate cards
    const uniqueInGroup = [];
    const duplicates = [];
    const seenTargets = new Set();

    group.forEach(card => {
      const normTarget = (card.target || '').trim().toLowerCase();
      if (!seenTargets.has(normTarget)) {
        seenTargets.add(normTarget);
        uniqueInGroup.push(card);
      } else {
        duplicates.push({ card, normTarget });
      }
    });

    // 2. If there are multiple different translations for the same French text, make them unique
    if (uniqueInGroup.length > 1) {
      uniqueInGroup.forEach((card, i) => {
        const oldId = card.id;
        // Append counter to make fr unique
        card.fr = `${card.fr} (${i + 1})`;
        card.id = getExpectedCardId(card.fr);

        if (!deckMappings[oldId]) deckMappings[oldId] = new Set();
        deckMappings[oldId].add(card.id);
      });
    } else if (uniqueInGroup.length === 1) {
      // Just one card in group, update its ID if French text changed (due to trimming, etc.)
      const card = uniqueInGroup[0];
      const oldId = card.id;
      card.id = getExpectedCardId(card.fr);

      if (!deckMappings[oldId]) deckMappings[oldId] = new Set();
      deckMappings[oldId].add(card.id);
    }

    // 3. Now that survivor cards have their FINAL IDs, map discarded duplicates to the survivor's final ID
    duplicates.forEach(({ card, normTarget }) => {
      const survivor = uniqueInGroup.find(c => (c.target || '').trim().toLowerCase() === normTarget);
      if (survivor) {
        const oldId = card.id;
        const newId = survivor.id;
        if (!deckMappings[oldId]) deckMappings[oldId] = new Set();
        deckMappings[oldId].add(newId);
      }
    });

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

// Write fixed decks back atomically
Object.entries(decks).forEach(([deckId, deck]) => {
  const filePath = path.join(DECKS_DIR, `${deckId}.json`);
  atomicWriteJson(filePath, deck);
});

// 3. Fix Sync Files
if (fs.existsSync(SYNC_DIR)) {
  const syncFiles = fs.readdirSync(SYNC_DIR).filter(f => f.endsWith('.json'));
  console.log(`\nUpdating ${syncFiles.length} sync files...`);

  syncFiles.forEach(file => {
    const filePath = path.join(SYNC_DIR, file);
    let syncCode = file;
    try {
      syncCode = decodeURIComponent(path.basename(file, '.json'));
    } catch {
      // ignore decoding error for logging
    }
    console.log(`  Updating Sync [${syncCode}]...`);

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!data || typeof data !== 'object' || !data.decks) return;

      Object.entries(data.decks).forEach(([deckId, deckSync]) => {
        const deck = decks[deckId];
        if (!deck) {
          console.warn(`  [WARN] No deck data for [${deckId}], skipping sync update`);
          return;
        }

        const mappings = idMappings[deckId] || {};
        const oldProgress = deckSync.progress || {};
        const oldExcluded = Array.isArray(deckSync.excluded) ? deckSync.excluded : [];

        const newProgress = {};
        const newExcluded = new Set();

        // Update progress keys with deterministic merge
        Object.entries(oldProgress).forEach(([oldId, progVal]) => {
          const mappedIds = mappings[oldId];
          if (mappedIds) {
            mappedIds.forEach(newId => {
              if (deck && deck.cards.some(c => c.id === newId)) {
                newProgress[newId] = mergeProgress(newProgress[newId], progVal);
              }
            });
          } else {
            if (deck && deck.cards.some(c => c.id === oldId)) {
              newProgress[oldId] = mergeProgress(newProgress[oldId], progVal);
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

      atomicWriteJson(filePath, data);
    } catch (err) {
      console.error(`  [ERROR] Failed to process sync file ${file}: ${err.message}`);
    }
  });
}

console.log('\n=== Database Clean and Fix Completed successfully! ===');
