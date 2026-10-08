// Stage ids are the keys in everybody's save file. Losing one loses that
// person's progress on that stop, silently — no error, no crash, just a tick
// that quietly disappears or lands on the wrong lesson.
//
// So the ids are pinned. tests/known-ids.json records what shipped; this
// compares today's ids against it and fails if any went missing without a
// MAPS entry saying where it went. Adding new stops is free, which is the
// point of stable ids: inserting a lesson no longer renames its neighbours.
//
// When a failure here is intentional (you renamed or removed a lesson on
// purpose), the fix is to add the mapping and bump the schema — the message
// below tells you exactly what to write — then refresh the snapshot with:
//   node tests/ids.test.js --update
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};
const APP = path.resolve(__dirname, '..', 'index.html');
const SNAPSHOT = path.join(__dirname, 'known-ids.json');

let fails = [];
function check(label, cond, detail) {
  console.log((cond ? '  OK  ' : ' FAIL ') + label + (detail ? '  →  ' + detail : ''));
  if (!cond) fails.push(label);
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const page = await browser.newPage();
  await page.goto('file://' + APP);

  const live = await page.evaluate(() => ({
    schema: SCHEMA,
    ids: ZONES.flatMap(z => z.stages.map(s => s.id)),
    maps: MAPS
  }));
  await browser.close();

  if (process.argv.includes('--update')) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({ schema: live.schema, ids: live.ids }, null, 1) + '\n');
    console.log('snapshot updated: schema ' + live.schema + ', ' + live.ids.length + ' ids');
    return;
  }

  const known = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const liveSet = new Set(live.ids);

  console.log('== ids are unique and well formed ==');
  check('no duplicate ids', liveSet.size === live.ids.length,
    live.ids.length - liveSet.size + ' duplicate(s)');
  const malformed = live.ids.filter(id => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id));
  check('every id is a plain lowercase slug', malformed.length === 0, malformed.join(', ') || 'all clean');
  const positional = live.ids.filter(id => /^\d+\.\d+$/.test(id));
  check('no id is a bare position any more', positional.length === 0, positional.join(', ') || 'none');

  console.log('\n== no shipped id disappeared without somewhere to go ==');
  // An id may vanish from the content only if some MAPS step forwards it.
  const forwarded = new Set();
  Object.keys(live.maps).forEach(step => Object.keys(live.maps[step]).forEach(from => forwarded.add(from)));

  const orphaned = known.ids.filter(id => !liveSet.has(id) && !forwarded.has(id));
  check('every id from the last snapshot is still reachable', orphaned.length === 0,
    orphaned.length
      ? orphaned.length + ' id(s) vanished with no MAPS entry: ' + orphaned.slice(0, 5).join(', ') +
        '  — add   ' + JSON.stringify(Object.fromEntries(orphaned.slice(0, 3).map(o => [o, 'its-new-id']))) +
        '   to MAPS[' + live.schema + '] and set SCHEMA = ' + (live.schema + 1)
      : known.ids.length + ' ids still present or mapped');

  // Where a MAPS entry exists, it has to point at something real.
  const dangling = [];
  Object.keys(live.maps).forEach(step => {
    Object.keys(live.maps[step]).forEach(from => {
      let target = live.maps[step][from];
      for (let s = Number(step) + 1; s < live.schema; s++) {
        if (live.maps[s] && live.maps[s][target]) target = live.maps[s][target];
      }
      if (!liveSet.has(target)) dangling.push(from + ' -> ' + target);
    });
  });
  check('every MAPS chain ends at a stop that exists', dangling.length === 0,
    dangling.slice(0, 4).join('; ') || 'all chains land');

  console.log('\n== the snapshot itself is current ==');
  const added = live.ids.filter(id => !known.ids.includes(id));
  check('snapshot schema matches the page', known.schema === live.schema,
    'snapshot ' + known.schema + ', page ' + live.schema);
  if (added.length) {
    console.log('  note  ' + added.length + ' new stop(s) since the snapshot: ' + added.slice(0, 4).join(', ') +
      (added.length > 4 ? ' …' : '') + '  — run  node tests/ids.test.js --update  once you are happy');
  }

  console.log(fails.length ? '\n' + fails.length + ' FAILING: ' + fails.join(', ') : '\nALL GREEN');
  if (fails.length) process.exitCode = 1;
})();
