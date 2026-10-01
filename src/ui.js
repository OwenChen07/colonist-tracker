/*
 * Colonist Resource Tracker — overlay panel.
 * Lives in a shadow root so colonist's styles and ours never collide.
 */
(function (root) {
  'use strict';
  const NS = (root.CRT = root.CRT || {});
  const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  const EMOJI = { lumber: '🌲', brick: '🧱', wool: '🐑', grain: '🌾', ore: '🪨' };
  // colonist.io's own card art, loaded from colonist's CDN (the same files the game shows).
  // If colonist publishes new versions, the controller picks the current URLs off the page instead.
  const CDN = 'https://cdn.colonist.io/dist/assets/';
  const CARD_ART = {
    lumber: CDN + 'card_lumber.cf22f8083cf89c2a29e7.svg',
    brick: CDN + 'card_brick.5950ea07a7ea01bc54a5.svg',
    wool: CDN + 'card_wool.17a6dea8d559949f0ccc.svg',
    grain: CDN + 'card_grain.09c9d82146a64bce69b5.svg',
    ore: CDN + 'card_ore.117f64dab28e1c987958.svg',
  };
  const LABEL = { lumber: 'Lumber', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
  const BUILD = [
    ['road', 'Rd', 'Road'],
    ['settlement', 'St', 'Settlement'],
    ['city', 'Ct', 'City'],
    ['dev', 'Dv', 'Development card'],
  ];
  const PREFS_KEY = 'crt:ui';

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel {
    position: fixed; z-index: 2147483000; min-width: 292px;
    font: 12px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #2a2e35; background: #fffdf8;
    border: 1px solid #e2d9c6; border-radius: 10px; overflow: hidden;
    box-shadow: 0 8px 24px rgba(60, 45, 20, 0.18), 0 1px 3px rgba(60, 45, 20, 0.10);
    user-select: none; -webkit-font-smoothing: antialiased;
  }
  .hdr { display: flex; align-items: center; gap: 7px; padding: 6px 6px 6px 10px; cursor: grab; background: #f6f1e6; }
  .hdr:active { cursor: grabbing; }
  .title { font-weight: 650; font-size: 12px; letter-spacing: 0.15px; flex: 1; white-space: nowrap; color: #2a2e35; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #a3a9b4; flex: none; }
  .dot.live { background: #2fa65a; box-shadow: 0 0 0 3px rgba(47, 166, 90, 0.18); }
  .dot.busy { background: #e0a100; }
  .btn { background: transparent; border: 0; color: #6b7280; min-width: 22px; height: 22px; padding: 0 5px;
         border-radius: 6px; cursor: pointer; font: inherit; font-size: 13px; line-height: 22px; }
  .btn:hover { background: rgba(60, 45, 20, 0.08); color: #111827; }
  .body { border-top: 1px solid #e9e1cf; }
  .collapsed .body { display: none; }
  .panel.collapsed { min-width: 0; }
  table { border-collapse: collapse; margin: 3px 6px 4px; }
  th { font-weight: 500; color: #7a7f89; font-size: 11px; padding: 4px 4px 3px; text-align: center; }
  th.l { text-align: left; padding-left: 4px; }
  th img { height: 22px; width: auto; display: block; margin: 0 auto; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.18)); }
  th .emo { font-size: 15px; line-height: 22px; }
  td { padding: 4px 4px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tbody tr + tr td { border-top: 1px solid #efe8da; }
  td.name { text-align: left; max-width: 150px; overflow: hidden; text-overflow: ellipsis; padding-right: 8px; color: #2a2e35; }
  .sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; vertical-align: 0; background: #888; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15); }
  .you { color: #8a8f99; font-weight: 400; }
  tr.self td { opacity: 0.55; }
  .z { color: #c4c8cf; }
  .v { color: #1f2328; font-weight: 650; }
  .u { color: #b45f06; font-weight: 650; cursor: help; }
  td.tot { font-weight: 650; padding-left: 8px; border-left: 1px solid #e9e1cf; color: #1f2328; }
  td.tot.hi { color: #d0392b; }
  td.dev { color: #4b5563; }
  .warn { color: #d97706; cursor: help; margin-left: 2px; }
  .chips { display: inline-flex; gap: 3px; }
  .chip { font-size: 10px; line-height: 15px; padding: 0 4px; border-radius: 4px; border: 1px solid transparent; }
  .chip.yes { background: #2f8f55; color: #ffffff; }
  .chip.maybe { border-color: #e2b13c; background: #fff6e0; color: #a35d00; cursor: help; }
  .chip.no { color: #c4c8cf; border-color: #ece6d9; }
  .ftr { display: flex; gap: 10px; justify-content: space-between; align-items: center; padding: 5px 10px 7px;
         color: #80858f; font-size: 11px; border-top: 1px solid #e9e1cf; }
  .link { color: #b45f06; cursor: pointer; text-decoration: underline dotted; }
  .empty { padding: 12px 12px 10px; color: #6b7280; max-width: 300px; }
  .settings { padding: 8px 10px; border-top: 1px solid #e9e1cf; display: grid; gap: 7px; background: #fbf8f1; }
  .settings label { display: flex; align-items: center; gap: 8px; color: #374151; }
  .settings select { background: #ffffff; color: #1f2328; border: 1px solid #d6cdb9; border-radius: 5px; padding: 2px 4px; font: inherit; }
  .settings .act { justify-self: start; background: #f6f1e6; border: 1px solid #ddd3bf; color: #1f2328; border-radius: 6px; padding: 3px 9px; font: inherit; cursor: pointer; }
  .settings .act:hover { background: #efe7d6; }
  .unparsed { padding: 6px 10px 8px; max-width: 360px; color: #4b5563; font-size: 11px; border-top: 1px solid #e9e1cf; }
  .unparsed div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 1px 0; }
  .hidden { display: none !important; }
  `;

  function loadPrefs() {
    try {
      return Object.assign({ x: null, y: 90, collapsed: false, showSelf: true }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
    } catch (e) {
      return { x: null, y: 90, collapsed: false, showSelf: true };
    }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const pct = (x) => (x >= 0.995 ? '100%' : x <= 0.005 ? '0%' : Math.round(x * 100) + '%');

  class Overlay {
    constructor(handlers) {
      this.h = handlers || {};
      this.prefs = loadPrefs();
      this.showSettings = false;
      this.showUnparsed = false;
      this.last = null;
    }

    mount() {
      if (this.host && this.host.isConnected) return;
      this.host = document.createElement('div');
      this.host.id = 'crt-overlay-host';
      const sr = this.host.attachShadow({ mode: 'open' });
      sr.innerHTML = `<style>${CSS}</style>
        <div class="panel">
          <div class="hdr" part="hdr">
            <span class="dot"></span><span class="title">Resource Tracker</span>
            <button class="btn" data-a="rescan" title="Re-read the whole game log">⟳</button>
            <button class="btn" data-a="settings" title="Settings">⚙</button>
            <button class="btn" data-a="collapse" title="Collapse">–</button>
          </div>
          <div class="body">
            <div class="content"></div>
            <div class="settings hidden"></div>
            <div class="unparsed hidden"></div>
            <div class="ftr"><span class="stat"></span><span class="extra"></span></div>
          </div>
        </div>`;
      this.sr = sr;
      this.panel = sr.querySelector('.panel');
      document.documentElement.appendChild(this.host);
      this._place();
      this._applyCollapsed();

      // A card image that fails to load (e.g. colonist renamed it) falls back to an emoji.
      this.badIcons = new Set();
      sr.addEventListener('error', (e) => {
        const img = e.target;
        if (!img || img.tagName !== 'IMG' || !img.dataset.res) return;
        this.badIcons.add(img.getAttribute('src'));
        const span = document.createElement('span');
        span.className = 'emo';
        span.title = img.title;
        span.textContent = EMOJI[img.dataset.res];
        img.replaceWith(span);
      }, true);

      sr.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        const act = a.getAttribute('data-a');
        if (act === 'collapse') {
          this.prefs.collapsed = !this.prefs.collapsed;
          savePrefs(this.prefs);
          this._applyCollapsed();
        } else if (act === 'settings') {
          this.showSettings = !this.showSettings;
          if (this.prefs.collapsed) { this.prefs.collapsed = false; this._applyCollapsed(); }
          this.render(this.last);
        } else if (act === 'rescan') {
          this.h.onRescan && this.h.onRescan();
        } else if (act === 'reset') {
          this.h.onReset && this.h.onReset();
        } else if (act === 'unparsed') {
          this.showUnparsed = !this.showUnparsed;
          this.render(this.last);
        }
      });
      sr.addEventListener('change', (e) => {
        const t = e.target;
        if (t.matches('select[data-k="self"]')) this.h.onSetSelf && this.h.onSetSelf(t.value || null);
        if (t.matches('input[data-k="showSelf"]')) {
          this.prefs.showSelf = t.checked;
          savePrefs(this.prefs);
          this.render(this.last);
        }
      });
      this._drag();
      window.addEventListener('resize', () => this._place());
    }

    _applyCollapsed() {
      this.panel.classList.toggle('collapsed', !!this.prefs.collapsed);
      const b = this.sr.querySelector('[data-a="collapse"]');
      b.textContent = this.prefs.collapsed ? '+' : '–';
      b.title = this.prefs.collapsed ? 'Expand' : 'Collapse';
    }

    _place() {
      const w = this.panel.offsetWidth || 320;
      const h = this.panel.offsetHeight || 40;
      let x = this.prefs.x == null ? window.innerWidth - w - 16 : this.prefs.x;
      let y = this.prefs.y == null ? 90 : this.prefs.y;
      x = Math.max(4, Math.min(x, window.innerWidth - Math.min(w, 120) - 4));
      y = Math.max(4, Math.min(y, window.innerHeight - Math.min(h, 34) - 4));
      this.panel.style.left = x + 'px';
      this.panel.style.top = y + 'px';
    }

    _drag() {
      const hdr = this.sr.querySelector('.hdr');
      let sx, sy, ox, oy, moving = false;
      hdr.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        moving = true;
        sx = e.clientX; sy = e.clientY;
        const r = this.panel.getBoundingClientRect();
        ox = r.left; oy = r.top;
        hdr.setPointerCapture(e.pointerId);
      });
      hdr.addEventListener('pointermove', (e) => {
        if (!moving) return;
        this.prefs.x = ox + e.clientX - sx;
        this.prefs.y = oy + e.clientY - sy;
        this._place();
      });
      const end = () => {
        if (!moving) return;
        moving = false;
        savePrefs(this.prefs);
      };
      hdr.addEventListener('pointerup', end);
      hdr.addEventListener('pointercancel', end);
    }

    /**
     * model: {state:'waiting'|'live'|'busy', status, summary, icons, boardCounts,
     *         selfName, selfSource, unparsed:[text], lines}
     */
    render(model) {
      if (!model || !this.sr) return;
      this.last = model;
      const sr = this.sr;
      const dot = sr.querySelector('.dot');
      dot.className = 'dot ' + (model.state === 'live' ? 'live' : model.state === 'busy' ? 'busy' : '');
      dot.title = model.status || '';

      const s = model.summary;
      this._set('.content', !s || !s.players.length
        ? `<div class="empty">${esc(model.status || 'Waiting for a game log…')}</div>`
        : this._table(model));

      // settings
      const st = sr.querySelector('.settings');
      st.classList.toggle('hidden', !this.showSettings);
      if (this.showSettings) {
        const names = s ? s.players.map((p) => p.name).filter((n) => n !== 'YOU') : [];
        const auto = model.selfSource && model.selfSource !== 'manual' && model.selfName ? `Auto (${esc(model.selfName)})` : 'Auto-detect';
        const opts = [`<option value="">${auto}</option>`]
          .concat(names.map((n) => `<option value="${esc(n)}" ${model.selfSource === 'manual' && model.selfName === n ? 'selected' : ''}>${esc(n)}</option>`))
          .join('');
        this._set('.settings', `
          <label>You are <select data-k="self">${opts}</select></label>
          <label><input type="checkbox" data-k="showSelf" ${this.prefs.showSelf ? 'checked' : ''}> Show my own row</label>
          <button class="act" data-a="reset" title="Forget everything tracked for this game and re-read the log">Reset this game</button>`);
      }

      // unparsed lines (diagnostics)
      const up = sr.querySelector('.unparsed');
      const nUn = (model.unparsed || []).length;
      up.classList.toggle('hidden', !(this.showUnparsed && nUn));
      if (this.showUnparsed && nUn) {
        const pretty = (t) => t.replace(/\{([a-z]+)\}/g, (m, r) => EMOJI[r] || '🂠');
        this._set('.unparsed', model.unparsed.slice(-8).map((t) => `<div title="${esc(t)}">${esc(pretty(t))}</div>`).join(''));
      }

      this._set('.stat', esc(model.status || ''));
      this._set('.extra', nUn
        ? `<span class="link" data-a="unparsed" title="Log lines with cards that the tracker did not understand">${nUn} unrecognised</span>`
        : s && s.worlds > 1
        ? `<span title="Number of distinct hand combinations still consistent with the log">${s.worlds} possibilities</span>`
        : '');
      this._place();
    }

    /** Only touch the DOM when the markup actually changed (keeps tooltips and open dropdowns alive). */
    _set(sel, html) {
      this._cache = this._cache || {};
      if (this._cache[sel] === html) return;
      this._cache[sel] = html;
      this.sr.querySelector(sel).innerHTML = html;
    }

    setVisible(v) {
      if (this.host) this.host.style.display = v ? '' : 'none';
    }

    _icon(r, icons) {
      const bad = this.badIcons || new Set();
      const src = [icons && icons[r], CARD_ART[r]].find((u) => u && !bad.has(u));
      return src
        ? `<img src="${esc(src)}" data-res="${r}" alt="${LABEL[r]}" title="${LABEL[r]}">`
        : `<span class="emo" title="${LABEL[r]}">${EMOJI[r]}</span>`;
    }

    _cell(c, plain) {
      if (c.min === c.max) return plain ? String(c.min) : `<span class="${c.min ? 'v' : 'z'}">${c.min}</span>`;
      const odds = Array.from(c.dist.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([k, w]) => `${k}: ${pct(w)}`)
        .join('  ·  ');
      return `<span class="u" title="${esc(odds)}\nexpected ${c.exp.toFixed(1)}">${c.min}–${c.max}</span>`;
    }

    _table(model) {
      const s = model.summary;
      const icons = model.icons || {};
      const rows = s.players
        .filter((p) => this.prefs.showSelf || !p.isSelf)
        .map((p) => {
          const color = p.color || '#8a94a8';
          const nm = p.name === 'YOU' ? 'You' : p.name;
          const chips = BUILD.map(([k, short, label]) => {
            const x = p.build[k];
            const cls = x >= 0.995 ? 'yes' : x > 0.005 ? 'maybe' : 'no';
            const tip = cls === 'yes' ? `Can afford a ${label.toLowerCase()}` : cls === 'maybe' ? `${pct(x)} chance they can afford a ${label.toLowerCase()}` : `Cannot afford a ${label.toLowerCase()}`;
            return `<span class="chip ${cls}" title="${esc(tip)}">${short}</span>`;
          }).join('');
          const board = model.boardCounts && (model.boardCounts.get(p.name) ?? (p.isSelf ? model.boardCounts.get('@self') : undefined));
          const warns = p.warn.slice();
          const T = p.total;
          if (board != null && (board < T.min || board > T.max)) {
            warns.unshift(`Board shows ${board} cards, tracker has ${T.min === T.max ? T.min : T.min + '–' + T.max}. A log line was probably missed — try ⟳.`);
          }
          const warn = warns.length ? `<span class="warn" title="${esc(warns.join('\n'))}">⚠</span>` : '';
          return `<tr class="${p.isSelf ? 'self' : ''}">
            <td class="name" title="${esc(nm)}"><span class="sw" style="background:${esc(color)}"></span>${esc(nm)}${p.isSelf ? ' <span class="you">(you)</span>' : ''}</td>
            ${p.res.map((c) => `<td>${this._cell(c)}</td>`).join('')}
            <td class="tot ${T.max >= 8 ? 'hi' : ''}" title="${T.min >= 8 ? 'More than 7 cards: will discard on a 7' : 'Total resource cards'}">${this._cell(T, true)}${warn}</td>
            <td class="dev" title="Development cards bought but not yet played${p.knights ? ` · ${p.knights} knight${p.knights > 1 ? 's' : ''} played` : ''}">${p.devHeld || '<span class="z">0</span>'}</td>
            <td><span class="chips">${chips}</span></td>
          </tr>`;
        })
        .join('');
      return `<table>
        <thead><tr>
          <th class="l">Player</th>
          ${RES.map((r) => `<th>${this._icon(r, icons)}</th>`).join('')}
          <th title="Total resource cards">Σ</th>
          <th title="Unplayed development cards">Dev</th>
          <th title="What they can afford right now">Can build</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }

    destroy() {
      if (this.host) this.host.remove();
      this.host = null;
    }
  }

  NS.Overlay = Overlay;
})(typeof globalThis !== 'undefined' ? globalThis : this);
