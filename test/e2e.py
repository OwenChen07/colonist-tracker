"""
End-to-end test: load the real unpacked extension in Chromium, serve a
colonist-like page at https://colonist.io/ (requests are intercepted, nothing
hits the network), stream a simulated game into a virtualised log, and check
the overlay's numbers against the true hands.
"""
import json, os, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = open(os.path.join(ROOT, 'test', 'fixture.html')).read()
SIM = open(os.path.join(ROOT, 'test', 'sim.js')).read()
OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
SEED = int(os.environ.get('SEED', '7'))

CHECK_JS = """
(truthByName) => {
  // read the tracker through the overlay's rendered table
  const host = document.getElementById('crt-overlay-host');
  if (!host) return {error: 'no overlay'};
  const rows = Array.from(host.shadowRoot.querySelectorAll('tbody tr'));
  const out = {};
  for (const tr of rows) {
    const tds = tr.querySelectorAll('td');
    const name = tds[0].getAttribute('title');
    const res = [1,2,3,4,5].map(i => {
      const t = tds[i].textContent.trim();
      const m = t.split('–').map(Number);
      return m.length === 2 ? {min: m[0], max: m[1]} : {min: m[0], max: m[0]};
    });
    const tt = tds[6].textContent.replace('⚠','').trim().split('–').map(Number);
    out[name] = {res, total: {min: tt[0], max: tt.length > 1 ? tt[1] : tt[0]}, warn: !!tds[6].querySelector('.warn')};
  }
  const problems = [];
  for (const [name, truth] of Object.entries(truthByName)) {
    const label = name;
    const row = out[label] || out['You'];
    if (!row) { problems.push('missing row ' + name); continue; }
    truth.forEach((c, r) => {
      if (c < row.res[r].min || c > row.res[r].max) problems.push(`${name} r${r} truth ${c} not in ${row.res[r].min}-${row.res[r].max}`);
    });
    const tot = truth.reduce((a,b)=>a+b,0);
    if (tot < row.total.min || tot > row.total.max) problems.push(`${name} total ${tot} not in ${row.total.min}-${row.total.max}`);
    if (row.warn) problems.push(`${name} shows a warning`);
  }
  return {rows: out, problems, status: host.shadowRoot.querySelector('.stat').textContent,
          extra: host.shadowRoot.querySelector('.extra').textContent};
}
"""

def main():
    ext = ROOT
    results = {}
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            tempfile.mkdtemp(), channel='chromium', headless=True,
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}'],
            viewport={'width': 1280, 'height': 760})
        ctx.route('https://colonist.io/**', lambda route: route.fulfill(status=200, content_type='text/html', body=FIXTURE))
        ctx.route('https://cdn.colonist.io/**', lambda route: route.fulfill(status=200, content_type='image/svg+xml', body=svg_for(route.request.url)))

        page = ctx.new_page()
        page.on('console', lambda m: print('  [console]', m.text) if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: print('  [pageerror]', e))

        # ---------- A: live game, extension present from the start ----------
        page.goto('https://colonist.io/#gameA')
        page.add_script_tag(content=SIM)
        game = page.evaluate(f'(() => {{ const g = CRTSim.simulate({SEED}, {{turns: 70}}); window.__g = g; return {{n: g.rows.length, names: g.names}}; }})()')
        names = game['names']
        print('A: rows', game['n'])
        page.wait_for_timeout(1200)
        n = game['n']
        step = 7
        for i in range(0, n, step):
            page.evaluate(f'pushRows(__g.rows.slice({i}, {i+step}).map(r => r.html))')
            page.wait_for_timeout(60)
        page.wait_for_timeout(1500)
        truth = page.evaluate('__g.rows[__g.rows.length-1].truth')
        truth_by_name = {names[i]: truth[i] for i in range(len(names))}
        page.evaluate("setPlayers(%s)" % json.dumps([{'name': nm, 'count': sum(truth[i]), 'self': i == 0} for i, nm in enumerate(names)]))
        page.wait_for_timeout(4500)
        r = page.evaluate(CHECK_JS, truth_by_name)
        print('A:', r.get('status'), '|', r.get('extra'), '| problems:', r.get('problems'))
        results['A'] = r
        page.screenshot(path=os.path.join(OUT, 'A_live.png'))
        host = page.locator('#crt-overlay-host')
        page.screenshot(path=os.path.join(OUT, 'A_overlay.png'), clip=overlay_clip(page))

        # ---------- B: refresh mid-game (log already long, only tail rendered) ----------
        page2 = ctx.new_page()
        page2.on('pageerror', lambda e: print('  [pageerror B]', e))
        page2.add_init_script("if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); }")
        page2.goto('https://colonist.io/#gameB')
        page2.add_script_tag(content=SIM)
        g2 = page2.evaluate(f'(() => {{ const g = CRTSim.simulate({SEED + 1}, {{turns: 90}}); window.__g = g; pushRows(g.rows.map(r => r.html)); return {{n: g.rows.length, names: g.names}}; }})()')
        print('B: rows', g2['n'])
        # wait for backfill to finish
        deadline = time.time() + 40
        while time.time() < deadline:
            page2.wait_for_timeout(700)
            st = page2.evaluate("(() => { const h = document.getElementById('crt-overlay-host'); return h ? h.shadowRoot.querySelector('.stat').textContent : ''; })()")
            if st.startswith(f"{g2['n']} log lines") and 'missing' not in st:
                break
        truth2 = page2.evaluate('__g.rows[__g.rows.length-1].truth')
        r2 = page2.evaluate(CHECK_JS, {g2['names'][i]: truth2[i] for i in range(4)})
        print('B:', r2.get('status'), '|', r2.get('extra'), '| problems:', r2.get('problems'))
        print('B: scrolled back to bottom:', page2.evaluate('log.scrollTop + log.clientHeight >= log.scrollHeight - 5'))
        results['B'] = r2

        # ---------- C: reload the same tab → state restored from storage + log ----------
        page2.reload()
        page2.add_script_tag(content=SIM)
        page2.evaluate(f'(() => {{ const g = CRTSim.simulate({SEED + 1}, {{turns: 90}}); window.__g = g; pushRows(g.rows.map(r => r.html)); }})()')
        page2.wait_for_timeout(2500)
        print('C: status 2.5s after reload:', page2.evaluate("document.getElementById('crt-overlay-host').shadowRoot.querySelector('.stat').textContent"))
        r3 = page2.evaluate(CHECK_JS, {g2['names'][i]: truth2[i] for i in range(4)})
        print('C (reload):', r3.get('status'), '| problems:', r3.get('problems'))
        results['C'] = r3

        # ---------- D: new game in the same tab ----------
        page2.evaluate(f'(() => {{ resetLog(); const g = CRTSim.simulate({SEED + 2}, {{turns: 40, names: ["Owen","Dax","Eli","Fay"]}}); window.__g = g; pushRows(g.rows.map(r => r.html)); return g.rows.length; }})()')
        deadline = time.time() + 40
        while time.time() < deadline:
            page2.wait_for_timeout(700)
            st = page2.evaluate("document.getElementById('crt-overlay-host').shadowRoot.querySelector('.stat').textContent")
            if 'missing' not in st and 'Reading' not in st: break
        page2.wait_for_timeout(1000)
        truth4 = page2.evaluate('__g.rows[__g.rows.length-1].truth')
        r4 = page2.evaluate(CHECK_JS, {n: truth4[i] for i, n in enumerate(["Owen", "Dax", "Eli", "Fay"])})
        print('D (new game):', r4.get('status'), '| players:', list(r4.get('rows', {}).keys()), '| problems:', r4.get('problems'))
        results['D'] = r4
        page2.screenshot(path=os.path.join(OUT, 'D_newgame.png'))
        ctx.close()
    bad = sum(len(v.get('problems', [])) for v in results.values())
    print('TOTAL PROBLEMS', bad)


def overlay_clip(page):
    box = page.evaluate("(() => { const p = document.getElementById('crt-overlay-host').shadowRoot.querySelector('.panel').getBoundingClientRect(); return {x: p.x-12, y: p.y-12, width: p.width+24, height: p.height+24}; })()")
    return box


def svg_for(url):
    colors = {'lumber': '#2f6b2a', 'brick': '#b4552f', 'wool': '#9ccf5c', 'grain': '#e5c14a', 'ore': '#7b7f8a', 'rescardback': '#3b4f8f'}
    for k, c in colors.items():
        if 'card_' + k in url:
            return f'<svg xmlns="http://www.w3.org/2000/svg" width="57" height="80" viewBox="0 0 57 80"><rect x="2" y="2" width="53" height="76" rx="7" fill="#fff" stroke="#c7b78f" stroke-width="3"/><rect x="8" y="8" width="41" height="64" rx="4" fill="{c}"/></svg>'
    return '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#999"/></svg>'


if __name__ == '__main__':
    main()
