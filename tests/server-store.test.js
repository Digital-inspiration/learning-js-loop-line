// Runs the real server.py and checks progress genuinely lands in a
// per-player progress-<name>.json — and that two different players never
// share a file or overwrite each other's.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const { seed } = require('./_seed');
const fs = require('fs');
const os = require('os');

// Uses whatever Chromium Playwright installed (`npx playwright install chromium`).
// Set CHROME_PATH to point at a specific binary instead.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');


let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// A save is debounced 250ms before the POST even fires, so checking a file's
// existence right after a UI action is an inherent race — poll instead of
// guessing a sleep long enough to always win it.
async function waitForFile(p, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(p)) return true;
    await wait(50);
  }
  return false;
}
// Same idea for on-page text after a reload: connectFileStore's fetch has to
// resolve and re-render before the UI reflects what is on disk.
async function waitForText(locator, regex, timeoutMs = 5000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    last = await locator.innerText().catch(() => '');
    if (regex.test(last)) return last;
    await wait(50);
  }
  return last;
}

(async () => {
  // isolated copy so the real folder is untouched
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopline-'));
  fs.copyFileSync(APP, path.join(dir, 'index.html'));
  fs.copyFileSync(path.resolve(__dirname, '..', 'styles.css'), path.join(dir, 'styles.css'));
  fs.copyFileSync(path.resolve(__dirname, '..', 'server.py'), path.join(dir, 'server.py'));
  const STORE = path.join(dir, 'progress-tester.json');   // _seed.js's default player
  // Port 0 asks the OS for a free ephemeral port, so this run can never
  // collide with a stale process left over from an earlier crashed run —
  // that was the actual cause of a whole suite of ENOENT failures here
  // (a dead run's server.py stayed bound to a fixed port and silently
  // intercepted the next run's requests, pointed at a directory that no
  // longer existed). Read the real port back off the server's own log line.
  // -u: unbuffered, so the banner reaches this pipe on a machine without
  // PYTHONUNBUFFERED set. server.py flushes it too; belt and braces.
  const srv = spawn('python3', ['-u', 'server.py', '0'], { cwd: dir });
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d.toString(); });
  srv.stderr.on('data', d => { srvOut += d.toString(); });
  let browser = null;
  try {
  const PORT = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const m = srvOut.match(/localhost:(\d+)/);
      if (m) return parseInt(m[1], 10);
      await wait(50);
    }
    throw new Error('server.py never printed its port:\n' + srvOut);
  })();

  browser = await chromium.launch(LAUNCH);
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await seed(context);
  const page = await context.newPage();
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));
  const URL = 'http://localhost:' + PORT + '/';

  console.log('== the server is the store ==');
  await page.goto(URL);
  await page.waitForTimeout(600);
  check('server serves the game', (await page.title()) === 'Loop Line', await page.title());
  check('page reports the file store, named after the player',
    /progress-tester\.json/.test(await page.locator('#storeLabel').innerText()),
    (await page.locator('#storeLabel').innerText()).replace(/\s+/g, ' '));
  check('no progress-tester.json until something is won', !fs.existsSync(STORE));

  console.log('\n== winning a stop writes the file ==');
  await page.locator('.stop[data-stage="z0-say-something"]').click(); await page.waitForTimeout(140);
  await page.locator('#gotBtn').click(); await page.waitForTimeout(150);
  await page.locator('#mapBtn').click();
  check('progress-tester.json now exists on disk', await waitForFile(STORE));
  let disk = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : {};
  check('it holds the win', disk.done && disk.done['z0-say-something'] === true, JSON.stringify(disk.done || {}));
  check('it is readable JSON a human could open',
    fs.existsSync(STORE) && fs.readFileSync(STORE, 'utf8').includes('\n  "'), 'indented');
  check('server logged the save, naming the file', /saved progress-tester\.json/.test(srvOut), srvOut.trim().split('\n').pop());

  console.log('\n== a wiped browser recovers from the file ==');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const progAfterWipe = await waitForText(page.locator('.progtext'), /1 \/ 95/);
  check('progress came back from the file, not the browser', /1 \/ 95/.test(progAfterWipe), progAfterWipe);

  console.log('\n== a brand new browser profile sees the same progress ==');
  const context2 = await browser.newContext();
  await seed(context2);
  const page2 = await context2.newPage();
  await page2.goto(URL);
  const progOtherProfile = await waitForText(page2.locator('.progtext'), /1 \/ 95/);
  check('different profile, same file-backed progress', /1 \/ 95/.test(progOtherProfile), progOtherProfile);
  await context2.close();

  console.log('\n== editing the file by hand is respected ==');
  disk = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : { done: {}, stars: {} };
  disk.xp = 999;
  disk.done['z0-plus-does-two-jobs'] = true; disk.stars['z0-plus-does-two-jobs'] = 3;
  fs.writeFileSync(STORE, JSON.stringify(disk, null, 2));
  await page.reload();
  const progAfterHandEdit = await waitForText(page.locator('.progtext'), /2 \/ 95/);
  check('hand-edited XP picked up', (await page.locator('#xp').innerText()) === '999',
    await page.locator('#xp').innerText());
  check('hand-added stop picked up', /2 \/ 95/.test(progAfterHandEdit), progAfterHandEdit);

  console.log('\n== a second, different player gets their own file — never Tester\'s ==');
  const ROLI_STORE = path.join(dir, 'progress-roli.json');
  const ctxRoli = await browser.newContext();
  await seed(ctxRoli, 'Roli');
  const pageRoli = await ctxRoli.newPage();
  await pageRoli.goto(URL);
  const progRoliStart = await waitForText(pageRoli.locator('.progtext'), /0 \/ 95/);
  check('Roli starts at their own 0 / 95, not Tester\'s 2 / 95', /0 \/ 95/.test(progRoliStart), progRoliStart);
  await pageRoli.locator('.stop[data-stage="z0-say-something"]').click(); await pageRoli.waitForTimeout(140);
  await pageRoli.locator('#gotBtn').click(); await pageRoli.waitForTimeout(150);
  await pageRoli.locator('#mapBtn').click();
  const gotRoliFile = await waitForFile(ROLI_STORE);
  check('a separate progress-roli.json was created', gotRoliFile);
  check('Tester\'s file still exists too — Roli did not replace it', fs.existsSync(STORE));
  const tester2 = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : {};
  check('Tester\'s progress is untouched by Roli winning a stop',
    tester2.xp === 999 && tester2.done && tester2.done['z0-plus-does-two-jobs'] === true,
    'xp=' + tester2.xp + ' done=' + JSON.stringify(tester2.done));
  const roliDisk = gotRoliFile ? JSON.parse(fs.readFileSync(ROLI_STORE, 'utf8')) : { done: {} };
  check('Roli\'s file holds only Roli\'s win, not Tester\'s history',
    roliDisk.done['z0-say-something'] === true && !roliDisk.done['z0-plus-does-two-jobs'] && roliDisk.xp !== 999,
    JSON.stringify(roliDisk.done));
  await ctxRoli.close();

  console.log('\n== a corrupt file for one player does not touch another\'s ==');
  fs.writeFileSync(STORE, '{ this is not json');
  await page.reload();
  await page.waitForTimeout(800);
  check('page still loads with a broken store', (await page.locator('.linemap').isVisible()));
  check('server reported the bad file, by name', /could not read progress-tester\.json/.test(srvOut),
    'logged');
  check('Roli\'s own file is unaffected by Tester\'s corrupt one',
    fs.existsSync(ROLI_STORE) && JSON.parse(fs.readFileSync(ROLI_STORE, 'utf8')).done['z0-say-something'] === true);
  // and a fresh win should repair it
  await page.locator('.stop[data-stage="z0-say-something"]').click(); await page.waitForTimeout(140);
  await page.locator('#gotBtn').click(); await page.waitForTimeout(150);
  await page.locator('#mapBtn').click();
  let repaired = false;
  const repairDeadline = Date.now() + 5000;
  while (Date.now() < repairDeadline) {
    try { JSON.parse(fs.readFileSync(STORE, 'utf8')); repaired = true; break; } catch (e) {}
    await wait(50);
  }
  check('next save repairs the file', repaired);

  console.log('\n== opened as a plain file, it falls back cleanly ==');
  const c3 = await browser.newContext(); await seed(c3);
  const p3 = await c3.newPage();
  const fileErrs = [];
  p3.on('pageerror', e => fileErrs.push(e.message));
  await p3.goto('file://' + path.join(dir, 'index.html'));
  await p3.waitForTimeout(900);
  check('still playable with no server', await p3.locator('.linemap').isVisible());
  check('and says so honestly',
    /saved in this browser/i.test(await p3.locator('#storeLabel').innerText()),
    (await p3.locator('#storeLabel').innerText()).replace(/\s+/g, ' '));
  check('no errors thrown by the failed fetch', fileErrs.length === 0, fileErrs.join(' | ') || 'none');

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  } catch (e) {
    fails.push('crashed: ' + e.message);
    console.log('\nCRASHED: ' + (e.stack || e.message));
  } finally {
    // However a run ends — clean assertions, a failed check, or an uncaught
    // exception — this must still run, or a next run's spawn(server.py)
    // finds a stale process squatting on state a browser test relies on.
    // (Port 0 above means it can no longer squat on a *port*, but it would
    // still leak a process and a temp dir if this were skipped.)
    if (browser) await browser.close().catch(() => {});
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (fails.length) process.exitCode = 1;
})();
