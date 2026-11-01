#!/usr/bin/env python3
"""Docket on its own, in headless Chrome: this repo served as a static site, the way docket.alexisdavidson.org
serves it, with no Workshop agent. Checks that the page loads with no errors, picks browser storage, moves an
old localStorage board in once, saves and reloads, makes backups, and registers its own service worker.

  pip install playwright && python -m playwright install chromium
  python test/e2e.py

Docket inside Workshop (the shell, the agent, two windows in sync) is checked by Workshop's tests/e2e.py,
which runs against a checkout of this repo. Exit 1 if any check fails."""
import functools, http.server, json, os, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'test', 'fixtures')
PORT = 8812
SITE = f'http://127.0.0.1:{PORT}'


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


# Globals the page defines beyond a blank page, minus the shared classic scripts. Docket is ES modules, so only
# its test hook should remain.
GLOBALS = """() => {
  const f = document.createElement('iframe'); document.body.appendChild(f);
  const blank = new Set(Object.getOwnPropertyNames(f.contentWindow)); f.remove();
  const shared = new Set(['WorkshopTheme', 'WorkshopSw', 'XLSX', 'cptable', 'make_xlsx_lib', 'DO_NOT_EXPORT_CODEPAGE']);
  return Object.getOwnPropertyNames(window).filter(n => !blank.has(n) && !shared.has(n)).sort();
}"""


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with open(os.path.join(FIX, 'today-localstorage.json')) as f: legacy = json.load(f)
    want = sorted(t['title'] for t in legacy['tasks'])
    titles = "() => window.__prioritizer.state.tasks.map(t => t.title).sort()"

    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome') if os.path.exists('/usr/bin/google-chrome') and not os.environ.get('CI') else p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        # The SDK probes /api/health for a Workshop agent on this site; its 404 is expected here.
        pg.on('console', lambda m: m.type == 'error' and not m.text.startswith('Failed to load resource') and errors.append(m.text))

        # A board saved by the localStorage versions moves into browser storage once.
        pg.goto(SITE + '/manifest.webmanifest')
        pg.evaluate("raw => localStorage.setItem('prioritizer.v1', raw)", json.dumps(legacy))
        pg.goto(SITE + '/')
        pg.wait_for_function('window.__prioritizer && document.querySelector("#syncBtn")', timeout=15000)
        pg.wait_for_timeout(1200)
        check('Docket opens on its own at the site root', pg.title() == 'Docket')
        check('it has the standalone top bar', pg.locator('.ws-bar .here').text_content() == 'Docket')
        check('only its test hook is left on window', pg.evaluate(GLOBALS) == ['__prioritizer'])
        check('with no Workshop, it uses browser storage', pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js');
          const ws = await connect({app: 'prioritizer'}); return ws.mode + '/' + ws.backend; }""") == 'browser/browser')
        check('the old browser board moves in on first load', pg.evaluate(titles) == want)
        stored = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').get('prioritizer/tasks'); q.onsuccess = () => res(q.result); }; })""")
        check('the board is saved as a prioritizer.tasks envelope, the format Workshop reads', stored and stored['schema'] == 'prioritizer.tasks' and len(stored['items']) == len(want))
        check('the old copy is kept, and marked as moved', pg.evaluate("localStorage.getItem('prioritizer.v1') !== null && localStorage.getItem('prioritizer.v1.moved') !== null"))

        pg.evaluate("() => { const P = window.__prioritizer; P.state.tasks = P.state.tasks.filter(t => t.id !== 't7'); P.commit(); return P.saved(); }")
        pg.reload(); pg.wait_for_function('window.__prioritizer', timeout=15000); pg.wait_for_timeout(1200)
        check('it moves only once: a deleted task stays deleted after reload', pg.evaluate(titles) == [t for t in want if t != 'Untriaged idea'])

        pg.click('#syncBtn'); pg.wait_for_timeout(200)
        menu = pg.inner_text('.menu')
        check('the file menu says the board is saved in this browser', 'Saved in this browser' in menu and 'Download a backup' in menu)
        pg.keyboard.press('Escape')
        with pg.expect_download() as dl: pg.evaluate('window.__prioritizer.downloadBackup()')
        path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
        with open(path) as f: bundle = json.load(f)
        check('a backup is a Workshop bundle with all four collections', bundle['schema'] == 'workshop.bundle'
              and sorted(c['collection'] for c in bundle['collections']) == ['lists', 'people', 'settings', 'tasks'])

        pg.wait_for_function('navigator.serviceWorker.controller !== null || navigator.serviceWorker.getRegistration().then(r => !!r)', timeout=10000)
        scope = pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r && r.scope)")
        check('it registers its own service worker for the whole site', scope == SITE + '/')
        pg.wait_for_timeout(1500)
        cached = pg.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(all => all.flat().map(r => new URL(r.url).pathname))")
        check('the service worker precaches the files app.json lists', '/js/people.js' in cached and '/shared/workshop-sdk.js' in cached and '/icons/favicon.svg' in cached)
        check('no errors on the page', errors == [])
        if errors: print('\n'.join('  ' + e for e in errors))
        b.close()
    srv.shutdown()
    print(f'\n{len(failed)} failed' if failed else '\nAll checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
