/**
 * Verifies cross-browser sync: Browser A saves progress, Browser B loads it.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SYNC_CODE = 'verify-test-' + Date.now();
const DECK_HASH = '#deck/tds-it';

async function run() {
  const browser = await chromium.launch({ headless: true });

  try {
    // ── Browser A: study a card, save progress ────────────────────────────────
    console.log('\n── Browser A: study + save ──');
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(BASE + '/' + DECK_HASH);
    await pageA.waitForSelector('#origin-sentence-text:not(:empty)', { timeout: 8000 });

    // Type an answer and submit
    await pageA.fill('#user-answer-input', 'test answer');
    await pageA.click('#submit-answer-btn');
    await pageA.waitForSelector('#feedback-section:not(.hide)', { timeout: 5000 });

    // Rate "good"
    await pageA.click('#rate-good-btn');

    // Wait for localStorage progress to be saved
    await pageA.waitForFunction(() => {
      const p = JSON.parse(localStorage.getItem('progress_tds-it') || '{}');
      return Object.keys(p).length > 0;
    }, { timeout: 5000 });

    // Read what card was studied
    const progressA = await pageA.evaluate(() => JSON.parse(localStorage.getItem('progress_tds-it') || '{}'));
    const studiedCardIds = Object.keys(progressA);
    const studiedCount = studiedCardIds.length;
    console.log(`  Cards studied in A: ${studiedCount} (${studiedCardIds.join(', ')})`);

    // Enter sync code and save
    await pageA.fill('#sync-code-input', SYNC_CODE);
    await pageA.click('#sync-save-btn');
    await pageA.waitForSelector('.sync-status-msg.success', { timeout: 8000 });
    const saveStatus = await pageA.textContent('.sync-status-msg');
    console.log(`  Save status: "${saveStatus}"`);

    // ── Browser B: fresh context (isolated storage), load sync ────────────────
    console.log('\n── Browser B: fresh browser, load sync ──');
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(BASE + '/' + DECK_HASH);
    await pageB.waitForSelector('#origin-sentence-text:not(:empty)', { timeout: 8000 });

    // Enforce empty-browser precondition
    await pageB.evaluate(() => localStorage.removeItem('progress_tds-it'));
    const progressBefore = await pageB.evaluate(() => localStorage.getItem('progress_tds-it'));
    console.log(`  localStorage before load: ${progressBefore === null ? 'empty ✓' : progressBefore}`);

    // Read stats before load
    const newBefore = parseInt((await pageB.textContent('#stat-new')) || '0', 10);
    const laterBefore = parseInt((await pageB.textContent('#stat-later')) || '0', 10);
    console.log(`  Stats before load — new: ${newBefore}, later: ${laterBefore}`);

    // Enter sync code and load
    await pageB.fill('#sync-code-input', SYNC_CODE);
    await pageB.click('#sync-load-btn');
    await pageB.waitForSelector('.sync-status-msg.success', { timeout: 8000 });
    const loadStatus = await pageB.textContent('.sync-status-msg');
    console.log(`  Load status: "${loadStatus}"`);

    // Wait for localStorage in Page B to receive progress
    await pageB.waitForFunction((expectedCardId) => {
      const p = JSON.parse(localStorage.getItem('progress_tds-it') || '{}');
      return p[expectedCardId] !== undefined;
    }, studiedCardIds[0], { timeout: 8000 });

    const progressAfter = await pageB.evaluate(() => JSON.parse(localStorage.getItem('progress_tds-it') || '{}'));
    const studiedCountB = Object.keys(progressAfter).length;
    const newAfter = parseInt((await pageB.textContent('#stat-new')) || '0', 10);
    const laterAfter = parseInt((await pageB.textContent('#stat-later')) || '0', 10);
    const seenFraction = await pageB.textContent('#stat-seen-fraction');

    console.log(`  Cards in localStorage after load: ${studiedCountB}`);
    console.log(`  Stats after load — new: ${newAfter}, later: ${laterAfter}`);
    console.log(`  Seen fraction: ${seenFraction}`);

    // ── Verdict ───────────────────────────────────────────────────────────────
    console.log('\n── Result ──');
    let passed = true;

    if (studiedCountB !== studiedCount || studiedCountB === 0) {
      console.log(`❌ FAIL — Count mismatch: A=${studiedCount}, B=${studiedCountB}`);
      passed = false;
    }

    // Verify deep card data match
    for (const id of studiedCardIds) {
      if (!progressAfter[id]) {
        console.log(`❌ FAIL — Missing card ${id} in Browser B`);
        passed = false;
      } else {
        const a = progressA[id];
        const b = progressAfter[id];
        if (a.ease !== b.ease || a.interval !== b.interval) {
          console.log(`❌ FAIL — Value mismatch for card ${id}: A=${JSON.stringify(a)} vs B=${JSON.stringify(b)}`);
          passed = false;
        }
      }
    }

    // Verify UI stats updated
    if (laterAfter <= laterBefore) {
      console.log(`❌ FAIL — UI later stats did not increment: before=${laterBefore}, after=${laterAfter}`);
      passed = false;
    }

    if (passed) {
      console.log(`✅ PASS — Exact progress data and UI stats synced correctly from A to B`);
    }

    process.exitCode = passed ? 0 : 1;
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
