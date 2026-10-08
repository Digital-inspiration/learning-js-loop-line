const { chromium } = require('playwright');
const path = require('path');
const { seed } = require('./_seed');
const fs = require('fs');
const os = require('os');

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  await seed(context);
  const page = await context.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(300);

  console.log('== reload alone never loses progress ==');
  await page.locator('.stop[data-stage="z0-say-something"]').click(); await page.waitForTimeout(120);
  await page.locator('#gotBtn').click(); await page.waitForTimeout(120);
  await page.locator('#mapBtn').click(); await page.waitForTimeout(140);
  const before = await page.locator('.progtext').innerText();
  await page.reload(); await page.waitForTimeout(320);
  check('progress survives a plain reload', (await page.locator('.progtext').innerText()) === before,
    'before ' + before + ', after ' + (await page.locator('.progtext').innerText()));

  console.log('\n== a v1 save is migrated, not wiped ==');
  await page.evaluate(() => {
    localStorage.clear();
    // A real v1 save, with the ids that build actually wrote. These stay
    // positional on purpose — they are the INPUT to the migration, not a
    // reference to today's stops. The chain walked here is
    // 0.3 -> 0.4 -> a name, and 3.7 -> 3.10 -> 3.12 -> a name.
    localStorage.setItem('loopline.v1', JSON.stringify({
      xp: 145, done: { '0.1': true, '0.2': true, '0.3': true, '3.7': true },
      stars: { '0.1': 3, '0.2': 3, '0.3': 2, '3.7': 3 }
    }));
  });
  await page.reload(); await page.waitForTimeout(340);
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('loopline.v2')));
  check('old save carried forward', migrated && migrated.xp === 145, 'xp=' + (migrated && migrated.xp));
  check('the v1 boss id walked 3.7 -> 3.10 -> 3.12 -> a stable name',
    migrated.done['z3-interchange-the-delay-board'] === true && !migrated.done['3.7'] && !migrated.done['3.12'],
    Object.keys(migrated.done).join(', '));
  check('stars came with it', migrated.stars['z3-interchange-the-delay-board'] === 3 && migrated.stars['z0-keep-it-in-a-box'] === 2,
    'boss=' + migrated.stars['z3-interchange-the-delay-board'] + ' 0.3-> ' + migrated.stars['z0-keep-it-in-a-box']);
  check('map reflects the migrated save', /4 \/ 95/.test(await page.locator('.progtext').innerText()),
    await page.locator('.progtext').innerText());

  console.log('\n== saving progress to a real file (local: Blob path) ==');
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.locator('#expBtn').click();
  const download = await dl;
  check('a download was offered', !!download, download ? await download.suggestedFilename() : 'none');
  let savedPath = null;
  if (download) {
    savedPath = path.join(os.tmpdir(), 'll-' + Date.now() + '.json');
    await download.saveAs(savedPath);
    const body = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    check('file is a valid progress payload',
      body.format === 'loopline-progress' && body.v === 2 && body.xp === 145,
      'format=' + body.format + ' v=' + body.v + ' xp=' + body.xp);
    check('filename says how far you got', /4of95/.test(await download.suggestedFilename()),
      await download.suggestedFilename());
    check('confirmation names the file', /Saved as/.test(await page.locator('#saveNote').innerText()),
      (await page.locator('#saveNote').innerText()).replace(/\s+/g, ' ').slice(0, 80));
  }

  console.log('\n== wiping the browser and loading the file back ==');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(320);
  check('browser really is empty now', (await page.locator('.progtext').innerText()).trim() === '0 / 95',
    await page.locator('.progtext').innerText());

  await page.locator('#impFile').setInputFiles(savedPath);
  await page.waitForTimeout(300);
  const summary = (await page.locator('#saveNote').innerText()).replace(/\s+/g, ' ');
  check('import previews before replacing anything, and says whose it is',
    /(holds|\u2019s file:) 4 cleared/.test(summary), summary.slice(0, 100));
  check('nothing applied until confirmed', (await page.locator('.progtext').innerText()).trim() === '0 / 95');
  await page.locator('#doImport').click(); await page.waitForTimeout(300);
  check('progress restored after confirming', /4 \/ 95/.test(await page.locator('.progtext').innerText()),
    await page.locator('.progtext').innerText());
  check('XP restored too', (await page.locator('#xp').innerText()) === '145');
  await page.reload(); await page.waitForTimeout(320);
  check('and it persists after reload', /4 \/ 95/.test(await page.locator('.progtext').innerText()));

  console.log('\n== bad input is rejected without damaging what is there ==');
  const junk = path.join(os.tmpdir(), 'junk-' + Date.now() + '.json');
  fs.writeFileSync(junk, 'this is not json at all');
  await page.locator('#impFile').setInputFiles(junk);
  await page.waitForTimeout(250);
  check('non-JSON rejected', /not valid JSON/.test(await page.locator('#saveNote').innerText()),
    (await page.locator('#saveNote').innerText()).replace(/\s+/g, ' ').slice(0, 70));

  const wrong = path.join(os.tmpdir(), 'wrong-' + Date.now() + '.json');
  fs.writeFileSync(wrong, JSON.stringify({ hello: 'world' }));
  await page.locator('#impFile').setInputFiles(wrong);
  await page.waitForTimeout(250);
  check('valid JSON of the wrong shape rejected',
    /not a Loop Line progress file/.test(await page.locator('#saveNote').innerText()),
    (await page.locator('#saveNote').innerText()).replace(/\s+/g, ' ').slice(0, 70));
  check('existing progress untouched by both rejections',
    /4 \/ 95/.test(await page.locator('.progtext').innerText()),
    await page.locator('.progtext').innerText());

  console.log('\n== a file naming stops this build does not have ==');
  const future = path.join(os.tmpdir(), 'future-' + Date.now() + '.json');
  fs.writeFileSync(future, JSON.stringify({
    format: 'loopline-progress', v: 2, xp: 500,
    done: { 'z0-say-something': true, 'z99-does-not-exist': true }, stars: { 'z0-say-something': 3, 'z99-does-not-exist': 3 }
  }));
  await page.locator('#impFile').setInputFiles(future);
  await page.waitForTimeout(250);
  check('unknown stops flagged, not counted',
    /not in this version/.test(await page.locator('#saveNote').innerText()),
    (await page.locator('#saveNote').innerText()).replace(/\s+/g, ' ').slice(0, 110));
  await page.locator('#doImport').click(); await page.waitForTimeout(280);
  check('unknown stops dropped on import',
    await page.evaluate(() => !JSON.parse(localStorage.getItem('loopline.v2')).done['z99-does-not-exist']));
  check('counter shows only real stops', /1 \/ 95/.test(await page.locator('.progtext').innerText()),
    await page.locator('.progtext').innerText());

  // A save that goes out and comes back must land on the SAME stops. The older
  // assertions here only counted them, which is how a double-migration bug that
  // shifted every mapped id (0.3 -> 0.4, 3.7 -> 3.9) passed for so long: the
  // count never changes, only which stops you own.
  console.log('\n== a round trip returns the same stops, not just the same number ==');
  const original = { 'z0-backticks-or-quotes': true, 'z0-keep-it-in-a-box': true, 'z1-the-age-gate': true, 'z3-count-to-five': true, 'z3-read-out-every-stop': true };
  await page.evaluate(d => {
    state = { schema: SCHEMA, player: 'Tester', xp: 120, stars: {}, done: d };
    Object.keys(d).forEach(k => state.stars[k] = 3);
    save();
  }, original);
  const roundTrip = path.join(os.tmpdir(), 'rt-' + Date.now() + '.json');
  fs.writeFileSync(roundTrip, await page.evaluate(() => serializeProgress()));
  await page.locator('#impFile').setInputFiles(roundTrip);
  await page.waitForTimeout(300);
  await page.locator('#doImport').click(); await page.waitForTimeout(320);
  const back = await page.evaluate(() => Object.keys(state.done).sort().join(','));
  const wanted = Object.keys(original).sort().join(',');
  check('every stop comes back as itself', back === wanted, back === wanted ? back : 'got ' + back + ', wanted ' + wanted);
  check('XP survives the round trip as a number',
    await page.evaluate(() => state.xp === 120), await page.evaluate(() => typeof state.xp + ' ' + state.xp));

  // xp used to reach innerHTML unescaped and uncoerced, so a crafted file ran
  // script on import AND on every load afterwards.
  console.log('\n== a hostile progress file cannot inject markup ==');
  let pwned = 0;
  await page.exposeFunction('__pwned', () => { pwned++; });
  const evil = path.join(os.tmpdir(), 'evil-' + Date.now() + '.json');
  fs.writeFileSync(evil, JSON.stringify({
    format: 'loopline-progress', v: 2, schema: 3, player: 'Someone',
    xp: '<img src=x onerror="window.__pwned()">', done: { 'z0-say-something': true }, stars: { 'z0-say-something': 3 }
  }));
  await page.locator('#impFile').setInputFiles(evil);
  await page.waitForTimeout(350);
  check('nothing executes from the import preview', pwned === 0, pwned + ' execution(s)');
  await page.locator('#doImport').click(); await page.waitForTimeout(350);
  await page.reload(); await page.waitForTimeout(450);
  check('nothing executes after importing or reloading', pwned === 0, pwned + ' execution(s)');
  check('a non-numeric xp becomes 0 rather than markup',
    await page.evaluate(() => state.xp === 0), await page.evaluate(() => JSON.stringify(state.xp)));
  fs.unlinkSync(roundTrip); fs.unlinkSync(evil);

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
})();
