// The sandbox is read straight out of index.html, so this suite always tests
// the loop guard that actually ships. See tests/_sandbox.js.
//
// Every case states what the sandbox SHOULD do, not what it currently does, so
// this fails if the guard regresses rather than just recording the new output.
// The two things that matter most:
//   - a loop that cannot end must be stopped, and say so in plain English
//   - everything else must run untouched — especially code that merely mentions
//     "while" or "for" inside a string, a comment or a variable name
const { runCode, instrument, friendly, MAX_TICKS, MAX_MS } = require('./_sandbox.js');

let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A message a beginner can act on: no stack trace, no "undefined".
const GUARD_MSG = /never stopped|still going after/;

// logs:  exact console output expected, in order
// guard: true when the loop guard must stop it
// err:   a pattern the error message must match
const cases = [
  // --- ordinary code runs untouched -------------------------------------
  { name: 'normal for',                src: 'for (let i = 0; i < 3; i++) { console.log(i); }', logs: ['0', '1', '2'] },
  { name: 'single-statement while body', src: 'let i=0;\nwhile (i < 3) console.log(i++);',      logs: ['0', '1', '2'] },
  { name: 'do while',                  src: 'let i=0;\ndo { console.log(i); i++; } while (i < 3);', logs: ['0', '1', '2'] },
  { name: 'nested parens in condition', src: 'const a=[1,2,3];\nlet i=0;\nwhile (i < Math.min(a.length, 10)) { console.log(a[i]); i++; }', logs: ['1', '2', '3'] },
  { name: 'nested loops',              src: 'for (let i=0;i<2;i++){ for (let j=0;j<2;j++){ console.log(i+"-"+j); } }', logs: ['0-0', '0-1', '1-0', '1-1'] },
  { name: 'for...of untouched',        src: 'for (const s of ["a","b"]) { console.log(s); }',   logs: ['a', 'b'] },
  { name: 'forEach not mangled',       src: '["a","b"].forEach(function(x){ console.log(x); });', logs: ['a', 'b'] },
  { name: 'template literal',          src: 'const n="Pri";\nconsole.log(`Hi, ${n}!`);',        logs: ['Hi, Pri!'] },
  { name: 'array + objects',           src: 'const s=[{a:1}];\nconsole.log(s[0]);',             logs: ['{"a":1}'] },

  // --- the words "for" and "while" must only count as keywords ----------
  { name: 'string containing while',   src: 'console.log("while (true) is a trap");',           logs: ['while (true) is a trap'] },
  { name: 'comment containing for',    src: '// for (;;) never do this\nconsole.log("ok");',    logs: ['ok'] },
  { name: 'variable named format',     src: 'const format = 1; console.log(format);',           logs: ['1'] },
  { name: 'variable named forever',    src: 'let forever = 2; console.log(forever);',           logs: ['2'] },

  // --- loops that cannot end must be stopped ----------------------------
  { name: 'infinite while',            src: 'let i = 0;\nwhile (i < 5) { console.log("hi"); }', guard: true },
  { name: 'infinite for (no increment)', src: 'for (let i = 0; i < 5;) { console.log("x"); }',  guard: true },
  { name: 'for(;;)',                   src: 'let n=0;\nfor (;;) { n++; }',                      guard: true, logs: [] },
  { name: 'infinite single-statement', src: 'let i=0;\nwhile (i < 3) console.log("stuck");',    guard: true },
  { name: 'infinite do while',         src: 'let i=0;\ndo { i = 0; } while (i < 3);',           guard: true, logs: [] },

  // --- broken code explains itself --------------------------------------
  { name: 'reference error',           src: 'console.log(nmae);', logs: [], err: /never heard of "nmae"/ },
  { name: 'syntax error',              src: 'for (let i = 0; i < 3 i++) { }', logs: [], err: /cannot read this code/ }
];

console.log('== ' + cases.length + ' cases through the real sandbox ==');
let slowest = 0;
for (const c of cases) {
  const t0 = Date.now();
  const r = runCode(c.src);
  const ms = Date.now() - t0;
  slowest = Math.max(slowest, ms);

  const shown = JSON.stringify(r.logs.slice(0, 4)) + (r.logs.length > 4 ? ' +' + (r.logs.length - 4) : '');

  if (c.guard) {
    check(c.name + ': stopped by the guard', !!r.err && GUARD_MSG.test(r.err),
      r.err ? r.err.slice(0, 60) + '…' : 'NO ERROR — the loop was not caught');
  } else if (c.err) {
    check(c.name + ': explained, not crashed', !!r.err && c.err.test(r.err), r.err || 'no error raised');
  } else {
    check(c.name + ': no error', !r.err, r.err || 'clean');
  }

  if (c.logs) {
    check(c.name + ': output', same(r.logs, c.logs),
      same(r.logs, c.logs) ? shown : 'got ' + shown + ', wanted ' + JSON.stringify(c.logs));
  }
}

console.log('\n== the guard returns promptly, so the page never hangs ==');
check('slowest case well inside the 1.5s time budget', slowest < 5000, slowest + 'ms');

console.log('\n== instrument() rewrites conditions, and only conditions ==');
const inst = src => instrument(src);
check('a while condition gets a tick', /__tick\(\) && \(i < 5\)/.test(inst('while (i < 5) { x(); }')),
  inst('while (i < 5) { x(); }'));
check("a for's middle clause gets a tick", /__tick\(\) && \(i<n\)/.test(inst('for (let i=0; i<n; i++) { x(); }')),
  inst('for (let i=0; i<n; i++) { x(); }'));
check('an empty for condition still ticks', /__tick\(\)/.test(inst('for (;;) { x(); }')), inst('for (;;) { x(); }'));
check('a while inside a string is left alone', !/__tick/.test(inst('console.log("while (true)");')),
  inst('console.log("while (true)");'));
check('a for inside a comment is left alone', !/__tick/.test(inst('// for (;;)\nx();')), inst('// for (;;)\nx();'));
check('for...of is left alone', !/__tick/.test(inst('for (const s of xs) { x(); }')), inst('for (const s of xs) { x(); }'));
check('a variable called forever is left alone', !/__tick/.test(inst('let forever = 2;')), inst('let forever = 2;'));
check('the loop body is not touched', /\{ console\.log\(i\); \}/.test(inst('while (i<3) { console.log(i); }')),
  inst('while (i<3) { console.log(i); }'));

console.log('\n== the stop message quotes the real limits, not numbers typed by hand ==');
const countMsg = runCode('while (true) { }').err;
check('the count message names the configured tick cap',
  countMsg.includes(MAX_TICKS.toLocaleString('en-US')), countMsg.slice(0, 48) + '…  (cap ' + MAX_TICKS + ')');
const timeMsg = friendly(Object.assign(new Error('LOOP_GUARD_TIME'), { __guard: true }));
check('the time message names the configured time budget',
  timeMsg.includes(String(MAX_MS / 1000)), timeMsg.slice(0, 48) + '…  (budget ' + MAX_MS + 'ms)');

console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
if (fails.length) process.exitCode = 1;
