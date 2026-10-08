const { chromium } = require('playwright');
const path = require('path');
const { seed } = require('./_seed');

// Uses whatever Chromium Playwright installed (`npx playwright install chromium`).
// Set CHROME_PATH to point at a specific binary instead.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');
const FILE = 'file://' + APP;


let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await seed(context);
  const page = await context.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));

  console.log('== off by default: a learner never sees it ==');
  await page.goto(FILE);
  await page.locator('.linemap').waitFor({ state: 'visible', timeout: 10000 });
  check('no test bar on a fresh visit', await page.locator('#devbar').isHidden());
  check('only the first stop is unlocked', await page.locator('.stop:not([disabled])').count() === 1,
    await page.locator('.stop:not([disabled])').count() + ' unlocked');
  check('later stops are disabled', await page.locator('.stop[data-stage="z3-count-to-five"]').count() === 0,
    'zone 3 not even rendered yet');

  console.log('\n== the keyboard shortcut turns it on ==');
  await page.keyboard.press('Control+Shift+D');
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
  check('test bar appears', await page.locator('#devbar').isVisible());
  check('every stop now unlocked', await page.locator('.stop:not([disabled])').count() === 95,
    await page.locator('.stop:not([disabled])').count() + ' unlocked');
  check('map explains why the line is ungated', /Test mode is on/i.test(await page.locator('.revisit').innerText()));

  console.log('\n== jumping straight to 3.4 ==');
  const opts = await page.locator('#devJump option').count();
  check('dropdown lists all 95 stops plus a placeholder', opts === 96, opts + ' options');
  const groups = await page.locator('#devJump optgroup').count();
  check('grouped by zone', groups === 11, groups + ' groups');

  await page.selectOption('#devJump', 'z3-count-to-five');
  await page.locator('.brief h2').waitFor({ state: 'visible', timeout: 10000 });
  const title = await page.locator('.brief h2').innerText();
  check('landed on the right stop without playing anything', title.includes('Count to five'), title);
  check('the stop is fully playable', await page.locator('#ed').isVisible() && await page.locator('#runBtn').isVisible());

  await page.locator('#ed').fill('for (let i = 1; i <= 5; i++) {\n  console.log(i);\n}');
  await page.locator('#runBtn').click();
  await page.waitForTimeout(220);
  check('and it scores normally', await page.locator('.verdict.pass').count() === 1,
    (await page.locator('#starmeter .pips').innerText()).replace(/\s/g, ''));
  await page.locator('#contBtn').click(); await page.waitForTimeout(150);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(180);
  check('progress recorded the real result', /1 \/ 95/.test(await page.locator('.progtext').innerText()),
    await page.locator('.progtext').innerText());

  console.log('\n== it survives a reload, and can be turned off ==');
  await page.reload();
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
  check('still on after reload', await page.locator('#devbar').isVisible());
  await page.locator('#devOff').click();
  await page.locator('#devbar').waitFor({ state: 'hidden', timeout: 10000 });
  check('turn-off hides the bar', await page.locator('#devbar').isHidden());
  check('gating comes straight back', await page.locator('.stop:not([disabled])').count() < 95,
    await page.locator('.stop:not([disabled])').count() + ' unlocked');
  await page.reload();
  await page.waitForTimeout(300);
  check('stays off after reload', await page.locator('#devbar').isHidden());

  console.log('\n== ?dev on the URL also works ==');
  await page.goto(FILE + '?dev');
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
  check('query string turns it on', await page.locator('#devbar').isVisible());

  console.log('\n== a separate browser profile is unaffected ==');
  const context2 = await browser.newContext();
  await seed(context2);
  const page2 = await context2.newPage();
  await page2.goto(FILE);
  await page2.locator('.linemap').waitFor({ state: 'visible', timeout: 10000 });
  check('another viewer sees no test bar', await page2.locator('#devbar').isHidden());
  check('another viewer is still gated', await page2.locator('.stop:not([disabled])').count() === 1);

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
})();
