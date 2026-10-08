// Loads the REAL sandbox out of index.html, so guard.test.js tests the code
// that actually ships rather than a copy of it.
//
// This replaces the old tests/loop-guard.js, which was a hand-maintained
// duplicate: the suite could pass while index.html had drifted away from it.
//
// The sandbox is section 1 of the page script and touches nothing in the DOM —
// it is pure string work plus a `new Function` call — so it evaluates happily
// in a bare vm context with no browser.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.resolve(__dirname, '..', 'index.html');

// Everything from the top of the page script down to the start of section 2.
// If those section headers are ever renamed this throws loudly, which is the
// point: better a failed test run than silently checking the wrong code.
function sandboxSource(html) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!script) throw new Error('_sandbox.js: no <script> block found in index.html');
  const src = script[1];

  const nextSection = src.indexOf('2. CONTENT');
  if (nextSection === -1) {
    throw new Error('_sandbox.js: could not find the "2. CONTENT" section header in index.html — ' +
                    'if the sections were renamed, update this loader.');
  }
  const cut = src.lastIndexOf('/*', nextSection);   // start of section 2's banner comment
  const code = src.slice(0, cut);

  if (!/function\s+runCode\s*\(/.test(code) || !/function\s+instrument\s*\(/.test(code)) {
    throw new Error('_sandbox.js: the extracted section does not define runCode/instrument — ' +
                    'index.html may have been reorganised.');
  }
  return code;
}

function loadSandbox() {
  const code = sandboxSource(fs.readFileSync(APP, 'utf8'));
  // Hand back the same names index.html uses, so a rename there surfaces here.
  const exposed = '\n;({ splitTop, isIdent, instrument, stripComments, stripStrings, ' +
                  'makeTick, formatValue, friendly, runCode, MAX_TICKS, MAX_MS })';
  return vm.runInNewContext(code + exposed, Object.create(null), { filename: 'index.html:sandbox' });
}

module.exports = loadSandbox();
module.exports.sandboxSource = sandboxSource;
