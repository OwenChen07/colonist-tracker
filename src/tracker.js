/*
 * Colonist Resource Tracker — hand-tracking engine.
 *
 * Every opponent's hand is tracked exactly, except when one opponent robs
 * another and the log only shows a card back. To handle that, the engine
 * keeps a weighted set of "possible worlds" (one complete assignment of
 * hands to every player). An unknown steal splits each world into one world
 * per resource the victim could have lost, weighted by how many of that
 * resource they held. Later events prune impossible worlds: if the thief
 * builds a city, every world where they couldn't afford one disappears.
 */
(function (root) {
  'use strict';
  const NS = (root.CRT = root.CRT || {});
  const R = 5;
  const YOU = 'YOU';
  const MAX_WORLDS = 4000;

  const COST = {
    road: [1, 1, 0, 0, 0],
    settlement: [1, 1, 1, 1, 0],
    city: [0, 0, 0, 2, 3],
    dev: [0, 0, 1, 1, 1],
  };

  class Tracker {
    constructor(opts) {
      this.selfName = (opts && opts.selfName) || null;
      this.reset();
    }

    reset() {
      this.players = []; // ordered names
      this.idx = new Map(); // name -> index
      this.meta = new Map(); // name -> {color, devBought, devUsed, knights, warn:[]}
      this.worlds = [{ h: [], w: 1 }];
      this.lastRobber = null;
      this.freeRoads = null;
      this.events = 0;
      this.selfInferred = null;
      this.dice = NS.DiceModel ? new NS.DiceModel() : null;
    }

    resolve(name) {
      if (name === YOU) return this.selfName || YOU;
      return name;
    }

    ensure(name) {
      if (!name) return -1;
      if (this.idx.has(name)) return this.idx.get(name);
      const i = this.players.length;
      this.players.push(name);
      this.idx.set(name, i);
      this.meta.set(name, { color: '', devBought: 0, devUsed: 0, knights: 0, warn: [] });
      for (const w of this.worlds) for (let r = 0; r < R; r++) w.h.push(0);
      return i;
    }

    setColor(name, color) {
      name = this.resolve(name);
      if (!color || !this.idx.has(name)) return;
      this.meta.get(name).color = color;
    }

    warn(name, msg) {
      const m = this.meta.get(name);
      if (!m) return;
      m.warn.push(msg);
      if (m.warn.length > 5) m.warn.shift();
    }

    // ---- core world operations -------------------------------------------

    /** Apply fn to each world; fn returns an array of successor worlds. */
    _step(fn, lenient, onFail) {
      let next = [];
      for (const w of this.worlds) {
        const out = fn(w);
        for (const o of out) next.push(o);
      }
      if (!next.length) {
        // Contradiction: our record no longer explains the log (a missed
        // line, a rule variant…). Fall back to a forgiving update instead of
        // losing everything.
        next = [];
        for (const w of this.worlds) for (const o of lenient(w)) next.push(o);
        if (onFail) onFail();
      }
      this.worlds = this._merge(next);
    }

    _merge(list) {
      const map = new Map();
      for (const w of list) {
        const k = w.h.join(',');
        const e = map.get(k);
        if (e) e.w += w.w;
        else map.set(k, { h: w.h, w: w.w });
      }
      let arr = Array.from(map.values());
      if (arr.length > MAX_WORLDS) {
        arr.sort((a, b) => b.w - a.w);
        arr = arr.slice(0, MAX_WORLDS);
      }
      const tot = arr.reduce((s, w) => s + w.w, 0) || 1;
      for (const w of arr) w.w /= tot;
      return arr;
    }

    delta(name, vec, why) {
      const p = this.ensure(name);
      const base = p * R;
      this._step(
        (w) => {
          const h = w.h.slice();
          for (let r = 0; r < R; r++) {
            h[base + r] += vec[r];
            if (h[base + r] < 0) return [];
          }
          return [{ h, w: w.w }];
        },
        (w) => {
          const h = w.h.slice();
          for (let r = 0; r < R; r++) h[base + r] = Math.max(0, h[base + r] + vec[r]);
          return [{ h, w: w.w }];
        },
        () => this.warn(name, 'Log shows ' + name + ' spending cards they were not tracked as holding (' + (why || 'update') + ').')
      );
    }

    stealUnknown(thief, victim) {
      const t = this.ensure(thief) * R, v = this.ensure(victim) * R;
      this._step(
        (w) => {
          let tot = 0;
          for (let r = 0; r < R; r++) tot += w.h[v + r];
          if (tot <= 0) return [];
          const out = [];
          for (let r = 0; r < R; r++) {
            const c = w.h[v + r];
            if (!c) continue;
            const h = w.h.slice();
            h[v + r]--;
            h[t + r]++;
            out.push({ h, w: (w.w * c) / tot });
          }
          return out;
        },
        (w) => {
          const out = [];
          for (let r = 0; r < R; r++) {
            const h = w.h.slice();
            h[t + r]++;
            if (h[v + r] > 0) h[v + r]--;
            out.push({ h, w: w.w / R });
          }
          return out;
        },
        () => this.warn(victim, victim + ' was robbed while tracked with no cards.')
      );
    }

    monopoly(name, res, n) {
      const p = this.ensure(name);
      const ri = NS.parser ? NS.parser.RES.indexOf(res) : ['lumber', 'brick', 'wool', 'grain', 'ore'].indexOf(res);
      if (ri < 0) return;
      const P = this.players.length;
      const take = (w, strict) => {
        const h = w.h.slice();
        let sum = 0;
        for (let q = 0; q < P; q++) {
          if (q === p) continue;
          sum += h[q * R + ri];
          h[q * R + ri] = 0;
        }
        if (strict && sum !== n) return [];
        h[p * R + ri] += n;
        return [{ h, w: w.w }];
      };
      this._step(
        (w) => take(w, true),
        (w) => take(w, false),
        () => this.warn(name, 'Monopoly total (' + n + ' ' + res + ') did not match tracked hands.')
      );
    }

    /**
     * Keep only worlds whose hand sizes match the card counts shown on the
     * board. Returns false (and changes nothing) if no world matches.
     */
    constrainTotals(counts) {
      const req = [];
      for (const name in counts) {
        const n = this.resolve(name);
        if (this.idx.has(n)) req.push([this.idx.get(n) * R, counts[name]]);
      }
      if (!req.length) return true;
      const keep = this.worlds.filter((w) =>
        req.every(([b, c]) => w.h[b] + w.h[b + 1] + w.h[b + 2] + w.h[b + 3] + w.h[b + 4] === c)
      );
      if (!keep.length) return false;
      if (keep.length !== this.worlds.length) this.worlds = this._merge(keep);
      return true;
    }

    /** True when some player's hand size differs between possible worlds. */
    totalsUncertain() {
      if (this.worlds.length < 2) return false;
      const first = this.worlds[0].h;
      for (let p = 0; p < this.players.length; p++) {
        const b = p * R;
        const t0 = first[b] + first[b + 1] + first[b + 2] + first[b + 3] + first[b + 4];
        for (const w of this.worlds) {
          if (w.h[b] + w.h[b + 1] + w.h[b + 2] + w.h[b + 3] + w.h[b + 4] !== t0) return true;
        }
      }
      return false;
    }

    // ---- event dispatch --------------------------------------------------

    /**
     * Apply one parsed event. Returns {selfDiscovered: name} when the event
     * revealed which player name is "you" (caller should replay).
     */
    apply(ev) {
      if (!ev) return null;
      this.events++;
      const res = NS.parser ? NS.parser.RES : ['lumber', 'brick', 'wool', 'grain', 'ore'];
      const name = (k) => this.resolve(ev[k]);

      // Road Building: the next two roads by that player are free.
      if (this.freeRoads && !((ev.type === 'build' || ev.type === 'place') && ev.what === 'road' && name('player') === this.freeRoads.p)) {
        this.freeRoads = null;
      }

      switch (ev.type) {
        case 'roll':
          this.ensure(name('player'));
          if (this.dice) {
            if (ev.d1) this.dice.observe(name('player'), ev.d1, ev.d2);
            else this.dice.skip(name('player'));
          }
          break;
        case 'robber':
          this.lastRobber = name('player');
          this.ensure(this.lastRobber);
          break;
        case 'place':
          this.ensure(name('player'));
          if (this.dice && ev.what === 'settlement') this.dice.notePlacement(name('player'));
          if (ev.what === 'road' && this.freeRoads && this.freeRoads.n > 0) this.freeRoads.n--;
          break;
        case 'delta':
          this.delta(name('player'), ev.vec, ev.why);
          break;
        case 'trade': {
          const a = name('a'), b = name('b');
          const vec = ev.get.map((g, i) => g - ev.give[i]); // a gains vec, b loses vec
          this.delta(a, vec, 'trade with ' + b);
          this.delta(b, vec.map((x) => -x), 'trade with ' + a);
          break;
        }
        case 'build': {
          const p = name('player');
          if (ev.what === 'road' && this.freeRoads && this.freeRoads.p === p && this.freeRoads.n > 0) {
            this.freeRoads.n--;
            this.ensure(p);
          } else {
            this.delta(p, COST[ev.what].map((x) => -x), 'built ' + ev.what);
          }
          break;
        }
        case 'dev_buy': {
          const p = name('player');
          this.delta(p, COST.dev.map((x) => -x), 'bought dev card');
          this.meta.get(p).devBought++;
          break;
        }
        case 'dev_used': {
          const p = name('player');
          this.ensure(p);
          const m = this.meta.get(p);
          m.devUsed++;
          if (ev.card === 'knight') {
            m.knights++;
            this.lastRobber = p;
          }
          if (ev.card === 'roadbuilding') this.freeRoads = { p, n: 2 };
          break;
        }
        case 'steal': {
          const thief = name('thief'), victim = name('victim');
          let discovered = null;
          if (ev.thief === YOU && !this.selfName && this.lastRobber && this.lastRobber !== YOU) {
            discovered = this.lastRobber;
          }
          if (ev.res && ev.res !== 'unknown') {
            const vec = [0, 0, 0, 0, 0];
            vec[res.indexOf(ev.res)] = 1;
            this.delta(victim, vec.map((x) => -x), 'robbed');
            this.delta(thief, vec, 'stole');
          } else {
            this.stealUnknown(thief, victim);
          }
          this.lastRobber = null;
          if (discovered) {
            this.selfInferred = discovered;
            return { selfDiscovered: discovered };
          }
          break;
        }
        case 'monopoly':
          this.monopoly(name('player'), ev.res, ev.n);
          break;
        case 'counts':
          this.constrainTotals(ev.counts);
          break;
        default:
          break;
      }
      return null;
    }

    // ---- read-out ---------------------------------------------------------

    summary() {
      const P = this.players.length;
      const out = [];
      for (let p = 0; p < P; p++) {
        const name = this.players[p];
        const res = [];
        for (let r = 0; r < R; r++) res.push({ min: Infinity, max: -Infinity, exp: 0, dist: new Map() });
        const build = { road: 0, settlement: 0, city: 0, dev: 0 };
        const total = { min: Infinity, max: -Infinity, exp: 0, dist: new Map() };
        for (const w of this.worlds) {
          const h = w.h;
          let t = 0;
          for (let r = 0; r < R; r++) {
            const c = h[p * R + r];
            t += c;
            const s = res[r];
            if (c < s.min) s.min = c;
            if (c > s.max) s.max = c;
            s.exp += c * w.w;
            s.dist.set(c, (s.dist.get(c) || 0) + w.w);
          }
          if (t < total.min) total.min = t;
          if (t > total.max) total.max = t;
          total.exp += t * w.w;
          total.dist.set(t, (total.dist.get(t) || 0) + w.w);
          for (const k in COST) {
            const cost = COST[k];
            let ok = true;
            for (let r = 0; r < R; r++) if (h[p * R + r] < cost[r]) { ok = false; break; }
            if (ok) build[k] += w.w;
          }
        }
        for (const s of res) {
          if (s.min === Infinity) { s.min = 0; s.max = 0; }
        }
        const m = this.meta.get(name);
        out.push({
          name,
          isSelf: name === YOU || (!!this.selfName && name === this.selfName),
          color: m.color,
          total: total.min === Infinity ? { min: 0, max: 0, exp: 0, dist: new Map([[0, 1]]) } : total,
          res,
          build,
          devHeld: Math.max(0, m.devBought - m.devUsed),
          knights: m.knights,
          warn: m.warn.slice(),
        });
      }
      return { players: out, worlds: this.worlds.length, events: this.events, dice: this.dice ? this.dice.summary() : null };
    }
  }

  NS.Tracker = Tracker;
  NS.COST = COST;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Tracker, COST };
})(typeof globalThis !== 'undefined' ? globalThis : this);
