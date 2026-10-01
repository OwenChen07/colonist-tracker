/*
 * Random 4-player Catan game simulator that emits colonist.io-style log rows
 * from the point of view of one player ("Owen"), plus the true hands after
 * every row. Used to property-test the tracker: the true hands must always
 * be one of the tracker's possible worlds.
 */
(function (root) {
  'use strict';
  const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
  const ALT = { lumber: 'Lumber', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
  const COLORS = ['#3e3e3e', '#e27174', '#223697', '#62b95d'];
  const COST = { road: [1, 1, 0, 0, 0], settlement: [1, 1, 1, 1, 0], city: [0, 0, 0, 2, 3], dev: [0, 0, 1, 1, 1] };

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function simulate(seed, opts) {
    opts = opts || {};
    const rand = rng(seed);
    const ri = (n) => Math.floor(rand() * n);
    const names = opts.names || ['Owen', 'Ana', 'Bram', 'Cleo'];
    const me = 0;
    const hands = names.map(() => [0, 0, 0, 0, 0]);
    const rows = []; // {html, text, truth}
    const total = (p) => hands[p].reduce((a, b) => a + b, 0);

    const nameHtml = (p) => `<span style="font-weight:600;word-break:break-all;color:${COLORS[p]}">${names[p]}</span>`;
    const resHtml = (r) => `<img src="https://cdn.colonist.io/dist/assets/card_${r}.abc123.svg" alt="${ALT[r]}" height="20" width="14.25" class="lobbyChatTextIcon">`;
    const backHtml = () => `<img src="https://cdn.colonist.io/dist/assets/card_rescardback.03c18312.svg" alt="Resource Card" height="20" width="14.25" class="lobbyChatTextIcon">`;
    const icon = (alt, file) => `<img src="https://cdn.colonist.io/dist/assets/${file}.svg" alt="${alt}" height="20" width="20" class="lobbyChatTextIcon">`;
    const vecHtml = (v) => v.map((c, r) => resHtml(RES[r]).repeat(c)).join('');
    const subj = (p, youForm) => (p === me && youForm ? 'You' : nameHtml(p));

    function emit(inner) {
      const html = `<div class="messagePart-x1"><img class="avatar-y2" src="https://cdn.colonist.io/dist/assets/icon_player.svg"><span class="message-z3">${inner}</span></div>`;
      rows.push({ html, truth: hands.map((h) => h.slice()) });
    }
    const add = (p, v, s) => { for (let r = 0; r < 5; r++) hands[p][r] += s * v[r]; };
    const randomCards = (p, n) => {
      const v = [0, 0, 0, 0, 0];
      const pool = [];
      hands[p].forEach((c, r) => { for (let i = 0; i < c; i++) pool.push(r); });
      for (let i = 0; i < n && pool.length; i++) v[pool.splice(ri(pool.length), 1)[0]]++;
      return v;
    };
    const can = (p, cost) => cost.every((c, r) => hands[p][r] >= c);

    emit(`Happy settling! Learn how to play in the <a href="#open-rulebook">rulebook</a>. <br>List of commands: /help`);
    rows.push({ html: '<div><span><hr></span></div>', truth: hands.map((h) => h.slice()) });

    // setup
    const order = [0, 1, 2, 3, 3, 2, 1, 0].map((i) => i % names.length);
    order.forEach((p, k) => {
      emit(`${nameHtml(p)} placed a ${icon('settlement', 'settlement_red')}`);
      emit(`${nameHtml(p)} placed a ${icon('road', 'road_red')}`);
      if (k >= names.length) {
        const v = [0, 0, 0, 0, 0];
        for (let i = 0; i < 3; i++) v[ri(5)]++;
        add(p, v, 1);
        emit(`${nameHtml(p)} received starting resources ${vecHtml(v)}`);
      }
    });

    function robberAndSteal(p) {
      emit(`${subj(p, false)} moved Robber ${icon('robber', 'icon_robber')} to ${icon('prob_8', 'prob_8')} ${icon('brick tile', 'tile_brick')}`);
      const victims = names.map((_, q) => q).filter((q) => q !== p && total(q) > 0);
      if (!victims.length) return;
      const v = victims[ri(victims.length)];
      const card = randomCards(v, 1);
      const r = card.indexOf(1);
      add(v, card, -1);
      add(p, card, 1);
      if (p === me) emit(`You stole ${resHtml(RES[r])} from ${nameHtml(v)}`);
      else if (v === me) emit(`${nameHtml(p)} stole ${resHtml(RES[r])} from you`);
      else emit(`${nameHtml(p)} stole ${backHtml()} from ${nameHtml(v)}`);
    }

    const turns = opts.turns || 60;
    for (let t = 0; t < turns; t++) {
      const p = t % names.length;
      const d1 = 1 + ri(6), d2 = 1 + ri(6);
      emit(`${nameHtml(p)} rolled ${icon('dice_' + d1, 'dice_' + d1)} ${icon('dice_' + d2, 'dice_' + d2)}`);
      if (d1 + d2 === 7) {
        names.forEach((_, q) => {
          if (total(q) > 7) {
            const v = randomCards(q, Math.floor(total(q) / 2));
            add(q, v, -1);
            emit(`${nameHtml(q)} discarded ${vecHtml(v)}`);
          }
        });
        robberAndSteal(p);
      } else {
        names.forEach((_, q) => {
          const n = ri(3);
          if (!n) return;
          const v = [0, 0, 0, 0, 0];
          for (let i = 0; i < n; i++) v[ri(5)]++;
          add(q, v, 1);
          emit(`${nameHtml(q)} got ${vecHtml(v)}`);
        });
      }

      for (let a = 0; a < 4; a++) {
        const choice = ri(10);
        if (choice === 0 && can(p, COST.city)) {
          add(p, COST.city, -1);
          emit(`${nameHtml(p)} built a ${rand() < 0.5 ? 'City ' : ''}${icon('city', 'city_red')} (+1 VP)`);
        } else if (choice === 1 && can(p, COST.settlement)) {
          add(p, COST.settlement, -1);
          emit(`${nameHtml(p)} built a ${rand() < 0.5 ? 'Settlement ' : ''}${icon('settlement', 'settlement_red')} (+1 VP)`);
        } else if (choice === 2 && can(p, COST.road)) {
          add(p, COST.road, -1);
          emit(`${nameHtml(p)} built a ${rand() < 0.5 ? 'Road ' : ''}${icon('road', 'road_red')}`);
        } else if (choice === 3 && can(p, COST.dev)) {
          add(p, COST.dev, -1);
          emit(`${nameHtml(p)} bought ${icon('Development Card', 'card_devcardback')}`);
        } else if (choice === 4) {
          const r = hands[p].findIndex((c) => c >= 4);
          if (r >= 0) {
            const give = [0, 0, 0, 0, 0]; give[r] = 4;
            const get = [0, 0, 0, 0, 0]; get[(r + 1 + ri(4)) % 5] = 1;
            add(p, give, -1); add(p, get, 1);
            emit(`${nameHtml(p)} gave bank ${vecHtml(give)} and took ${vecHtml(get)}`);
          }
        } else if (choice === 5) {
          const q = (p + 1 + ri(names.length - 1)) % names.length;
          if (total(p) && total(q)) {
            const give = randomCards(p, 1 + ri(2));
            const get = randomCards(q, 1);
            if (give.some((c, r) => c && get[r])) continue; // colonist forbids same-resource swaps
            add(p, give, -1); add(q, give, 1); add(q, get, -1); add(p, get, 1);
            emit(`${nameHtml(p)} gave ${vecHtml(give)} and got ${vecHtml(get)} from ${q === me && rand() < 0.5 ? 'you' : nameHtml(q)}`);
          }
        } else if (choice === 6 && rand() < 0.5) {
          emit(`${nameHtml(p)} used </span><div class="devCard-a1"><span>Knight ${icon('Knight', 'card_knight')}</span></div><span>`);
          robberAndSteal(p);
        } else if (choice === 7 && rand() < 0.3) {
          const r = ri(5);
          emit(`${nameHtml(p)} used </span><div class="devCard-a1"><span>Monopoly ${icon('Monopoly', 'card_monopoly')}</span></div><span>`);
          let n = 0;
          names.forEach((_, q) => { if (q !== p) { n += hands[q][r]; hands[q][r] = 0; } });
          hands[p][r] += n;
          emit(`${p === me && rand() < 0.5 ? 'You' : nameHtml(p)} stole ${n} ${resHtml(RES[r])}`);
        } else if (choice === 8 && rand() < 0.3) {
          const v = [0, 0, 0, 0, 0]; v[ri(5)]++; v[ri(5)]++;
          emit(`${nameHtml(p)} used </span><div class="devCard-a1"><span>Year of Plenty ${icon('Year of Plenty', 'card_yearofplenty')}</span></div><span>`);
          add(p, v, 1);
          emit(`${nameHtml(p)} took from bank ${vecHtml(v)}`);
        } else if (choice === 9 && rand() < 0.3) {
          emit(`${nameHtml(p)} used </span><div class="devCard-a1"><span>Road Building ${icon('Road Building', 'card_roadbuilding')}</span></div><span>`);
          const verb = rand() < 0.5 ? 'built' : 'placed';
          emit(`${nameHtml(p)} ${verb} a ${icon('road', 'road_red')}`);
          emit(`${nameHtml(p)} ${verb} a ${icon('road', 'road_red')}`);
        }
      }
    }
    return { names, rows };
  }

  root.CRTSim = { simulate, RES };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CRTSim;
})(typeof globalThis !== 'undefined' ? globalThis : this);
