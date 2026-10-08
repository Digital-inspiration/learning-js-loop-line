const { chromium } = require('playwright');
const path = require('path');
const { seed } = require('./_seed');

// Uses whatever Chromium Playwright installed (`npx playwright install chromium`).
// Set CHROME_PATH to point at a specific binary instead.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');
const SHOTS = process.env.SHOTS_DIR || require('os').tmpdir();

const SOL = 'const name = "Pri";\nconsole.log(`Hi, ${name}! Ready to roll.`);';

let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  await seed(page.context());
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));
  await page.goto('file://' + APP);
  await page.waitForTimeout(300);

  const meter = async () => (await page.locator('#starmeter .pips').innerText()).replace(/\s/g, '');
  const rungs = () => page.locator('#helpSlot .revealed').count();
  async function open(id) { await page.locator('.stop[data-stage="' + id + '"]').click(); await page.waitForTimeout(120); }
  async function run(code) { await page.locator('#ed').fill(code); await page.locator('#runBtn').click(); await page.waitForTimeout(160); }
  async function clearLearn(id) { await open(id); await page.locator('#gotBtn').click(); await page.waitForTimeout(90); await page.locator('#mapBtn').click(); await page.waitForTimeout(90); }
  async function clearMcq(id, i) { await open(id); await page.locator('.opt[data-i="' + i + '"]').click(); await page.waitForTimeout(110); await page.locator('#contBtn').click(); await page.waitForTimeout(110); await page.locator('#mapBtn').click(); await page.waitForTimeout(110); }

  await clearLearn('z0-say-something');
  await clearMcq('z0-plus-does-two-jobs', 0);
  await clearMcq('z0-backticks-or-quotes', 0);          // "Backticks or quotes?" now sits before the write

  console.log('\n== 3 free attempts, then one rung per miss ==');
  await open('z0-keep-it-in-a-box');
  check('starts at 3 stars, no rungs', await meter() === '★★★' && await rungs() === 0);

  await run('console.log("a");');
  check('miss 1 → nothing revealed', await rungs() === 0, 'meter ' + await meter());
  await run('console.log("b");');
  check('miss 2 → still nothing', await rungs() === 0, 'meter ' + await meter());
  await run('console.log("c");');
  check('miss 3 → nudge appears unasked', await rungs() === 1, (await page.locator('.nudge').innerText()).replace(/\s+/g, ' ').slice(0, 80));
  check('  ...and it cost a star', await meter() === '★★☆');

  await run('console.log("d");');
  check('miss 4 → worked example appears', await page.locator('.example').count() === 1);
  check('  ...meter down to one', await meter() === '★☆☆');

  await run('console.log("e");');
  check('miss 5 → answer shape appears', await page.locator('.hintbox').count() === 1);
  check('  ...star floor holds at 1', await meter() === '★☆☆');
  check('no escape hatch yet', await page.locator('#escBtn').count() === 0);

  console.log('\n== repeat runs of identical code do not burn a rung ==');
  const before = await rungs();
  await page.locator('#runBtn').click(); await page.waitForTimeout(150);
  await page.locator('#runBtn').click(); await page.waitForTimeout(150);
  check('two identical re-runs revealed nothing new', await rungs() === before, before + ' rungs before and after');
  check('escape still not offered', await page.locator('#escBtn').count() === 0);

  console.log('\n== miss 6 offers the escape hatch ==');
  await run('console.log("f");');
  check('escape hatch appears', await page.locator('#escBtn').count() === 1,
    (await page.locator('.escape p').innerText()).replace(/\s+/g, ' ').slice(0, 70));
  await page.locator('#escBtn').click(); await page.waitForTimeout(150);
  const filled = await page.locator('#ed').inputValue();
  check('editor filled with a working answer', /const name/.test(filled) && /Ready to roll/.test(filled), filled.split('\n')[0]);

  await page.locator('#runBtn').click(); await page.waitForTimeout(200);
  check('the filled answer actually passes', await page.locator('.verdict.pass').count() === 1);
  await page.locator('#contBtn').click(); await page.waitForTimeout(150);
  const fin = (await page.locator('.finish').innerText()).replace(/\s+/g, ' ');
  check('finish screen says skipped, not 1 star', /skipped/i.test(fin), fin.slice(0, 90));
  await page.locator('#mapBtn').click(); await page.waitForTimeout(150);
  check('map shows a skipped chip', await page.locator('.stop[data-stage="z0-keep-it-in-a-box"] .skipchip').count() === 1);
  check('skipped stop still unlocks the next one', await page.locator('.stop[data-stage="z0-two-boxes-one-sentence"]:not([disabled])').count() === 1);
  const xp = await page.locator('#xp').innerText();
  check('XP still awarded for a skip', xp === '40', 'xp=' + xp);

  console.log('\n== replaying a skipped stop wins the stars back ==');
  await open('z0-keep-it-in-a-box');
  check('meter resets to 3', await meter() === '★★★');
  await run(SOL);
  await page.locator('#contBtn').click(); await page.waitForTimeout(140);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(140);
  check('skipped chip replaced by 3 stars',
    await page.locator('.stop[data-stage="z0-keep-it-in-a-box"] .skipchip').count() === 0 &&
    (await page.locator('.stop[data-stage="z0-keep-it-in-a-box"] .stars').innerText()).trim() === '★★★');

  console.log('\n== asking early pulls rungs forward at the same price ==');
  // zone 0 now has five stops; 0.5 must clear before zone 1 opens
  await open('z0-two-boxes-one-sentence');
  await run('const drink = "flat white";\nconst price = 5;\nconsole.log(`A ${drink} costs $${price}.`);');
  await page.locator('#contBtn').click(); await page.waitForTimeout(130);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(130);
  await clearLearn('z1-choosing-a-track');
  await open('z1-first-true-wins');
  check('MCQ starts clean', await meter() === '★★★' && await rungs() === 0);
  await page.locator('.opt[data-i="1"]').click(); await page.waitForTimeout(130);
  check('MCQ miss 1 → nothing', await rungs() === 0);
  await page.locator('.opt[data-i="2"]').click(); await page.waitForTimeout(130);
  check('MCQ escalates a miss earlier (nudge at 2)', await rungs() === 1, 'meter ' + await meter());
  await page.locator('.opt[data-i="0"]').click(); await page.waitForTimeout(130);
  check('MCQ correct answer still accepted', await page.locator('.verdict.pass').count() === 1);
  await page.locator('#contBtn').click(); await page.waitForTimeout(130);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(130);

  await clearMcq('z1-on-the-line-or-over-it', 0);          // "On the line, or over it?" precedes the write now
  await open('z1-the-age-gate');
  await page.locator('#hintBtn').click(); await page.waitForTimeout(180);
  check('clicking the top rung reveals every rung below it first', await rungs() === 3,
    (await rungs()) + ' rungs shown');
  check('asking for all three costs the same as waiting', await meter() === '★☆☆');
  check('both buttons now marked spent',
    await page.locator('#exBtn.spent').count() === 1 && await page.locator('#hintBtn.spent').count() === 1);
  check('nudge came before the answer',
    (await page.locator('#helpSlot .revealed').first().innerText()).toLowerCase().includes('push in the right direction'));

  await page.screenshot({ path: path.join(SHOTS, 'shot-escalate.png'), fullPage: true });

  console.log('\n== content completeness ==');
  const gaps = await page.evaluate(() => {
    const out = [];
    ZONES.forEach(z => z.stages.forEach(s => {
      if (s.kind === 'write' || s.kind === 'boss') {
        ['nudge', 'example', 'hint', 'solution'].forEach(k => { if (!s[k]) out.push(s.id + ' missing ' + k); });
      }
      if (s.kind === 'mcq' && (!s.nudge || !s.example)) out.push(s.id + ' mcq missing a rung');
    }));
    return out;
  });
  check('every stage has a full ladder + escape solution', gaps.length === 0, gaps.join(' | ') || 'clean');

  const solOk = await page.evaluate(() => {
    // every stored solution must actually satisfy its own check()
    const out = [];
    ZONES.forEach(z => z.stages.forEach(s => {
      if (!s.solution) return;
      const r = runCode(s.solution);
      if (r.err) { out.push(s.id + ' solution errored: ' + r.err); return; }
      const v = s.check(r.logs, s.solution);
      if (!v.ok) out.push(s.id + ' solution fails its own check: ' + v.msg);
    }));
    return out;
  });
  check('every escape-hatch solution passes its own check', solOk.length === 0, solOk.join(' | ') || 'all solutions verified');

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
})();
