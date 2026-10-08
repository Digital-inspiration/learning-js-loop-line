// Boss login: a password-gated way into the same test mode Ctrl+Shift+D
// unlocks, for someone who does not want to remember (or reveal) a
// keyboard shortcut. Should survive a reload of the same tab but NOT a
// brand-new one — sessionStorage, not localStorage.
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
  await page.goto(FILE);
  await page.locator('.linemap').waitFor({ state: 'visible', timeout: 10000 });

  console.log('== the link is there, and off by default ==');
  check('a Boss login link is on the map', await page.locator('#bossBtn').isVisible());
  check('not logged in yet', await page.locator('#devbar').isHidden());

  console.log('\n== a wrong password is rejected ==');
  await page.locator('#bossBtn').click();
  await page.locator('#bossPw').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#bossPw').fill('definitely-not-it');
  await page.locator('#bossGo').click();
  await page.waitForTimeout(150);
  check('an error shows', await page.locator('#bossWarn').innerText() !== '');
  check('still on the login panel, not unlocked', await page.locator('#bossPw').isVisible());
  check('cancel returns to the map', true);
  await page.locator('#bossCancel').click();
  await page.waitForTimeout(150);
  check('back on the map', await page.locator('.linemap').isVisible());

  console.log('\n== the right password unlocks everything ==');
  await page.locator('#bossBtn').click();
  await page.locator('#bossPw').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#bossPw').fill('interchange-4417');
  await page.locator('#bossGo').click();
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
  check('test mode is on', await page.locator('#devbar').isVisible());
  check('every stop unlocked', await page.locator('.stop:not([disabled])').count() > 1);
  check('the login link is gone now that we are in', await page.locator('#bossBtn').count() === 0);

  console.log('\n== it survives a reload of this tab ==');
  await page.reload();
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
  check('still logged in after reload', await page.locator('#devbar').isVisible());

  console.log('\n== but a brand-new tab is logged out again ==');
  const page2 = await context.newPage();
  await page2.goto(FILE);
  await page2.locator('.linemap').waitFor({ state: 'visible', timeout: 10000 });
  check('a new tab asks again', await page2.locator('#devbar').isHidden());
  check('and offers the login link again', await page2.locator('#bossBtn').isVisible());
  await page2.close();

  console.log('\n== turning test mode off logs the boss session out too ==');
  await page.locator('#devOff').click();
  await page.locator('#devbar').waitFor({ state: 'hidden', timeout: 10000 });
  await page.reload();
  await page.waitForTimeout(300);
  check('stays logged out after reload', await page.locator('#devbar').isHidden());
  check('login link is back', await page.locator('#bossBtn').isVisible());

  console.log('\n== the old keyboard shortcut still works, untouched ==');
  await page.keyboard.press('Control+Shift+D');
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
  check('Ctrl+Shift+D still toggles test mode on its own', await page.locator('#devbar').isVisible());
  await page.locator('#devOff').click();
  await page.waitForTimeout(150);

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
})();
