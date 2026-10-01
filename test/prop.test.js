// Property test: parse simulated log rows with the real parser (via jsdom),
// feed the tracker, and check the true hands are always a possible world.
const { JSDOM } = require('jsdom');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><body></body>');
global.document = dom.window.document;
const parser = require(path.join(ROOT, 'src/parser.js'));
const { Tracker } = require(path.join(ROOT, 'src/tracker.js'));
const { simulate } = require(path.join(ROOT, 'test/sim.js'));

function run(seed, turns, withSelfKnown) {
  const g = simulate(seed, { turns });
  const evs = g.rows.map((row) => {
    const el = document.createElement('div');
    el.innerHTML = row.html;
    return parser.parseEntry(el);
  });
  const unparsed = evs.filter((e) => e.ev && e.ev.type === 'unparsed');
  if (unparsed.length) {
    console.log('UNPARSED', unparsed.slice(0, 5).map((e) => e.text));
  }
  // Replay with self discovery like the controller does.
  let selfName = withSelfKnown ? 'Owen' : null;
  let t;
  let restart = true;
  let maxWorlds = 0, failures = 0, firstFail = null;
  while (restart) {
    restart = false;
    t = new Tracker({ selfName });
    failures = 0; firstFail = null; maxWorlds = 0;
    for (let i = 0; i < evs.length; i++) {
      const r = t.apply(evs[i].ev);
      if (r && r.selfDiscovered && !selfName) {
        selfName = r.selfDiscovered;
        restart = true;
        break;
      }
      maxWorlds = Math.max(maxWorlds, t.worlds.length);
      // check truth ∈ worlds (only once self name is known; before that "YOU" is separate)
      const truth = g.rows[i].truth;
      const order = t.players.map((n) => g.names.indexOf(n === 'YOU' ? 'Owen' : n));
      if (order.some((o) => o < 0)) continue;
      const key = order.map((o) => truth[o].join(',')).join(',');
      const ok = t.worlds.some((w) => w.h.join(',') === key);
      if (!ok) {
        failures++;
        if (!firstFail) firstFail = { i, text: evs[i].text, key, worlds: t.worlds.slice(0, 3).map((w) => w.h.join(',')), players: t.players.slice() };
      }
    }
  }
  const warns = t.summary().players.flatMap((p) => p.warn);
  return { rows: g.rows.length, selfName, maxWorlds, finalWorlds: t.worlds.length, failures, firstFail, warns, unparsed: unparsed.length, players: t.players };
}

let bad = 0, totalWorlds = 0, maxW = 0;
const N = +process.argv[2] || 200;
for (let s = 1; s <= N; s++) {
  const r = run(s, +process.argv[3] || 80, false);
  maxW = Math.max(maxW, r.maxWorlds);
  totalWorlds += r.finalWorlds;
  if (r.failures || r.warns.length || r.unparsed || r.selfName !== 'Owen' || r.players.length !== 4) {
    bad++;
    if (bad <= 3) console.log('seed', s, JSON.stringify(r, null, 1).slice(0, 1500));
  }
}
console.log(`games=${N} bad=${bad} maxWorlds=${maxW} avgFinalWorlds=${(totalWorlds / N).toFixed(1)}`);
