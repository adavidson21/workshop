#!/usr/bin/env python3
"""End-to-end check of the rail order (docs/apps.md, Rail order) in headless Chromium.

  pip install playwright && python -m playwright install chromium
  python tests/rail-e2e.py

Browser mode on a static site (127.0.0.1:8824). Alt+Shift+Up and Down on a focused rail button move it, a drag moves
it, Alt+<n> and the tooltips follow the new order, the order is in Settings' rail collection and survives a reload
(even with this browser's copy gone), another window follows, and Reset the rail order in Ctrl+K puts it back.
Exit 1 if any check fails.
"""
import functools, os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
e2e = import_module('e2e')

HUB = 'http://127.0.0.1:8824'
DEFAULT = ['tasks', 'people', 'notes', 'roadmaps', 'bench', 'chat', 'settings']  # Builds is a tab of Tasks (Builds 6.23.0)
failed = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def rail(pg):
    return pg.eval_on_selector_all('.app-btn[data-app]', 'els => els.map(e => e.dataset.app)')


SAVED = """async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'settings'});
  const env = await ws.data.get('rail'); return env ? env.meta.order : null; }"""


def main():
    e2e.serve(8824, functools.partial(e2e.Static, directory=e2e.ROOT))
    with sync_playwright() as p:
        b = p.chromium.launch(**({'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}))
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        errors = []
        ctx.on('page', lambda pg: pg.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | {pg.url}')))
        pg = ctx.new_page()

        pg.goto(HUB + '/'); pg.wait_for_timeout(1500)
        check('the rail starts in the usual order', rail(pg) == DEFAULT)
        check('each rail button says how to move it', pg.get_attribute('.app-btn[data-app=notes]', 'aria-describedby') == 'railHint'
              and 'Alt+Shift' in pg.evaluate("document.getElementById('railHint').textContent"))
        pg.keyboard.press('Control+k'); pg.wait_for_timeout(300); pg.keyboard.type('reset the rail'); pg.wait_for_timeout(200)
        check('no Reset the rail order in Ctrl+K while the order is the usual one', pg.locator('.cmdk-empty').count() == 1)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

        # Keyboard: Notes up once (third since Builds became a tab of Tasks), then Settings to the top with Home.
        pg.focus('.app-btn[data-app=notes]')
        pg.keyboard.press('Alt+Shift+ArrowUp')
        pg.wait_for_timeout(300)
        check('Alt+Shift+Up moves the focused app up', rail(pg)[:4] == ['tasks', 'notes', 'people', 'roadmaps'])
        check('the moved button keeps focus', pg.evaluate("document.activeElement.dataset.app") == 'notes')
        pg.wait_for_timeout(200)
        check('a screen reader hears where it went', pg.inner_text('#railSay') == 'Notes moved to place 2 of 7.')
        check('the tooltip renumbers Alt+<n>', pg.get_attribute('.app-btn[data-app=notes]', 'title') == 'Notes (Alt+2)'
              and pg.get_attribute('.app-btn[data-app=people]', 'title') == 'People (Alt+3)')
        pg.focus('.app-btn[data-app=tasks]'); pg.keyboard.press('Alt+Shift+ArrowUp'); pg.wait_for_timeout(200)
        check('the first app does not move further up', rail(pg)[0] == 'tasks' and pg.inner_text('#railSay') == 'Tasks is already first.')

        pg.keyboard.press('Alt+2'); pg.wait_for_timeout(1200)
        check('Alt+2 opens the second app on the rail, now Notes', pg.url.endswith('#/notes'))

        # Drag: Bench above Tasks.
        pg.drag_and_drop('.app-btn[data-app=bench]', '.app-btn[data-app=tasks]', target_position={'x': 20, 'y': 5})
        pg.wait_for_timeout(600)
        want = ['bench', 'tasks', 'notes', 'people', 'roadmaps', 'chat', 'settings']
        check('dragging a button moves it', rail(pg) == want)
        check('a drag leaves nothing faded', pg.locator('.app-btn.dragging').count() == 0)
        check('the order is saved in Settings\' rail collection', pg.evaluate(SAVED) == want)

        # Reload with this browser's copy gone: the data has it.
        pg.evaluate("localStorage.removeItem('workshop.railOrder')")
        pg.goto(HUB + '/'); pg.wait_for_timeout(2000)
        check('the order survives a reload, from the data', rail(pg) == want)
        check('Workshop opens on the first app on the rail', pg.title() == 'Bench · Workshop')

        # Another window follows a move.
        other = ctx.new_page(); other.goto(HUB + '/#/settings'); other.wait_for_timeout(2000)
        check('another window opens in the same order', rail(other) == want)
        pg.focus('.app-btn[data-app=settings]'); pg.keyboard.press('Alt+Shift+Home'); pg.wait_for_timeout(1500)
        check('Alt+Shift+Home moves an app first', rail(pg)[0] == 'settings')
        check('another window follows the move', rail(other)[0] == 'settings')
        other.close()

        # Reset from the palette.
        pg.keyboard.press('Control+k'); pg.wait_for_timeout(300)
        pg.keyboard.type('reset the rail'); pg.wait_for_timeout(200); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
        check('Reset the rail order puts the usual order back', rail(pg) == DEFAULT and pg.evaluate(SAVED) == [])
        check('Alt+1 is Tasks again', pg.get_attribute('.app-btn[data-app=tasks]', 'title') == 'Tasks (Alt+1)')

        check('no page errors', not errors)
        for e in errors: print('   ', e)
        b.close()
    if failed:
        print(f'\n{len(failed)} failed'); sys.exit(1)
    print('\nall rail checks passed')


if __name__ == '__main__':
    main()
