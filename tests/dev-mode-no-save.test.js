// Test mode is for jumping to any stage and trying it — it must never leave
// a mark on the real player's save, in the browser or on disk. Covers both:
// a plain browser save (localStorage) and the server-backed file.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { seed } = require('./_seed');

const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');
const FILE = 'file://' + APP;

let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function winStop(page, id) {
  await page.locator('.stop[data-stage="' + id + '"]').click();
  await page.waitForTimeout(140);
  await page.locator('#gotBtn').click();
  await page.waitForTimeout(150);
  await page.locator('#mapBtn').click();
  await page.waitForTimeout(150);
}

(async () => {
  console.log('== browser storage: real progress first, then test-mode play ==');
  const browser = await chromium.launch(LAUNCH);
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await seed(context);
  const page = await context.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));
  await page.goto(FILE);
  await page.locator('.linemap').waitFor({ state: 'visible', timeout: 10000 });

  // A real win, outside test mode, should still save as always.
  await winStop(page, 'z0-say-something');
  const realSave = await page.evaluate(() => JSON.parse(localStorage.getItem('loopline.v2')));
  check('a real win outside test mode saves normally', realSave.done['z0-say-something'] === true, JSON.stringify(realSave.done));

  // Now turn test mode on and jump around, winning stages nowhere near
  // where the player actually is.
  await page.keyboard.press('Control+Shift+D');
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
  check('storage label admits nothing is being saved', /nothing.*saved/i.test(await page.locator('#storeLabel').innerText()),
    await page.locator('#storeLabel').innerText());
  await winStop(page, 'z4-naming-a-piece-of-code');
  await winStop(page, 'z6-the-short-form');
  const afterTestPlay = await page.evaluate(() => JSON.parse(localStorage.getItem('loopline.v2')));
  check('test-mode wins never reached localStorage', !afterTestPlay.done['z4-naming-a-piece-of-code'] && !afterTestPlay.done['z6-the-short-form'],
    JSON.stringify(afterTestPlay.done));
  check('the real win from before is still the only thing saved',
    afterTestPlay.done['z0-say-something'] === true && Object.keys(afterTestPlay.done).length === 1,
    JSON.stringify(afterTestPlay.done));

  // The UI itself should still reflect the test-mode win for this session —
  // otherwise there would be no way to see a stage actually score.
  check('the map still shows the test win for this session (in-memory only)',
    /2 \/ 95|3 \/ 95/.test(await page.locator('.progtext').innerText()), await page.locator('.progtext').innerText());

  // Reloading drops every trace of the test-mode session.
  await page.reload();
  await page.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 }); // dev mode itself persists (unchanged behaviour)
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('loopline.v2')));
  check('after reload, only the real win from before test mode survives',
    afterReload.done['z0-say-something'] === true && Object.keys(afterReload.done).length === 1,
    JSON.stringify(afterReload.done));
  check('test-mode wins are gone from the map too', /1 \/ 95/.test(await page.locator('.progtext').innerText()),
    await page.locator('.progtext').innerText());

  await browser.close();

  console.log('\n== server file: test-mode play never touches progress-tester.json ==');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopline-'));
  fs.copyFileSync(APP, path.join(dir, 'index.html'));
  fs.copyFileSync(path.resolve(__dirname, '..', 'styles.css'), path.join(dir, 'styles.css'));
  fs.copyFileSync(path.resolve(__dirname, '..', 'server.py'), path.join(dir, 'server.py'));
  const STORE = path.join(dir, 'progress-tester.json');
  // -u: unbuffered, so the banner reaches this pipe on a machine without
  // PYTHONUNBUFFERED set. server.py flushes it too; belt and braces.
  const srv = spawn('python3', ['-u', 'server.py', '0'], { cwd: dir });
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d.toString(); });
  srv.stderr.on('data', d => { srvOut += d.toString(); });
  let b2 = null;
  try {
    const PORT = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const m = srvOut.match(/localhost:(\d+)/);
        if (m) return parseInt(m[1], 10);
        await wait(50);
      }
      throw new Error('server.py never printed its port within 5s. It said: ' +
        (srvOut.trim() ? JSON.stringify(srvOut.trim().slice(0, 300)) : '(nothing at all)'));
    })();
    b2 = await chromium.launch(LAUNCH);
    const context2 = await b2.newContext();
    await seed(context2);
    const page2 = await context2.newPage();
    const URL = 'http://localhost:' + PORT + '/';
    await page2.goto(URL);
    await page2.waitForTimeout(500);

    await winStop(page2, 'z0-say-something');
    let deadline = Date.now() + 3000;
    while (Date.now() < deadline && !fs.existsSync(STORE)) await wait(50);
    check('the real win created the file', fs.existsSync(STORE));
    const diskAfterReal = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    check('the file holds the real win', diskAfterReal.done['z0-say-something'] === true, JSON.stringify(diskAfterReal.done));

    await page2.keyboard.press('Control+Shift+D');
    await page2.locator('#devbar').waitFor({ state: 'visible', timeout: 10000 });
    await winStop(page2, 'z4-naming-a-piece-of-code');
    await page2.waitForTimeout(600); // longer than the 250ms save debounce, so a leak would have landed by now
    const diskAfterTest = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    check('test-mode win never reached the file on disk',
      !diskAfterTest.done['z4-naming-a-piece-of-code'] && diskAfterTest.done['z0-say-something'] === true && Object.keys(diskAfterTest.done).length === 1,
      JSON.stringify(diskAfterTest.done));

    // The real bug: a real win schedules its file push on a 250ms debounce.
    // If test mode turns on and mutates the in-memory state before that timer
    // fires, the timer reads live `state` at fire time — not a snapshot from
    // when it was scheduled — so it can carry the test-mode change along with
    // it. Reproduced deterministically (no UI-timing race) via page.evaluate.
    await page2.evaluate(() => { window.setDev(false); });
    await page2.evaluate(() => {
      window.state.done['z0-plus-does-two-jobs'] = true;
      window.save(); // devMode false here — schedules the debounced push
      window.setDev(true);
      window.state.done['z5-two-labels-one-object'] = true; // mutates state before the pending push fires
    });
    await page2.waitForTimeout(600); // past the 250ms debounce
    const diskAfterRace = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    check('a push already scheduled before test mode turned on excludes the later test-mode change',
      !diskAfterRace.done['z5-two-labels-one-object'] && diskAfterRace.done['z0-plus-does-two-jobs'] === true,
      JSON.stringify(diskAfterRace.done));
    await page2.evaluate(() => { window.setDev(false); });
  } finally {
    if (b2) await b2.close().catch(() => {});
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  if (fails.length) process.exitCode = 1;
})();
