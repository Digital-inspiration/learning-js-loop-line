// Generic walker: reads the content out of the page and plays the whole line
// using each stage's own declared answer. Survives content changes.
const { chromium } = require('playwright');
const path = require('path');
const { seed } = require('./_seed');

// Uses whatever Chromium Playwright installed (`npx playwright install chromium`).
// Set CHROME_PATH to point at a specific binary instead.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');


let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await seed(page.context());
  const jsErr = [];
  page.on('pageerror', e => jsErr.push(e.message));
  await page.goto('file://' + APP);
  await page.waitForTimeout(300);

  const plan = await page.evaluate(() => ZONES.flatMap(z =>
    z.stages.map(s => ({ id: s.id, kind: s.kind, title: s.title, zone: z.name, answer: s.answer }))));

  console.log('== content audit ==');
  const zoneCount = new Set(plan.map(s => s.zone)).size;
  check('every stop has a unique id', new Set(plan.map(s => s.id)).size === plan.length,
    plan.length + ' stops across ' + zoneCount + ' zones');
  const shape = await page.evaluate(() => {
    const out = [];
    ZONES.forEach(z => {
      const kinds = z.stages.map(s => s.kind);
      out.push('Zone ' + z.id + ' (' + z.name + '): ' + kinds.join(' → '));
    });
    return out;
  });
  shape.forEach(l => console.log('       ' + l));

  const audit = await page.evaluate(() => {
    const out = [];
    ZONES.forEach(z => z.stages.forEach(s => {
      if (s.kind === 'write' || s.kind === 'boss') {
        ['nudge', 'example', 'hint', 'solution', 'check', 'starter', 'task'].forEach(k => {
          if (!s[k]) out.push(s.id + ' missing ' + k);
        });
        if (!s.reinforces || !s.reinforces.length) out.push(s.id + ' has no reinforces list');
      }
      if (s.kind === 'mcq') {
        if (!s.nudge || !s.example) out.push(s.id + ' mcq missing a help rung');
        if (typeof s.answer !== 'number' || !s.options[s.answer]) out.push(s.id + ' bad answer index');
      }
      if (s.kind === 'learn' && !s.code) out.push(s.id + ' learn stage has no code');
    }));
    return out;
  });
  check('every stage fully authored', audit.length === 0, audit.join(' | ') || 'clean');

  const solOk = await page.evaluate(() => {
    const out = [];
    ZONES.forEach(z => z.stages.forEach(s => {
      if (!s.solution) return;
      const r = runCode(s.solution);
      if (r.err) { out.push(s.id + ' errored: ' + r.err); return; }
      const v = s.check(r.logs, s.solution);
      if (!v.ok) out.push(s.id + ' fails own check: ' + v.msg);
    }));
    return out;
  });
  check('every declared solution passes its own check', solOk.length === 0, solOk.join(' | ') || 'all verified');

  // The bug this section exists for: starters are full of guidance comments, and
  // some of them mention the exact words a check() looks for ("one console.log",
  // "A flat white costs $5."). Submitting a bare `solution` never exercises that.
  console.log('\n== learner-realistic answers: guidance comments left in place ==');
  const realistic = await page.evaluate(() => {
    const out = [];
    ZONES.forEach(z => z.stages.forEach(s => {
      if (!s.solution || !s.starter) return;
      const comments = s.starter.split('\n').filter(l => l.trim().startsWith('//'));
      if (!comments.length) { out.push({ id: s.id, skipped: true }); return; }
      const src = comments.join('\n') + '\n' + s.solution;
      const r = runCode(src);
      if (r.err) { out.push({ id: s.id, ok: false, msg: 'errored: ' + r.err }); return; }
      const v = s.check(r.logs, stripComments(src));
      out.push({ id: s.id, ok: v.ok, msg: v.msg, comments: comments.length });
    }));
    return out;
  });
  realistic.forEach(r => {
    if (r.skipped) { console.log('       ' + r.id + '  (starter has no comments)'); return; }
    check(r.id + ' still passes with its ' + r.comments + ' starter comment(s) left in',
      r.ok, r.ok ? '' : r.msg);
  });

  console.log('\n== and the same thing through the real editor ==');
  // The counting stop is the one that was reported; the two-boxes stop had the
  // same latent fault. Named by id now, so renumbering cannot make this stale.
  const cases = [
    { id: 'z3-count-to-five', code: '// print 1, 2, 3, 4, 5 — one line each, one console.log\nfor (let i = 1; i <= 5; i++) {\n  console.log(i);\n}' },
    { id: 'z0-two-boxes-one-sentence', code: 'const drink = "flat white";\nconst price = 5;\n\n// print:  A flat white costs $5.\nconsole.log(`A ${drink} costs $${price}.`);' }
  ];
  await page.keyboard.press('Control+Shift+D');   // test mode, so we can jump
  await page.waitForTimeout(220);
  for (const c of cases) {
    await page.selectOption('#devJump', c.id);
    await page.waitForTimeout(200);
    await page.locator('#ed').fill(c.code);
    await page.locator('#runBtn').click();
    await page.waitForTimeout(220);
    const passed = await page.locator('.verdict.pass').count() === 1;
    const said = (await page.locator('.verdict').innerText()).replace(/\s+/g, ' ').slice(0, 110);
    check(c.id + ' accepted with the starter comment kept', passed, said);
    if (passed) { await page.locator('#contBtn').click(); await page.waitForTimeout(140); }
    await page.locator('#mapBtn').click(); await page.waitForTimeout(150);
  }
  await page.keyboard.press('Control+Shift+D');   // back to a gated line
  await page.waitForTimeout(200);
  await page.evaluate(() => { try { localStorage.removeItem('loopline.v1'); } catch (e) {} });
  await page.reload();
  await page.waitForTimeout(320);

  console.log('\n== walking the whole line ==');
  for (const st of plan) {
    await page.locator('.stop[data-stage="' + st.id + '"]').click();
    await page.waitForTimeout(110);
    let detail = '';
    if (st.kind === 'learn') {
      await page.locator('#gotBtn').click();
    } else if (st.kind === 'mcq') {
      await page.locator('.opt[data-i="' + st.answer + '"]').click();
      await page.waitForTimeout(120);
      const passed = await page.locator('.verdict.pass').count() === 1;
      if (!passed) fails.push(st.id + ' mcq answer rejected');
      detail = passed ? 'answer accepted' : 'ANSWER REJECTED';
      await page.locator('#contBtn').click();
    } else {
      const sol = await page.evaluate(id => {
        for (const z of ZONES) for (const s of z.stages) if (s.id === id) return s.solution;
      }, st.id);
      await page.locator('#ed').fill(sol);
      await page.locator('#runBtn').click();
      await page.waitForTimeout(180);
      const passed = await page.locator('.verdict.pass').count() === 1;
      if (!passed) fails.push(st.id + ' solution rejected in-app');
      const stars = (await page.locator('#starmeter .pips').innerText()).replace(/\s/g, '');
      detail = (passed ? 'passed' : 'REJECTED') + ' at ' + stars;
      await page.locator('#contBtn').click();
    }
    await page.waitForTimeout(120);
    await page.locator('#mapBtn').click();
    await page.waitForTimeout(110);
    console.log('  ' + (detail.includes('REJECT') ? 'FAIL' : ' OK ') + '  ' +
      st.id + ' [' + st.kind + '] ' + st.title + (detail ? '  →  ' + detail : ''));
  }

  const prog = await page.locator('.progtext').innerText();
  check('all stops cleared, none skipped', prog.trim() === plan.length + ' / ' + plan.length, prog);
  check('no unfinished business left', await page.locator('.revisit').count() === 0);

  console.log('\n== the loop cliff: does each zone-3 stop add only one thing? ==');
  const z3 = await page.evaluate(() => {
    const z = ZONES.find(x => x.id === 3);
    return z.stages.map(s => ({ id: s.id, title: s.title, kind: s.kind, sol: s.solution || s.code || '' }));
  });
  for (const s of z3) {
    const f = [];
    if (/\bfor\s*\(/.test(s.sol)) f.push('for');
    if (/\[\s*i\s*\]/.test(s.sol)) f.push('i-as-index');
    if (/i\s*\+\s*1/.test(s.sol)) f.push('i+1');
    if (/`/.test(s.sol)) f.push('template');
    if (/\bif\s*\(/.test(s.sol)) f.push('if');
    if (/\.length/.test(s.sol)) f.push('.length');
    console.log('       ' + s.id + ' ' + s.title.padEnd(28) + ' uses: ' + (f.join(', ') || '—'));
  }

  console.log('\njs errors: ' + (jsErr.length ? jsErr.join(' | ') : 'none'));
  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
})();
