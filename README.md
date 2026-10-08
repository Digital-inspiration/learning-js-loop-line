# Loop Line

A gamified JavaScript course for absolute beginners, built as a plain HTML page
with no framework and no build step. A metro line with 95 stops: `console.log`
at one end, spread and rest at the other, and nothing in between that has to be
taken on faith.

**[Play it →](https://digital-inspiration.github.io/loop-line/)**

No build step, no dependencies, no server required. Open `index.html` and it
runs. Three files, and only two of them matter to a player:

| File | What it holds |
|---|---|
| `index.html` | The whole game — content, sandbox, save system, help ladder |
| `styles.css` | Every rule the page uses; the palette is CSS custom properties on `:root` |
| `server.py` | Optional. Stores progress in a real file instead of the browser |

---

## The teaching model

Every zone runs **learn → predict → write**, so nobody meets a new idea and a
blank editor at the same time. Each stop adds exactly one concept and reuses
what the last one taught.

That reuse is not left to good intentions. All 90 stages past Zone 0 carry a
`reinforces` list naming concepts from earlier zones, and the content audit
fails if a stop where you write code has an empty one.

| | Stops |
|---|---|
| Read a worked example (`learn`) | 28 |
| Predict the output before running it (`mcq`) | 28 |
| Write it yourself (`write`) | 31 |
| Interchange — everything so far, at once (`boss`) | 8 |
| **Total** | **95** |

## The line

| Zone | Name | Teaches | Stops |
|---|---|---|---|
| 0 | Signals | `console.log`, `let` / `const`, `` `${...}` `` | 5 |
| 1 | Junctions | `if` / `else if` / `else`, comparison, boundaries | 5 |
| 2 | Sidings | arrays, index, `.length`, replacing an item | 5 |
| 3 | The Long Haul | `for`, the counter as an index, `if` inside a loop, a running total | 12 |
| 4 | Depots | functions, parameters, `return`, calling | 8 |
| 5 | Manifests | objects, dot notation, arrays of objects | 8 |
| 6 | Express | arrow functions, implicit return | 8 |
| 7 | The Yard | `forEach`, `map`, `filter`, a taste of `reduce` | 11 |
| 8 | Baggage Claim | array and object destructuring | 11 |
| 9 | The Ledger | `Set`, `Map` | 11 |
| 10 | The Coupling Yard | `...spread`, `...rest` | 11 |

Zone 3 is the longest stretch on the line. Loops are where beginners stall, so
that zone gets twelve stops and the first interchange.

## Design decisions worth knowing

**Wrong answers are free.** Every stop starts at ★★★. Guessing costs nothing;
stars are only spent on help. For someone who has never coded, the failed run
*is* the lesson.

**Help escalates on its own.** Miss three times and a hint appears unasked; each
further miss brings the next one. A rung costs the same whether you asked for it
or waited, so stars measure how much help was needed rather than how willing
someone was to press a button. After every hint is out, a last-resort button
fills in the answer and marks the stop skipped — no dead ends.

**Feedback names the gap, not the symptom.** `check()` receives both the console
output and the source, so it can say *"the tally is right but you never printed
the delays — add a console.log inside the if"* instead of *"expected 4 lines,
got 1"*. It can also insist on *how* a problem was solved: `stops[3]` is rejected
in favour of `stops[stops.length - 1]`.

**Checks read the learner's actual values, not the ones they were given.** If a
stop hands you `const age = 15` and invites you to change it and re-run, the
check parses the value back out of your source and works out the right answer
from that. Editing the example and being told you are wrong is the fastest way
to teach someone that the machine is arbitrary.

**More than one right answer is right.** Where an idiom is genuinely
interchangeable — `for...in`, `for...of`, a C-style counter — the check accepts
all of them rather than the one the lesson happened to demonstrate.

**It works on a phone.** Someone learning to code is as likely to be on a
bus as at a desk. The page declares a viewport and reflows the topbar below
640px, so the line, the editor and the run button are all reachable on a small
screen rather than scaled down to something unreadable.

**Untrusted numbers are coerced at the boundary.** XP arrives from browser
storage, from a progress file someone hands you, and from the server's copy —
none of which the page controls. `toXp()` turns anything that is not a sane
positive number into `0` at the point it enters, so a string can never
concatenate where addition was meant, and can never reach `innerHTML` as
markup. Player names are stripped of quotes, slashes and angle brackets on the
way in and escaped on the way out.

**Infinite loops are survivable.** Beginners learning loops write them
constantly. The runner rewrites loop *conditions* before executing:

```js
while (i < 5)              →  while (__tick() && (i < 5))
for (let i=0; i<n; i++)    →  for (let i=0; __tick() && (i<n); i++)
```

`__tick()` throws after 120,000 iterations or 1.5 seconds, and the learner gets
*"Your loop ran 120,000 times and never stopped. Check that the thing your
condition tests actually changes inside the loop."* Those two numbers come from
`MAX_TICKS` and `MAX_MS`: change a limit and the sentence follows it, and a test
fails if anyone types them back in by hand. Rewriting the condition rather than
the body covers single-statement bodies and `do/while` too; `for...of` is left
alone since it cannot spin forever on an array.

## Running it

Open `index.html`. That is the whole instruction — it works from the filesystem
with no server and no build. Keep `styles.css` beside it; the page links it as a
sibling, and a linked stylesheet loads fine over `file://`.

To keep progress in a real file instead of browser storage:

```bash
python3 server.py          # http://localhost:8000
python3 server.py 8080     # another port
```

`server.py` is stdlib only. It serves the page **and** writes
`progress-<name>.json` beside it — one file per player, so two people on the
same machine never share a save. Plain indented JSON you can read or edit,
created on the first win, reloaded on every visit. Writes go through a temp file
and a rename, so an interrupted save cannot leave a half-written file.

### Where progress is kept

The page works out where it is running and picks a store to match, then names
its choice at the foot of the map so nobody has to guess.

| Opened from | Store | Why |
|---|---|---|
| `file://` — double-clicking `index.html` | Browser storage | No server to POST to |
| `localhost` / `127.0.0.1` with `server.py` | `progress-<name>.json` | The server is there and can write |
| A static host, GitHub Pages included | Browser storage | The host serves files; it cannot accept a write |
| Any host, with `?store=file` on the URL | `progress-<name>.json` | Escape hatch for a host name the check does not recognise |

If a file write fails the page falls back to browser storage and says so rather
than pretending the save happened. The **Save progress to a file** / **Load
from a file** buttons work in every one of these cases, so progress can move
between them by hand.

`server.py` binds `127.0.0.1`, so it is reachable from the machine it runs on
and nowhere else. Serving it to a LAN means putting a real server in front of
it — which is also the case where `?store=file` earns its keep, since the
hostname check alone would send that visitor to browser storage.

### Deploying to GitHub Pages

Push the repo and turn Pages on for the default branch, root folder. There is
no build step, so nothing else is needed. `.nojekyll` sits in the root to stop
Pages running Jekyll over the files: Jekyll drops anything whose name starts
with an underscore, and it has no business processing a page that is already
finished. Nothing the game needs at runtime is underscore-prefixed, so this is
insurance rather than a fix — but it costs one empty file and removes a class
of surprise where a deployed file is simply missing.

Progress on a Pages deployment lives in each visitor's own browser storage.
That is per-browser and per-device: it does not follow someone to their phone,
and clearing site data clears it. The save/load buttons are the way across.

### Who is playing

The page asks for a name on first run, stores it alongside the progress, and
puts it on the map and into the one stage that asks you to print a greeting —
so the first code a learner writes says their own name back to them. The name
never leaves the browser.

## Test mode

You should not have to replay ninety-four stops to check the ninety-fifth.

| Way in | Scope |
|---|---|
| `Ctrl` / `⌘` + `Shift` + `D` | toggles, persists per browser until turned off |
| `?dev` on the URL | handy locally |
| **Boss login** button at the foot of the map | this tab only, until it is closed |

Every stop unlocks and a jump-to dropdown appears. Off by default and invisible
to anyone who never turns it on.

**Nothing done in test mode is saved.** Stars, XP and skips update on screen so
you can watch a stage score itself, but none of it reaches browser storage or
the progress file. Reload, or turn test mode off, and the real run is exactly as
it was.

> The boss-login password is a plain string in `index.html`, readable by anyone
> who opens view-source or devtools. It is a gate against stumbling into every
> level unlocked, not security. Change it at `BOSS_PASSWORD` (and in
> `tests/boss-login.test.js`) if you want a different one.

## Adding content

Everything lives in the `ZONES` array in `index.html`. A stage is:

```js
{
  id: 'z3-count-to-five',               // a NAME, not a position. Never change it
  kind: 'learn' | 'mcq' | 'write' | 'boss',
  title, brief, task, starter,
  reinforces: ['arrays', 'for'],        // the spiral, enforced in data

  nudge:    'a diagnostic question, no syntax',   // free, arrives on miss 3
  example:  { code, note },                       // same idea, DIFFERENT subject
  hint:     'the answer shape',
  solution: 'working code for the escape hatch',

  check: function (outputLines, sourceText) {
    return { ok: true|false, msg: 'plain English, not a stack trace' };
  }
}
```

What the tests enforce:

- **Every `write` and `boss` stage is fully authored** — nudge, example, hint,
  solution, check, starter and task all present. A half-written stop fails the
  suite rather than reaching a learner.
- **Every stage carries a non-empty `reinforces` list.** An empty one is a
  content bug: it means the stop has stopped spiralling.
- **Every `solution` passes its own `check()`.** The escape hatch can never hand
  someone an answer the game then rejects.
- **Starters still pass with their guidance comments left in**, since that is
  how a learner will actually run them.

And one convention the tests *don't* police, so it needs a human eye in review:
an `example` should use a different subject from the stage it helps with, so it
cannot be copy-pasted into the answer.

`check()` is handed comment-stripped source, because starters are full of
guidance comments that mention the very words checks look for.

### Never lose someone's progress

A stage id is the key under which someone's progress is stored, so losing one
loses a tick — silently, with no error to notice.

Ids used to be positions (`3.7` meant "zone 3, seventh stop"), which meant
inserting a lesson renamed every stop after it and every save in the wild went
stale. They are names now — `z3-count-to-five` — assigned once and never moved.
**Inserting, reordering or retitling a lesson renames nothing**, so the common
edit needs no migration at all. The number you see in the test-mode jump list is
computed from position at render time; it is a label, not the id.

The migration machinery stays for the uncommon case. Every save carries a
`schema` number, `MAPS[n]` forwards ids from schema *n* to *n+1*, and old saves
are walked forward on load — a save from the original 11-stop build still
migrates cleanly today. The move to stable ids was itself recorded that way, as
`MAPS[3]`.

If you ever do rename, merge or remove a lesson, add the mapping to `MAPS` and
bump `SCHEMA`. `tests/ids.test.js` holds you to it: it pins the shipped ids in
`tests/known-ids.json` and fails if one disappears without somewhere to go,
printing the entry you need to write. Adding new stops is free. Once you are
happy with a deliberate change, refresh the snapshot with
`node tests/ids.test.js --update`. Do not bump the storage key.

## Tests

```bash
npm run setup     # npm install && npx playwright install chromium
npm test
```

Every browser suite drives the real page — content is read out of the live
`ZONES`, and `server-store.test.js` runs the actual `server.py`.

| Suite | Covers |
|---|---|
| `guard.test.js` | 48 assertions across 20 sandbox cases against the real loop guard — infinite loops stopped, ordinary loops untouched, `for...of` and strings containing `while` left alone — plus 8 on what `instrument()` rewrites and 2 that the stop message quotes the real limits. No browser, ~1s |
| `ids.test.js` | Stage ids are unique, well formed, and none vanished without a `MAPS` entry |
| `content.test.js` | Content audit across all 95 stops; every solution passes its own check |
| `help-ladder.test.js` | Escalation thresholds, star costs, escape hatch |
| `progress-ui.test.js` | Tick strip, "not solved yet" panel |
| `test-mode.test.js` | Gating, jump-to, persistence, isolation between viewers |
| `dev-mode-no-save.test.js` | Test-mode play never reaches localStorage or the progress file |
| `boss-login.test.js` | Password gate, tab-scoped session, turning it off again |
| `boss-feedback.test.js` | The boss's near-miss messages |
| `player-name.test.js` | Naming, renaming, sanitising, and the name reaching the right stage |
| `save-file.test.js` | Save/load a progress file, schema migration, malformed input |
| `server-store.test.js` | Runs the real `server.py` and checks the file *is* the store |

`content.test.js` reads the content out of the live page rather than hardcoding
it, so it survives content edits without needing updates.

`guard.test.js` gets the sandbox from `tests/_sandbox.js`, which lifts section 1
of the page script straight out of `index.html` and evaluates it in a bare `vm`
context — the loop guard touches nothing in the DOM, so it runs with no browser
in about a second. It is the shipping code being tested, not a copy of it, and
the loader throws if it cannot find the section it expects rather than quietly
testing the wrong thing.

The nine browser suites that are not about naming share `tests/_seed.js`, which
plants a player name before the page's own scripts run so they skip the welcome
screen without faking anything else. It is deliberately careful around the
migration tests: when it finds an old-schema save already planted, it seeds the
name into *that* rather than overwriting it, so the real migration path still
runs.

Each case states what the sandbox *should* do rather than recording what it
currently does, so the suite fails on a regression instead of quietly adopting
it. The assertions were checked by breaking the guard on purpose and confirming
they notice: rewording the "your loop never stopped" message fails five cases,
removing the `for...of` protection fails that case, and taking out keyword
detection altogether makes the run hang — which is the point, since that is
exactly what would happen to a learner's browser.

## Licence

MIT — see `LICENSE`.
