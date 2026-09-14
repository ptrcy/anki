/**
 * Special Characters Helper - French (fr)
 * 
 * Auto-activates long-press accents and special characters on any input or textarea.
 * Simply include this script in your HTML page:
 *   <script src="special-chars-fr.js"></script>
 */
(function () {
  'use strict';

  // Clean up any previously active special chars helper
  if (typeof window.specialCharsCleanup === 'function') {
    window.specialCharsCleanup();
  }

  // Character mapping for French (Français)
  const CHAR_MAP = {
    "a": [
        "à",
        "â",
        "æ"
    ],
    "c": [
        "ç"
    ],
    "e": [
        "è",
        "é",
        "ê",
        "ë"
    ],
    "i": [
        "î",
        "ï"
    ],
    "o": [
        "ô",
        "œ"
    ],
    "u": [
        "ù",
        "û",
        "ü"
    ]
};
  const HOLD_DELAY_MS = 400;

  // State
  let popupEl = null;
  let longPressTimer = null;
  let longPressKey = null;
  let specialCharPopupOpen = false;
  let replacedCharPos = -1;
  let replacedChar = '';
  let popupOptions = [];
  let highlightedOptionIdx = 0;
  let activeTarget = null;
  const pressedKeys = new Set();

  function injectStyles() {
    if (document.getElementById('special-char-popup-styles')) return;
    const style = document.createElement('style');
    style.id = 'special-char-popup-styles';
    style.textContent = [
      '.special-char-popup {',
      '  position: fixed;',
      '  z-index: 999999;',
      '  display: flex;',
      '  flex-direction: row;',
      '  gap: 5px;',
      '  padding: 6px;',
      '  background: #ffffff;',
      '  border: 1px solid #cbd5e1;',
      '  border-radius: 8px;',
      '  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 4px 6px -2px rgba(0, 0, 0, 0.05);',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
      '  user-select: none;',
      '  box-sizing: border-box;',
      '  animation: special-char-pop 0.12s ease-out;',
      '}',
      '.special-char-popup.hide {',
      '  display: none !important;',
      '}',
      '@keyframes special-char-pop {',
      '  from { opacity: 0; transform: translateY(4px) scale(0.96); }',
      '  to   { opacity: 1; transform: translateY(0) scale(1); }',
      '}',
      '.special-char-btn {',
      '  position: relative;',
      '  width: 44px;',
      '  height: 52px;',
      '  border: 1px solid #e2e8f0;',
      '  border-radius: 6px;',
      '  background: #f8fafc;',
      '  cursor: pointer;',
      '  display: flex;',
      '  flex-direction: column;',
      '  align-items: center;',
      '  justify-content: center;',
      '  padding: 0;',
      '  margin: 0;',
      '  transition: background 0.1s, border-color 0.1s, transform 0.1s;',
      '  box-sizing: border-box;',
      '  outline: none;',
      '}',
      '.special-char-btn:hover,',
      '.special-char-btn.active {',
      '  background: #e0e7ff;',
      '  border-color: #6366f1;',
      '  transform: translateY(-2px);',
      '}',
      '.special-char-btn .sc-char {',
      '  font-size: 22px;',
      '  font-weight: 600;',
      '  line-height: 1;',
      '  color: #1e293b;',
      '}',
      '.special-char-btn .sc-num {',
      '  position: absolute;',
      '  bottom: 3px;',
      '  right: 5px;',
      '  font-size: 10px;',
      '  font-weight: 600;',
      '  color: #94a3b8;',
      '  line-height: 1;',
      '}',
      '@media (prefers-color-scheme: dark) {',
      '  .special-char-popup {',
      '    background: #1e293b;',
      '    border-color: #475569;',
      '    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3);',
      '  }',
      '  .special-char-btn {',
      '    border-color: #334155;',
      '    background: #0f172a;',
      '  }',
      '  .special-char-btn:hover,',
      '  .special-char-btn.active {',
      '    background: #312e81;',
      '    border-color: #818cf8;',
      '  }',
      '  .special-char-btn .sc-char {',
      '    color: #f1f5f9;',
      '  }',
      '  .special-char-btn .sc-num {',
      '    color: #64748b;',
      '  }',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  function ensurePopupElement() {
    if (!popupEl) {
      popupEl = document.getElementById('special-char-popup');
      if (!popupEl) {
        popupEl = document.createElement('div');
        popupEl.id = 'special-char-popup';
        popupEl.className = 'special-char-popup hide';
        popupEl.setAttribute('role', 'toolbar');
        popupEl.setAttribute('aria-label', 'Special characters');
      }
    }
    if (document.body && popupEl.parentElement !== document.body) {
      document.body.appendChild(popupEl);
    }
    return popupEl;
  }

  function isEditable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel', 'password'].indexOf(type) !== -1;
    }
    return false;
  }

  function showSpecialCharPopup(variants, target) {
    const popup = ensurePopupElement();
    if (!popup) return;

    popup.innerHTML = '';
    popupOptions = variants;
    highlightedOptionIdx = 0;
    activeTarget = target;

    popupOptions.forEach((ch, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'special-char-btn' + (idx === 0 ? ' active' : '');
      btn.dataset.char = ch;
      btn.dataset.num = String(idx + 1);

      const charSpan = document.createElement('span');
      charSpan.className = 'sc-char';
      charSpan.textContent = ch;

      const numSpan = document.createElement('span');
      numSpan.className = 'sc-num';
      numSpan.textContent = String(idx + 1);

      btn.appendChild(charSpan);
      btn.appendChild(numSpan);

      btn.addEventListener('mouseenter', () => {
        updatePopupHighlight(idx);
      });
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        replaceCharAtPos(ch, target);
        hideSpecialCharPopup();
      });
      popup.appendChild(btn);
    });

    popup.style.display = 'flex';
    popup.style.visibility = 'hidden';
    popup.classList.remove('hide');

    const rect = target.getBoundingClientRect();
    const popupH = popup.offsetHeight || 64;
    const popupW = popup.offsetWidth || 120;

    let top;
    if (rect.top - popupH - 8 >= 4) {
      top = rect.top - popupH - 8;
    } else if (rect.bottom + 8 + popupH <= window.innerHeight - 4) {
      top = rect.bottom + 8;
    } else {
      top = Math.max(4, window.innerHeight - popupH - 4);
    }
    popup.style.top = top + 'px';

    let left = rect.left;
    if (left + popupW > window.innerWidth - 8) {
      left = window.innerWidth - popupW - 8;
    }
    popup.style.left = Math.max(8, left) + 'px';

    popup.style.visibility = 'visible';
    specialCharPopupOpen = true;
  }

  function hideSpecialCharPopup() {
    if (popupEl) {
      popupEl.classList.add('hide');
    }
    specialCharPopupOpen = false;
    activeTarget = null;
    popupOptions = [];
    highlightedOptionIdx = 0;
    replacedCharPos = -1;
    replacedChar = '';
  }

  function updatePopupHighlight(idx) {
    highlightedOptionIdx = idx;
    if (!popupEl) return;
    const buttons = popupEl.querySelectorAll('.special-char-btn');
    buttons.forEach((btn, i) => {
      btn.classList.toggle('active', i === idx);
    });
  }

  function replaceCharAtPos(char, target) {
    if (!target) return;
    const val = target.value;
    if (replacedCharPos >= 0 && replacedCharPos < val.length && val[replacedCharPos] === replacedChar) {
      target.value = val.slice(0, replacedCharPos) + char + val.slice(replacedCharPos + 1);
      const nextPos = replacedCharPos + char.length;
      try {
        target.selectionStart = target.selectionEnd = nextPos;
      } catch {
        // inputs like email/number may throw on selectionStart
      }
    } else {
      insertCharAtCursor(char, target);
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
  }

  function insertCharAtCursor(char, target) {
    let start = target.value.length;
    let end = target.value.length;
    try {
      if (target.selectionStart !== null && target.selectionStart !== undefined) {
        start = target.selectionStart;
        end = target.selectionEnd;
      }
    } catch {
      // ignore selection read errors
    }
    target.value = target.value.slice(0, start) + char + target.value.slice(end);
    try {
      target.selectionStart = target.selectionEnd = start + char.length;
    } catch {
      // ignore selection write errors
    }
  }

  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229) return;

    const isRepeat = e.repeat || pressedKeys.has(e.key);
    pressedKeys.add(e.key);

    if (isRepeat) {
      if (e.key === longPressKey) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (specialCharPopupOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hideSpecialCharPopup();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const selectedChar = popupOptions[highlightedOptionIdx];
        if (selectedChar && activeTarget) {
          replaceCharAtPos(selectedChar, activeTarget);
        }
        hideSpecialCharPopup();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const nextIdx = (highlightedOptionIdx + 1) % popupOptions.length;
        updatePopupHighlight(nextIdx);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        const prevIdx = (highlightedOptionIdx - 1 + popupOptions.length) % popupOptions.length;
        updatePopupHighlight(prevIdx);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= popupOptions.length) {
          e.preventDefault();
          e.stopPropagation();
          replaceCharAtPos(popupOptions[num - 1], activeTarget);
          hideSpecialCharPopup();
          return;
        }
      }
      // Any other unhandled key dismisses the popup and allows standard typing
      hideSpecialCharPopup();
      return;
    }

    if (!isEditable(e.target)) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key !== longPressKey && longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressKey = null;
    }

    const lowerKey = e.key.toLowerCase();
    const variants = CHAR_MAP[lowerKey] || CHAR_MAP[e.key];
    if (!variants || variants.length === 0) return;

    longPressKey = e.key;
    const currentKey = e.key;
    const currentTarget = e.target;

    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (document.activeElement !== currentTarget) {
        longPressKey = null;
        return;
      }

      const isUpper = currentKey !== currentKey.toLowerCase();
      const casedVariants = isUpper ? variants.map(c => c.toUpperCase()) : variants;

      let pos = -1;
      try {
        pos = currentTarget.selectionStart;
      } catch {
        pos = -1;
      }

      if (pos > 0 && currentTarget.value[pos - 1] === currentKey) {
        replacedCharPos = pos - 1;
        replacedChar = currentKey;
      } else {
        replacedCharPos = -1;
        replacedChar = '';
      }

      if (casedVariants.length === 1) {
        replaceCharAtPos(casedVariants[0], currentTarget);
      } else {
        showSpecialCharPopup(casedVariants, currentTarget);
      }
    }, HOLD_DELAY_MS);
  }

  function onKeyUp(e) {
    pressedKeys.delete(e.key);
    if (e.key === longPressKey) {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressKey = null;
    }
  }

  function onBlur() {
    pressedKeys.clear();
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressKey = null;
    if (specialCharPopupOpen) {
      hideSpecialCharPopup();
    }
  }

  function onMouseDown(e) {
    if (specialCharPopupOpen && popupEl && !e.target.closest('#special-char-popup')) {
      hideSpecialCharPopup();
    }
  }

  function cleanup() {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('focusout', onBlur, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('blur', onBlur);

    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    pressedKeys.clear();
    hideSpecialCharPopup();

    const oldStyle = document.getElementById('special-char-popup-styles');
    if (oldStyle) oldStyle.remove();
    const oldPopup = document.getElementById('special-char-popup');
    if (oldPopup) oldPopup.remove();

    window.specialCharsCleanup = null;
  }

  function init() {
    injectStyles();
    if (document.body) {
      ensurePopupElement();
    } else {
      document.addEventListener('DOMContentLoaded', ensurePopupElement);
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('blur', onBlur);

    window.specialCharsCleanup = cleanup;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
