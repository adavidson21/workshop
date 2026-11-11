#!/usr/bin/env python3
"""End-to-end check of pop-out windows (?solo=<app>) in headless Chromium.

  pip install playwright && python -m playwright install chromium
  python tests/popout-e2e.py          (needs .remote/notes, like tests/e2e.py)

Browser mode on a static site (127.0.0.1:8822). Folio pops out into its own window on the note that was open,
the main window goes Home, links to other apps go back to the main window, and Back to Workshop closes it.
Exit 1 if any check fails.
"""
import functools, os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
e2e = import_module('e2e')

HUB = 'http://127.0.0.1:8822'
failed = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def frame_of(page, app):
    return next((f for f in page.frames if f'/apps/{app}/' in f.url), None)


def main():
    if not os.path.isfile(os.path.join(e2e.NOTES, 'app.json')):
        sys.exit(f'Folio is not checked out at {e2e.NOTES}. Run: git clone https://github.com/adavidson21/notes .remote/notes')
    e2e.serve(8822, functools.partial(e2e.Static, directory=e2e.ROOT))
    with sync_playwright() as p:
        b = p.chromium.launch(**({'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}))
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        errors = []
        ctx.on('page', lambda pg: pg.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | {pg.url}')))
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | {pg.url}'))

        pg.goto(HUB + '/'); pg.wait_for_timeout(800)
        check('the main window names itself, so pop-outs can find it', pg.evaluate('window.name') == 'workshop-main')
        check('the first app, at the plain address, has a pop-out button', pg.locator('#popBtn').is_visible())

        pg.goto(HUB + '/#/notes'); pg.wait_for_timeout(1500)
        nf = frame_of(pg, 'notes')
        check('Folio opens in the shell', nf is not None)
        check('the pop-out button shows on Folio and names it', pg.locator('#popBtn').is_visible() and 'Pop out Folio' in (pg.get_attribute('#popBtn', 'title') or ''))
        # A note to come back to: Folio remembers the last note per browser.
        nf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          await ws.files.write('popout-check.md', '# Popout check\\n\\nhello from the main window\\n', {create: true}); }""")
        pg.evaluate("location.hash = '#/notes/popout-check.md'"); pg.wait_for_timeout(1200)

        with ctx.expect_page() as pop_info:
            pg.click('#popBtn')
        pop = pop_info.value
        pop.wait_for_load_state(); pop.wait_for_timeout(2000)
        check('the pop-out opens Folio on its own address', '?solo=notes' in pop.url and pop.url.endswith('#/notes'))
        check('the pop-out has no rail', pop.locator('#rail').is_hidden())
        check('the pop-out shows the app name and a Back to Workshop button', pop.inner_text('#topbar .crumbs').strip().lower() == 'folio' and pop.locator('#popBtn').get_attribute('title') == 'Back to Workshop')
        pf = frame_of(pop, 'notes')
        check('the pop-out opens on the note that was open', pf is not None and 'hello from the main window' in pf.evaluate("document.body.innerText"))
        check('only Folio loads in the pop-out (no background apps)', [f.url for f in pop.frames if '/apps/' in f.url and '/apps/notes/' not in f.url] == [])
        pg.wait_for_timeout(300)
        check('the main window goes to the first rail app', pg.url == HUB + '/' and pg.title() == 'Docket · Workshop')

        # Another app from the pop-out opens in the main window; the pop-out stays on Folio.
        pop.evaluate("location.hash = '#/settings'"); pop.wait_for_timeout(1200)
        check('another app from the pop-out opens in the main window', pg.url.endswith('#/settings') and pop.url.endswith('#/notes'))

        # Popping out again reuses the same window (it has the same name).
        pg.evaluate("location.hash = '#/notes'"); pg.wait_for_timeout(800)
        before = len(ctx.pages)
        pg.click('#popBtn'); pg.wait_for_timeout(800)
        check('popping out again reuses the window', len(ctx.pages) == before)

        pop.click('#popBtn'); pg.wait_for_timeout(1200)
        check('Back to Workshop closes the pop-out and opens Folio in the main window', pop.is_closed() and pg.url.endswith('#/notes'))

        pg.goto(HUB + '/?solo=nothing'); pg.wait_for_timeout(1200)
        check('a pop-out for an app that is not here opens the main window', '?solo' not in pg.url and pg.locator('#rail').is_visible())

        check('no page errors', not errors)
        if errors: print('  ' + '\n  '.join(errors))
        b.close()
    print('\nAll checks passed.' if not failed else f'\n{len(failed)} failed.')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
