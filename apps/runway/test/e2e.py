#!/usr/bin/env python3
"""Runway on its own, in headless Chrome: this repo served as a static site, the way runway.alexisdavidson.org
serves it, with no Workshop agent. Pastes an outline, drags and nudges items, exports PNG, SVG and Markdown,
reloads and checks it was saved, and checks text is escaped and the page logs no errors.

  pip install playwright && python -m playwright install chromium
  python test/e2e.py

Exit 1 if any check fails."""
import functools, http.server, json, os, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8814
SITE = f'http://127.0.0.1:{PORT}'


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


OUTLINE = """# E2E plan
scale: month
start: 2027-01-01

## Search
- Index rebuild | Jan-Feb 2027
- New ranking | 1 month | after: Index rebuild
- * Ranking live | 2027-04-15

## <script>window.__pwned=1</script>
- <img src=x onerror="window.__pwned=1"> | Mar 2027
- Not a date | someday
- Unscheduled idea
"""

R = 'window.__runway'


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=SITE)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        # The SDK probes /api/health for a Workshop agent on this site; its 404 is expected here.
        pg.on('console', lambda m: m.type == 'error' and not m.text.startswith('Failed to load resource') and errors.append(m.text))

        pg.goto(SITE + '/')
        pg.wait_for_function('() => window.__runway && window.__runway.store.v.loaded', timeout=15000)
        check('Runway opens on its own at the site root', pg.title() == 'Runway')
        check('it has the standalone top bar', pg.locator('.ws-bar .here').text_content() == 'Runway')
        check('with no Workshop, it saves in this browser', pg.evaluate(f'{R}.ws.mode + "/" + {R}.ws.backend') == 'browser/browser')
        pg.wait_for_selector('.engcard [data-new]', timeout=5000)
        check('an empty list offers a new roadmap and the example', pg.locator('.engcard [data-new]').count() == 1 and pg.locator('.engcard [data-example]').count() == 1)

        # New roadmap, then type the outline.
        pg.click('.engcard [data-new]')
        pg.wait_for_selector('[data-outline]')
        pg.fill('[data-outline]', OUTLINE)
        pg.wait_for_timeout(700)
        doc = lambda: pg.evaluate(f'JSON.parse(JSON.stringify({R}.store.v.doc))')
        d = doc()
        items = [i for i in d['items'] if i['kind'] == 'item']
        check('typing the outline builds lanes and items', [l['title'] for l in d['lanes']] == ['Search', '<script>window.__pwned=1</script>'] and len(items) == 5)
        check('a line it cannot read stays, with a warning', any(i['kind'] == 'text' and 'someday' in i['raw'] for i in d['items']) and 'someday' in pg.inner_text('.warns'))
        check('the title comes from the outline', pg.input_value('[data-title]') == 'E2E plan')
        check('the timeline draws a bar per scheduled item', pg.locator('[data-tl] g.bar').count() == 4)
        check('unscheduled items wait in the tray', pg.locator('[data-tray]').count() == 1)
        check('text is escaped on the page', pg.evaluate('window.__pwned') is None and pg.locator('[data-tl] script, [data-tl] img').count() == 0)
        check('a dependency arrow is drawn', pg.locator('[data-tl] path[d^="M"]').count() >= 2)

        # Drag "Index rebuild" one month later (month scale snaps to weeks).
        idx = next(i for i in items if i['title'] == 'Index rebuild')
        bar = pg.locator(f'[data-tl] g.bar[data-id="{idx["id"]}"] rect').first
        box = bar.bounding_box()
        px = pg.evaluate(f'{R}.ui.L.px')
        pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        pg.mouse.down()
        pg.mouse.move(box['x'] + box['width'] / 2 + 14 * px, box['y'] + box['height'] / 2, steps=8)
        pg.mouse.up()
        pg.wait_for_timeout(300)
        moved = next(i for i in doc()['items'] if i['id'] == idx['id'])
        check('dragging a bar moves it by whole weeks, keeping its length', (moved['start'], moved['end']) == ('2027-01-15', '2027-03-14'))
        check('the outline follows the timeline', 'Index rebuild | 2027-01-15..2027-03-14' in pg.input_value('[data-outline]'))
        check('the item is selected, with its panel open', pg.locator(f'[data-panel="{idx["id"]}"]').count() == 1)

        # Keyboard: Shift+Right lengthens by a week, Left moves back a week.
        pg.focus('[data-tl]')
        pg.keyboard.press('Shift+ArrowRight')
        pg.keyboard.press('ArrowLeft')
        pg.wait_for_timeout(200)
        k = next(i for i in doc()['items'] if i['id'] == idx['id'])
        check('arrow keys move, Shift and arrows change the end', (k['start'], k['end']) == ('2027-01-08', '2027-03-14'))
        sched = pg.evaluate(f'(() => {{ const b = {R}.ui.L.bars.find(b => b.item.title === "New ranking"); return [b.start, b.end]; }})()')
        check('an item sized "1 month after" follows what it depends on', sched == ['2027-03-15', '2027-04-14'])

        # Drag the unscheduled item from the tray onto the Search lane.
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(150)
        lane_y = pg.evaluate(f'(() => {{ const l = {R}.ui.L.lanes.find(l => l.title === "Search"); return l.y + 10; }})()')
        svg_box = pg.locator('[data-tl] svg').bounding_box()
        x = pg.evaluate(f'{R}.ui.L.x("2027-05-10")')
        pg.locator('[data-tray]').drag_to(pg.locator('[data-tl]'), target_position={'x': x, 'y': lane_y})
        pg.wait_for_timeout(300)
        u = next(i for i in doc()['items'] if i.get('title') == 'Unscheduled idea')
        check('dropping a tray item schedules it for that month, in that lane', u['start'] == '2027-05-01' and u['end'] == '2027-05-31' and u['lane'] == d['lanes'][0]['id'])

        # Panel edits: status and color.
        pg.select_option(f'[data-panel="{u["id"]}"] [data-f="status"]', 'at risk')
        pg.wait_for_timeout(150)
        check('the panel changes status', next(i for i in doc()['items'] if i['id'] == u['id'])['status'] == 'at risk')

        # Fold a lane, then export.
        pg.evaluate(f'(() => {{ const l = {R}.ui.L.lanes[1]; document.querySelector(`[data-tl] g.lane[data-lane="${{l.id}}"] rect`).dispatchEvent(new PointerEvent("pointerdown", {{bubbles: true, button: 0, pointerId: 9}})); document.querySelector("[data-tl]").dispatchEvent(new PointerEvent("pointerup", {{bubbles: true, pointerId: 9}})); }})()')
        pg.wait_for_timeout(200)
        check('clicking a lane name folds it', len(doc()['meta']['hidden']) == 1)

        pg.click('[data-export]')
        pg.wait_for_selector('dialog[open] [data-x="png"]')
        tmp = tempfile.mkdtemp()
        with pg.expect_download() as dl: pg.click('[data-x="png"]')
        png = os.path.join(tmp, dl.value.suggested_filename); dl.value.save_as(png)
        with open(png, 'rb') as f: head = f.read(8)
        check('PNG export downloads a real PNG named after the roadmap', head == b'\x89PNG\r\n\x1a\n' and dl.value.suggested_filename.startswith('e2e-plan-') and os.path.getsize(png) > 4000)
        with pg.expect_download() as dl: pg.click('[data-x="svg"]')
        svgp = os.path.join(tmp, dl.value.suggested_filename); dl.value.save_as(svgp)
        svgt = open(svgp).read()
        check('SVG export has the title and items, and leaves the folded lane out', 'E2E plan' in svgt and 'Index rebuild' in svgt and 'Not a date' not in svgt and '&lt;script' not in svgt and '<script' not in svgt)
        pg.check('dialog[open] [name="table"]')
        with pg.expect_download() as dl: pg.click('[data-x="md"]')
        mdp = os.path.join(tmp, dl.value.suggested_filename); dl.value.save_as(mdp)
        md = open(mdp).read()
        check('Markdown export is the outline plus a table', md.startswith('# E2E plan\n') and '- Not a date | someday' in md and '| Lane | Item | Start | End | Status | After |' in md)
        pg.click('[data-x="copy"]')
        pg.wait_for_timeout(200)
        check('Copy puts the Markdown on the clipboard', pg.evaluate('navigator.clipboard.readText()').startswith('# E2E plan'))
        pg.click('[data-x="folder"]')
        pg.wait_for_timeout(400)
        pg.keyboard.press('Escape')

        # Reload: everything was saved.
        pg.evaluate(f'{R}.flush()')
        pg.wait_for_timeout(300)
        rid = pg.evaluate(f'{R}.store.v.mapId')
        pg.reload()
        pg.wait_for_function('() => window.__runway && window.__runway.store.v.doc', timeout=15000)
        after = doc()
        check('after a reload the roadmap opens where it was, as saved', after['meta']['title'] == 'E2E plan' and next(i for i in after['items'] if i['id'] == idx['id'])['start'] == '2027-01-08')
        stored = pg.evaluate(f"""() => new Promise(res => {{ const r = indexedDB.open('workshop'); r.onsuccess = () => {{
          const q = r.result.transaction('data').objectStore('data').get('runway/maps/{rid}'); q.onsuccess = () => res(q.result); }}; }})""")
        check('it is saved as a runway.maps envelope, the format Workshop reads', stored and stored['schema'] == f'runway.maps/{rid}' and stored['version'] == 1)
        files = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => res(q.result); }; })""")
        check('Save to folder wrote exports/<id>.md', any(f'runway/exports/{rid}.md' in str(k) for k in files))

        # Back to the list, the example, and remove.
        pg.click('[data-home]')
        pg.wait_for_selector('.rlist')
        check('the list shows the roadmap', 'E2E plan' in pg.inner_text('.rlist'))
        pg.click('[data-example]')
        pg.wait_for_selector('[data-tl] g.bar')
        check('the example opens with no warnings', pg.locator('.warns').count() == 0 and pg.locator('[data-tl] g.bar').count() >= 8)
        pg.click('button[data-mode="timeline"]')
        pg.wait_for_timeout(150)
        check('Timeline mode hides the outline', not pg.is_visible('[data-outline]'))
        pg.click('button[data-mode="split"]')
        pg.click('[data-home]')
        pg.wait_for_selector('.rlist')
        pg.locator('[data-del]').first.click()
        pg.click('dialog[open] button[value="ok"]')
        pg.wait_for_timeout(300)
        check('Remove takes a roadmap off the list', pg.locator('.rrow').count() == 1)

        # Narrow screen still works.
        pg.set_viewport_size({'width': 390, 'height': 844})
        pg.locator('[data-open]').first.click()
        pg.wait_for_selector('[data-tl] g.bar')
        check('no horizontal page scroll on a phone', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))

        check('no page errors', not errors)
        if errors: print('\n'.join(errors))
        b.close()
    srv.shutdown()
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
