/**
 * Verifies cross-browser sync: Browser A saves progress, Browser B loads it.
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const SYNC_CODE = 'verify-test-' + Date.now();
const DECK_HASH = '#deck/tds-it';

async function run() {
  const browser = await chromium.launch({ headless: true });

  // ── Browser A: study a card, save progress ────────────────────────────────
  console.log('\n── Browser A: study + save ──');
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE + '/' + DECK_HASH);
  await pageA.waitForSelector('#origin-sentence-text:not(:empty)', { timeout: 5000 });

  // Type an answer and submit
  await pageA.fill('#user-answer-input', 'test answer');
  await pageA.click('#submit-answer-btn');
  await pageA.waitForSelector('#feedback-section:not(.hide)', { timeout: 3000 });

  // Rate "good"
  await pageA.click('#rate-good-btn');
  await pageA.waitForTimeout(300);

  // Read what card was studied
  const progressA = await pageA.evaluate(() => JSON.parse(localStorage.getItem('progress_tds-it') || '{}'));
  const studiedCount = Object.keys(progressA).length;
  console.log(`  Cards studied: ${studiedCount}`);

  // Enter sync code and save
  await pageA.fill('#sync-code-input', SYNC_CODE);
  await pageA.click('#sync-save-btn');
  await pageA.waitForSelector('.sync-status-msg.success', { timeout: 5000 });
  const saveStatus = await pageA.textContent('.sync-status-msg');
  console.log(`  Save status: "${saveStatus}"`);

  // ── Browser B: fresh context (no localStorage), load sync ────────────────
  console.log('\n── Browser B: fresh browser, load sync ──');
  const ctxB = await browser.newContext(); // isolated storage
  const pageB = await ctxB.newPage();
  await pageB.goto(BASE + '/' + DECK_HASH);
  await pageB.waitForSelector('#origin-sentence-text:not(:empty)', { timeout: 5000 });

  // Confirm localStorage is empty
  const progressBefore = await pageB.evaluate(() => localStorage.getItem('progress_tds-it'));
  console.log(`  localStorage before load: ${progressBefore === null ? 'empty ✓' : progressBefore}`);

  // Read stats before load
  const newBefore = await pageB.textContent('#stat-new');
  console.log(`  New cards before load: ${newBefore}`);

  // Enter sync code and load
  await pageB.fill('#sync-code-input', SYNC_CODE);
  await pageB.click('#sync-load-btn');
  await pageB.waitForSelector('.sync-status-msg.success', { timeout: 5000 });
  const loadStatus = await pageB.textContent('.sync-status-msg');
  console.log(`  Load status: "${loadStatus}"`);

  // Read stats after load
  await pageB.waitForTimeout(500);
  const progressAfter = await pageB.evaluate(() => JSON.parse(localStorage.getItem('progress_tds-it') || '{}'));
  const studiedCountB = Object.keys(progressAfter).length;
  const newAfter = await pageB.textContent('#stat-new');
  const laterAfter = await pageB.textContent('#stat-later');
  const seenFraction = await pageB.textContent('#stat-seen-fraction');

  console.log(`  Cards in localStorage after load: ${studiedCountB}`);
  console.log(`  Stat — new: ${newAfter}, later: ${laterAfter}`);
  console.log(`  Seen fraction: ${seenFraction}`);

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log('\n── Result ──');
  const passed = studiedCountB === studiedCount && studiedCountB > 0;
  if (passed) {
    console.log(`✅ PASS — ${studiedCountB} card(s) synced from A to B correctly`);
  } else {
    console.log(`❌ FAIL — Browser A had ${studiedCount} card(s), Browser B got ${studiedCountB}`);
  }

  await browser.close();
  process.exit(passed ? 0 : 1);
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
