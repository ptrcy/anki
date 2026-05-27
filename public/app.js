/**
 * Anki Trainer Hub - Client Application Logic
 */

// Handle for the auto-easy timeout so it can be cancelled on manual rating
let autoEasyTimeout = null;

// Long-press special character picker state
let longPressTimer = null;
let longPressKey = null;
let specialCharPopupOpen = false;
let replacedCharPos = -1;
let replacedChar = '';
let popupOptions = [];
let highlightedOptionIdx = 0;
const pressedKeys = new Set();

const SPECIAL_CHARS = {
  it: { a: ['à','á'], e: ['è','é'], i: ['ì','í'], o: ['ò','ó'], u: ['ù','ú'] },
  de: { a: ['ä'], o: ['ö'], u: ['ü'], s: ['ß'] },
  es: { a: ['á'], e: ['é'], i: ['í'], n: ['ñ'], o: ['ó'], u: ['ú','ü'] },
  fr: { a: ['à','â','æ'], c: ['ç'], e: ['è','é','ê','ë'], i: ['î','ï'], o: ['ô','œ'], u: ['ù','û','ü'] },
  pt: { a: ['á','â','ã','à'], c: ['ç'], e: ['é','ê'], i: ['í'], o: ['ó','ô','õ'], u: ['ú'] },
};

function showSpecialCharPopup(variants, textarea) {
  const popup = document.getElementById('special-char-popup');
  popup.innerHTML = '';

  popupOptions = variants;
  highlightedOptionIdx = 0;

  popupOptions.forEach((ch, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'special-char-btn';
    if (idx === highlightedOptionIdx) {
      btn.classList.add('active');
    }
    btn.dataset.char = ch;
    btn.dataset.num = idx + 1;
    btn.innerHTML = `<span class="sc-char">${ch}</span><span class="sc-num">${idx + 1}</span>`;
    
    btn.addEventListener('mouseenter', () => {
      updatePopupHighlight(idx);
    });

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      replaceCharAtPos(ch, textarea);
      hideSpecialCharPopup();
    });
    popup.appendChild(btn);
  });

  const rect = textarea.getBoundingClientRect();
  const estimatedPopupH = 64;
  if (rect.top - estimatedPopupH - 8 >= 4) {
    popup.style.top = (rect.top - estimatedPopupH - 8) + 'px';
  } else {
    popup.style.top = (rect.bottom + 8) + 'px';
  }
  const left = Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8);
  popup.style.left = Math.max(4, left) + 'px';

  popup.classList.remove('hide');
  specialCharPopupOpen = true;
}

function hideSpecialCharPopup() {
  document.getElementById('special-char-popup').classList.add('hide');
  specialCharPopupOpen = false;
}

function updatePopupHighlight(idx) {
  highlightedOptionIdx = idx;
  const buttons = document.querySelectorAll('#special-char-popup .special-char-btn');
  buttons.forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
}

function replaceCharAtPos(char, textarea) {
  const val = textarea.value;
  if (replacedCharPos >= 0 && replacedCharPos < val.length && val[replacedCharPos] === replacedChar) {
    textarea.value = val.slice(0, replacedCharPos) + char + val.slice(replacedCharPos + 1);
    textarea.selectionStart = textarea.selectionEnd = replacedCharPos + char.length;
  } else {
    insertCharAtCursor(char, textarea);
  }
  textarea.focus();
}

function insertCharAtCursor(char, textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + char + textarea.value.slice(end);
  textarea.selectionStart = textarea.selectionEnd = start + char.length;
  textarea.focus();
}

// Persistent auto-play preference
let autoPlayEnabled = localStorage.getItem('anki-autoplay') !== 'false';

function setAutoPlay(enabled) {
  autoPlayEnabled = enabled;
  localStorage.setItem('anki-autoplay', enabled);
  document.getElementById('autoplay-icon-on').classList.toggle('hide', !enabled);
  document.getElementById('autoplay-icon-off').classList.toggle('hide', enabled);
  document.getElementById('autoplay-toggle-btn').style.opacity = enabled ? '1' : '0.4';
}


// Language Metadata & Flags Mapping
const languageMeta = {
  it: { name: 'italien', flag: 'it', flagUrl: 'https://flagcdn.com/w80/it.png', nativeName: 'Italiano' },
  en: { name: 'anglais', flag: 'us', flagUrl: 'https://flagcdn.com/w80/us.png', nativeName: 'English (US)' },
  es: { name: 'espagnol', flag: 'es', flagUrl: 'https://flagcdn.com/w80/es.png', nativeName: 'Español' },
  de: { name: 'allemand', flag: 'de', flagUrl: 'https://flagcdn.com/w80/de.png', nativeName: 'Deutsch' },
  fr: { name: 'français', flag: 'fr', flagUrl: 'https://flagcdn.com/w80/fr.png', nativeName: 'Français' },
  pt: { name: 'portugais', flag: 'pt', flagUrl: 'https://flagcdn.com/w80/pt.png', nativeName: 'Português' },
  ja: { name: 'japonais', flag: 'jp', flagUrl: 'https://flagcdn.com/w80/jp.png', nativeName: '日本語' },
  ru: { name: 'russe', flag: 'ru', flagUrl: 'https://flagcdn.com/w80/ru.png', nativeName: 'Русский' }
};

const targetLanguagePrompts = {
  de: {
    prompt: 'Schreiben Sie bitte Ihre Antwort auf Deutsch :',
    placeholder: 'Schreiben Sie bitte ihre Anwort...'
  },
  it: {
    prompt: 'Traduisez en italien (Scrivi la tua risposta) :',
    placeholder: 'Scrivi la tua risposta in italiano...'
  },
  en: {
    prompt: 'Traduisez en anglais (Write your answer in English) :',
    placeholder: 'Please write your answer in English...'
  },
  es: {
    prompt: 'Traduisez en espagnol (Escribe tu respuesta) :',
    placeholder: 'Escribe tu respuesta en español...'
  },
  pt: {
    prompt: 'Traduisez en portugais (Escreva sua resposta) :',
    placeholder: 'Escreva sua resposta em português...'
  },
  ja: {
    prompt: 'Traduisez en japonais (日本語で書いてください) :',
    placeholder: '日本語で回答を書いてください...'
  },
  ru: {
    prompt: 'Traduisez en russe (Напишите свой ответ) :',
    placeholder: 'Напишите свой ответ на русском...'
  },
  fr: {
    prompt: 'Traduisez en français (Veuillez écrire votre réponse) :',
    placeholder: 'Veuillez écrire votre réponse...'
  }
};

const flagOverrides = {
  en: 'us',
  ja: 'jp',
  zh: 'cn',
  ko: 'kr',
  da: 'dk',
  el: 'gr',
  he: 'il',
  sv: 'se',
  cs: 'cz',
  uk: 'ua',
  ur: 'pk',
  hi: 'in'
};

function getLanguageMeta(langCode) {
  const code = (langCode || 'it').toLowerCase();
  const nameMap = {
    it: 'italien',
    en: 'anglais',
    es: 'espagnol',
    de: 'allemand',
    fr: 'français',
    pt: 'portugais',
    ja: 'japonais',
    ru: 'russe'
  };
  
  if (languageMeta[code]) {
    return languageMeta[code];
  }
  
  const flagCode = flagOverrides[code] || code;
  return {
    name: nameMap[code] || code,
    flag: flagCode,
    flagUrl: `https://flagcdn.com/w80/${flagCode}.png`
  };
}

// Application State
let state = {
  decks: [],              // Decks metadata list
  activeDeck: null,       // Currently practicing deck
  progress: {},           // Card ID -> progress state
  excluded: new Set(),    // Card IDs excluded from practice
  currentCard: null,      // Card currently shown in trainer
  showAnswer: false,      // Showing verification panel
  sessionStats: {
    seen: 0,
    correct: 0
  },
  skippedCards: new Set(), // Card IDs skipped in this session
  studyAheadMode: false,   // Studying cards not yet due
  activeLessonFilter: 'all',
  lessonFilterMode: 'exact' // 'exact' or 'cumulative'
};

// Target Speech Synthesis Voices preloading
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices(); // Trigger load
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// DJB2 hash — shared algorithm used for both card IDs and audio filenames
function hashText(text) {
  let hash = 5381;
  const s = (text || '').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) + s.charCodeAt(i);
  }
  return Math.abs(hash & hash).toString(36);
}

// Stable hashing function for Card IDs (DJB2 algorithm)
function generateStableId(frText) {
  return 'card_' + hashText(frText);
}

// CSV Parser supporting quotes, escaped quotes, and newlines in cells
function parseCSV(text) {
  const cards = [];
  let row = [''];
  let inQuotes = false;
  
  // Auto-detect delimiter: count commas vs semicolons in the first line
  let delimiter = ',';
  const firstLineEnd = text.indexOf('\n');
  const firstLine = firstLineEnd !== -1 ? text.substring(0, firstLineEnd) : text;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  if (semicolonCount > commaCount) {
    delimiter = ';';
  }
  
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      if (row.length > 1 || row[0] !== '') {
        const cleanRow = row.map(cell => cell.trim());
        if (cleanRow[0] !== '' && cleanRow[1] !== '') {
          cards.push({
            id: generateStableId(cleanRow[0]),
            fr: cleanRow[0],
            target: cleanRow[1],
            lesson: cleanRow[2] || 'Général',
            index: cards.length
          });
        }
      }
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }
  
  if (row.length > 1 || row[0] !== '') {
    const cleanRow = row.map(cell => cell.trim());
    if (cleanRow[0] !== '' && cleanRow[1] !== '') {
      cards.push({
        id: generateStableId(cleanRow[0]),
        fr: cleanRow[0],
        target: cleanRow[1],
        lesson: cleanRow[2] || 'Général',
        index: cards.length
      });
    }
  }
  
  return cards;
}

// Spaced Repetition Logic (SM-2 implementation)
const Wu = 24 * 60 * 60 * 1000; // 1 day in milliseconds

function defaultProgress() {
  return {
    ease: 2.5,
    interval: 0,
    dueAt: Date.now(),
    reps: 0,
    lapses: 0,
    lastRating: null
  };
}

function rateCard(cardProgress, rating) {
  const now = Date.now();
  const today = new Date();
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).getTime();
  const p = { ...(cardProgress || defaultProgress()) };
  
  if (rating === 'again') {
    p.ease = Math.max(1.3, p.ease - 0.2);
    p.interval = 0;
    p.reps = 0;
    p.lapses = p.lapses + 1;
    p.dueAt = now + 600 * 1000; // Fail -> review again in 10 minutes
  } else if (rating === 'hard') {
    p.ease = Math.max(1.3, p.ease - 0.15);
    if (p.interval === 0) {
      // Still in relearn after a lapse — stay in short step, don't graduate
      p.dueAt = now + 1200 * 1000; // 20 min
    } else {
      p.interval = p.interval <= 1 ? 1 : Math.max(2, Math.round(p.interval * 1.2));
      p.reps = p.reps + 1;
      p.dueAt = endOfToday + (p.interval - 1) * Wu;
    }
  } else if (rating === 'good') {
    p.interval = p.reps === 0 ? 1 : p.reps === 1 ? 3 : Math.max(4, Math.round(p.interval * p.ease));
    p.reps = p.reps + 1;
    p.dueAt = endOfToday + (p.interval - 1) * Wu;
  } else if (rating === 'easy') {
    p.ease = p.ease + 0.15;
    p.interval = p.reps === 0 ? 3 : p.reps === 1 ? 6 : Math.max(7, Math.round(p.interval * (p.ease + 0.3)));
    p.reps = p.reps + 1;
    p.dueAt = endOfToday + (p.interval - 1) * Wu;
  }
  
  p.lastRating = rating;
  return p;
}

// Text Normalizer for scoring similarity
function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents/diacritics
    .replace(/[.,!?;:'"«»¡¿()\-]/g, '') // remove punctuation
    .replace(/\s+/g, ' ')           // collapse multiple whitespaces
    .trim();
}

// LCS Difference Highlighting Aligner
function diffStrings(userStr, targetStr) {
  const user = userStr.trim();
  const target = targetStr.trim();
  const uLen = user.length;
  const tLen = target.length;
  
  const dp = Array(uLen + 1).fill(null).map(() => Array(tLen + 1).fill(0));
  
  for (let i = 1; i <= uLen; i++) {
    for (let j = 1; j <= tLen; j++) {
      if (user[i - 1] === target[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  let i = uLen;
  let j = tLen;
  const result = [];
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && user[i - 1] === target[j - 1]) {
      result.unshift({ type: 'correct', char: user[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'missing', char: target[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'extra', char: user[i - 1] });
      i--;
    }
  }
  return result;
}

// Check similarity score between user and target (Levenshtein/word overlapping fallback)
function checkSimilarity(user, target) {
  const normUser = normalizeText(user);
  const normTarget = normalizeText(target);
  
  if (!normUser || !normTarget) return 0;
  if (normUser === normTarget) return 1;
  if (normUser.includes(normTarget) || normTarget.includes(normUser)) return 0.8;
  
  const userWords = normUser.split(' ');
  const targetWords = normTarget.split(' ');
  
  const userWordSet = new Set(userWords);
  const targetWordSet = new Set(targetWords);
  
  const intersection = [...userWordSet].filter(w => targetWordSet.has(w)).length;
  return intersection / Math.max(userWordSet.size, targetWordSet.size);
}

// Numerical extractor for lesson cumulative sorting
function extractLessonNumber(lessonStr) {
  const match = lessonStr.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

// Routing & View Switcher
function navigateTo(hash) {
  window.location.hash = hash;
}

function handleRoute() {
  const hash = window.location.hash || '#dashboard';
  const headerLogo = document.getElementById('header-logo');
  const backBtn = document.getElementById('back-to-dashboard-btn');
  
  if (hash === '#dashboard') {
    // Show Dashboard
    document.getElementById('dashboard-view').classList.remove('hide');
    document.getElementById('trainer-view').classList.add('hide');
    backBtn.classList.add('hide');
    headerLogo.style.cursor = 'default';
    state.activeDeck = null;
    fetchDecks();
  } else if (hash.startsWith('#deck/')) {
    // Show Trainer
    const deckId = hash.replace('#deck/', '');
    document.getElementById('dashboard-view').classList.add('hide');
    document.getElementById('trainer-view').classList.remove('hide');
    backBtn.classList.remove('hide');
    headerLogo.style.cursor = 'pointer';
    loadDeck(deckId);
  }
}

// API Integration Calls

async function fetchDecks() {
  const decksList = document.getElementById('decks-list');
  try {
    const res = await fetch('/api/decks');
    if (!res.ok) throw new Error('Could not fetch decks');
    
    state.decks = await res.json();
    document.getElementById('deck-count-badge').innerText = `${state.decks.length} deck${state.decks.length > 1 ? 's' : ''}`;
    
    if (state.decks.length === 0) {
      decksList.innerHTML = `
        <div class="empty-grid-state">
          <svg class="empty-illustration-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <h3>Aucun deck disponible</h3>
          <p>Importez votre premier fichier CSV pour commencer à réviser.</p>
        </div>
      `;
      return;
    }
    
    decksList.innerHTML = '';
    state.decks.forEach(deck => {
      // Load progress to show completion percentage bar
      const savedProgress = JSON.parse(localStorage.getItem(`progress_${deck.id}`) || '{}');
      const cardCount = deck.cardCount || 0;
      
      let studiedCount = 0;
      if (cardCount > 0) {
        studiedCount = Object.keys(savedProgress).filter(id => savedProgress[id] && savedProgress[id].reps > 0).length;
      }
      const progressPercent = cardCount > 0 ? Math.round((studiedCount / cardCount) * 100) : 0;
      
      const langMeta = getLanguageMeta(deck.targetLang);
      const deckCard = document.createElement('div');
      deckCard.className = 'card deck-card';
      deckCard.innerHTML = `
        <div class="deck-info">
          <div class="deck-header-row">
            <img class="deck-flag" src="${langMeta.flagUrl}" alt="${langMeta.name}" />
            <span class="badge deck-lang-badge badge-indigo">${deck.targetLang.toUpperCase()}</span>
          </div>
          <div class="deck-title" title="${escapeHtml(deck.name)}">${escapeHtml(deck.name)}</div>
          <div class="deck-stats">
            <span><strong>${cardCount}</strong> phrases</span>
            <span><strong>${progressPercent}%</strong> appris</span>
          </div>
        </div>
        <div class="overall-progress" style="margin-top: 10px; border-top: 0; padding-top: 0;">
          <div class="progress-track" style="height: 6px;">
            <div class="progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
        </div>
        <div class="deck-actions">
          <button class="btn btn-indigo btn-sm deck-btn-practice" onclick="navigateTo('#deck/${deck.id}')">
            Étudier
          </button>
          <button class="deck-btn-delete" title="Renommer le deck" onclick="event.stopPropagation(); renameDeck('${deck.id}', '${escapeHtml(deck.name)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
            </svg>
          </button>
          <button class="deck-btn-delete" title="Supprimer le deck" onclick="event.stopPropagation(); deleteDeck('${deck.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          </button>
        </div>
      `;
      decksList.appendChild(deckCard);
    });
  } catch (err) {
    decksList.innerHTML = `<div class="error-msg">Erreur lors de la récupération des decks : ${err.message}</div>`;
  }
}

async function loadDeck(deckId) {
  try {
    const res = await fetch(`/api/decks/${deckId}`);
    if (!res.ok) throw new Error('Deck non trouvé sur le serveur');

    state.activeDeck = await res.json();
    state.activeDeck.id = deckId;

    // Pull latest sync data before reading localStorage, so we always have fresh progress
    const syncCode = localStorage.getItem('anki-sync-code');
    if (syncCode) await loadAllProgress(syncCode, true);

    // Load local storage progress & exclusions
    const localProgress = localStorage.getItem(`progress_${deckId}`);
    state.progress = localProgress ? JSON.parse(localProgress) : {};

    const localExcluded = localStorage.getItem(`excluded_${deckId}`);
    state.excluded = localExcluded ? new Set(JSON.parse(localExcluded)) : new Set();
    
    // (sync code lives on the dashboard — no local reference needed here)
    
    // Clear session status
    state.sessionStats = { seen: 0, correct: 0 };
    state.skippedCards.clear();
    state.studyAheadMode = false;
    state.showAnswer = false;
    
    const langMeta = getLanguageMeta(state.activeDeck.targetLang);
    document.getElementById('active-deck-title').innerText = state.activeDeck.name;
    document.getElementById('active-deck-lang').innerText = (state.activeDeck.targetLang || 'it').toUpperCase();
    
    // Set language flag in header
    const flagImg = document.getElementById('active-deck-flag');
    if (flagImg) {
      flagImg.src = langMeta.flagUrl;
      flagImg.alt = langMeta.name;
      flagImg.classList.remove('hide');
    }
    
    // Set target translation prompt label & input placeholder
    const targetLangCode = (state.activeDeck.targetLang || 'it').toLowerCase();
    const customPrompt = targetLanguagePrompts[targetLangCode];

    const promptLabel = document.getElementById('sentence-prompt-label');
    if (promptLabel) {
      promptLabel.innerText = customPrompt ? customPrompt.prompt : `Traduisez en ${langMeta.name} :`;
    }

    const answerInput = document.getElementById('user-answer-input');
    if (answerInput) {
      answerInput.placeholder = customPrompt ? customPrompt.placeholder : `Tapez votre réponse en ${langMeta.name} ici...`;
    }
    
    // Build Lesson list dropdown
    buildLessonFilter();
    
    // Setup controls
    resetTrainerUI();
    showNextCard();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
    navigateTo('#dashboard');
  }
}

async function renameDeck(deckId, currentName) {
  const newName = prompt('Nouveau nom du deck :', currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    const res = await fetch(`/api/decks/${deckId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    if (!res.ok) throw new Error('Impossible de renommer le deck');
    fetchDecks();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
  }
}

async function deleteDeck(deckId) {
  if (!confirm('Voulez-vous vraiment supprimer ce deck et toute sa progression ?')) return;
  
  try {
    const res = await fetch(`/api/decks/${deckId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Impossible de supprimer le deck');
    
    // Clean local storage
    localStorage.removeItem(`progress_${deckId}`);
    localStorage.removeItem(`excluded_${deckId}`);
    
    fetchDecks();
  } catch (err) {
    alert(`Erreur : ${err.message}`);
  }
}

// Lesson Filter Builder
function buildLessonFilter() {
  const lessonSelect = document.getElementById('lesson-select');
  const lessonContainer = document.getElementById('lesson-filter-container');
  
  // Extract unique lesson names
  const lessons = new Set();
  state.activeDeck.cards.forEach(c => {
    if (c.lesson) lessons.add(c.lesson);
  });
  
  // If only one lesson or empty, hide filter
  if (lessons.size <= 1) {
    lessonContainer.classList.add('hide');
    state.activeLessonFilter = 'all';
    return;
  }
  
  lessonContainer.classList.remove('hide');
  
  // Sort lessons: if numerical, sort numerically; otherwise alphabetically
  const sortedLessons = [...lessons].sort((a, b) => {
    const numA = extractLessonNumber(a);
    const numB = extractLessonNumber(b);
    if (numA > 0 || numB > 0) {
      return numA - numB;
    }
    return a.localeCompare(b);
  });
  
  lessonSelect.innerHTML = '<option value="all">Toutes les leçons</option>';
  sortedLessons.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l;
    opt.innerText = l;
    lessonSelect.appendChild(opt);
  });
  
  state.activeLessonFilter = 'all';
  lessonSelect.value = 'all';
}

// Card Filtering & Selection
function filterDeckCards() {
  const cards = state.activeDeck.cards;
  
  // Filter 1: Excluded cards
  let filtered = cards.filter(c => !state.excluded.has(c.id));
  
  // Filter 2: Lesson
  if (state.activeLessonFilter !== 'all') {
    if (state.lessonFilterMode === 'exact') {
      filtered = filtered.filter(c => c.lesson === state.activeLessonFilter);
    } else if (state.lessonFilterMode === 'cumulative') {
      const selectedNum = extractLessonNumber(state.activeLessonFilter);
      filtered = filtered.filter(c => extractLessonNumber(c.lesson) <= selectedNum);
    }
  }
  
  return filtered;
}

function showNextCard() {
  state.showAnswer = false;
  resetTrainerUI();
  
  const filteredCards = filterDeckCards();
  
  if (filteredCards.length === 0) {
    document.getElementById('study-container').classList.add('hide');
    document.getElementById('no-cards-state').classList.remove('hide');
    document.getElementById('study-ahead-btn').classList.add('hide'); // no cards to study ahead
    updateStatistics(filteredCards);
    return;
  }
  
  const now = Date.now();
  const today = new Date();
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).getTime();
  
  // Check due reviews & new cards
  const dueNowReviews = filteredCards.filter(c => state.progress[c.id] && state.progress[c.id].dueAt <= now);
  const newCards = filteredCards.filter(c => !state.progress[c.id]);
  const dueLaterTodayReviews = filteredCards.filter(c => state.progress[c.id] && state.progress[c.id].dueAt > now && state.progress[c.id].dueAt <= endOfToday);
  
  let candidates = [];
  
  if (state.studyAheadMode) {
    // Study ahead mode: allow selecting future cards
    // Sort all cards by dueAt ascending (least dueAt first), prioritizing never-seen cards
    candidates = [...filteredCards].sort((a, b) => {
      const pA = state.progress[a.id];
      const pB = state.progress[b.id];
      
      const dueA = pA ? pA.dueAt : 0;
      const dueB = pB ? pB.dueAt : 0;
      
      if (dueA !== dueB) return dueA - dueB;
      return a.index - b.index; // original CSV order
    });
  } else {
    // Normal mode: reviews due now, then new cards in CSV order, then reviews due later today
    dueNowReviews.sort((a, b) => state.progress[a.id].dueAt - state.progress[b.id].dueAt);
    for (let i = newCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newCards[i], newCards[j]] = [newCards[j], newCards[i]];
    }
    dueLaterTodayReviews.sort((a, b) => state.progress[a.id].dueAt - state.progress[b.id].dueAt);
    
    candidates = [...dueNowReviews, ...newCards, ...dueLaterTodayReviews];
  }
  
  // If no cards due & not study ahead
  if (candidates.length === 0) {
    document.getElementById('study-container').classList.add('hide');
    document.getElementById('no-cards-state').classList.remove('hide');
    // Enable study ahead button if there are future reviews
    const hasFutureCards = filteredCards.some(c => state.progress[c.id] && state.progress[c.id].dueAt > endOfToday);
    if (hasFutureCards) {
      document.getElementById('study-ahead-btn').classList.remove('hide');
    } else {
      document.getElementById('study-ahead-btn').classList.add('hide');
    }
    updateStatistics(filteredCards);
    return;
  }
  
  // Skip session cards if possible, fallback to first candidate
  let nextCard = candidates.find(c => !state.skippedCards.has(c.id));
  if (!nextCard) {
    state.skippedCards.clear(); // All skipped — reset and cycle from the top
    nextCard = candidates[0];
  }
  
  state.currentCard = nextCard;
  
  // Populate UI
  document.getElementById('study-container').classList.remove('hide');
  document.getElementById('no-cards-state').classList.add('hide');
  document.getElementById('origin-sentence-text').innerText = nextCard.fr;
  document.getElementById('current-card-lesson').innerText = nextCard.lesson || 'Général';
  
  // Show Due badge if it's actually due
  const dueBadge = document.getElementById('due-badge');
  if (state.progress[nextCard.id] && state.progress[nextCard.id].dueAt <= now) {
    dueBadge.classList.remove('hide');
  } else {
    dueBadge.classList.add('hide');
  }
  
  updateStatistics(filteredCards);
  
  // Refocus input field
  setTimeout(() => {
    const input = document.getElementById('user-answer-input');
    input.value = '';
    input.focus();
  }, 100);
}

// Statistics Engine aligned with local calendar day boundaries
function updateStatistics(filteredCards) {
  const now = Date.now();
  const today = new Date();
  // Aligns to local midnight boundary (end of today)
  const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  
  let newCount = 0;
  let dueCount = 0;
  let tomorrowCount = 0;
  let days23Count = 0;
  let weekCount = 0;
  let laterCount = 0;
  
  filteredCards.forEach(c => {
    const p = state.progress[c.id];
    if (!p) {
      newCount++;
      return;
    }
    
    // Check due boundaries
    if (p.dueAt <= endOfToday) {
      dueCount++;
    } else if (p.dueAt <= endOfToday + dayMs) {
      tomorrowCount++;
    } else if (p.dueAt <= endOfToday + 3 * dayMs) {
      days23Count++;
    } else if (p.dueAt <= endOfToday + 7 * dayMs) {
      weekCount++;
    } else {
      laterCount++;
    }
  });
  
  // Write counts to UI
  document.getElementById('stat-new').innerText = newCount;
  document.getElementById('stat-due').innerText = dueCount;
  document.getElementById('stat-tomorrow').innerText = tomorrowCount;
  document.getElementById('stat-days23').innerText = days23Count;
  document.getElementById('stat-week').innerText = weekCount;
  document.getElementById('stat-later').innerText = laterCount;
  
  // Seen cards fraction ("Vues au moins une fois")
  // A card is studied/seen if it has reps > 0 in the progress store
  const totalCards = filteredCards.length;
  const seenCardsCount = filteredCards.filter(c => state.progress[c.id] && state.progress[c.id].reps > 0).length;
  document.getElementById('stat-seen-fraction').innerText = `${seenCardsCount} / ${totalCards}`;
  
  const percentSeen = totalCards > 0 ? Math.round((seenCardsCount / totalCards) * 100) : 0;
  document.getElementById('stat-seen-progress-bar').style.width = `${percentSeen}%`;
  
  // Update Session statistics
  document.getElementById('session-seen').innerText = state.sessionStats.seen;
  document.getElementById('session-correct').innerText = state.sessionStats.correct;
  
  const accuracy = state.sessionStats.seen > 0 
    ? Math.round((state.sessionStats.correct / state.sessionStats.seen) * 100) 
    : 0;
  document.getElementById('session-accuracy').innerText = `${accuracy}%`;
}

// UI Controls Reset
function resetTrainerUI() {
  document.getElementById('feedback-section').classList.add('hide');
  document.getElementById('submit-answer-btn').classList.remove('hide');
  document.getElementById('skip-card-btn').classList.remove('hide');
}

// Verify User Answer
function verifyAnswer() {
  if (!state.currentCard || state.showAnswer) return;
  
  state.showAnswer = true;
  document.getElementById('submit-answer-btn').classList.add('hide');
  document.getElementById('skip-card-btn').classList.add('hide');
  document.getElementById('feedback-section').classList.remove('hide');
  
  const typed = document.getElementById('user-answer-input').value;
  const target = state.currentCard.target;
  
  // 1. Generate Difference Highlighting
  const diff = diffStrings(typed, target);
  const diffOutput = document.getElementById('diff-highlight-output');
  diffOutput.innerHTML = '';
  
  diff.forEach(chunk => {
    const span = document.createElement('span');
    if (chunk.type === 'correct') {
      span.className = 'diff-correct';
      span.innerText = chunk.char;
    } else if (chunk.type === 'missing') {
      span.className = 'diff-missing';
      span.innerText = chunk.char;
    } else if (chunk.type === 'extra') {
      span.className = 'diff-extra';
      span.innerText = chunk.char;
    }
    diffOutput.appendChild(span);
  });
  
  // 2. Populate expected reference sentence
  document.getElementById('target-sentence-text').innerText = target;
  
  // 3. Audio TTS playback automatic trigger
  if (autoPlayEnabled) speakAudio();
  
  // 4. Update session statistics
  const score = checkSimilarity(typed, target);
  const isAccepted = score >= 0.8;
  
  state.sessionStats.seen++;
  if (isAccepted) {
    state.sessionStats.correct++;
  }
  
  // Update intervals on rating buttons
  updateRatingButtonsIntervals();
  
  // 5. Automatically rate "easy" if perfect similarity match (score === 1)
  if (score === 1) {
    autoEasyTimeout = setTimeout(() => {
      autoEasyTimeout = null;
      submitCardRating('easy');
    }, 1200);
  }
}

// Calculate and render expected future review intervals for rating buttons
function updateRatingButtonsIntervals() {
  const cardId = state.currentCard.id;
  const p = state.progress[cardId] || defaultProgress();
  
  // Temporary calculations using rating outcomes
  const againP = rateCard(p, 'again');
  const hardP = rateCard(p, 'hard');
  const goodP = rateCard(p, 'good');
  const easyP = rateCard(p, 'easy');
  
  document.getElementById('interval-again').innerText = formatInterval(againP.interval, true);
  document.getElementById('interval-hard').innerText = formatInterval(hardP.interval);
  document.getElementById('interval-good').innerText = formatInterval(goodP.interval);
  document.getElementById('interval-easy').innerText = formatInterval(easyP.interval);
}

function formatInterval(intervalDays, isAgain = false) {
  if (isAgain) return '10m';
  if (intervalDays === 0) return '10m';
  if (intervalDays < 1) return '10m';
  if (intervalDays === 1) return '1j';
  return `${intervalDays}j`;
}

// Submit Flashcard Rating
function submitCardRating(rating) {
  if (!state.currentCard) return;
  if (autoEasyTimeout) {
    clearTimeout(autoEasyTimeout);
    autoEasyTimeout = null;
  }
  
  const cardId = state.currentCard.id;
  const currentProg = state.progress[cardId] || defaultProgress();
  
  // Rate card and save to state
  state.progress[cardId] = rateCard(currentProg, rating);
  
  // Persist locally
  localStorage.setItem(`progress_${state.activeDeck.id}`, JSON.stringify(state.progress));
  
  // Remove from skipped list if it was skipped and now studied
  state.skippedCards.delete(cardId);
  
  saveProgress(); // silent background sync if a code is set
  
  showNextCard();
}

// Exclude Card from Deck list
function excludeCurrentCard() {
  if (!state.currentCard) return;
  const cardId = state.currentCard.id;
  
  if (confirm('Voulez-vous exclure cette phrase ? Elle ne vous sera plus proposée.')) {
    state.excluded.add(cardId);
    localStorage.setItem(`excluded_${state.activeDeck.id}`, JSON.stringify([...state.excluded]));
    
    saveProgress(); // silent background sync if a code is set
    
    showNextCard();
  }
}

// Skip Card without rating it
function skipCurrentCard() {
  if (!state.currentCard) return;
  state.skippedCards.add(state.currentCard.id);
  showNextCard();
}

// Text-To-Speech Playback — uses pre-generated WaveNet MP3 if available, falls back to browser TTS
function speakAudio() {
  if (!state.currentCard || !state.activeDeck) return;

  const cardId = state.currentCard.id;
  let fallbackFired = false;
  const fallback = () => { if (!fallbackFired) { fallbackFired = true; speakBrowserTTS(); } };

  // Filename = hash(fr) + "_" + hash(target) — uniquely identifies the audio
  // content regardless of deck or language, no collisions possible.
  const targetHash = hashText(state.currentCard.target);
  const audio = new Audio(`/audio/${cardId}_${targetHash}.mp3`);
  audio.onerror = fallback;
  audio.play().catch(fallback);
}

function speakBrowserTTS() {
  if (!state.currentCard || !state.activeDeck || !('speechSynthesis' in window)) return;
  const text = state.currentCard.target;
  const lang = state.activeDeck.targetLang || 'it';

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'it' ? 'it-IT' :
                   lang === 'en' ? 'en-US' :
                   lang === 'es' ? 'es-ES' :
                   lang === 'de' ? 'de-DE' :
                   lang === 'fr' ? 'fr-FR' :
                   lang === 'pt' ? 'pt-PT' :
                   lang === 'ja' ? 'ja-JP' :
                   lang === 'ru' ? 'ru-RU' : 'it-IT';

  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith(lang));
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}

// Sync API Operations

// Sync Queue to handle concurrent saveProgress calls
let syncQueue = Promise.resolve();

// Save current deck's progress to the server (called automatically on each card rating)
async function saveProgress(silent = true) {
  const code = localStorage.getItem('anki-sync-code');
  if (!code || code.length < 3 || !state.activeDeck) return;

  // Capture current state snapshot to avoid late-binding issues if state changes before queue processes
  const deckId = state.activeDeck.id;
  const progressSnapshot = { ...state.progress };
  const excludedSnapshot = [...state.excluded];

  // Chain the sync request to the queue to ensure sequential execution
  syncQueue = syncQueue.then(async () => {
    try {
      const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckId: deckId,
          progress: progressSnapshot,
          excluded: excludedSnapshot
        })
      });
      if (!res.ok) throw new Error('Erreur serveur');
    } catch (err) {
      console.error('Sync failed:', err);
      if (!silent) updateSyncStatus(err.message, 'error');
    }
  });
  
  return syncQueue;
}

// Pull all decks from server and merge into localStorage
async function loadAllProgress(code, silent = false) {
  if (!silent) updateSyncStatus('Chargement...', 'loading');

  try {
    const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
    if (res.status === 404) return false; // new code — nothing to pull yet, not an error
    if (!res.ok) throw new Error('Erreur serveur');

    const syncData = await res.json();
    const decks = syncData.decks || {};

    for (const [deckId, deckData] of Object.entries(decks)) {
      const localProg = JSON.parse(localStorage.getItem(`progress_${deckId}`) || '{}');
      const merged = { ...localProg };
      for (const [id, remote] of Object.entries(deckData.progress || {})) {
        const local = merged[id];
        // Use lastModified timestamp if available, fallback to reps for legacy data
        const remoteTime = remote.lastModified || 0;
        const localTime = local ? (local.lastModified || 0) : -1;
        
        if (!local || remoteTime > localTime || (remoteTime === localTime && remote.reps > local.reps)) {
          merged[id] = remote;
        }
      }
      localStorage.setItem(`progress_${deckId}`, JSON.stringify(merged));

      const localExcl = JSON.parse(localStorage.getItem(`excluded_${deckId}`) || '[]');
      const mergedExcl = [...new Set([...localExcl, ...(deckData.excluded || [])])];
      localStorage.setItem(`excluded_${deckId}`, JSON.stringify(mergedExcl));
    }

    // Refresh active deck state if one is open
    if (state.activeDeck) {
      state.progress = JSON.parse(localStorage.getItem(`progress_${state.activeDeck.id}`) || '{}');
      state.excluded = new Set(JSON.parse(localStorage.getItem(`excluded_${state.activeDeck.id}`) || '[]'));
      showNextCard();
    }

    const savedDateStr = syncData._savedAt ? new Date(syncData._savedAt).toLocaleDateString() : '';
    if (!silent) updateSyncStatus(`Connecté ✓ ${savedDateStr}`, 'success');
    return true;
  } catch (err) {
    if (!silent) updateSyncStatus(err.message, 'error');
    return false;
  }
}

function updateSyncStatus(text, type) {
  const statusEl = document.getElementById('sync-status');
  statusEl.innerText = text;
  statusEl.className = 'sync-status-msg ' + type;
}

// Reset Entire Deck Progress
function resetDeckProgress() {
  if (!confirm('Voulez-vous réinitialiser toute votre progression sur ce deck ? Cette opération est irréversible.')) return;
  
  state.progress = {};
  state.excluded.clear();
  state.sessionStats = { seen: 0, correct: 0 };
  state.skippedCards.clear();
  state.studyAheadMode = false;
  
  localStorage.removeItem(`progress_${state.activeDeck.id}`);
  localStorage.removeItem(`excluded_${state.activeDeck.id}`);
  
  showNextCard();
}

// Event Bindings and Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Bind routes
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
  
  // Dashboard Brand click
  document.getElementById('header-logo').addEventListener('click', () => {
    navigateTo('#dashboard');
  });
  
  // Back to Dashboard button
  document.getElementById('back-to-dashboard-btn').addEventListener('click', () => {
    navigateTo('#dashboard');
  });
  
  // Modal Open/Close Controls
  const modal = document.getElementById('create-deck-modal');
  const openModalBtn = document.getElementById('open-upload-modal-btn');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const cancelModalBtn = document.getElementById('cancel-modal-btn');
  
  openModalBtn.addEventListener('click', () => {
    modal.classList.remove('hide');
    document.getElementById('deck-name-input').value = '';
    document.getElementById('deck-file-input').value = '';
    document.getElementById('selected-file-name').innerText = '';
    document.getElementById('modal-error-message').classList.add('hide');
  });
  
  const closeModal = () => modal.classList.add('hide');
  closeModalBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);
  
  // Custom file selector styling
  const fileDropArea = document.querySelector('.file-drop-area');
  const fileInput = document.getElementById('deck-file-input');
  
  fileDropArea.addEventListener('click', () => {
    fileInput.click();
  });
  
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      document.getElementById('selected-file-name').innerText = fileInput.files[0].name;
    }
  });
  
  // Import Deck Submission Form
  document.getElementById('create-deck-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('deck-name-input').value.trim();
    const targetLang = document.getElementById('deck-lang-select').value;
    const file = fileInput.files[0];
    const errorEl = document.getElementById('modal-error-message');
    const submitBtn = document.getElementById('submit-deck-btn');
    const spinner = document.getElementById('modal-spinner');
    
    if (!file) return;
    
    errorEl.classList.add('hide');
    submitBtn.disabled = true;
    spinner.classList.remove('hide');
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const cards = parseCSV(text);
        
        if (cards.length === 0) {
          throw new Error('Fichier CSV vide ou mal structuré (aucune phrase trouvée).');
        }
        
        const response = await fetch('/api/decks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, targetLang, cards })
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Erreur lors de l\'enregistrement du deck');
        }
        
        const newDeck = await response.json();
        closeModal();
        fetchDecks(); // reload dashboard
      } catch (err) {
        errorEl.innerText = err.message;
        errorEl.classList.remove('hide');
      } finally {
        submitBtn.disabled = false;
        spinner.classList.add('hide');
      }
    };
    
    reader.readAsText(file);
  });
  
  // Active Trainer Controls
  
  // Lesson dropdown selection change
  document.getElementById('lesson-select').addEventListener('change', (e) => {
    state.activeLessonFilter = e.target.value;
    state.skippedCards.clear();
    state.studyAheadMode = false;
    showNextCard();
  });
  
  // Lesson filter mode radio inputs
  document.getElementsByName('lesson-mode').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.lessonFilterMode = e.target.value;
      state.skippedCards.clear();
      state.studyAheadMode = false;
      showNextCard();
    });
  });
  
  // Verify typed answer button click
  document.getElementById('submit-answer-btn').addEventListener('click', verifyAnswer);
  
  // Audio Speech button click
  document.getElementById('speak-audio-btn').addEventListener('click', speakAudio);

  // Auto-play toggle
  setAutoPlay(autoPlayEnabled); // apply saved preference on load
  document.getElementById('autoplay-toggle-btn').addEventListener('click', () => setAutoPlay(!autoPlayEnabled));
  
  // Rating rating buttons binding
  document.getElementById('rate-again-btn').addEventListener('click', () => submitCardRating('again'));
  document.getElementById('rate-hard-btn').addEventListener('click', () => submitCardRating('hard'));
  document.getElementById('rate-good-btn').addEventListener('click', () => submitCardRating('good'));
  document.getElementById('rate-easy-btn').addEventListener('click', () => submitCardRating('easy'));
  
  // Skip Card Button click
  document.getElementById('skip-card-btn').addEventListener('click', skipCurrentCard);
  
  // Study ahead congrats page button
  document.getElementById('study-ahead-btn').addEventListener('click', () => {
    state.studyAheadMode = true;
    showNextCard();
  });
  
  document.getElementById('empty-state-back-btn').addEventListener('click', () => {
    navigateTo('#dashboard');
  });
  
  // Reset Session Statistics
  document.getElementById('reset-session-btn').addEventListener('click', () => {
    state.sessionStats = { seen: 0, correct: 0 };
    updateStatistics(filterDeckCards());
  });
  
  // Reset Deck Progress
  document.getElementById('reset-deck-progress-btn').addEventListener('click', resetDeckProgress);
  
  // Sync Controls (dashboard)
  const syncCodeInput = document.getElementById('sync-code-input');
  const connectBtn    = document.getElementById('sync-connect-btn');
  const disconnectBtn = document.getElementById('sync-disconnect-btn');

  function applySyncCodeUI(code) {
    if (code) {
      syncCodeInput.value = code;
      syncCodeInput.disabled = true;
      connectBtn.classList.add('hide');
      disconnectBtn.classList.remove('hide');
    } else {
      syncCodeInput.value = '';
      syncCodeInput.disabled = false;
      connectBtn.classList.remove('hide');
      disconnectBtn.classList.add('hide');
      updateSyncStatus('', '');
    }
  }

  connectBtn.addEventListener('click', async () => {
    const code = syncCodeInput.value.trim().toLowerCase();
    if (code.length < 3) { updateSyncStatus('Code trop court (min 3 car.)', 'error'); return; }

    updateSyncStatus('Synchronisation...', 'loading');

    // Push every deck that has local progress to the server first
    const pushPromises = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('progress_')) {
        const deckId = key.slice('progress_'.length);
        const progress = JSON.parse(localStorage.getItem(key) || '{}');
        const excluded = JSON.parse(localStorage.getItem(`excluded_${deckId}`) || '[]');
        pushPromises.push(
          fetch(`/api/sync?code=${encodeURIComponent(code)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deckId, progress, excluded })
          })
        );
      }
    }
    await Promise.all(pushPromises);

    // Pull the merged server state (404 = new code, that's fine)
    localStorage.setItem('anki-sync-code', code);
    const ok = await loadAllProgress(code, false);
    if (!ok && pushPromises.length > 0) {
      // Push succeeded but pull failed — real error, don't connect
      localStorage.removeItem('anki-sync-code');
    } else {
      applySyncCodeUI(code);
      if (!ok) updateSyncStatus('Connecté ✓ (nouveau code)', 'success');
      fetchDecks();
    }
  });

  disconnectBtn.addEventListener('click', () => {
    localStorage.removeItem('anki-sync-code');
    applySyncCodeUI(null);
  });

  // On startup: restore saved code and auto-load progress
  const savedCode = localStorage.getItem('anki-sync-code');
  if (savedCode) {
    applySyncCodeUI(savedCode);
    loadAllProgress(savedCode, true).then(() => fetchDecks());
  }
  
  // Create Exclusion Button injection inside Card Counter Header
  const counterHeader = document.querySelector('.card-counter');
  const excludeBtn = document.createElement('span');
  excludeBtn.id = 'exclude-card-btn';
  excludeBtn.className = 'exclude-link';
  excludeBtn.style.cssText = 'font-size: 11px; cursor: pointer; color: var(--text-light); text-transform: none; text-decoration: underline; transition: color 0.2s;';
  excludeBtn.innerText = "Ne plus afficher";
  excludeBtn.addEventListener('click', excludeCurrentCard);
  excludeBtn.addEventListener('mouseenter', () => excludeBtn.style.color = 'var(--danger)');
  excludeBtn.addEventListener('mouseleave', () => excludeBtn.style.color = 'var(--text-light)');
  counterHeader.appendChild(excludeBtn);
  
  // Long-press special char picker — wired to the answer textarea
  const answerTextarea = document.getElementById('user-answer-input');

  answerTextarea.addEventListener('keydown', (e) => {
    // Track pressed keys to manually detect repeating key presses (robust browser/OS fallback)
    const isRepeat = e.repeat || pressedKeys.has(e.key);
    pressedKeys.add(e.key);

    // Block key-repeat of the held key
    if (isRepeat) {
      if (e.key === longPressKey) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Popup is open: handle navigation and select keypresses
    if (specialCharPopupOpen) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSpecialCharPopup();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const selectedChar = popupOptions[highlightedOptionIdx];
        if (selectedChar) {
          replaceCharAtPos(selectedChar, answerTextarea);
        }
        hideSpecialCharPopup();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextIdx = (highlightedOptionIdx + 1) % popupOptions.length;
        updatePopupHighlight(nextIdx);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevIdx = (highlightedOptionIdx - 1 + popupOptions.length) % popupOptions.length;
        updatePopupHighlight(prevIdx);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const btn = document.querySelector(`#special-char-popup [data-num="${e.key}"]`);
        if (btn) {
          e.preventDefault();
          replaceCharAtPos(btn.dataset.char, answerTextarea);
          hideSpecialCharPopup();
        }
        return;
      }
      // Any other key (e.g. Backspace, letters): close the popup and let key go through
      hideSpecialCharPopup();
      return;
    }

    // Clear active timer if a DIFFERENT key is pressed
    if (e.key !== longPressKey && longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressKey = null;
    }

    // Match 2-character language base code (e.g. pt-BR -> pt)
    const lang = (state.activeDeck?.targetLang || '').toLowerCase().slice(0, 2);
    const map = SPECIAL_CHARS[lang] || {};
    const variants = map[e.key.toLowerCase()];
    if (!variants || variants.length === 0) return;

    // Start timer, but let the default behavior insert the character immediately
    longPressKey = e.key;
    const key = e.key;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      const isUpper = key !== key.toLowerCase();
      const casedVariants = isUpper ? variants.map(c => c.toUpperCase()) : variants;
      
      // Note the position of the character we just typed so we can replace it on selection
      const pos = answerTextarea.selectionStart;
      if (pos > 0 && answerTextarea.value[pos - 1] === key) {
        replacedCharPos = pos - 1;
        replacedChar = key;
      } else {
        replacedCharPos = -1;
        replacedChar = '';
      }
      
      if (casedVariants.length === 1) {
        replaceCharAtPos(casedVariants[0], answerTextarea);
      } else {
        showSpecialCharPopup(casedVariants, answerTextarea);
      }
    }, 400);
  });

  answerTextarea.addEventListener('keyup', (e) => {
    pressedKeys.delete(e.key);
    if (e.key === longPressKey) {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressKey = null;
    }
  });

  answerTextarea.addEventListener('blur', () => {
    pressedKeys.clear();
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressKey = null;
  });

  // Close popup when clicking outside
  document.addEventListener('mousedown', (e) => {
    if (specialCharPopupOpen && !e.target.closest('#special-char-popup')) {
      hideSpecialCharPopup();
    }
  });

  // Keyboard Shortcuts Support
  document.addEventListener('keydown', (e) => {
    // Avoid shortcuts firing inside text inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {

      // ENTER triggers validation inside Answer Textarea (skip if popup is open)
      if (e.key === 'Enter' && e.target.id === 'user-answer-input' && !e.shiftKey && !specialCharPopupOpen) {
        e.preventDefault();
        verifyAnswer();
      }
      return;
    }
    
    const key = e.key.toLowerCase();
    
    // Standard Trainer view shortcuts
    if (!document.getElementById('trainer-view').classList.contains('hide')) {
      if (!state.showAnswer) {
        // Validation & Skip triggers
        if (e.key === 'Enter') {
          verifyAnswer();
        } else if (key === 's' || e.key === 'ArrowRight') {
          skipCurrentCard();
        }
      } else {
        // Rating triggers
        if (e.key === '1') {
          submitCardRating('again');
        } else if (e.key === '2') {
          submitCardRating('hard');
        } else if (e.key === '3') {
          submitCardRating('good');
        } else if (e.key === '4') {
          submitCardRating('easy');
        } else if (key === 'v') {
          speakAudio();
        }
      }
    }
  });
});

// HTML escaping helper
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
