/**
 * Anki Trainer Hub - Client Application Logic
 */

// Handle for the auto-easy timeout so it can be cancelled on manual rating
let autoEasyTimeout = null;

// Pre-fetched audio for the currently displayed card, warmed up while the
// user is still typing so playback on submit has no network delay.
let preloadedAudio = null; // { cardId, audio }

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

/* ====================================================
   AI Memory Coach Engine (OpenAI-compatible Chat API)
   Adapted from Teach Yourself German Phrasebook Trainer
   ==================================================== */

const AI_SETTINGS_KEY = 'anki-ai-v1';
const AI_CACHE_KEY = 'anki-ai-cache-v1';
const AI_CACHE_MAX = 400;
const AI_DEFAULT_MODEL = 'google/gemini-2.5-flash';
const AI_DEFAULT_BASE = 'https://openrouter.ai/api/v1';
const AI_DEFAULT_LANG = 'fr';

let ai = (function() {
  const d = { enabled: false, apiKey: '', model: AI_DEFAULT_MODEL, baseUrl: AI_DEFAULT_BASE, lang: AI_DEFAULT_LANG };
  try {
    const r = JSON.parse(localStorage.getItem(AI_SETTINGS_KEY));
    if (r && typeof r === 'object') {
      for (const k in d) {
        if (k in r && r[k] !== undefined && r[k] !== null) d[k] = r[k];
      }
      if (!r.baseUrl && typeof r.endpoint === 'string' && r.endpoint) {
        d.baseUrl = r.endpoint.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
      }
    }
  } catch(e) {}
  if (!d.baseUrl) d.baseUrl = AI_DEFAULT_BASE;
  if (!d.model) d.model = AI_DEFAULT_MODEL;
  if (!d.lang) d.lang = AI_DEFAULT_LANG;
  return d;
})();

function saveAiSettings() {
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(ai)); } catch(e) {}
}

function aiConfigured() {
  return !!(ai.enabled && ai.apiKey && ai.model && ai.baseUrl);
}

function aiCompletionsUrl() {
  const b = String(ai.baseUrl || AI_DEFAULT_BASE).trim().replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(b) ? b : b + '/chat/completions';
}

function aiIsOpenRouter() {
  return /openrouter\.ai/i.test(String(ai.baseUrl || ''));
}

let aiCache = (function() {
  try {
    const r = JSON.parse(localStorage.getItem(AI_CACHE_KEY));
    return (r && typeof r === 'object') ? r : {};
  } catch(e) {
    return {};
  }
})();

function saveAiCache() {
  const keys = Object.keys(aiCache);
  if (keys.length > AI_CACHE_MAX) {
    keys.sort((a, b) => (aiCache[a].ts || 0) - (aiCache[b].ts || 0));
    keys.slice(0, keys.length - AI_CACHE_MAX).forEach(k => delete aiCache[k]);
  }
  try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(aiCache)); } catch(e) {}
}

function aiCacheKey(cardId, userAnswer, wasWrong) {
  return cardId + '|' + (wasWrong ? normalizeText(userAnswer) : '__ok__') + '|' + (ai.lang || 'fr');
}

/* Character-level diff for AI coach prompt (guarantees verified diff without model hallucinations) */
function alignChars(a, b) {
  const la = a.length, lb = b.length;
  const dp = [];
  for (let i = 0; i <= la; i++) {
    dp.push(new Array(lb + 1));
    dp[i][0] = i;
  }
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const subCost = (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + subCost, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }

  const dist = dp[la][lb];
  const ops = [];
  let i = la, j = lb;
  while (i > 0 || j > 0) {
    const subCost2 = (i > 0 && j > 0) ? ((a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) ? 0 : 1) : Infinity;
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + subCost2) {
      ops.push({ type: subCost2 === 0 ? 'equal' : 'sub', aCh: a[i - 1], bCh: b[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'del', aCh: a[i - 1], bCh: null });
      i--;
    } else {
      ops.push({ type: 'ins', aCh: null, bCh: b[j - 1] });
      j--;
    }
  }
  ops.reverse();
  return { ops, distance: dist };
}

function summarizeDiff(correct, answer) {
  const aligned = alignChars(correct, answer);
  const ops = aligned.ops;
  const groups = [];
  let cur = null, pos = 0;

  ops.forEach(op => {
    if (op.type === 'equal') {
      if (cur) { groups.push(cur); cur = null; }
      pos++;
    } else {
      if (!cur) cur = { ops: [], startPos: pos };
      cur.ops.push(op);
      if (op.type !== 'ins') pos++;
    }
  });
  if (cur) groups.push(cur);
  if (!groups.length) return null;

  const parts = groups.map(g => {
    const before = correct.slice(Math.max(0, g.startPos - 4), g.startPos);
    const consumed = g.ops.filter(o => o.type !== 'ins').length;
    const endPos = g.startPos + consumed;
    const after = correct.slice(endPos, endPos + 4);
    const missing = g.ops.filter(o => o.type === 'del').map(o => o.aCh).join('');
    const extra = g.ops.filter(o => o.type === 'ins').map(o => o.bCh).join('');
    const subs = g.ops.filter(o => o.type === 'sub');
    const desc = [];
    if (missing) desc.push('manquant "' + missing + '"');
    if (extra) desc.push('en trop "' + extra + '"');
    subs.forEach(o => { desc.push('"' + o.bCh + '" au lieu de "' + o.aCh + '"'); });
    return desc.join(', ') + ' (entre "...' + before + '" et "' + after + '...")';
  });
  return { desc: parts.join(' ; '), distance: aligned.distance };
}

const AI_LANG_NAMES = {
  de: { en: 'German', fr: 'allemand' },
  it: { en: 'Italian', fr: 'italien' },
  es: { en: 'Spanish', fr: 'espagnol' },
  en: { en: 'English', fr: 'anglais' },
  fr: { en: 'French', fr: 'français' },
  pt: { en: 'Portuguese', fr: 'portugais' },
  ja: { en: 'Japanese', fr: 'japonais' },
  ru: { en: 'Russian', fr: 'russe' },
  nl: { en: 'Dutch', fr: 'néerlandais' },
  zh: { en: 'Chinese', fr: 'chinois' },
  ar: { en: 'Arabic', fr: 'arabe' }
};

function getAiLangName(code, inLang) {
  const c = (code || 'it').toLowerCase();
  const item = AI_LANG_NAMES[c];
  if (item) return item[inLang] || item.en;
  return c;
}

function buildAiSystemPrompt(targetLangCode, sourceLangCode, explanationLang) {
  const isFr = (explanationLang || 'fr') === 'fr';
  const targetEn = getAiLangName(targetLangCode, 'en');
  const targetFr = getAiLangName(targetLangCode, 'fr');
  const sourceEn = getAiLangName(sourceLangCode, 'en');
  const sourceFr = getAiLangName(sourceLangCode, 'fr');

  let targetSpecificTips = '';
  if (targetLangCode === 'de') {
    targetSpecificTips = isFr
      ? [
          '   - Grammaire & ordre des mots : Si la position du verbe (ex: verbe en 2e position, verbe en fin de proposition subordonnée, verbe modal rejetant l\'infinitif à la fin), les préverbes séparables (particule rejetée à la fin), ou les cas/déclinaisons (accusatif vs datif, prépositions comme mit/zu/nach, der/die/das) posent problème, explique la règle simplement.',
          '   - Faux amis & vocabulaire : Si un faux-ami ou un autre mot a été utilisé (ex: "bekommen" = recevoir, pas devenir), clarifie la nuance.',
          '   - Orthographe / Umlauts : Si un tréma (ä/ö/ü), ß vs ss, ou l\'inversion ie/ei a été oublié, indique l\'impact sur le son et le sens (ex: schon = déjà, schön = beau).',
          '   - Registre : Si le formel (Sie/Ihnen) et le familier (du/dir) ont été confondus, précise le cadre social.'
        ].join('\n')
      : [
          '   - Grammar & word order: If verb placement (e.g. V2 in main clauses, verb at end in subordinate clauses, modal pushing infinitive to the end), separable prefixes, or case/endings (accusative vs dative, prepositions like mit/zu/nach, der/die/das) slipped, explain the rule simply.',
          '   - False friends & wrong words: If a false friend or wrong word was used (e.g. "bekommen" = get/receive, not become), contrast them.',
          '   - Spelling / Umlauts: If an umlaut (ä/ö/ü), ß vs ss, or vowel swap (ie vs ei) was missed, explain how that alters pronunciation and meaning.',
          '   - Register: If formal (Sie/Ihnen) vs familiar (du/dir) was mixed up, note the social setting.'
        ].join('\n');
  } else if (targetLangCode === 'it') {
    targetSpecificTips = isFr
      ? [
          '   - Grammaire & accords : Si la conjugaison, le choix de l\'auxiliaire au passé composé (essere vs avere), les pronoms clitiques (ci, ne, mi, ti, lo, la, gli...), les prépositions articulées (del, al, dal, nel, sul) ou les accords de genre/nombre (-o/-a/-i/-e) ont glissé, explique simplement.',
          '   - Faux amis & vocabulaire : Si un faux cognat (ex: "salire" = monter, pas partir; "camera" = chambre, pas caméra; "curare" = soigner) ou un autre terme a été employé, clarifie.',
          '   - Orthographe, accents & doubles consonnes (doppie) : Si un accent grave/aigu (è vs é, à, ò, ù) ou une consonne double (ex: fatto vs fato, anno vs ano) manque, souligne l\'impact sur le son et le sens.',
          '   - Registre : Si le vouvoiement (Lei) et le tutoiement (tu) ont été mélangés, rappelle le contexte.'
        ].join('\n')
      : [
          '   - Grammar & agreement: If verb conjugation, auxiliary choice in compound past (essere vs avere), clitic pronouns (ci, ne, mi, ti, lo, la, gli...), prepositions, or gender/plural agreements slipped, explain simply.',
          '   - False friends & wrong words: If a false friend or confusing word was used (e.g. "salire" = go up; "camera" = room), clarify.',
          '   - Spelling, accents & double consonants: If accents (è vs é, à, ò, ù) or double consonants (doppie, e.g. fatto vs fato) were missed, explain the distinction.',
          '   - Register: If formal (Lei) vs informal (tu) was mixed up, note the context.'
        ].join('\n');
  } else if (targetLangCode === 'es') {
    targetSpecificTips = isFr
      ? [
          '   - Grammaire & syntaxe : Si ser vs estar, por vs para, imparfait vs passé simple, le subjonctif, ou la place des pronoms compléments ont glissé, explique simplement.',
          '   - Faux amis & vocabulaire : (ex: "embarazada" = enceinte, pas embarrassée; "éxito" = succès), clarifie la confusion.',
          '   - Orthographe & accents (tildes) : Si un accent écrit (á, é, í, ó, ú, ñ) a été oublié, indique la nuance de sens ou d\'accent tonique (ex: está vs esta, hablo vs habló).',
          '   - Registre : Formel (Usted/Ustedes) vs familier (tú/vosotros).'
        ].join('\n')
      : [
          '   - Grammar & syntax: If ser vs estar, por vs para, preterite vs imperfect, subjunctive, or pronoun placement slipped, explain simply.',
          '   - False friends & wrong words: (e.g. "embarazada" = pregnant; "éxito" = success), clarify the confusion.',
          '   - Spelling & accents: If written accents (á, é, í, ó, ú, ñ) were missed, explain the change in stress or meaning (e.g. está vs esta).',
          '   - Register: Formal (Usted) vs informal (tú).'
        ].join('\n');
  } else if (targetLangCode === 'en') {
    targetSpecificTips = isFr
      ? [
          '   - Grammaire & phrasé : Verbes à particule (phrasal verbs), prétérit irrégulier, prépositions (in/on/at), faux amis (ex: actually = en fait, eventually = finalement).',
          '   - Orthographe : Lettres muettes, consonnes doubles.'
        ].join('\n')
      : [
          '   - Grammar & phrasing: Phrasal verbs, irregular past tense, prepositions (in/on/at), false friends.',
          '   - Spelling: Silent letters, doubled consonants.'
        ].join('\n');
  } else {
    targetSpecificTips = isFr
      ? [
          '   - Grammaire & syntaxe : Ordre des mots, particules/prépositions, accords et conjugaisons.',
          '   - Faux amis & vocabulaire : Clarifie la différence exacte entre le mot de l\'apprenant et le mot attendu.',
          '   - Orthographe & diacritiques : Souligne le piège de lettre ou d\'accent.'
        ].join('\n')
      : [
          '   - Grammar & syntax: Word order, particles/prepositions, inflections, or agreement rules.',
          '   - Wrong word / False friend: Clarify the distinction between learner\'s word and target word.',
          '   - Spelling & diacritics: Highlight specific character or spelling traps.'
        ].join('\n');
  }

  if (isFr) {
    return [
      `Tu es un coach linguistique expert, bienveillant et perspicace pour un locuteur de langue ${sourceFr} qui s'entraîne à maîtriser l'${targetFr} avec des cartes de répétition espacée.`,
      `L'apprenant s'exerce à traduire des phrases pour communiquer en situation réelle. La bonne réponse en ${targetFr} est DÉJÀ affichée à l'écran juste au-dessus de ton message. Tu ne donnes qu'UNE SEULE réponse ; l'apprenant ne peut pas poser de question de suivi.`,
      '',
      `TON OBJECTIF PRINCIPAL : Lorsque l'apprenant commet une erreur ou hésite, aide-le à comprendre POURQUOI il a glissé, offre-lui un CROCHET MÉMORIEL (mnémotechnique) percutant pour retenir la tournure en ${targetFr}, et donne-lui un CONSEIL RAPIDE pour réussir la prochaine fois.`,
      '',
      'SI L\'APPRENANT A COMMIS UNE ERREUR (Mode : CORRIGER UNE ERREUR) :',
      'Réponds avec exactement trois sections concises sous titres en gras :',
      '1. **Pourquoi cela a glissé :** Diagnostique précisément l\'erreur en 1 à 2 phrases amicales et pédagogiques (sans jargon abstrait).',
      targetSpecificTips,
      '   - Case vide / hésitation : Si l\'apprenant n\'a rien écrit ou ne savait pas, décompose la logique mot à mot de la phrase cible pour qu\'elle devienne intuitive.',
      `2. **Crochet mémoriel :** Donne le meilleur moyen mnémotechnique pour faire retenir la bonne réponse en ${targetFr} :`,
      `   - Cognat ou parenté de mot avec le ${sourceFr} ou l'anglais (liens étymologiques réels, jamais d'étymologie inventée).`,
      '   - Image mentale vivante, jeu de sonorité ou association d\'idées marquante.',
      '   - Décomposition littérale des mots composés ou des expressions idiomatiques.',
      '3. **Conseil rapide :** Une formule réflexe en une ligne, un repère mental ou une astuce de déclic pour ne plus hésiter la prochaine fois.',
      '',
      'SI L\'APPRENANT A RÉPONDU CORRECTEMENT (Mode : RENFORCER) :',
      'Réponds avec exactement deux sections courtes :',
      `1. **Crochet mémoriel :** Un lien étymologique, un cognat ou une décomposition pour ancrer durablement la tournure en ${targetFr}.`,
      '2. **Astuce d\'usage :** Une courte nuance sur l\'usage courant à l\'oral, l\'intonation naturelle ou le contexte quotidien.',
      '',
      'CONTRAINTES STRICTES :',
      '- Longueur totale : 70 à 120 mots. Concis, direct et instantanément lisible.',
      `- Langue de rédaction : Rédige TOUTE ton explication et tes titres en français. Les mots cibles en ${targetFr} doivent être en *italique*.`,
      '- Ne répète JAMAIS la réponse correcte seule sur la première ligne (l\'apprenant la voit déjà à l\'écran). Entre directement dans l\'explication.',
      '- Utilise un markdown propre (**gras** pour les titres et mots clés, *italique* pour les termes en langue cible).',
      '- Ton : Chaleureux, encourageant et très pratique pour la communication réelle.'
    ].join('\n');
  } else {
    return [
      `You are an expert, encouraging, and perceptive ${targetEn} language coach for a ${sourceEn} speaker practicing with flashcards.`,
      `The learner is drilling phrases and sentences for real conversation. The correct ${targetEn} answer is already prominently displayed on the learner's screen above your note. You get ONE reply; they cannot ask a follow-up.`,
      '',
      `YOUR PRIMARY GOAL: When the learner makes a mistake or gets stuck, help them understand WHY they slipped, give them a vivid memory hook / mnemonic to remember it, and give a quick tip so they get it right next time.`,
      '',
      'IF THE LEARNER MADE A MISTAKE (Mode: CORRECT A MISTAKE):',
      'Respond with three concise, high-value sections using bold headings:',
      '1. **Why that slipped:** Diagnose the exact mistake clearly in 1-2 friendly sentences (no dry academic jargon).',
      targetSpecificTips,
      '   - Left blank / stuck: Break down the literal word-for-word logic so the phrase makes intuitive sense.',
      `2. **Memory Hook:** Provide the single most memorable hook to make the correct ${targetEn} stick:`,
      `   - Cognate or word-family connection with ${sourceEn} or English. Never invent false etymology.`,
      '   - Vivid mental image, sound-alike, or wordplay for unfamiliar words.',
      '   - Literal breakdown of compound words or idioms.',
      '3. **Quick Tip:** A punchy 1-line rule-of-thumb, trigger formula, or mental shortcut to nail it next time.',
      '',
      'IF THE LEARNER ANSWERED CORRECTLY (Mode: REINFORCE):',
      'Respond with two short sections:',
      `1. **Memory Hook:** A memorable cognate, etymological link, or compound word breakdown to deepen long-term retention.`,
      '2. **Native Tip:** A brief nuance on spoken usage, natural intonation, or phrasebook context.',
      '',
      'STRICT CONSTRAINTS:',
      '- Total length: 70 to 120 words. Concise, punchy, and instantly scannable.',
      '- Write the explanation and headings in English.',
      `- Never repeat the correct ${targetEn} answer on its own as line 1 (the learner is already looking at it on screen). Jump straight into the explanation.`,
      '- Use clean markdown (**bold** for headings and key words, *italics* for target language words and meanings).',
      '- Tone: Warm, empowering, and practical for real-world communication.'
    ].join('\n');
  }
}

function buildAiUserMsg(card, userAnswer, wasWrong, targetLangCode, opts) {
  opts = opts || {};
  const isFr = (ai.lang || 'fr') === 'fr';
  const targetName = getAiLangName(targetLangCode, isFr ? 'fr' : 'en');
  const lines = [
    'Mode: ' + (wasWrong ? 'CORRECT A MISTAKE' : 'REINFORCE - they answered correctly'),
    'Deck: ' + ((state.activeDeck && state.activeDeck.name) || 'Deck') + ' (' + targetName + ')',
    'Lesson: ' + (card.lesson || 'Général'),
    'Prompt line: "' + (card.fr || '') + '"',
    'Target ' + targetName + ' answer: "' + (card.target || '') + '"'
  ];

  if (card.grammatical) lines.push('Grammar note: "' + card.grammatical + '"');
  if (card.cloze) lines.push('Cloze sentence context: "' + card.cloze + '"');

  if (!wasWrong) {
    lines.push('Learner\'s answer: (answered correctly)');
  } else {
    const trimmed = (userAnswer || '').trim();
    if (!trimmed) {
      lines.push('Learner\'s answer: (left blank / did not know)');
      lines.push('Mistake category: The learner was stuck or gave up. Break down the phrase and explain how it is built.');
    } else {
      lines.push('Learner\'s answer: "' + trimmed + '"');
      try {
        const sDiff = summarizeDiff(card.target, trimmed);
        if (sDiff && sDiff.desc) {
          const maxCloseDist = Math.max(2, Math.floor(card.target.length * 0.35));
          if (sDiff.distance <= maxCloseDist && sDiff.distance <= 4) {
            lines.push('Verified spelling diff: ' + sDiff.desc);
            lines.push('Mistake category: Close typo or spelling slip. Highlight the exact letter or accent trap.');
          } else {
            lines.push('Mistake category: The learner provided a different word or phrasing ("' + trimmed + '") instead of "' + card.target + '". Contrast them, explain what the learner\'s word means (or why it doesn\'t fit), and clarify the grammatical or vocabulary difference.');
          }
        }
      } catch(e) {}
    }
  }

  if (opts.lapses > 1) {
    lines.push('Missed ' + opts.lapses + ' times before: Earlier hints did not stick. Use an extra vivid or different mnemonic angle.');
  }
  if (opts.retry) {
    lines.push('User requested a different hint: Provide a fresh perspective or an alternative mnemonic.');
  }

  return lines.join('\n');
}

let aiCtrl = null;
let aiReqSeq = 0;

function renderAiMarkdown(text) {
  if (!text) return '';
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*([^\*\n]+?)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  const lines = escaped.split(/\r?\n/);
  const out = [];
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^[-*•]\s+(.*)$/);
    if (m) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + m[1] + '</li>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line) {
        out.push('<p>' + line + '</p>');
      }
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function renderAiBox(boxState, text) {
  const box = document.getElementById('aihint');
  const askBtn = document.getElementById('ai-ask-btn');
  if (!box) return;

  box.classList.remove('hide', 'err');
  if (askBtn) askBtn.classList.add('hide');

  const isFr = (ai.lang || 'fr') === 'fr';
  const headerText = isFr ? 'Coach mémoire' : 'Memory coach';
  const retryText = isFr ? 'Autre conseil' : 'Different hint';
  const errRetryText = isFr ? 'Réessayer' : 'Try again';

  if (boxState === 'loading') {
    box.innerHTML = `<div class="aihdr"><span class="aispin"></span> ${headerText}</div>`;
  } else if (boxState === 'ok') {
    box.innerHTML = `<div class="aihdr">💭 ${headerText}</div>` +
                    `<div class="aibody">${renderAiMarkdown(text)}</div>` +
                    `<button type="button" class="retry" id="aiFreshBtn">${retryText}</button>`;
    const fb = document.getElementById('aiFreshBtn');
    if (fb) fb.addEventListener('click', () => { askCoach(true); });
  } else {
    box.classList.add('err');
    box.innerHTML = `<div class="aihdr">${headerText} — indisponible</div>` +
                    `<div class="aibody">${escapeHtml(text)}</div>` +
                    `<button type="button" class="retry" id="aiRetryBtn">${errRetryText}</button>`;
    const rb = document.getElementById('aiRetryBtn');
    if (rb) rb.addEventListener('click', () => { askCoach(true); });
  }
}

function hideAiBox() {
  if (aiCtrl) {
    try { aiCtrl.abort(); } catch(e) {}
    aiCtrl = null;
  }
  aiReqSeq++;
  const box = document.getElementById('aihint');
  if (box) {
    box.classList.add('hide', 'err');
    box.innerHTML = '';
  }
  const askBtn = document.getElementById('ai-ask-btn');
  if (askBtn) askBtn.classList.add('hide');
}

function askCoach(force) {
  if (!state.currentCard || !aiConfigured()) return;

  if (autoEasyTimeout) {
    clearTimeout(autoEasyTimeout);
    autoEasyTimeout = null;
  }

  const card = state.currentCard;
  const target = card.target || '';
  const userAnswer = (document.getElementById('user-answer-input').value || '').trim();
  const score = checkSimilarity(userAnswer, target);
  const isAccepted = score >= 0.8;
  const wasWrong = !isAccepted;
  const ckey = aiCacheKey(card.id, userAnswer, wasWrong);

  if (!force && aiCache[ckey] && aiCache[ckey].t) {
    renderAiBox('ok', aiCache[ckey].t);
    return;
  }

  if (aiCtrl) {
    try { aiCtrl.abort(); } catch(e) {}
  }
  aiCtrl = ('AbortController' in window) ? new AbortController() : null;
  const seq = ++aiReqSeq;
  renderAiBox('loading');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + ai.apiKey,
    'X-Title': 'Anki Trainer Hub'
  };
  if (/^https?:/i.test(location.origin)) {
    headers['HTTP-Referer'] = location.origin;
  }

  const targetLang = (state.activeDeck && state.activeDeck.targetLang) || 'it';
  const cardProg = state.progress[card.id];
  const userMsg = buildAiUserMsg(card, userAnswer, wasWrong, targetLang, {
    lapses: cardProg ? (cardProg.lapses || 0) : 0,
    retry: !!force
  });
  const sysPrompt = buildAiSystemPrompt(targetLang, 'fr', ai.lang || 'fr');

  const body = {
    model: ai.model,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userMsg }
    ],
    temperature: 0.75,
    max_tokens: 1200
  };
  if (aiIsOpenRouter()) {
    body.reasoning = { effort: 'low' };
  }

  fetch(aiCompletionsUrl(), {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
    signal: aiCtrl ? aiCtrl.signal : undefined
  })
  .then(r => r.json().then(j => ({ status: r.status, j }), () => ({ status: r.status, j: null })))
  .then(res => {
    if (seq !== aiReqSeq) return;
    const j = res.j || {};
    if (res.status < 200 || res.status >= 300 || j.error) {
      const msg = (j.error && (j.error.message || j.error.type)) || ('HTTP ' + res.status);
      renderAiBox('error', String(msg));
      return;
    }
    const choice = j && j.choices && j.choices[0];
    const text = (choice && choice.message && choice.message.content || '').trim();
    if (!text) {
      const fr = choice && (choice.finish_reason || choice.native_finish_reason);
      renderAiBox('error', fr === 'length'
        ? 'Le modèle a épuisé son quota de tokens avant de répondre. Essayez un modèle non-raisonnant.'
        : 'Le modèle a renvoyé une réponse vide.');
      return;
    }
    aiCache[ckey] = { t: text, ts: Date.now() };
    saveAiCache();
    renderAiBox('ok', text);
  })
  .catch(err => {
    if (seq !== aiReqSeq) return;
    if (err && err.name === 'AbortError') return;
    renderAiBox('error', (err && err.message) ? err.message : 'Erreur de connexion avec l\'API.');
  });
}

function syncAiToForms() {
  // Dashboard inputs
  const ed = document.getElementById('ai-enabled-dashboard');
  const kd = document.getElementById('ai-key-dashboard');
  const md = document.getElementById('ai-model-dashboard');
  const bd = document.getElementById('ai-base-url-dashboard');
  const ld = document.getElementById('ai-lang-dashboard');

  if (ed) ed.checked = !!ai.enabled;
  if (kd) kd.value = ai.apiKey || '';
  if (md) md.value = ai.model || AI_DEFAULT_MODEL;
  if (bd) bd.value = ai.baseUrl || AI_DEFAULT_BASE;
  if (ld) ld.value = ai.lang || AI_DEFAULT_LANG;

  // Modal inputs
  const em = document.getElementById('ai-enabled-modal');
  const km = document.getElementById('ai-key-modal');
  const mm = document.getElementById('ai-model-modal');
  const bm = document.getElementById('ai-base-url-modal');
  const lm = document.getElementById('ai-lang-modal');

  if (em) em.checked = !!ai.enabled;
  if (km) km.value = ai.apiKey || '';
  if (mm) mm.value = ai.model || AI_DEFAULT_MODEL;
  if (bm) bm.value = ai.baseUrl || AI_DEFAULT_BASE;
  if (lm) lm.value = ai.lang || AI_DEFAULT_LANG;

  // Sidebar controls
  const es = document.getElementById('ai-enabled-sidebar');
  if (es) es.checked = !!ai.enabled;

  const badge = document.getElementById('ai-sidebar-badge');
  if (badge) {
    if (ai.enabled) {
      badge.innerText = 'Actif';
      badge.className = 'badge badge-success drawer-glance';
    } else {
      badge.innerText = 'Inactif';
      badge.className = 'badge drawer-glance';
    }
  }
}

function syncAiFromDashboard() {
  const ed = document.getElementById('ai-enabled-dashboard');
  const kd = document.getElementById('ai-key-dashboard');
  const md = document.getElementById('ai-model-dashboard');
  const bd = document.getElementById('ai-base-url-dashboard');
  const ld = document.getElementById('ai-lang-dashboard');

  if (ed) ai.enabled = ed.checked;
  if (kd) ai.apiKey = kd.value.trim();
  if (md) ai.model = md.value.trim() || AI_DEFAULT_MODEL;
  if (bd) ai.baseUrl = bd.value.trim().replace(/\/+$/, '') || AI_DEFAULT_BASE;
  if (ld) ai.lang = ld.value || AI_DEFAULT_LANG;

  saveAiSettings();
  syncAiToForms();
}

function syncAiFromModal() {
  const em = document.getElementById('ai-enabled-modal');
  const km = document.getElementById('ai-key-modal');
  const mm = document.getElementById('ai-model-modal');
  const bm = document.getElementById('ai-base-url-modal');
  const lm = document.getElementById('ai-lang-modal');

  if (em) ai.enabled = em.checked;
  if (km) ai.apiKey = km.value.trim();
  if (mm) ai.model = mm.value.trim() || AI_DEFAULT_MODEL;
  if (bm) ai.baseUrl = bm.value.trim().replace(/\/+$/, '') || AI_DEFAULT_BASE;
  if (lm) ai.lang = lm.value || AI_DEFAULT_LANG;

  saveAiSettings();
  syncAiToForms();
}

function testAiConnection(outputEl) {
  if (!outputEl) return;
  if (!ai.apiKey) {
    outputEl.textContent = '✗ Saisissez d\'abord une clé API.';
    outputEl.style.color = 'var(--danger)';
    return;
  }
  outputEl.textContent = 'Test en cours…';
  outputEl.style.color = 'var(--text-muted)';

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + ai.apiKey,
    'X-Title': 'Anki Trainer Hub'
  };
  if (/^https?:/i.test(location.origin)) {
    headers['HTTP-Referer'] = location.origin;
  }

  fetch(aiCompletionsUrl(), {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
      max_tokens: 5
    })
  })
  .then(r => r.json().then(j => ({ status: r.status, j }), () => ({ status: r.status, j: null })))
  .then(res => {
    const j = res.j || {};
    if (res.status >= 200 && res.status < 300 && j.choices) {
      outputEl.textContent = '✓ Connecté — ' + ai.model;
      outputEl.style.color = 'var(--success)';
    } else {
      const m = (j.error && (j.error.message || j.error.type)) || ('HTTP ' + res.status);
      outputEl.textContent = '✗ ' + m;
      outputEl.style.color = 'var(--danger)';
    }
  })
  .catch(e => {
    outputEl.textContent = '✗ ' + ((e && e.message) || 'Erreur réseau');
    outputEl.style.color = 'var(--danger)';
  });
}

function initAiCoachUI() {
  syncAiToForms();

  // Dashboard inputs change/input
  ['ai-enabled-dashboard', 'ai-key-dashboard', 'ai-model-dashboard', 'ai-base-url-dashboard', 'ai-lang-dashboard'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', syncAiFromDashboard);
      el.addEventListener('input', syncAiFromDashboard);
    }
  });

  // Modal inputs change/input
  ['ai-enabled-modal', 'ai-key-modal', 'ai-model-modal', 'ai-base-url-modal', 'ai-lang-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', syncAiFromModal);
      el.addEventListener('input', syncAiFromModal);
    }
  });

  // Sidebar toggle
  const es = document.getElementById('ai-enabled-sidebar');
  if (es) {
    es.addEventListener('change', () => {
      ai.enabled = es.checked;
      saveAiSettings();
      syncAiToForms();
    });
  }

  // Dashboard buttons
  const testBtnDash = document.getElementById('ai-test-btn-dashboard');
  if (testBtnDash) {
    testBtnDash.addEventListener('click', () => {
      syncAiFromDashboard();
      testAiConnection(document.getElementById('ai-test-out-dashboard'));
    });
  }

  const clearBtnDash = document.getElementById('ai-clear-cache-btn-dashboard');
  if (clearBtnDash) {
    clearBtnDash.addEventListener('click', () => {
      aiCache = {};
      try { localStorage.removeItem(AI_CACHE_KEY); } catch(e) {}
      const out = document.getElementById('ai-test-out-dashboard');
      if (out) {
        out.textContent = 'Cache d\'indices vidé.';
        out.style.color = 'var(--text-muted)';
      }
    });
  }

  // Modal open/close & buttons
  const openModalBtn = document.getElementById('open-ai-settings-btn');
  const modalEl = document.getElementById('ai-settings-modal');
  const closeModalBtn = document.getElementById('close-ai-settings-modal-btn');
  const saveModalBtn = document.getElementById('save-ai-settings-btn');

  if (openModalBtn && modalEl) {
    openModalBtn.addEventListener('click', () => {
      syncAiToForms();
      modalEl.classList.remove('hide');
    });
  }

  if (closeModalBtn && modalEl) {
    closeModalBtn.addEventListener('click', () => {
      modalEl.classList.add('hide');
    });
  }

  if (saveModalBtn && modalEl) {
    saveModalBtn.addEventListener('click', () => {
      syncAiFromModal();
      modalEl.classList.add('hide');
    });
  }

  const testBtnModal = document.getElementById('ai-test-btn-modal');
  if (testBtnModal) {
    testBtnModal.addEventListener('click', () => {
      syncAiFromModal();
      testAiConnection(document.getElementById('ai-test-out-modal'));
    });
  }

  const clearBtnModal = document.getElementById('ai-clear-cache-btn-modal');
  if (clearBtnModal) {
    clearBtnModal.addEventListener('click', () => {
      aiCache = {};
      try { localStorage.removeItem(AI_CACHE_KEY); } catch(e) {}
      const out = document.getElementById('ai-test-out-modal');
      if (out) {
        out.textContent = 'Cache vidé.';
        out.style.color = 'var(--text-muted)';
      }
    });
  }

  // Ask Coach button click in study card
  const askBtn = document.getElementById('ai-ask-btn');
  if (askBtn) {
    askBtn.addEventListener('click', () => {
      if (autoEasyTimeout) {
        clearTimeout(autoEasyTimeout);
        autoEasyTimeout = null;
      }
      askCoach(false);
    });
  }
}

// ====================================================
// Session Mistakes Tracking & Export for Advanced Agent (ChatGPT / Claude)
// ====================================================
const SESSION_MISTAKES_KEY = 'anki-session-mistakes';
let sessionMistakes = loadSessionMistakes();

function loadSessionMistakes() {
  try {
    const raw = localStorage.getItem(SESSION_MISTAKES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveSessionMistakes() {
  try {
    localStorage.setItem(SESSION_MISTAKES_KEY, JSON.stringify(sessionMistakes));
  } catch (e) {}
}

function recordSessionMistake(card, userAnswer) {
  if (!card) return;
  const cardId = card.id;
  const typed = (userAnswer || '').trim();
  const deckTitle = (state.activeDeck && state.activeDeck.title) || '';
  const targetLang = (state.activeDeck && state.activeDeck.targetLang) || 'it';

  let diffDesc = '';
  try {
    const sDiff = summarizeDiff(card.target, typed);
    if (sDiff && sDiff.desc) {
      diffDesc = sDiff.desc;
    }
  } catch (e) {}

  const existingIdx = sessionMistakes.findIndex(m => m.id === cardId);
  const now = Date.now();

  if (existingIdx >= 0) {
    const existing = sessionMistakes[existingIdx];
    existing.attempts = (existing.attempts || 1) + 1;
    if (typed) existing.userAnswer = typed;
    if (diffDesc) existing.diffDesc = diffDesc;
    existing.timestamp = now;
  } else {
    sessionMistakes.push({
      id: cardId,
      deckTitle: deckTitle,
      targetLang: targetLang,
      fr: card.fr || '',
      target: card.target || '',
      userAnswer: typed,
      diffDesc: diffDesc,
      lesson: card.lesson || '',
      grammatical: card.grammatical || '',
      cloze: card.cloze || '',
      timestamp: now,
      attempts: 1
    });
  }

  saveSessionMistakes();
  updateMistakesUI();
}

function clearSessionMistakes() {
  if (sessionMistakes.length === 0) return;
  if (!confirm(`Voulez-vous vraiment effacer l'historique des ${sessionMistakes.length} erreur(s) de cette session ?`)) {
    return;
  }
  sessionMistakes = [];
  saveSessionMistakes();
  updateMistakesUI();
  const preview = document.getElementById('mistakes-prompt-preview');
  if (preview) preview.value = '';
  const modal = document.getElementById('session-mistakes-modal');
  if (modal && !modal.classList.contains('hide')) {
    modal.classList.add('hide');
  }
}

function generateMistakesPrompt() {
  if (!sessionMistakes || sessionMistakes.length === 0) {
    return 'Aucune erreur enregistrée pour cette session.';
  }

  const isEn = (ai.lang || 'fr') === 'en';
  const targetLangs = [...new Set(sessionMistakes.map(m => m.targetLang).filter(Boolean))];
  const langDisplay = targetLangs.map(l => getAiLangName(l, isEn ? 'en' : 'fr')).join(', ') || 'la langue cible';

  const header = isEn
    ? `You are an expert language tutor and memory coach.\n` +
      `Below is a list of flashcards / sentences that I got WRONG during my spaced repetition practice session (${langDisplay}).\n\n` +
      `For EACH item below, provide:\n` +
      `1. Precise Diagnosis: Why was my answer wrong? (spelling slip, grammatical error, false friend, wrong preposition/case, or completely different word).\n` +
      `2. Reflex Rule: A concise 1-2 sentence rule or trick to immediately recall the correct structure next time.\n` +
      `3. Memory Hook / Mnemonic: A vivid association, imagery, or etymological link to anchor the correct answer in memory.\n` +
      `4. Two Micro-Examples: 2 short, natural example sentences using this target expression in context (with English translations).\n\n` +
      `At the end, provide a brief synthesis of the top 2-3 grammar or vocabulary patterns I should drill next.\n\n` +
      `==================================================\n` +
      `SESSION MISTAKES LIST (${sessionMistakes.length} card${sessionMistakes.length > 1 ? 's' : ''}):\n` +
      `==================================================\n\n`
    : `Tu es un tuteur expert en langues vivantes et un pédagogue spécialisé en mémorisation.\n` +
      `Voici la liste des cartes / phrases sur lesquelles j'ai échoué lors de ma session d'entraînement Anki (${langDisplay}).\n\n` +
      `Pour CHAQUE carte ci-dessous, donne-moi :\n` +
      `1. Diagnostic précis : Pourquoi ma réponse est fausse ou inadaptée (faute d'inattention, faux-ami, mauvaise déclinaison/conjugaison, préposition erronée, mot différent, ordre des mots).\n` +
      `2. Règle réflexe : Une règle simple et percutante en 1 à 2 phrases pour faire le bon choix sans hésiter.\n` +
      `3. Crochet mémoriel / Mnémotechnique : Une image mentale marquante, un pont étymologique ou une astuce pour ancrer définitivement la bonne réponse.\n` +
      `4. Deux exemples concrets : 2 phrases courtes et naturelles réutilisant la structure ou le mot clé en contexte (avec leur traduction).\n\n` +
      `Termine par un court bilan de synthèse des 2 ou 3 points clés à retravailler en priorité d'après cette série d'erreurs.\n\n` +
      `==================================================\n` +
      `LISTE DES ERREURS DE LA SESSION (${sessionMistakes.length} carte${sessionMistakes.length > 1 ? 's' : ''}) :\n` +
      `==================================================\n\n`;

  const items = sessionMistakes.map((m, idx) => {
    const num = idx + 1;
    const userAns = m.userAnswer ? `"${m.userAnswer}"` : (isEn ? '(left blank / skipped)' : '(laissé vide / passé)');
    const diff = m.diffDesc ? ` [Écart : ${m.diffDesc}]` : '';
    const attempts = m.attempts > 1 ? ` (${m.attempts} échecs)` : '';
    const lesson = m.lesson ? ` | Leçon : ${m.lesson}` : '';
    const grammar = m.grammatical ? ` | Grammaire : ${m.grammatical}` : '';
    const cloze = m.cloze ? ` | Cloze : ${m.cloze}` : '';
    const deck = m.deckTitle ? ` [Deck : ${m.deckTitle}]` : '';

    return `${num}. Question / Source : "${m.fr}"${deck}\n` +
           `   • Réponse attendue : "${m.target}"\n` +
           `   • Ma réponse : ${userAns}${diff}${attempts}\n` +
           (lesson || grammar || cloze ? `   • Contexte :${lesson}${grammar}${cloze}\n` : '') +
           `\n`;
  }).join('');

  return header + items;
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  return new Promise((resolve, reject) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        resolve();
      } else {
        reject(new Error('execCommand copy failed'));
      }
    } catch (err) {
      reject(err);
    }
  });
}

function copyMistakesPrompt(statusEl, btnEl) {
  if (!sessionMistakes || sessionMistakes.length === 0) {
    if (statusEl) {
      statusEl.textContent = 'Aucune erreur à copier.';
      statusEl.style.color = 'var(--text-muted)';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
    }
    return;
  }

  const promptText = generateMistakesPrompt();

  copyTextToClipboard(promptText).then(() => {
    if (statusEl) {
      statusEl.textContent = '✓ Copié ! Prêt pour ChatGPT.';
      statusEl.style.color = 'var(--success)';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3500);
    }
    if (btnEl) {
      const origHtml = btnEl.innerHTML;
      btnEl.innerHTML = `<span>✓ Copié !</span>`;
      setTimeout(() => { if (btnEl) btnEl.innerHTML = origHtml; }, 2000);
    }
  }).catch(() => {
    if (statusEl) {
      statusEl.textContent = '✗ Impossible de copier automatiquement.';
      statusEl.style.color = 'var(--danger)';
    }
  });
}

function updateMistakesUI() {
  const count = sessionMistakes.length;
  const badge = document.getElementById('mistakes-count-badge');
  const copyBtn = document.getElementById('copy-mistakes-btn');
  const viewBtn = document.getElementById('view-mistakes-btn');
  const preview = document.getElementById('mistakes-prompt-preview');

  if (badge) {
    badge.textContent = count;
    if (count > 0) {
      badge.classList.add('has-mistakes');
    } else {
      badge.classList.remove('has-mistakes');
    }
  }

  if (copyBtn) copyBtn.disabled = (count === 0);
  if (viewBtn) viewBtn.disabled = (count === 0);

  if (preview && preview.offsetParent !== null) {
    preview.value = generateMistakesPrompt();
  }
}

function initSessionMistakesUI() {
  updateMistakesUI();

  const copyBtn = document.getElementById('copy-mistakes-btn');
  const copyStatus = document.getElementById('copy-mistakes-status');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      copyMistakesPrompt(copyStatus, copyBtn);
    });
  }

  const clearBtn = document.getElementById('clear-mistakes-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearSessionMistakes);
  }

  const viewBtn = document.getElementById('view-mistakes-btn');
  const modal = document.getElementById('session-mistakes-modal');
  const preview = document.getElementById('mistakes-prompt-preview');
  if (viewBtn && modal) {
    viewBtn.addEventListener('click', () => {
      if (preview) preview.value = generateMistakesPrompt();
      modal.classList.remove('hide');
    });
  }

  const closeBtn1 = document.getElementById('close-mistakes-modal-btn');
  const closeBtn2 = document.getElementById('close-mistakes-modal-btn-2');
  [closeBtn1, closeBtn2].forEach(btn => {
    if (btn && modal) {
      btn.addEventListener('click', () => {
        modal.classList.add('hide');
      });
    }
  });

  const modalCopyBtn = document.getElementById('copy-mistakes-modal-btn');
  if (modalCopyBtn) {
    modalCopyBtn.addEventListener('click', () => {
      copyMistakesPrompt(null, modalCopyBtn);
    });
  }

  const modalClearBtn = document.getElementById('clear-mistakes-modal-btn');
  if (modalClearBtn) {
    modalClearBtn.addEventListener('click', clearSessionMistakes);
  }
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
    syncAiToForms();
    updateMistakesUI();
  } else if (hash.startsWith('#deck/')) {
    // Show Trainer
    const deckId = hash.replace('#deck/', '');
    document.getElementById('dashboard-view').classList.add('hide');
    document.getElementById('trainer-view').classList.remove('hide');
    backBtn.classList.remove('hide');
    headerLogo.style.cursor = 'pointer';
    loadDeck(deckId);
    syncAiToForms();
    updateMistakesUI();
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
          <button class="deck-btn-delete" title="Enrichir le deck" onclick="event.stopPropagation(); openEnrichModal('${deck.id}', '${escapeHtml(deck.name)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 21l-.813-5.096L3.1 15.09l5.087-.805L9 9.186l.813 5.098 5.087.805-5.087.815zm10.742-8.528L19.5 12l-1.055-4.624L13.82 6.32l4.625-1.056L19.5 1l1.055 4.264 4.625 1.056-4.625 1.056z" />
            </svg>
          </button>
          <button class="deck-btn-delete" title="Exporter le deck" onclick="event.stopPropagation(); exportDeck('${deck.id}', '${escapeHtml(deck.name)}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
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

    // If route changed while fetching, abort to prevent race conditions
    if (window.location.hash !== '#deck/' + deckId) return;

    state.activeDeck = await res.json();
    state.activeDeck.id = deckId;

    // Pull latest sync data before reading localStorage, so we always have fresh progress
    const syncCode = localStorage.getItem('anki-sync-code');
    if (syncCode) {
      await loadAllProgress(syncCode, true);
      // If route changed while loading sync progress, abort
      if (window.location.hash !== '#deck/' + deckId) return;
    }

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
    
    // Safety check in case activeDeck was cleared
    if (!state.activeDeck) return;

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

async function exportDeck(deckId, deckName) {
  try {
    const res = await fetch(`/api/decks/${deckId}`);
    if (!res.ok) throw new Error("Impossible de charger le deck.");
    const deck = await res.json();
    const cards = deck.cards || [];

    const progress = JSON.parse(localStorage.getItem(`progress_${deckId}`) || '{}');

    const headers = [
      "Index",
      "Langue Cible",
      "Traduction (fr)",
      "Target (Cible)",
      "Lecon",
      "Classification Grammaticale",
      "Phrase a trou (cloze)",
      "Nombre de revisions",
      "Repetitions réussies",
      "Intervalle (jours)",
      "Facteur de facilite",
      "Prochaine revision",
      "Temps d'attente restant"
    ];

    const rows = cards.map(c => {
      const prog = progress[c.id] || {};
      const reps = prog.reps || 0;
      const interval = prog.interval || 0;
      const ease = prog.ease || 2.5;
      const reviews = prog.reviews || 0;
      const dueAt = prog.dueAt || '';

      let waitTime = "Jamais revise";
      if (reps > 0) {
        if (!dueAt || new Date(dueAt) <= new Date()) {
          waitTime = "Pret a reviser";
        } else {
          const diffMs = new Date(dueAt) - new Date();
          const diffHours = Math.round(diffMs / (60 * 60 * 1000));
          if (diffHours < 24) {
            waitTime = `${diffHours} heure${diffHours > 1 ? 's' : ''}`;
          } else {
            const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
            waitTime = `${diffDays} jour${diffDays > 1 ? 's' : ''}`;
          }
        }
      }

      const formattedDue = dueAt ? new Date(dueAt).toLocaleString('fr-FR') : '';

      return [
        c.index,
        deck.targetLang.toUpperCase(),
        c.fr || '',
        c.target || '',
        c.lesson || 'General',
        c.grammatical || '',
        c.cloze || '',
        reviews,
        reps,
        interval,
        ease.toFixed(2),
        formattedDue,
        waitTime
      ];
    });

    const csvContent = [headers, ...rows].map(row => 
      row.map(val => {
        const text = String(val === null || val === undefined ? '' : val);
        return `"${text.replace(/"/g, '""')}"`;
      }).join(';')
    ).join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    
    const safeName = deckName.replace(/[^a-z0-9_-]/gi, '_');
    link.setAttribute("download", `export_deck_${safeName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    alert(`Erreur d'exportation : ${err.message}`);
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
  preloadCardAudio(nextCard);

  // Populate UI
  document.getElementById('study-container').classList.remove('hide');
  document.getElementById('no-cards-state').classList.add('hide');
  document.getElementById('origin-sentence-text').innerText = nextCard.fr;
  
  // Update grammar classification hint
  const grammarEl = document.getElementById('card-grammar-hint');
  if (grammarEl) {
    if (nextCard.grammatical) {
      grammarEl.innerText = nextCard.grammatical;
      grammarEl.classList.remove('hide');
    } else {
      grammarEl.classList.add('hide');
    }
  }

  // Update cloze sentence hint
  const clozeEl = document.getElementById('card-cloze-hint');
  if (clozeEl) {
    if (nextCard.cloze) {
      clozeEl.innerText = nextCard.cloze;
      clozeEl.classList.remove('hide');
    } else {
      clozeEl.classList.add('hide');
    }
  }

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

  // Glance badge on the collapsed drawer header — visible without opening it
  const dueGlance = document.getElementById('stat-due-glance');
  if (dueGlance) {
    if (dueCount > 0) {
      dueGlance.innerText = `${dueCount} dues`;
      dueGlance.classList.remove('hide');
    } else {
      dueGlance.classList.add('hide');
    }
  }

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

  const accuracyGlance = document.getElementById('session-accuracy-glance');
  if (accuracyGlance) accuracyGlance.innerText = `${accuracy}%`;
}

// UI Controls Reset
function resetTrainerUI() {
  document.getElementById('feedback-section').classList.add('hide');
  document.getElementById('submit-answer-btn').classList.remove('hide');
  document.getElementById('skip-card-btn').classList.remove('hide');
  hideAiBox();
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
  } else {
    recordSessionMistake(state.currentCard, typed);
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

  // 6. AI Memory Coach: Auto-explain on a miss, or offer it on demand
  if (aiConfigured()) {
    if (!isAccepted) {
      askCoach(false);
    } else {
      const askBtn = document.getElementById('ai-ask-btn');
      if (askBtn) askBtn.classList.remove('hide');
    }
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
  
  if (rating === 'again') {
    const typed = (document.getElementById('user-answer-input') || {}).value || '';
    recordSessionMistake(state.currentCard, typed);
  }
  
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

// Builds the pre-generated WaveNet MP3 URL for a card in the active deck.
function audioUrlForCard(card) {
  const targetLang = (state.activeDeck.targetLang || 'it').toLowerCase();
  const targetHash = hashText(card.target);
  return `/audio/${card.id}_${targetHash}_${targetLang}.mp3`;
}

// Starts fetching the current card's audio in the background as soon as the
// card is shown, so it is already buffered by the time the user submits an
// answer and speakAudio() actually plays it.
function preloadCardAudio(card) {
  if (!card || !state.activeDeck) return;
  const audio = new Audio(audioUrlForCard(card));
  audio.preload = 'auto';
  audio.onerror = () => {}; // ignored — speakAudio() falls back to browser TTS when played
  preloadedAudio = { cardId: card.id, audio };
}

// Text-To-Speech Playback — uses pre-generated WaveNet MP3 if available, falls back to browser TTS
function speakAudio() {
  if (!state.currentCard || !state.activeDeck) return;

  const cardId = state.currentCard.id;
  let fallbackFired = false;
  const fallback = () => { if (!fallbackFired) { fallbackFired = true; speakBrowserTTS(); } };

  // Reuse the pre-fetched audio for this card when available so playback
  // starts immediately instead of waiting on a fresh network request.
  let audio;
  if (preloadedAudio && preloadedAudio.cardId === cardId) {
    audio = preloadedAudio.audio;
    audio.currentTime = 0;
  } else {
    audio = new Audio(audioUrlForCard(state.currentCard));
  }
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
  
  // Initialize AI Memory Coach UI
  initAiCoachUI();
  
  // Initialize Session Mistakes Export UI
  initSessionMistakesUI();
  
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
        } else if (key === 'c') {
          if (aiConfigured()) {
            if (autoEasyTimeout) {
              clearTimeout(autoEasyTimeout);
              autoEasyTimeout = null;
            }
            askCoach(false);
          }
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

// ----------------------------------------------------
// ENRICH DECK FEATURES (LLM Bulk Generator)
// ----------------------------------------------------

function openEnrichModal(deckId, deckName) {
  document.getElementById('enrich-deck-id').value = deckId;
  
  // Set modal title
  const titleEl = document.querySelector('#enrich-deck-modal h3');
  if (titleEl) titleEl.innerText = `Enrichir le Deck : ${deckName}`;
  
  // Reset fields
  document.getElementById('enrich-lang-select').value = 'fr';
  document.getElementById('enrich-grammar-checkbox').checked = true;
  document.getElementById('enrich-cloze-checkbox').checked = true;
  
  // Load saved API key from localStorage
  const savedKey = localStorage.getItem('gemini-api-key') || '';
  document.getElementById('enrich-api-key-input').value = savedKey;

  // Hide progress and errors
  document.getElementById('enrich-progress-container').classList.add('hide');
  document.getElementById('enrich-error-message').classList.add('hide');
  document.getElementById('enrich-modal-actions').classList.remove('hide');

  // Show Modal
  document.getElementById('enrich-deck-modal').classList.remove('hide');
}

function closeEnrichModal() {
  document.getElementById('enrich-deck-modal').classList.add('hide');
}

// Bind modal close buttons
document.getElementById('close-enrich-modal-btn').addEventListener('click', closeEnrichModal);
document.getElementById('cancel-enrich-btn').addEventListener('click', closeEnrichModal);

// Handle Form Submission
document.getElementById('enrich-deck-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const deckId = document.getElementById('enrich-deck-id').value;
  const translationLang = document.getElementById('enrich-lang-select').value;
  const includeGrammar = document.getElementById('enrich-grammar-checkbox').checked;
  const includeCloze = document.getElementById('enrich-cloze-checkbox').checked;
  const apiKey = document.getElementById('enrich-api-key-input').value.trim();

  // Save API key if provided
  if (apiKey) {
    localStorage.setItem('gemini-api-key', apiKey);
  } else {
    localStorage.removeItem('gemini-api-key');
  }

  // Show progress spinner, hide buttons/errors
  const progressContainer = document.getElementById('enrich-progress-container');
  const errorEl = document.getElementById('enrich-error-message');
  const modalActions = document.getElementById('enrich-modal-actions');

  progressContainer.classList.remove('hide');
  errorEl.classList.add('hide');
  modalActions.classList.add('hide');

  try {
    const res = await fetch(`/api/decks/${deckId}/enrich`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        translationLang,
        includeGrammar,
        includeCloze,
        apiKey
      })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Une erreur est survenue lors de l'enrichissement");

    // Success! Update local progress mapping
    if (result.idChanges) {
      updateLocalProgressKeys(deckId, result.idChanges);
    }

    closeEnrichModal();
    alert('Deck enrichi avec succès ! Le serveur a mis à jour les cartes et synchronisé votre progression.');
    fetchDecks(); // reload dashboard deck counts and list

  } catch (err) {
    errorEl.innerText = err.message;
    errorEl.classList.remove('hide');
    modalActions.classList.remove('hide');
    progressContainer.classList.add('hide');
  }
});

// Helper to rename localStorage progress keys based on server-side ID changes
function updateLocalProgressKeys(deckId, idChanges) {
  const localProgKey = `progress_${deckId}`;
  const localExclKey = `excluded_${deckId}`;

  const progress = JSON.parse(localStorage.getItem(localProgKey) || '{}');
  const excluded = JSON.parse(localStorage.getItem(localExclKey) || '[]');

  const newProgress = {};
  const newExcluded = new Set();

  Object.entries(progress).forEach(([oldId, val]) => {
    const newId = idChanges[oldId];
    if (newId) {
      newProgress[newId] = val;
    } else {
      newProgress[oldId] = val;
    }
  });

  excluded.forEach(oldId => {
    const newId = idChanges[oldId];
    if (newId) {
      newExcluded.add(newId);
    } else {
      newExcluded.add(oldId);
    }
  });

  localStorage.setItem(localProgKey, JSON.stringify(newProgress));
  localStorage.setItem(localExclKey, JSON.stringify(Array.from(newExcluded)));
}
