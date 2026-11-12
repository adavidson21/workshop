#!/usr/bin/env python3
"""B7 (docs/shared.md): Workshop works with any one app switched off.

  pip install playwright && python -m playwright install chromium
  python tests/switches-e2e.py        (apps from another repo need .remote/<id>, like tests/e2e.py)

Browser mode on a static site (127.0.0.1:8823). For each app that can be switched off, a fresh browser with only
that app off (Settings' browser switch, localStorage workshop.appsOff): the app is gone from the rail, every other
app still opens, the Needs you panel and the capture bar still open, its address lands somewhere else, and no page
throws. Exit 1 if any check fails.
"""
import functools, json, os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
e2e = import_module('e2e')

HUB = 'http://127.0.0.1:8823'
failed = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def frame_of(page, app):
    return next((f for f in page.frames if f'/apps/{app}/' in f.url), None)


def switchable():
    """Rail apps that Settings can switch off: not the panel app, not Settings, not one marked home."""
    with open(os.path.join(e2e.ROOT, 'apps', 'registry.json'), encoding='utf-8') as f:
        apps = json.load(f)['apps']
    out = []
    for a in apps:
        m = a['manifest']
        if m.get('panel') or m.get('home') or m['id'] == 'settings': continue
        if m.get('modes') and 'browser' not in m['modes']: continue
        base = a.get('base', '')
        here = os.path.join(e2e.ROOT, base.strip('/'), 'app.json')
        remote = os.path.join(e2e.ROOT, '.remote', m['id'], 'app.json')
        if not (os.path.isfile(here) or os.path.isfile(remote)): continue
        out.append((m['id'], m['name']))
    return out


def main():
    apps = switchable()
    if len(apps) < 2: sys.exit('Fewer than two apps to check. Are the .remote/ checkouts there?')
    e2e.serve(8823, functools.partial(e2e.Static, directory=e2e.ROOT))
    with sync_playwright() as p:
        b = p.chromium.launch(**({'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}))
        for off, name in apps:
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
            ctx.add_init_script(f"try {{ localStorage.setItem('workshop.appsOff', JSON.stringify([{json.dumps(off)}])); }} catch (e) {{}}")
            errors = []
            pg = ctx.new_page()
            pg.on('pageerror', lambda e, pg=pg: errors.append(f'{str(e)[:300]} | {pg.url}'))
            pg.goto(HUB + '/'); pg.wait_for_timeout(1200)
            rail = pg.eval_on_selector_all('#rail .app-btn', 'els => els.map(e => e.dataset.app)')
            check(f'{name} off: it is not on the rail', off not in rail and len(rail) > 0)
            others = [a for a, _ in apps if a != off and a in rail]
            opened = []
            for other in others:
                pg.evaluate(f"location.hash = '#/{other}'"); pg.wait_for_timeout(1500)
                if frame_of(pg, other) is not None: opened.append(other)
            check(f'{name} off: every other app still opens ({", ".join(others)})', opened == others)
            if pg.locator('#panelBtn').count():
                pg.click('#panelBtn'); pg.wait_for_timeout(1200)
                check(f'{name} off: the Needs you panel opens', pg.locator('#spanel').is_visible())
                pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            pg.click('#capBtn'); pg.wait_for_timeout(500)
            check(f'{name} off: the capture bar opens', pg.locator('.capture').first.is_visible())
            pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            pg.evaluate(f"location.hash = '#/{off}'"); pg.wait_for_timeout(1200)
            check(f'{name} off: its address does not open it', frame_of(pg, off) is None)
            check(f'{name} off: no page errors', not errors)
            for e in errors: print('   ', e)
            ctx.close()
        b.close()
    print('\nAll checks passed.' if not failed else f'\n{len(failed)} check(s) failed.')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
