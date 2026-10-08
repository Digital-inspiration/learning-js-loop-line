// Shared test seed.
//
// The game asks for a player name on first run. Every suite except
// player-name.test.js is about something else, so they seed a name up front
// via addInitScript and skip the welcome screen.
//
// It runs before the page's own scripts on EVERY navigation, and is careful not
// to disturb the save it finds: if a v1 blob is present (the migration tests
// plant one) it seeds the name into that instead, so the real migration path
// still runs.

const SEED_NAME = 'Tester';

function seedScript(name) {
  const who = name || SEED_NAME;
  return `(() => {
    try {
      var K = 'loopline.v2', OLD = 'loopline.v1', who = ${JSON.stringify(who)};
      var v2 = localStorage.getItem(K);
      if (v2) {
        var o = JSON.parse(v2);
        if (!o.player) { o.player = who; localStorage.setItem(K, JSON.stringify(o)); }
        return;
      }
      var v1 = localStorage.getItem(OLD);
      if (v1) {
        var p = JSON.parse(v1);
        if (!p.player) { p.player = who; localStorage.setItem(OLD, JSON.stringify(p)); }
        return;
      }
      localStorage.setItem(K, JSON.stringify({ schema: 3, player: who, xp: 0, done: {}, stars: {} }));
    } catch (e) {}
  })()`;
}

/** Call on a BrowserContext before its first navigation. */
async function seed(context, name) {
  await context.addInitScript(seedScript(name));
}

module.exports = { seed, seedScript, SEED_NAME };
