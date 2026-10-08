// The sandbox runs learner code through `new Function`, which means any name it
// does not shadow resolves to the real window. That is not a theoretical hole:
// `print` is window.print, so a beginner typing print('hi') — the natural guess
// coming from Python — opened the browser's print dialog. The same route
// reached localStorage, where this page keeps everybody's progress.
//
// This suite has to run in a real browser. The vm-based guard suite cannot see
// this class of bug at all, because its context has no window to leak from.
const { chromium } = require('playwright');
const path = require('path');

const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');

let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}

// Names a learner must not be able to reach. Each one is a real window property
// in a browser, so if the shadowing ever regresses these go back to being live.
// `print` is deliberately NOT here: it is shadowed by a shim that throws a
// lesson, so it is still a function — just not window.print. Its own section
// below proves it teaches rather than opening the print dialog.
const MUST_BE_UNREACHABLE = [
  'alert', 'confirm', 'prompt', 'open',
  'window', 'document', 'globalThis', 'self', 'parent', 'top',
  'localStorage', 'sessionStorage', 'indexedDB',
  'fetch', 'XMLHttpRequest', 'navigator', 'location', 'history',
  'setTimeout', 'setInterval',
  'state', 'ZONES', 'save'
];

// Things the lessons genuinely use. Blocking too much is its own bug, so the
// suite fails in that direction too.
const MUST_STILL_WORK = [
  ['console.log',        'console.log("Platform 9"); console.log(94);',                       ['Platform 9', '94']],
  ['template literal',   'const n="Soma"; console.log(`Hi, ${n}! Ready to roll.`);',          ['Hi, Soma! Ready to roll.']],
  ['for loop + total',   'let t=0; for(let i=1;i<=5;i++){ t+=i; } console.log(t);',           ['15']],
  ['array methods',      'console.log([1,2,3].map(n=>n*2).filter(n=>n>2));',                  ['[4,6]']],
  ['Set and Map',        'console.log(new Set([1,1,2]).size, new Map([["a",1]]).get("a"));',  ['2 1']],
  ['spread and rest',    'const f=(...n)=>n.length; console.log(f(...[1,2,3]));',             ['3']],
  ['Math, JSON, Date',   'console.log(Math.max(2,9), typeof JSON.parse, typeof Date);',       ['9 function function']]
];

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage();

  // A dialog would block every later call, so record and dismiss rather than
  // letting one wedge the run. Seeing any at all is itself the failure.
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });

  await page.goto(FILE);

  console.log('== browser globals do not reach learner code ==');
  for (const name of MUST_BE_UNREACHABLE) {
    const out = await page.evaluate(n => runCode('console.log(typeof ' + n + ')'), name);
    check(name + ' is out of reach', out.logs[0] === 'undefined',
      out.err ? 'error: ' + out.err : 'typeof → ' + out.logs[0]);
  }

  console.log('\n== print() teaches instead of hijacking the browser ==');
  const printed = await page.evaluate(() => runCode("print('Hi, Soma! Ready to roll.');"));
  const isWindowPrint = await page.evaluate(() => runCode('console.log(print === window.print)'));
  check('print is not window.print', isWindowPrint.logs[0] !== 'true',
    'window is itself shadowed, so this reads ' + JSON.stringify(isWindowPrint.logs) + ' / ' + (isWindowPrint.err || 'no error'));
  check('print() does not print the page', dialogs.length === 0, dialogs.join(', ') || 'no dialog opened');
  check('print() produces no console output', printed.logs.length === 0, JSON.stringify(printed.logs));
  check('print() names console.log as the fix', /console\.log\(\)/.test(printed.err || ''), printed.err);
  check('the message is a sentence, not a stack trace', !/^Error:/.test(printed.err || ''), printed.err);

  console.log('\n== the save cannot be read or overwritten from a lesson ==');
  const wipe = await page.evaluate(() => runCode('localStorage.setItem("loopline.v2","wiped")'));
  check('writing to the save throws instead of succeeding', !!wipe.err, wipe.err);
  const survived = await page.evaluate(() => {
    try { return localStorage.getItem('loopline.v2') !== 'wiped'; } catch (e) { return true; }
  });
  check('the real save is untouched', survived);

  console.log('\n== the lessons themselves still run ==');
  for (const [label, code, expected] of MUST_STILL_WORK) {
    const out = await page.evaluate(c => runCode(c), code);
    check(label + ' still works',
      !out.err && JSON.stringify(out.logs) === JSON.stringify(expected),
      out.err ? 'ERROR ' + out.err : JSON.stringify(out.logs));
  }

  console.log('\n== the blocklist in the page covers everything this suite checks ==');
  const declared = await page.evaluate(() => SANDBOX_BLOCKED);
  const missing = MUST_BE_UNREACHABLE.concat('print').filter(n => !declared.includes(n));
  check('every name here is named in SANDBOX_BLOCKED', missing.length === 0,
    missing.join(', ') || declared.length + ' names declared');

  console.log('\n== the loop guard is unaffected ==');
  const spun = await page.evaluate(() => runCode('let i=0; while(i<5){ }'));
  check('an infinite loop is still stopped', /never stopped/.test(spun.err || ''), spun.err);

  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  await browser.close();
  if (fails.length) process.exitCode = 1;
})();
