# Special Characters Typing Helpers

Standalone, zero-dependency JavaScript files that enable **macOS/iOS-style long-press accent and special character typing** on any HTML page.

## 🚀 Quick Start

Include the script corresponding to the desired language anywhere in your HTML page:

```html
<!-- Example: For Italian -->
<script src="special-chars-it.js"></script>
```

That's it! The script automatically handles all `<input>` and `<textarea>` elements on the page (including dynamically added ones).

---

## 📁 Available Language Files

| File | Language | Supported Keys & Accents |
|------|----------|--------------------------|
| [`special-chars-it.js`](./special-chars-it.js) | **Italian** (Italiano) | `a` (à, á), `e` (è, é), `i` (ì, í), `o` (ò, ó), `u` (ù, ú) |
| [`special-chars-de.js`](./special-chars-de.js) | **German** (Deutsch) | `a` (ä), `o` (ö), `u` (ü), `s` (ß) |
| [`special-chars-es.js`](./special-chars-es.js) | **Spanish** (Español) | `a` (á), `e` (é), `i` (í), `n` (ñ), `o` (ó), `u` (ú, ü), `?` (¿), `!` (¡) |
| [`special-chars-fr.js`](./special-chars-fr.js) | **French** (Français) | `a` (à, â, æ), `c` (ç), `e` (è, é, ê, ë), `i` (î, ï), `o` (ô, œ), `u` (ù, û, ü) |
| [`special-chars-pt.js`](./special-chars-pt.js) | **Portuguese** (Português) | `a` (á, â, ã, à), `c` (ç), `e` (é, ê), `i` (í), `o` (ó, ô, õ), `u` (ú) |

---

## ⌨️ How It Works

1. **Type normally:** Key presses register immediately without lag.
2. **Hold key down (~400ms):**
   - If there is **1 variant** (e.g. German `s` → `ß` or `a` → `ä`), the held character is automatically replaced.
   - If there are **multiple variants** (e.g. French `e` → `è`, `é`, `ê`, `ë`), a floating numbered popup appears directly above (or below) the input.
3. **Select character:**
   - Press **number keys** (`1`, `2`, `3`, etc.).
   - Use **Arrow keys** (`←` / `→`) to highlight, then press **Enter** or **Space**.
   - **Click** any character button with the mouse.
4. **Dismiss:**
   - Press **Escape**, click anywhere outside, or continue typing any other letter.
5. **Casing Support:**
   - Holding `Shift` + key (e.g. `E`) automatically produces uppercase accents (`È`, `É`, `Ê`, `Ë`).

---

## ✨ Features

- **Zero dependencies:** Pure vanilla JavaScript.
- **Self-contained:** Injects its own styling automatically (supports light and dark modes).
- **Event delegation:** Works automatically with existing inputs as well as inputs created dynamically via JS/React/Vue/Alpine.
- **Form / Framework friendly:** Dispatches native `input` and `change` events so two-way bindings (React state, Vue `v-model`, vanilla event listeners) sync properly.
