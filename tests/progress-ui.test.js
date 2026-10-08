const { chromium } = require('playwright');
const path = require('path');
const { seed } = require('./_seed');

// Uses whatever Chromium Playwright installed (`npx playwright install chromium`).
// Set CHROME_PATH to point at a specific binary instead.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');
const SHOTS = process.env.SHOTS_DIR || require('os').tmpdir();

const SOL = {
  'z0-backticks-or-quotes': 'const name = "Pri";\nconsole.log(`Hi, ${name}! Ready to roll.`);',
  'z1-on-the-line-or-over-it': 'const age = 15;\nif (age < 18) { console.log("Minor"); } else { console.log("Adult"); }'
};

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

  const progText = () => page.locator('.progtext').innerText();
  const tickClasses = () => page.evaluate(() =>
    [...document.querySelectorAll('.tick')].map(t => t.className.replace('tick', '').trim() || 'todo'));
  async function open(id) { await page.locator('.stop[data-stage="' + id + '"]').click(); await page.waitForTimeout(120); }
  async function run(code) { await page.locator('#ed').fill(code); await page.locator('#runBtn').click(); await page.waitForTimeout(170); }
  async function clearLearn(id) { await open(id); await page.locator('#gotBtn').click(); await page.waitForTimeout(90); await page.locator('#progBtn').click(); await page.waitForTimeout(90); }
  async function clearMcq(id, i) { await open(id); await page.locator('.opt[data-i="' + i + '"]').click(); await page.waitForTimeout(110); await page.locator('#contBtn').click(); await page.waitForTimeout(110); await page.locator('#progBtn').click(); await page.waitForTimeout(110); }

  console.log('\n== the tick strip ==');
  check('one tick per stop', (await tickClasses()).length === 95, (await tickClasses()).length + ' ticks');
  check('starts at 0 / 95', (await progText()).trim() === "0 / 95", await progText());
  check('map tally shows what is left',
    /0\s*cleared/.test(await page.locator('.tally').innerText()) && /95\s*to go/.test(await page.locator('.tally').innerText()),
    (await page.locator('.tally').innerText()).replace(/\s+/g, ' '));
  check('no revisit panel when nothing is unfinished', await page.locator('.revisit').count() === 0);

  await clearLearn('z0-say-something');
  check('count rises as stops clear', (await progText()).trim() === "1 / 95", await progText());
  check('first tick marked done', (await tickClasses())[0] === 'done');

  console.log('\n== the strip travels into a stage and marks where you are ==');
  await clearMcq('z0-plus-does-two-jobs', 0);
  await clearMcq('z0-backticks-or-quotes', 0);
  await open('z0-keep-it-in-a-box');
  check('strip still visible inside a stage', await page.locator('#progBtn').isVisible());
  check('current stop marked "here"', (await tickClasses())[3].includes('here'), (await tickClasses())[3]);
  check('a back arrow appears', await page.locator('#progBtn .back').count() === 1);
  await page.locator('#progBtn').click(); await page.waitForTimeout(140);
  check('clicking the strip returns to the map', await page.locator('.linemap').isVisible());

  console.log('\n== skipping surfaces a way back ==');
  await open('z0-keep-it-in-a-box');
  for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) await run('console.log("' + c + '");');
  await page.locator('#escBtn').click(); await page.waitForTimeout(140);
  await page.locator('#runBtn').click(); await page.waitForTimeout(200);
  await page.locator('#contBtn').click(); await page.waitForTimeout(140);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(160);

  check('progress counts the skip separately', /3 \/ 95 · 1 skipped/.test(await progText()), await progText());
  check('fourth tick renders as skipped', (await tickClasses())[3] === 'skipped', (await tickClasses())[3]);
  check('revisit panel appears', await page.locator('.revisit').count() === 1);
  check('panel is titled for what it holds', /not solved yet/i.test(await page.locator('.revisit .eyebrow').innerText()),
    await page.locator('.revisit .eyebrow').innerText());
  const chip = page.locator('.rchip[data-stage="z0-keep-it-in-a-box"]');
  check('skipped stop listed as a chip', await chip.count() === 1, (await chip.innerText()).replace(/\s+/g, ' '));
  check('chip marked as skipped', await page.locator('.rchip.skip').count() === 1);
  check('panel copy explains what happened, not just that it is unfinished',
    /filled in rather than worked out/i.test(await page.locator('.revisit p').innerText()),
    (await page.locator('.revisit p').innerText()).replace(/\s+/g, ' ').slice(0, 90));

  console.log('\n== the chip jumps straight back in, and clears itself ==');
  await chip.click(); await page.waitForTimeout(150);
  check('chip opened the right stop', (await page.locator('.brief h2').innerText()).includes('Keep it in a box'));
  await run(SOL['z0-backticks-or-quotes']);
  await page.locator('#contBtn').click(); await page.waitForTimeout(140);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(160);
  check('revisit panel gone once it is beaten clean', await page.locator('.revisit').count() === 0);
  check('progress no longer mentions a skip', (await progText()).trim() === "4 / 95", await progText());
  check('tick now done, not skipped', (await tickClasses())[3] === 'done');

  console.log('\n== a partial win is NOT listed: it was finished, just with help ==');
  // zone 0 now has five stops; 0.5 must clear before zone 1 opens
  await open('z0-two-boxes-one-sentence');
  await run('const drink = "flat white";\nconst price = 5;\nconsole.log(`A ${drink} costs $${price}.`);');
  await page.locator('#contBtn').click(); await page.waitForTimeout(130);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(130);
  await clearLearn('z1-choosing-a-track'); await clearMcq('z1-first-true-wins', 0); await clearMcq('z1-on-the-line-or-over-it', 0);
  await open('z1-the-age-gate');
  await page.locator('#exBtn').click(); await page.waitForTimeout(150);   // costs stars
  await run(SOL['z1-on-the-line-or-over-it']);
  await page.locator('#contBtn').click(); await page.waitForTimeout(140);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(160);
  check('a hinted win is NOT in the panel', await page.locator('.rchip[data-stage="z1-the-age-gate"]').count() === 0);
  check('panel stays hidden when only hinted wins exist', await page.locator('.revisit').count() === 0);
  check('its stars still show on the map',
    (await page.locator('.stop[data-stage="z1-the-age-gate"] .stars').innerText()).trim() === '\u2605\u2606\u2606',
    await page.locator('.stop[data-stage="z1-the-age-gate"] .stars').innerText());
  check('no skip in the counter', !/skipped/.test(await progText()), await progText());

  await page.screenshot({ path: path.join(SHOTS, 'shot-progress.png'), fullPage: false });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'shot-progress-dark.png'), fullPage: false });

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
})();
