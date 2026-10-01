/*
 * Colonist Resource Tracker — balanced-dice model.
 *
 * colonist.io's "balanced dice" draws rolls from a deck of the 36 two-dice
 * combinations and then nudges the odds. Everything that drives those odds is
 * visible in the game log (every roll and who rolled it), so this class keeps
 * a mirror of the game's dice state and reproduces the exact odds of the next
 * roll. The rules follow colonist's DiceControllerBalanced:
 *
 *   - Deck: 36 cards, one per ordered pair of dice. A drawn card is removed.
 *     Before a draw, if fewer than 13 cards remain, all 36 go back in.
 *   - Base weight of a total = cards of that total left / cards left.
 *   - Recency: weight × (1 − 0.34 × times that total came up in the last 5
 *     rolls), floored at 0. A total rolled 3 times in the last 5 can't come up.
 *   - 7s, depending on who is rolling:
 *       share  = 2 − (their 7s / all 7s) × players-who-have-rolled
 *                (just 1 until there have been at least that many 7s)
 *       streak = 0.4 × length of the current run of 7s by one player,
 *                negative if the run is theirs, positive if someone else's
 *       7 weight × clamp(share + streak, 0, 2)
 *
 * If a roll happens that these rules make impossible (a total with no cards
 * left, a blocked total, a 7 with a ×0 multiplier), the game isn't using
 * balanced dice, and the model switches to normal two-dice odds.
 */
(function (root) {
  'use strict';
  const NS = (root.CRT = root.CRT || {});

  const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const FULL = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]; // cards per total in a fresh deck
  const STANDARD = FULL.map((c) => c / 36);
  const CFG = {
    deckSize: 36,
    minCardsBeforeReshuffle: 13,
    recentReduction: 0.34,
    recentMemory: 5,
    sevenStreakReduction: 0.4,
  };
  const I7 = 5; // index of total 7

  class DiceModel {
    constructor() {
      this.counts = FULL.slice();
      this.cardsLeft = CFG.deckSize;
      this.recent = []; // last ≤5 totals
      this.recentCount = new Array(11).fill(0);
      this.sevens = new Map(); // player -> 7s rolled (players appear once they have rolled)
      this.streak = { player: null, count: 0 };
      this.rolledCount = new Array(11).fill(0);
      this.rolls = 0;
      this.order = []; // turn order (from setup placements, then from rolls)
      this.lastRoller = null;
      this.mode = 'balanced'; // 'balanced' | 'random' | 'unreadable'
      this.brokenAt = null; // {roll, total, reason}
      this.shuffles = 0;
    }

    /** Setup placements give turn order: the first settlement by each player, in order. */
    notePlacement(player) {
      if (player && !this.rolls && !this.order.includes(player)) this.order.push(player);
    }

    _weights(player, counts, cardsLeft) {
      const w = new Array(11);
      for (let i = 0; i < 11; i++) {
        let x = counts[i] / cardsLeft;
        x *= 1 - this.recentCount[i] * CFG.recentReduction;
        w[i] = x < 0 ? 0 : x;
      }
      w[I7] *= this.sevenMultiplier(player);
      return w;
    }

    /** The factor applied to the 7 weight if `player` were rolling now. */
    sevenMultiplier(player) {
      const seen = new Map(this.sevens);
      if (player != null && !seen.has(player)) seen.set(player, 0); // the roller is registered before drawing
      const size = seen.size;
      let total = 0;
      for (const v of seen.values()) total += v;
      let share = 1;
      if (total >= size && size > 0) {
        const mine = seen.get(player) || 0;
        const ideal = 1 / size;
        share = 1 + (ideal - mine / total) / ideal;
      }
      const streak = CFG.sevenStreakReduction * this.streak.count * (this.streak.player === player ? -1 : 1);
      return Math.min(2, Math.max(0, share + streak));
    }

    /** Odds of each total (2..12) for the next roll, if `player` rolls it. */
    predict(player) {
      if (this.mode !== 'balanced') return STANDARD.slice();
      let counts = this.counts, left = this.cardsLeft;
      if (left < CFG.minCardsBeforeReshuffle) { counts = FULL; left = CFG.deckSize; }
      const w = this._weights(player, counts, left);
      const sum = w.reduce((a, b) => a + b, 0);
      if (!(sum > 0)) return STANDARD.slice();
      return w.map((x) => x / sum);
    }

    /** Apply one observed roll. */
    observe(player, d1, d2) {
      const t = d1 + d2;
      const i = t - 2;
      if (!(i >= 0 && i < 11)) return;
      if (player && !this.order.includes(player)) this.order.push(player);

      if (this.mode === 'balanced') {
        if (this.cardsLeft < CFG.minCardsBeforeReshuffle) {
          this.counts = FULL.slice();
          this.cardsLeft = CFG.deckSize;
          this.shuffles++;
        }
        const p = this.predict(player)[i];
        if (!(p > 0)) {
          const reason = this.counts[i] === 0
            ? `no ${t}s were left in the dice deck`
            : t === 7 && this.recentCount[i] * CFG.recentReduction < 1
            ? `${player} couldn't roll a 7 under the balancing rules`
            : `${t} had come up too often in the last 5 rolls`;
          this.mode = 'random';
          this.brokenAt = { roll: this.rolls + 1, total: t, reason };
        } else {
          this.counts[i]--;
          this.cardsLeft--;
        }
      }

      // Recency, 7 tallies and the streak are kept either way (cheap, and shown in the panel).
      this.recent.push(t);
      this.recentCount[i]++;
      if (this.recent.length > CFG.recentMemory) this.recentCount[this.recent.shift() - 2]--;
      if (!this.sevens.has(player)) this.sevens.set(player, 0);
      if (t === 7) {
        this.sevens.set(player, this.sevens.get(player) + 1);
        if (this.streak.player === player) this.streak.count++;
        else this.streak = { player, count: 1 };
      }
      this.rolledCount[i]++;
      this.rolls++;
      this.lastRoller = player;
    }

    /** A roll whose dice faces couldn't be read: the deck can no longer be followed. */
    skip(player) {
      if (player && !this.order.includes(player)) this.order.push(player);
      if (!this.sevens.has(player)) this.sevens.set(player, 0);
      if (this.mode === 'balanced') {
        this.mode = 'unreadable';
        this.brokenAt = { roll: this.rolls + 1, total: null, reason: 'the dice on that roll could not be read' };
      }
      this.rolls++;
      this.lastRoller = player;
    }

    nextRoller() {
      const o = this.order;
      if (!o.length) return null;
      if (!this.lastRoller) return o[0];
      const k = o.indexOf(this.lastRoller);
      return k < 0 ? null : o[(k + 1) % o.length];
    }

    summary() {
      const next = this.nextRoller();
      const reshuffleIn = this.mode === 'balanced'
        ? (this.cardsLeft < CFG.minCardsBeforeReshuffle ? 0 : this.cardsLeft - CFG.minCardsBeforeReshuffle + 1)
        : null;
      const players = this.order.length ? this.order : Array.from(this.sevens.keys());
      return {
        mode: this.mode,
        brokenAt: this.brokenAt,
        rolls: this.rolls,
        next,
        odds: this.predict(next),
        standard: STANDARD.slice(),
        rolled: this.rolledCount.slice(),
        cardsLeft: this.mode === 'balanced' ? (this.cardsLeft < CFG.minCardsBeforeReshuffle ? CFG.deckSize : this.cardsLeft) : null,
        deckCounts: this.mode === 'balanced' ? (this.cardsLeft < CFG.minCardsBeforeReshuffle ? FULL.slice() : this.counts.slice()) : null,
        reshuffleIn, // rolls until the deck is refilled (0 = refilled before the next roll)
        sevens: players.map((p) => ({ player: p, count: this.sevens.get(p) || 0, mult: this.mode === 'balanced' ? this.sevenMultiplier(p) : 1 })),
        streak: { ...this.streak },
      };
    }
  }

  NS.DiceModel = DiceModel;
  NS.DICE = { TOTALS, FULL, STANDARD, CFG };
  if (typeof module !== 'undefined' && module.exports) module.exports = { DiceModel, TOTALS, FULL, STANDARD, CFG };
})(typeof globalThis !== 'undefined' ? globalThis : this);
