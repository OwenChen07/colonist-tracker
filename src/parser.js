/*
 * Colonist Resource Tracker — log parser.
 *
 * Turns one rendered game-log row from colonist.io into a plain event object.
 * It only relies on things that have stayed stable across colonist's UI
 * rewrites: the visible text, and the `alt` / `src` of the card images.
 * Hashed CSS class names are never required.
 */
(function (root) {
  'use strict';
  const NS = (root.CRT = root.CRT || {});

  const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  const YOU = 'YOU';

  // alt text / file-name fragments → resource key
  const RES_ALIASES = {
    lumber: 'lumber', wood: 'lumber',
    brick: 'brick',
    wool: 'wool', sheep: 'wool',
    grain: 'grain', wheat: 'grain',
    ore: 'ore', stone: 'ore',
  };

  /** Classify an <img>: a resource key, 'unknown' (card back), or null. */
  function resourceOfImg(img) {
    const alt = (img.getAttribute('alt') || '').trim().toLowerCase();
    const src = (img.getAttribute('src') || '').toLowerCase();
    if (alt) {
      if (/resource ?card|card ?back|rescardback|unknown/.test(alt)) return 'unknown';
      if (RES_ALIASES[alt]) return RES_ALIASES[alt];
    }
    const m = src.match(/card_([a-z]+)/);
    if (m) {
      if (m[1] === 'rescardback' || m[1] === 'cardback') return 'unknown';
      if (RES_ALIASES[m[1]]) return RES_ALIASES[m[1]];
    }
    return null;
  }

  function isNameElement(el) {
    if (el.tagName !== 'SPAN') return false;
    const style = el.getAttribute('style') || '';
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/color\s*:/.test(style) && /font-weight|word-break/.test(style)) return true;
    return /(^|\s)(player-?name|username|playerName|name)([-_][A-Za-z0-9]+)?(\s|$)/i.test(cls);
  }

  /**
   * Flatten a log row to a single line of text. Resource cards become
   * `{lumber}` … `{ore}` / `{unknown}`, other icons become `[alt]`.
   */
  function flatten(entry) {
    const out = [];
    const names = [];
    const icons = {};
    (function walk(node) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          out.push(c.nodeValue);
        } else if (c.nodeType === 1) {
          const tag = c.tagName;
          if (tag === 'IMG') {
            const r = resourceOfImg(c);
            if (r) {
              out.push(' {' + r + '} ');
              if (r !== 'unknown' && !icons[r]) icons[r] = c.src || c.getAttribute('src');
            } else {
              const alt = (c.getAttribute('alt') || '').trim();
              if (alt) out.push(' [' + alt.toLowerCase() + '] ');
            }
          } else if (tag === 'BR' || tag === 'HR') {
            out.push(' ');
          } else if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'svg') {
            // skip
          } else {
            if (isNameElement(c)) {
              const n = (c.textContent || '').trim();
              if (n) names.push({ name: n, color: c.style ? c.style.color : '' });
            }
            out.push(' ');
            walk(c);
            out.push(' ');
          }
        }
      }
    })(entry);
    const text = out.join('').replace(/\s+/g, ' ').trim();
    return { text, names, icons };
  }

  function countRes(s) {
    const v = [0, 0, 0, 0, 0];
    let unknown = 0;
    const re = /\{([a-z]+)\}/g;
    let m;
    while ((m = re.exec(s || ''))) {
      const i = RES.indexOf(m[1]);
      if (i >= 0) v[i]++;
      else if (m[1] === 'unknown') unknown++;
    }
    return { v, unknown, n: v.reduce((a, b) => a + b, 0) };
  }

  function firstRes(s) {
    const m = /\{([a-z]+)\}/.exec(s || '');
    if (m) return m[1];
    // fall back to a resource word in plain text (e.g. "stole 3 Brick")
    const w = /\b(lumber|wood|brick|wool|sheep|grain|wheat|ore)\b/i.exec(s || '');
    return w ? RES_ALIASES[w[1].toLowerCase()] : null;
  }

  function cleanName(s) {
    let n = (s || '').replace(/[{[][^\]}]*[\]}]/g, ' ').replace(/\s+/g, ' ').trim();
    n = n.replace(/[.!:,]+$/, '').trim();
    if (/^you$/i.test(n)) return YOU;
    return n;
  }

  const NOISE = /(wants to give|has disconnected|has reconnected|rulebook|no player to steal|has no cards|is blocked by the robber|no resources produced|won the game|passed from|happy settling|list of commands|game (is )?paused|resumed|is now|karma|proposed|offer)/i;

  /**
   * Parse a flattened line into an event. Returns null for lines with no
   * effect on hands. Unknown lines that mention resource cards come back as
   * {type:'unparsed'} so the overlay can surface them.
   */
  function parseText(text) {
    if (!text) return null;
    let m;

    // ----- turn / robber / dev-card bookkeeping (no resource effect) -----
    if ((m = /^(.+?) rolled\b/i.exec(text))) return { type: 'roll', player: cleanName(m[1]) };
    if ((m = /^(.+?) moved (the )?robber\b/i.exec(text))) return { type: 'robber', player: cleanName(m[1]) };
    if ((m = /^(.+?) used (.*)$/i.exec(text))) {
      const rest = m[2].toLowerCase();
      let card = 'unknown';
      if (/knight/.test(rest)) card = 'knight';
      else if (/monopoly/.test(rest)) card = 'monopoly';
      else if (/year of plenty|yearofplenty/.test(rest)) card = 'yop';
      else if (/road ?building/.test(rest)) card = 'roadbuilding';
      return { type: 'dev_used', player: cleanName(m[1]), card };
    }
    if ((m = /^(.+?) bought\b(.*)$/i.exec(text)) && /development|dev card/i.test(m[2])) {
      return { type: 'dev_buy', player: cleanName(m[1]) };
    }

    // ----- trades (must precede the generic "got" rule) -----
    if ((m = /^(.+?) gave bank (.*?) and (?:took|got|received) (.*)$/i.exec(text))) {
      const give = countRes(m[2]).v, get = countRes(m[3]).v;
      return { type: 'delta', player: cleanName(m[1]), vec: get.map((g, i) => g - give[i]), why: 'bank trade' };
    }
    if ((m = /^(.+?) traded (.*?) (?:for|and got) (.*?) with (?:the )?bank\b/i.exec(text))) {
      const give = countRes(m[2]).v, get = countRes(m[3]).v;
      return { type: 'delta', player: cleanName(m[1]), vec: get.map((g, i) => g - give[i]), why: 'bank trade' };
    }
    if ((m = /^(.+?) gave (.*?) and (?:got|took|received) (.*?) from (.+)$/i.exec(text))) {
      return { type: 'trade', a: cleanName(m[1]), b: cleanName(m[4]), give: countRes(m[2]).v, get: countRes(m[3]).v };
    }
    if ((m = /^(.+?) traded (.*?) for (.*?) with (.+)$/i.exec(text))) {
      return { type: 'trade', a: cleanName(m[1]), b: cleanName(m[4]), give: countRes(m[2]).v, get: countRes(m[3]).v };
    }

    // ----- robber steals & monopoly -----
    if ((m = /^(.+?) stole (\d+) (.*)$/i.exec(text)) && !/ from /i.test(m[3])) {
      const res = firstRes(m[3]);
      if (res && res !== 'unknown') return { type: 'monopoly', player: cleanName(m[1]), res, n: parseInt(m[2], 10) };
    }
    if ((m = /^(.+?) stole (.*?) from (.+)$/i.exec(text))) {
      const res = firstRes(m[2]) || 'unknown';
      return { type: 'steal', thief: cleanName(m[1]), victim: cleanName(m[3]), res };
    }

    // ----- building -----
    if ((m = /^(.+?) built (.*)$/i.exec(text))) {
      const rest = m[2].toLowerCase();
      let what = null;
      if (/\bcity\b/.test(rest)) what = 'city';
      else if (/\bsettlement\b/.test(rest)) what = 'settlement';
      else if (/\broad\b/.test(rest)) what = 'road';
      if (what) return { type: 'build', player: cleanName(m[1]), what };
    }
    if ((m = /^(.+?) placed (.*)$/i.exec(text))) {
      const rest = m[2].toLowerCase();
      return { type: 'place', player: cleanName(m[1]), what: /\broad\b/.test(rest) ? 'road' : /\bcity\b/.test(rest) ? 'city' : 'settlement' };
    }

    // ----- gains / losses -----
    if ((m = /^(.+?) discarded (.*)$/i.exec(text))) {
      const c = countRes(m[2]);
      if (c.n) return { type: 'delta', player: cleanName(m[1]), vec: c.v.map((x) => -x), why: 'discard' };
    }
    if ((m = /^(.+?) took from (?:the )?bank (.*)$/i.exec(text))) {
      const c = countRes(m[2]);
      if (c.n) return { type: 'delta', player: cleanName(m[1]), vec: c.v, why: 'year of plenty' };
    }
    if ((m = /^(.+?) received starting resources(.*)$/i.exec(text))) {
      const c = countRes(m[2]);
      if (c.n) return { type: 'delta', player: cleanName(m[1]), vec: c.v, why: 'starting resources' };
    }
    if ((m = /^(.+?) (?:got|received|collected) (.*)$/i.exec(text))) {
      const c = countRes(m[2]);
      if (c.n) return { type: 'delta', player: cleanName(m[1]), vec: c.v, why: 'production' };
      return null;
    }

    if (NOISE.test(text)) return null;
    if (/\{[a-z]+\}/.test(text)) return { type: 'unparsed', text };
    return null;
  }

  function parseEntry(entry) {
    const flat = flatten(entry);
    let ev = parseText(flat.text);
    // Prefer the exact names from the styled name spans when they line up.
    if (ev && flat.names.length) {
      const n0 = flat.names[0] && flat.names[0].name;
      const fix = (key) => {
        if (ev[key] && ev[key] !== YOU && n0 && ev[key] !== n0 && flat.text.indexOf(n0) === 0) ev[key] = n0;
      };
      if ('player' in ev) fix('player');
      if ('thief' in ev) fix('thief');
      if ('a' in ev) fix('a');
    }
    return { ev, text: flat.text, names: flat.names, icons: flat.icons };
  }

  NS.parser = { RES, YOU, resourceOfImg, flatten, parseText, parseEntry, countRes };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.parser;
})(typeof globalThis !== 'undefined' ? globalThis : this);
