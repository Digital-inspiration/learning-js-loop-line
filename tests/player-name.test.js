const { chromium } = require('playwright');
const path = require('path');

// Uses whatever Chromium Playwright installed (`npx playwright install chromium`).
// Set CHROME_PATH to point at a specific binary instead.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');
const FILE = 'file://' + APP;

let fails = [];
// .map-head .eyebrow is CSS-uppercased, so innerText would lie about the name.
const lineName = page => page.evaluate(() => document.querySelector('.map-head .eyebrow').textContent);
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));

  console.log('== nobody starts without being asked ==');
  await page.goto(FILE);
  await page.waitForTimeout(320);
  check('welcome screen shown first', await page.locator('.welcome').isVisible());
  check('no map until a name is given', await page.locator('.linemap').count() === 0);
  check('the input is focused ready to type',
    await page.evaluate(() => document.activeElement && document.activeElement.id === 'nameIn'));

  console.log('\n== the name is required, and sanitised ==');
  await page.locator('#nameGo').click();
  await page.waitForTimeout(150);
  check('empty name refused', await page.locator('.namewarn').count() === 1,
    (await page.locator('.namewarn').innerText()));
  check('still on the welcome screen', await page.locator('.welcome').isVisible());

  await page.locator('#nameIn').fill('   ');
  await page.locator('#nameGo').click(); await page.waitForTimeout(150);
  check('whitespace-only refused', await page.locator('.welcome').isVisible());

  await page.locator('#nameIn').fill('"\\\\/;()<>');
  await page.locator('#nameGo').click(); await page.waitForTimeout(150);
  check('a name made only of stripped characters is refused',
    await page.locator('.welcome').isVisible(),
    (await page.locator('#nameWarn').innerText()).replace(/\s+/g, ' ') || 'refused');

  // An injection attempt keeps whatever letters survive, with the dangerous
  // characters gone — the name is data, and it has to be safe as data.
  await page.locator('#nameIn').fill('"; alert(1); //');
  await page.locator('#nameGo').click(); await page.waitForTimeout(300);
  const injected = await page.evaluate(() => state.player);
  check('injection characters stripped from what is stored',
    !/["'\\\\;()\/<>]/.test(injected.replace(/'/g, '')) && injected.length > 0,
    JSON.stringify(injected));
  check('no dialog was triggered', await page.locator('.linemap').isVisible());
  await page.locator('#whoBtn').click(); await page.waitForTimeout(200);

  console.log('\n== a real name gets in, and lands on the line ==');
  await page.locator('#nameIn').fill("Maya O'Brien-Smith");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(320);
  check('Enter submits', await page.locator('.linemap').isVisible());
  const eyebrow = (await lineName(page)).replace(/\u2019/g, "'");
  check('the line is named after them', /Maya O'Brien-Smith's line/.test(eyebrow), eyebrow);
  check('apostrophes and hyphens survive sanitising', /O'Brien-Smith/.test(eyebrow), eyebrow);

  console.log('\n== the greeting stage uses their name, not a hardcoded one ==');
  await page.locator('.stop[data-stage="z0-keep-it-in-a-box"]').click().catch(() => {});
  // that stop is gated; unlock with test mode instead
  await page.keyboard.press('Control+Shift+D');
  await page.waitForTimeout(220);
  await page.selectOption('#devJump', 'z0-keep-it-in-a-box');
  await page.waitForTimeout(250);
  const task = await page.locator('.brief').innerText();
  check('the task shows their name in the target output', /Hi, Maya O'Brien-Smith! Ready to roll\./.test(task.replace(/\u2019/g, "'")),
    task.split('\n').filter(l => /Hi,/.test(l))[0] || task.slice(0, 80));
  // Guards against a sample name from the content ever being hardcoded into the
  // rendered page instead of going through {{name}}. Word-bounded so it cannot
  // trip on an ordinary word that happens to contain the same letters.
  check('no other name appears anywhere on the page',
    !/\bPri\b/i.test(await page.content()));

  await page.locator('#hintBtn').click();
  await page.waitForTimeout(250);
  const hint = await page.locator('.hintbox').innerText();
  check('the answer shape names them', /const name = "Maya O'Brien-Smith"/.test(hint.replace(/\u2019/g, "'")), hint.replace(/\s+/g, ' ').slice(0, 90));

  console.log('\n== the escape hatch fills in valid code with their name ==');
  for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) {
    await page.locator('#ed').fill('console.log("' + c + '");');
    await page.locator('#runBtn').click(); await page.waitForTimeout(150);
  }
  await page.locator('#escBtn').click(); await page.waitForTimeout(200);
  const filled = await page.locator('#ed').inputValue();
  check('editor filled with their name', /Maya O'Brien-Smith/.test(filled.replace(/\u2019/g, "'")), filled.split('\n')[0]);
  await page.locator('#runBtn').click(); await page.waitForTimeout(250);
  check('and that code actually runs and passes', await page.locator('.verdict.pass').count() === 1,
    (await page.locator('#board').innerText()).trim());
  await page.locator('#contBtn').click(); await page.waitForTimeout(150);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(200);

  console.log('\n== a quote-heavy name cannot break the generated code ==');
  await page.locator('#whoBtn').click(); await page.waitForTimeout(200);
  await page.locator('#nameIn').fill('Sam "The Coder" \\O\'Neil');
  await page.locator('#nameGo').click(); await page.waitForTimeout(300);
  const eyebrow2 = await lineName(page);
  check('quotes and backslashes stripped from the stored name',
    !/["\\]/.test(eyebrow2), eyebrow2);
  await page.selectOption('#devJump', 'z0-keep-it-in-a-box');
  await page.waitForTimeout(250);
  const sol = await page.evaluate(() => {
    let st; ZONES.forEach(z => z.stages.forEach(x => { if (x.id === 'z0-keep-it-in-a-box') st = x; }));
    return tpl(st.solution);
  });
  const ran = await page.evaluate(src => runCode(src), sol);
  check('the filled-in solution is still syntactically valid JS', !ran.err, ran.err || JSON.stringify(ran.logs));

  console.log('\n== the name persists, travels, and can be changed ==');
  await page.locator('#progBtn').click(); await page.waitForTimeout(200);
  await page.reload(); await page.waitForTimeout(400);
  check('no welcome screen on a return visit', await page.locator('.welcome').count() === 0);
  check('name survived the reload', /Sam The Coder O'Neil/.test((await lineName(page)).replace(/\u2019/g, "'")),
    await lineName(page));

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('loopline.v2')));
  check('name is stored with the progress, not separately', typeof stored.player === 'string' && stored.player.length > 0,
    'player=' + JSON.stringify(stored.player));

  const payload = await page.evaluate(() => JSON.parse(serializeProgress()));
  check('an exported file carries the name', payload.player === stored.player, 'player=' + payload.player);
  check('the filename is named after them', /^loopline-sam-the-coder-o-neil-/.test(await page.evaluate(() => progressFilename())),
    await page.evaluate(() => progressFilename()));

  console.log('\n== resetting progress keeps the name ==');
  await page.locator('#resetBtn').click(); await page.waitForTimeout(300);
  check('no welcome screen after a reset', await page.locator('.welcome').count() === 0);
  check('progress cleared', (await page.locator('.progtext').innerText()).trim() === '0 / 95',
    await page.locator('.progtext').innerText());
  check('name kept', /Sam/.test(await lineName(page)), await lineName(page));

  console.log('\n== "Not you?" reopens the question and can be cancelled ==');
  await page.locator('#whoBtn').click(); await page.waitForTimeout(200);
  check('welcome reopens prefilled', (await page.locator('#nameIn').inputValue()).startsWith('Sam'),
    await page.locator('#nameIn').inputValue());
  await page.locator('#nameCancel').click(); await page.waitForTimeout(220);
  check('cancel returns to the map unchanged', await page.locator('.linemap').isVisible() &&
    /Sam/.test(await lineName(page)), await lineName(page));

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
})();
