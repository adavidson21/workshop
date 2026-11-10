#!/usr/bin/env python3
"""Layout check (docs/layout.md): every app at half a screen (960), a laptop (1440), full HD (1920) and a large
screen (2560), in browser mode on a static copy of the site, with a little data so pages are not empty.

  pip install playwright && python -m playwright install chromium
  git clone https://github.com/adavidson21/docket .remote/prioritizer    # and runway, receipts, notes
  python tests/layout-e2e.py

Fails when an app's page scrolls sideways (a board may scroll inside its own area), or when a list page grows past
its width token. Screenshots go to tests/out/layout/ (CI keeps them as an artifact). Exit 1 if any check fails.
"""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REMOTE = {a: os.environ.get(f'{a.upper()}_DIR') or os.path.join(ROOT, '.remote', a) for a in ('prioritizer', 'runway', 'receipts', 'notes')}
OUT = os.path.join(ROOT, 'tests', 'out', 'layout')
SIZES = [(960, 1000), (1440, 900), (1920, 1080), (2560, 1440)]
APPS = ['home', 'prioritizer', 'slate', 'agents', 'receipts', 'notes', 'runway', 'settings']
# List and form pages: their content stays inside --w-page plus gutters (88rem at 1920, 104rem at 2560).
CAPPED = {'settings': '.wrap', 'agents': '.wrap'}


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        for app, folder in REMOTE.items():
            if clean.startswith(f'/apps/{app}/'):
                rest = clean[len(f'/apps/{app}/'):]
                return os.path.join(folder, *[p for p in rest.split('/') if p and p not in ('.', '..')])
        return super().translate_path(path)


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def frame_of(pg, app):
    return next((f for f in pg.frames if f'/apps/{app}/' in f.url), None)


def seed(pg):
    """A few tasks in Docket and a roadmap in Runway, through their own pages."""
    pg.evaluate("location.hash = '#/prioritizer'"); pg.wait_for_timeout(2500)
    f = frame_of(pg, 'prioritizer')
    if f:
        skip = f.locator('[data-skip]')
        if skip.count() and skip.first.is_visible(): skip.first.click(); f.wait_for_timeout(200)
        f.evaluate("""() => { const P = window.__prioritizer; if (!P) return; const L = P.state.lists[0].id;
          ['Review the capacity plan', 'Fix the login redirect loop', 'Write the onboarding doc', 'Prep the sprint review'].forEach((title, i) =>
            P.state.tasks.push({ id: 'lay' + i, title, listId: L, value: 3, effort: 'M', created: '2026-11-02' }));
          P.state = P.sanitize(P.state); P.commit(); }""")
    pg.evaluate("location.hash = '#/runway'"); pg.wait_for_timeout(2000)
    f = frame_of(pg, 'runway')
    if f and f.locator('[data-example]').count(): f.click('[data-example]'); f.wait_for_timeout(800)


def main():
    missing = [a for a, d in REMOTE.items() if not os.path.isdir(d)]
    if missing:
        print('Missing checkouts in .remote/: ' + ', '.join(missing)); sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8812), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None)
        for w, h in SIZES:
            ctx = b.new_context(viewport={'width': w, 'height': h})
            pg = ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto('http://127.0.0.1:8812/'); pg.wait_for_timeout(2500)
            seed(pg)
            for app in APPS:
                pg.evaluate(f"location.hash = '#/{app}'"); pg.wait_for_timeout(1800)
                pg.screenshot(path=os.path.join(OUT, f'{app}-{w}.png'))
                f = pg if app == 'home' and not frame_of(pg, 'home') else frame_of(pg, app)
                if not f: check(f'{app} at {w}: opens', False); continue
                over = f.evaluate('() => document.documentElement.scrollWidth - document.documentElement.clientWidth')
                check(f'{app} at {w}: the page does not scroll sideways', over <= 1)
                if app in CAPPED:
                    width = f.evaluate(f"() => {{ const el = document.querySelector('{CAPPED[app]}'); return el ? el.getBoundingClientRect().width : 0; }}")
                    cap = {960: 10**6, 1440: 72 * 16 + 56, 1920: 88 * 16 + 72, 2560: 104 * 16 + 88}[w]
                    check(f'{app} at {w}: stays inside its page width ({int(width)}px)', width <= cap + 1)
            check(f'no page errors at {w}', not errors)
            if errors: print('\n'.join(errors[:5]))
            ctx.close()
        b.close()
    print(f'\n{len(failed)} failed' if failed else '\nAll layout checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
