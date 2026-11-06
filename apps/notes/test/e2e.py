#!/usr/bin/env python3
"""Notes on its own, in headless Chrome: this repo served as a static site, the way notes.alexisdavidson.org
serves it, with no Workshop agent. Checks that the page loads with no errors, saves in the browser, makes notes
from templates, opens today's note, renders ws: links as chips, keeps and restores history, imports a folder of
Markdown, survives a reload, and works offline through its service worker.

  pip install playwright && python -m playwright install chromium
  python test/e2e.py

Notes inside Workshop (sending action items to Docket, Home's Recent notes) is checked by Workshop's
tests/e2e.py, which runs against a checkout of this repo. Exit 1 if any check fails."""
import functools, http.server, os, re, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8813
SITE = f'http://127.0.0.1:{PORT}/'
# Asked for by the SDK on every static site: no agent on this origin, no registry. Not errors here.
# The starter templates in js/templates.js (STARTERS), counted from the source so a new one needs no edit here.
with open(os.path.join(ROOT, 'js', 'templates.js')) as _f:
    STARTERS = len(re.findall(r"^\s+(?:'templates/[a-z0-9-]+\.md'|\[PRODUCT_TPL\]):", _f.read(), re.M))
EXPECTED_404 = ('/api/health', '/apps/registry.json')


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def write_vault(root):
    """A small Obsidian-style vault: spaces and capitals in names, a wikilink, an embed and a hidden folder."""
    v = os.path.join(root, 'My Vault')
    os.makedirs(os.path.join(v, 'Projects')); os.makedirs(os.path.join(v, '.obsidian'))
    with open(os.path.join(v, 'Projects', 'Q4 Plan.md'), 'w') as f: f.write('# Q4 Plan\n\n## Big Goals\n\nShip it.\n')
    with open(os.path.join(v, 'Daily.md'), 'w') as f: f.write('See [[Q4 Plan#Big Goals|the plan]].\n')
    with open(os.path.join(v, '.obsidian', 'app.json'), 'w') as f: f.write('{}')
    return v


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tmp = tempfile.mkdtemp(prefix='notes-e2e-')
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context()
            pg = ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('response', lambda r: errors.append(f'{r.status} {r.url}') if r.status >= 400 and not r.url.endswith(EXPECTED_404) else None)

            pg.goto(SITE)
            pg.wait_for_selector('.side-head', timeout=15000)
            check('the page loads with the top bar', pg.is_visible('.ws-bar'))
            check('the sidebar foot says notes are saved in this browser', 'in this browser' in pg.inner_text('.side-foot'))

            pg.keyboard.press('t'); pg.wait_for_timeout(800)
            check("T opens today's note under daily/", 'daily/' in pg.inner_text('#head'))

            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            check('New note opens a blank note right away, with no dialog',
                  pg.locator('dialog[open]').count() == 0 and pg.input_value('#editor') == '# \n\n')
            check("a note made while today's note is open goes at the top, not in daily/", pg.inner_text('#head').startswith('untitled.md'))
            pg.click('[data-act=starters]'); pg.wait_for_timeout(800)
            check('the starter templates are added and the blank note offers them', pg.locator('[data-act=use-template]').count() == STARTERS)
            pg.fill('#editor', '# Team Sync\n\n'); pg.wait_for_timeout(300)
            check('the template offer shows names', 'Meeting notes' in pg.inner_text('#head'))
            pg.click('[data-act=use-template][data-tpl="templates/meeting.md"]'); pg.wait_for_timeout(800)
            txt = pg.input_value('#editor')
            check('a note from the meeting template keeps the title typed', txt.startswith('# Team Sync') and '## Action items' in txt)
            check('once the note has a body, the template offer goes away', pg.locator('[data-act=use-template]').count() == 0)

            pg.fill('#editor', '# Team Sync\n\n- [ ] Draft the rollout plan\n- Shipped the cache #win\n\nSee [the task](ws:prioritizer/task/t_1)\n')
            pg.keyboard.press('Control+s'); pg.wait_for_timeout(1200)
            check('a ws: link shows as a chip with the app name', pg.locator('#preview .app-link .app-chip').inner_text().lower() == 'docket')
            check('on its own and not paired, there are no send buttons', pg.locator('[data-act=send]').count() == 0)

            check('the panel offers the earlier version', '1 earlier version' in pg.inner_text('#panel'))
            pg.click('[data-act=history]'); pg.wait_for_selector('dialog[open] .history')
            check('History shows the earlier version', 'Action items' in pg.inner_text('.ver-preview'))
            pg.click('dialog[open] button[value=ok]'); pg.wait_for_timeout(1200)
            check('restoring brings back the earlier text', '## Attendees' in pg.input_value('#editor'))
            check('restoring keeps the replaced text: two versions now', '2 earlier versions' in pg.inner_text('#panel'))
            check('history/ is not in the tree', pg.locator('#side [data-folder="history"]').count() == 0)
            check('templates show by name in the tree, not {{title}}', 'Meeting notes' in pg.inner_text('#side') and '{{title}}' not in pg.inner_text('#side'))

            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            check('leaving a new note names its file from the title', pg.locator('#side li.note[data-path="team-sync.md"]').count() == 1
                  and pg.locator('#side li.note[data-path="untitled.md"]').count() == 1)
            pg.fill('#editor', '# Scratch\n\nA line.\n'); pg.wait_for_timeout(300)
            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            pg.click('#side li.note[data-path="team-sync.md"] a.row'); pg.wait_for_timeout(800)
            check('a new note left blank goes to the trash', pg.locator('#side li.note[data-path^="untitled"]').count() == 0)
            pg.hover('#side li.note[data-path="scratch.md"]')
            pg.click('#side li.note[data-path="scratch.md"] [data-act=trash-path]'); pg.wait_for_selector('dialog[open]')
            pg.click('dialog[open] button[value=ok]'); pg.wait_for_timeout(800)
            check('a note can be trashed from its row in the sidebar', pg.locator('#side li.note[data-path="scratch.md"]').count() == 0)

            vault = write_vault(tmp)
            with pg.expect_file_chooser() as fc:
                pg.click('[data-act=import]')
            fc.value.set_files(vault)
            pg.wait_for_selector('dialog[open] .renames')
            renames = pg.inner_text('dialog[open] .renames')
            check('the import lists every rename first', 'my-vault/projects/q4-plan.md' in renames and 'my-vault/daily.md' in renames)
            check('the import leaves hidden folders out', '.obsidian' not in renames)
            pg.click('dialog[open] button[value=ok]'); pg.wait_for_timeout(1500)
            pg.evaluate("location.hash = '#/my-vault/daily.md'"); pg.wait_for_timeout(1000)
            ed = pg.input_value('#editor')
            check('an imported wikilink now points at the new path', '[the plan](projects/q4-plan.md#big-goals)' in ed)
            if '[the plan]' not in ed: print('      head:', pg.inner_text('#head')[:80].replace('\n', ' '), '| editor:', ed[:120].replace('\n', ' '))

            pg.goto(SITE + '#/today'); pg.reload(); pg.wait_for_selector('.side-head'); pg.wait_for_timeout(1000)
            check("the address #/today opens today's note on Notes' own site", 'daily/' in pg.inner_text('#head'))
            check('after a reload, the notes are still there', pg.locator('#side').inner_text().lower().count('team sync') >= 1)

            pg.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller !== null', timeout=15000)
            check('the service worker controls the page', True)
            ctx.set_offline(True)
            pg.reload(); pg.wait_for_selector('.side-head', timeout=15000)
            check('offline, the page still loads from the service worker', pg.is_visible('.side-head'))
            ctx.set_offline(False)

            check('no page errors or failed requests', not errors)
            if errors: print('      ' + '\n      '.join(errors[:8]))
            b.close()
    finally:
        srv.shutdown()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
