/*
 * Colonist Resource Tracker — controller.
 * Finds the game log, reads every row exactly once (by its data-index),
 * feeds the tracker, and keeps the overlay up to date.
 */
(function () {
  'use strict';
  const NS = globalThis.CRT;
  if (!NS || NS.started) return;
  NS.started = true;

  const P = NS.parser;
  const LOG_HINT = /\b(rolled|placed a|received starting resources|got|built a|happy settling|moved robber|stole|discarded|gave bank|bought)\b/i;
  const STORE_PREFIX = 'crt:g:';
  const HINT_KEY = 'crt:selfHint';
  const MAX_AGE = 24 * 3600 * 1000;

  let container = null;
  let observer = null;
  let ui = null;
  let game = null;
  let backfilling = false;
  let scanQueued = false;
  let saveTimer = null;
  let boardCounts = null;
  let boardStable = new Map();

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota / disabled */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  function gameKey() {
    return location.pathname + location.search + location.hash;
  }

  function newGame(key, restore) {
    const g = {
      key,
      known: new Map(), // idx -> {fp, ev}
      colors: {},
      icons: {},
      unparsed: [],
      selfName: null,
      selfSource: null, // 'robber' | 'header' | 'hint' | 'manual'
      tracker: null,
      appliedUpTo: -1,
      maxIdx: -1,
      backfillTries: 0,
      lastBackfill: 0,
      constraints: new Map(), // idx -> [counts] (card counts read off the board after that row)
      lastRowAt: 0,
    };
    if (restore) {
      const saved = store.get(STORE_PREFIX + key);
      if (saved && Date.now() - saved.t < MAX_AGE && Array.isArray(saved.known)) {
        for (const [i, fp, ev] of saved.known) g.known.set(i, { fp, ev });
        Object.assign(g.colors, saved.colors || {});
        for (const [i, list] of saved.constraints || []) g.constraints.set(i, list);
        g.selfName = saved.selfName || null;
        g.selfSource = saved.selfSource || null;
        g.maxIdx = Math.max(-1, ...g.known.keys());
      }
    }
    g.tracker = new NS.Tracker({ selfName: g.selfName });
    return g;
  }

  function persistNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!game || !game.known.size) return;
    const known = Array.from(game.known.entries()).map(([i, v]) => [i, v.fp, v.ev]);
    store.set(STORE_PREFIX + game.key, {
      t: Date.now(), known, colors: game.colors, selfName: game.selfName, selfSource: game.selfSource,
      constraints: Array.from(game.constraints.entries()),
    });
  }

  function persistSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(persistNow, 400);
  }

  function pruneStore() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(STORE_PREFIX) !== 0) continue;
        const v = store.get(k);
        if (!v || Date.now() - v.t > MAX_AGE) localStorage.removeItem(k);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- finding the log

  function findContainer() {
    const cands = new Set();
    document.querySelectorAll('[class*="virtualScroller"]').forEach((e) => cands.add(e));
    document.querySelectorAll('[data-index]').forEach((e) => { if (e.parentElement) cands.add(e.parentElement); });
    let best = null, bestScore = 0;
    for (const c of cands) {
      let score = 0;
      for (const e of c.querySelectorAll('[data-index]')) if (LOG_HINT.test(e.textContent || '')) score++;
      if (score > bestScore || (score === bestScore && best && score > 0 && c.contains(best))) {
        best = c;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function scrollerOf(el) {
    const first = el.querySelector('[data-index]');
    let e = first ? first.parentElement : el;
    while (e && e !== document.body && e !== document.documentElement) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4) return e;
      e = e.parentElement;
    }
    return null;
  }

  function attach(c) {
    if (observer) observer.disconnect();
    container = c;
    observer = new MutationObserver(queueScan);
    observer.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-index'] });
  }

  // ---------------------------------------------------------------- reading rows

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      scan();
    }, 40);
  }

  function scan() {
    if (!container || !container.isConnected || !game) return;
    const els = container.querySelectorAll('[data-index]');
    const added = [];
    let renderedMax = -1;
    for (const el of els) {
      const idx = parseInt(el.getAttribute('data-index'), 10);
      if (!Number.isFinite(idx)) continue;
      if (!el.childElementCount && !(el.textContent || '').trim()) continue; // not rendered yet
      renderedMax = Math.max(renderedMax, idx);
      const parsed = P.parseEntry(el);
      for (const n of parsed.names) if (n.color && !game.colors[n.name]) game.colors[n.name] = n.color;
      for (const r in parsed.icons) if (!game.icons[r]) game.icons[r] = parsed.icons[r];
      const prev = game.known.get(idx);
      if (prev) {
        if (prev.fp !== parsed.text && prev.fp && parsed.text) {
          if ((idx <= 4 && game.maxIdx > 12) || (significant(prev.ev) && significant(parsed.ev))) {
            // The log now says something else at a row we already read:
            // this tab has moved on to a different game.
            startGame(true);
            return scan();
          }
          prev.fp = parsed.text; // cosmetic re-render (e.g. a trade offer updating)
        }
        continue;
      }
      game.known.set(idx, { fp: parsed.text, ev: parsed.ev });
      if (idx > game.maxIdx) game.maxIdx = idx;
      added.push(idx);
    }

    // A fresh game whose log is much shorter than what we remember.
    if (!backfilling && renderedMax >= 0 && renderedMax < game.maxIdx - 8) {
      const sc = scrollerOf(container);
      const atBottom = !sc || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 30;
      if (atBottom && !added.length && game.known.get(0) && game.maxIdx > 12) {
        const firstFp = (game.known.get(renderedMax) || {}).fp;
        const el = container.querySelector(`[data-index="${renderedMax}"]`);
        if (el && firstFp !== P.parseEntry(el).text) {
          startGame(true); // fresh start; don't restore the old game we just left
          return scan();
        }
      }
    }

    if (!added.length || backfilling) return;
    game.lastRowAt = Date.now();
    added.sort((a, b) => a - b);
    if (added[0] <= game.appliedUpTo) replay();
    else for (const i of added) if (applyIdx(i)) break; // true = it replayed everything
    maybeLearnSelf();
    maybeBackfill();
    render();
    persistSoon();
  }

  function applyIdx(i) {
    const rec = game.known.get(i);
    if (rec && rec.ev) {
      if (rec.ev.type === 'unparsed') {
        if (!game.unparsed.includes(rec.ev.text)) game.unparsed.push(rec.ev.text);
      } else {
        const r = game.tracker.apply(rec.ev);
        if (r && r.selfDiscovered && !game.selfName) {
          setSelf(r.selfDiscovered, 'robber');
          return true; // setSelf replays everything
        }
      }
    }
    game.appliedUpTo = Math.max(game.appliedUpTo, i);
    return false;
  }

  function significant(ev) {
    return !!ev && ev.type !== 'unparsed';
  }

  function replay() {
    for (let attempt = 0; attempt < 2; attempt++) {
      game.tracker = new NS.Tracker({ selfName: game.selfName });
      game.unparsed = [];
      game.appliedUpTo = -1;
      const order = Array.from(game.known.keys()).sort((a, b) => a - b);
      let restarted = false;
      for (const i of order) {
        const rec = game.known.get(i);
        if (rec.ev && rec.ev.type === 'unparsed') {
          if (!game.unparsed.includes(rec.ev.text)) game.unparsed.push(rec.ev.text);
        } else if (rec.ev) {
          const r = game.tracker.apply(rec.ev);
          if (r && r.selfDiscovered && !game.selfName) {
            game.selfName = r.selfDiscovered;
            game.selfSource = 'robber';
            store.set(HINT_KEY, game.selfName);
            restarted = true;
            break;
          }
        }
        for (const counts of game.constraints.get(i) || []) game.tracker.apply({ type: 'counts', counts });
        game.appliedUpTo = i;
      }
      if (!restarted) break;
    }
  }

  function setSelf(name, source) {
    game.selfName = name;
    game.selfSource = name ? source : null;
    if (name && source !== 'manual') store.set(HINT_KEY, name);
    replay();
    render();
    persistSoon();
  }

  function playerNamesInLog() {
    return new Set(game.tracker.players.filter((n) => n !== 'YOU'));
  }

  /** Work out which name is "you" without waiting for a robbery. */
  function maybeLearnSelf() {
    if (game.selfName) return;
    const names = playerNamesInLog();
    const header = document.querySelector('.web-header-username, [class*="headerUsername"], [class*="header-username"]');
    const hn = header && (header.textContent || '').trim();
    if (hn && names.has(hn)) return setSelf(hn, 'header');
    const hint = store.get(HINT_KEY);
    if (hint && names.has(hint)) return setSelf(hint, 'hint');
  }

  // ---------------------------------------------------------------- backfill

  function missingCount() {
    let miss = 0;
    for (let i = 0; i <= game.maxIdx; i++) if (!game.known.has(i)) miss++;
    return miss;
  }

  function maybeBackfill(force) {
    if (backfilling || !container) return;
    if (!force) {
      if (!missingCount()) return;
      if (game.backfillTries >= 3 || Date.now() - game.lastBackfill < 8000) return;
    }
    backfill();
  }

  /** The log is a virtual list: scroll through it so every row renders once. */
  async function backfill() {
    const sc = scrollerOf(container);
    game.backfillTries++;
    game.lastBackfill = Date.now();
    if (!sc) return;
    backfilling = true;
    render();
    const atBottom = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 30;
    const saved = sc.scrollTop;
    try {
      sc.scrollTop = 0;
      await sleep(150);
      scan();
      for (let guard = 0; guard < 1500; guard++) {
        if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) break;
        sc.scrollTop += Math.max(40, sc.clientHeight * 0.85);
        await sleep(45);
        scan();
        render();
      }
    } finally {
      sc.scrollTop = atBottom ? sc.scrollHeight : saved;
      await sleep(60);
      backfilling = false;
      scan();
      replay();
      maybeLearnSelf();
      render();
      persistSoon();
    }
  }

  // ---------------------------------------------------------------- board check

  /** Best-effort read of the card counts colonist shows next to each player. */
  function readBoardCounts() {
    const out = new Map();
    const wraps = document.querySelectorAll('[class*="informationWrapper"]');
    for (const w of wraps) {
      const nameEl = w.querySelector('[class*="username"]');
      const countEl = Array.from(w.querySelectorAll('[class]')).find((e) => /(^|\s)count[-_]/.test(e.className) && /^\d+$/.test((e.textContent || '').trim()));
      if (!countEl) continue;
      const name = nameEl ? (nameEl.textContent || '').trim() : '@self';
      out.set(name || '@self', parseInt(countEl.textContent.trim(), 10));
    }
    return out.size ? out : null;
  }

  /**
   * After a monopoly, hand sizes can be uncertain. Colonist shows every
   * player's card count, so once the log is quiet use those counts to rule
   * out impossible hands, and remember that for future replays.
   */
  function maybeConstrain() {
    if (!boardCounts || !boardCounts.size || !game || !game.tracker || backfilling) return;
    if (Date.now() - game.lastRowAt < 1500 || missingCount()) return;
    const t = game.tracker;
    if (!t.totalsUncertain()) return;
    const counts = {};
    for (const [k, v] of boardCounts) counts[k === '@self' ? 'YOU' : k] = v;
    if (!t.constrainTotals(counts)) return;
    const at = game.appliedUpTo;
    const list = game.constraints.get(at) || [];
    list.push(counts);
    game.constraints.set(at, list);
    persistSoon();
  }

  /** Pick up colonist's current card-art URLs from anywhere on the page (your hand, the bank, the log). */
  function findCardArt() {
    if (!game) return;
    const need = P.RES.filter((r) => !game.icons[r]);
    if (!need.length) return;
    for (const img of document.querySelectorAll('img[src*="card_"]')) {
      const r = P.resourceOfImg(img);
      if (r && r !== 'unknown' && !game.icons[r]) game.icons[r] = img.src;
    }
  }

  function updateBoardCounts() {
    const now = readBoardCounts();
    if (!now) { boardCounts = null; return; }
    // Only report a value once it has held steady for two reads, so the
    // brief moment between a card moving and its log line doesn't flash.
    const stable = new Map();
    for (const [k, v] of now) {
      if (boardStable.get(k) === v) stable.set(k, v);
    }
    boardStable = now;
    boardCounts = stable;
  }

  // ---------------------------------------------------------------- UI

  function render(state, status) {
    if (!ui) return;
    if (backfilling && game) {
      // Reading history: partial numbers would mislead, so show progress until the full replay.
      const have = game.maxIdx + 1 - missingCount();
      ui.render({ state: 'busy', status: `Reading the game log… ${have}/${game.maxIdx + 1}`, summary: null, unparsed: [] });
      return;
    }
    const summary = game && game.tracker ? game.tracker.summary() : null;
    if (summary) for (const p of summary.players) p.color = p.color || game.colors[p.name] || (p.isSelf && game.colors[game.selfName]) || '';
    const lines = game ? game.known.size : 0;
    let st = state || (container ? 'live' : 'waiting');
    let msg = status;
    if (!msg) {
      if (!container) msg = 'Waiting for a game log…';
      else if (!summary || !summary.players.length) msg = 'Game found — waiting for the first moves.';
      else {
        const miss = missingCount();
        msg = `${lines} log lines` + (miss ? ` · ${miss} missing` : '');
        if (miss) st = 'busy';
      }
    }
    ui.render({
      state: st,
      status: msg,
      summary,
      icons: game ? game.icons : {},
      boardCounts,
      selfName: game && game.selfName,
      selfSource: game && game.selfSource,
      unparsed: game ? game.unparsed : [],
    });
  }

  function startGame(fromConflict) {
    const key = gameKey();
    if (fromConflict) store.del(STORE_PREFIX + key);
    game = newGame(key, !fromConflict);
    replay();
  }

  function ensureUI() {
    if (ui) return;
    ui = new NS.Overlay({
      onRescan: () => {
        if (!game) return;
        game.backfillTries = 0;
        maybeBackfill(true);
      },
      onReset: () => {
        if (!game) return;
        store.del(STORE_PREFIX + game.key);
        const self = game.selfSource === 'manual' ? game.selfName : null;
        game = newGame(game.key, false);
        if (self) { game.selfName = self; game.selfSource = 'manual'; }
        scan();
        maybeBackfill(true);
        render();
      },
      onSetSelf: (name) => {
        if (!game) return;
        if (name) setSelf(name, 'manual');
        else { game.selfName = null; game.selfSource = null; replay(); maybeLearnSelf(); render(); persistSoon(); }
      },
    });
    ui.mount();
  }

  // ---------------------------------------------------------------- main loop

  function tick() {
    if (game && game.key !== gameKey()) game = null;
    if (!container || !container.isConnected) {
      const c = findContainer();
      if (c) {
        attach(c);
        if (!game) startGame(false);
        ensureUI();
        ui.setVisible(true);
        scan();
        // Joined (or refreshed) mid-game: read the rows that scrolled away.
        if (missingCount()) maybeBackfill(true);
        render();
      } else if (container) {
        container = null;
        if (observer) observer.disconnect();
        if (ui) ui.setVisible(false); // back in the lobby
      }
      return;
    }
    if (!game) {
      startGame(false);
      scan();
    }
    findCardArt();
    updateBoardCounts();
    maybeConstrain();
    render();
  }

  pruneStore();
  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistNow(); });
  tick();
  setInterval(tick, 1000);

  // Small debugging hook (inspect from the console with the extension's context selected).
  NS.debug = { get game() { return game; }, scan, replay, backfill: () => maybeBackfill(true) };
})();
