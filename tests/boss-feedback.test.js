const { chromium } = require('playwright');
const path = require('path');
const { seed } = require('./_seed');

// Uses whatever Chromium Playwright installed (`npx playwright install chromium`).
// Set CHROME_PATH to point at a specific binary instead.
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');

let fails = [];
function check(l, c, d) { console.log((c ? '  OK  ' : ' FAIL ') + l + (d ? '\n           → ' + d : '')); if (!c) fails.push(l); }

const CASES = [
  { name: "A learner's submission: counted but never printed",
    code: `const delays = [2, 14, 0, 23, 7, 31];
let count =0;
// print each delay over 10, then the total count
for (let i = 0; i < delays.length; i++) {
  if (delays[i] >= 10) {
    count++;            // grows INSIDE the if
  }
}
console.log(\`\${count} services delayed\`);`,
    want: /Add a console\.log for the delay inside the if/ },
  { name: 'printed the delays but forgot the tally',
    code: `const delays = [2, 14, 0, 23, 7, 31];
for (let i = 0; i < delays.length; i++) {
  if (delays[i] > 10) { console.log(\`Delay: \${delays[i]} min\`); }
}`,
    want: /only the final tally line is missing/ },
  { name: 'print outside the if — everything comes out',
    code: `const delays = [2, 14, 0, 23, 7, 31];
let count = 0;
for (let i = 0; i < delays.length; i++) {
  console.log(\`Delay: \${delays[i]} min\`);
  if (delays[i] > 10) { count++; }
}
console.log(\`\${count} services delayed\`);`,
    want: /outside the if/ },
  { name: 'counter declared inside the loop',
    code: `const delays = [2, 14, 0, 23, 7, 31];
for (let i = 0; i < delays.length; i++) {
  let count = 0;
  if (delays[i] > 10) { console.log(\`Delay: \${delays[i]} min\`); count++; }
}
console.log("3 services delayed");`,
    want: /typed by hand|Expected 4 lines/ },
  { name: 'correct answer, but with >= 10',
    code: `const delays = [2, 14, 0, 23, 7, 31];
let count = 0;
for (let i = 0; i < delays.length; i++) {
  if (delays[i] >= 10) { console.log(\`Delay: \${delays[i]} min\`); count++; }
}
console.log(\`\${count} services delayed\`);`,
    want: /"over 10" means > 10/, expectPass: true }
];

(async () => {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage();
  await p.goto('file://' + APP);
  await p.waitForTimeout(300);
  for (const c of CASES) {
    const r = await p.evaluate(src => {
      // This suite is specifically about the zone-3 "delay board" boss's near-miss
      // messages — find it by id rather than "the last boss stage", since there is
      // now more than one boss stage in the line.
      let boss; ZONES.forEach(z => z.stages.forEach(s => { if (s.id === 'z3-interchange-the-delay-board') boss = s; }));
      const out = runCode(src);
      if (out.err) return { err: out.err };
      const v = boss.check(out.logs, stripComments(src));
      return { ok: v.ok, msg: v.msg, lines: out.logs.length };
    }, c.code);
    const passOk = c.expectPass ? r.ok === true : r.ok === false;
    check(c.name, passOk && c.want.test(r.msg || ''), (r.lines !== undefined ? '(' + r.lines + ' lines) ' : '') + (r.msg || r.err));
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILING' : '\nALL GREEN');
  await b.close();
})();
