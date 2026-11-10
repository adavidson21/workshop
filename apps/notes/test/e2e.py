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
# The diagram starters in js/diagram-kits.js (KITS), as [id, code], read from the source.
with open(os.path.join(ROOT, 'js', 'diagram-kits.js')) as _f:
    KITS = re.findall(r"\{ id: '([a-z0-9-]+)'.*?code: '((?:[^'\\]|\\.)*)' \}", _f.read(), re.S)


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def wait_js(pg, expr, timeout=15000):
    """Poll a JS expression until it is truthy. (wait_for_function evaluates a string, which the page's CSP refuses.)"""
    for _ in range(timeout // 100):
        if pg.evaluate(expr): return True
        pg.wait_for_timeout(100)
    return False


def fill_editor(pg, text):
    """Replace the note's text, as typing would (CodeMirror's editable element)."""
    pg.fill('.cm-content', text)
    pg.wait_for_timeout(150)


def write_vault(root):
    """A small Obsidian-style vault: spaces and capitals in names, a wikilink, an embed and a hidden folder."""
    v = os.path.join(root, 'My Vault')
    os.makedirs(os.path.join(v, 'Projects')); os.makedirs(os.path.join(v, '.obsidian'))
    with open(os.path.join(v, 'Projects', 'Q4 Plan.md'), 'w') as f: f.write('# Q4 Plan\n\n## Big Goals\n\nShip it.\n')
    with open(os.path.join(v, 'Daily.md'), 'w') as f: f.write('See [[Q4 Plan#Big Goals|the plan]].\n')
    with open(os.path.join(v, '.obsidian', 'app.json'), 'w') as f: f.write('{}')
    return v


LIVE_DOC = """# Live check

Some **bold**, `code`, a [missing link](nowhere.md), [web](https://example.com) and #ops.

- [ ] open task
- plain bullet

| a | b |
|---|---|
| 1 | 2 |

> [!NOTE] Heads up
> callout body

```mermaid
graph TD
  A-->B
```

End.
"""


def live_checks(b):
    """Live, the default view in a fresh browser: Markdown hidden off the cursor's line, blocks drawn in place,
    tasks, tags and links that act on a click; and both sidebars folding away, remembered after a reload."""
    lc = b.new_context(viewport={'width': 1400, 'height': 900})
    pg = lc.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(SITE); pg.wait_for_selector('.side-head', timeout=15000)
    pg.click('#side [data-act=new-note]'); pg.wait_for_timeout(800)
    check('Live is the default view in a fresh browser', 'mode-live' in pg.get_attribute('#body', 'class') and pg.locator('.cm-editor.live').count() == 1)
    check('a new note\'s Title hint sits on the Live heading line', pg.is_visible('#title-hint') and 'lp' in (pg.get_attribute('#title-hint', 'class') or ''))
    fill_editor(pg, LIVE_DOC)
    pg.keyboard.press('Control+s'); pg.wait_for_timeout(800)
    pg.click('.nb-name'); pg.wait_for_timeout(800)
    lines = pg.evaluate("[...document.querySelectorAll('.cm-line')].map(l => l.textContent)")
    check('Live hides Markdown marks when the editor is not focused', lines[0] == 'Live check' and '**' not in lines[2] and '`' not in lines[2])
    check('Live sizes headings', pg.locator('.cm-line.lp-h1').count() == 1)
    check('Live draws the table, callout and diagram in place', pg.locator('.lp-block table').count() == 1 and pg.locator('.lp-block .callout').count() == 1 and pg.locator('.lp-block figure.diagram').count() == 1)
    check('Live draws a diagram as SVG', wait_js(pg, "!!document.querySelector('.lp-block figure.diagram .diagram-out svg')"))
    check('Live marks a link to a missing note', pg.locator('.lp-link.missing').count() == 1)
    pg.evaluate("document.querySelector('.cm-scroller').scrollTop = 0"); pg.wait_for_timeout(300)
    pg.click('.cm-line >> nth=2', position={'x': 3, 'y': 8}); pg.wait_for_timeout(300)
    check('a click in Live puts the cursor there, with no selection', pg.evaluate("(r => r.length === 1 && r[0].empty)(document.getElementById('editor').editor.view.state.selection.ranges)"))
    check('the line the cursor is on shows its Markdown', '**bold**' in pg.evaluate("document.querySelectorAll('.cm-line')[2].textContent"))
    pg.click('.lp-box'); pg.wait_for_timeout(1200)
    check('ticking a box in Live changes that line and saves', '- [x] open task' in pg.input_value('#editor') and 'saved' in pg.inner_text('#head .status').lower())
    pg.click('.lp-block td >> nth=0'); pg.wait_for_timeout(300)
    check('clicking a drawn table shows its Markdown to edit', pg.locator('.lp-block table').count() == 0 and any(l.startswith('| a |') for l in pg.evaluate("[...document.querySelectorAll('.cm-line')].map(l => l.textContent)")))
    pg.click('.nb-name'); pg.wait_for_timeout(300)
    pg.click('.lp-tag'); pg.wait_for_timeout(400)
    check('clicking a #tag in Live searches for it', pg.input_value('[data-search]') == 'tag:ops')
    pg.fill('[data-search]', ''); pg.wait_for_timeout(300)
    check('Ctrl+E goes from Live to Edit', (pg.click('.cm-content'), pg.keyboard.press('Control+e'), pg.wait_for_timeout(200), 'mode-edit' in pg.get_attribute('#body', 'class'))[-1])
    pg.click('[data-mode=live]'); pg.wait_for_timeout(200)

    check('every New note button uses the same plus icon', pg.evaluate(
        "(() => { const svgs = [...document.querySelectorAll('[data-act=new-note] svg, [data-act=new-note-in] svg')].map(s => s.innerHTML); return svgs.length >= 1 && new Set(svgs).size === 1; })()"))
    pg.keyboard.press('Control+Backslash'); pg.wait_for_timeout(300)
    pg.keyboard.press('Control+Shift+Backslash'); pg.wait_for_timeout(300)
    check('Ctrl+\\ and Ctrl+Shift+\\ fold the pages list and the page panel away', not pg.is_visible('#side') and not pg.is_visible('#panel'))
    check('with both folded, the note takes the full width', pg.evaluate("document.getElementById('main').getBoundingClientRect().width") > 1300)
    pg.reload(); pg.wait_for_selector('.side-head', state='attached'); pg.wait_for_timeout(1200)
    check('the folded sidebars stay folded after a reload', not pg.is_visible('#side') and not pg.is_visible('#panel'))
    pg.click('[data-act=side]'); pg.click('[data-act=panel]'); pg.wait_for_timeout(300)
    check('the fold buttons bring both back', pg.is_visible('#side') and pg.is_visible('#panel'))
    check('Live: no page errors', not errs)
    if errs: print('      ' + '\n      '.join(errs[:5]))
    lc.close()


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tmp = tempfile.mkdtemp(prefix='notes-e2e-')
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context()
            # Most checks read the preview beside the editor, so this browser starts in Split (Live, the default,
            # has its own checks in live_checks below).
            ctx.add_init_script("try { if (!localStorage.getItem('notes.live-default')) { localStorage.setItem('notes.live-default', '1'); localStorage.setItem('notes.mode', 'split'); } } catch (e) {}")
            ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=SITE.rstrip('/'))
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

            sizes = pg.evaluate("[document.documentElement.scrollHeight, window.innerHeight]")
            check('the notebook fits under the top bar: nothing below the window', sizes[0] <= sizes[1])
            check('section tabs show, and today\'s note opened the Daily section', pg.locator('.sec.on').inner_text().strip().startswith('Daily'))
            check('the Tandem section is hidden with no Workshop on this computer', pg.locator('.sec-tandem').count() == 0)

            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            check('New note opens a blank note right away, with no dialog',
                  pg.locator('dialog[open]').count() == 0 and pg.input_value('#editor') == '# \n\n')
            check("a note made while today's note is open goes at the top, not in daily/", pg.inner_text('#head').startswith('untitled.md'))
            check('the empty title line shows a faint Title hint', pg.is_visible('#title-hint'))
            check('the starter templates are offered with no extra step', pg.locator('[data-act=use-template]').count() == STARTERS)
            check('each template has a pencil to change it', pg.locator('#head [data-act=edit-template]').count() == STARTERS)
            pg.focus('.cm-content'); pg.keyboard.press('End'); pg.keyboard.type('# Team Sync'); pg.wait_for_timeout(300)
            check('typing "# " again on the title line keeps one #', pg.input_value('#editor').startswith('# Team Sync\n'))
            check('the template offer shows names', 'Meeting notes' in pg.inner_text('#head'))
            pg.click('[data-act=use-template][data-tpl="templates/meeting.md"]'); pg.wait_for_timeout(800)
            txt = pg.input_value('#editor')
            check('a note from the meeting template keeps the title typed', txt.startswith('# Team Sync') and '## Action items' in txt)
            check('once the note has a body, the template offer goes away', pg.locator('[data-act=use-template]').count() == 0)

            fill_editor(pg, '# Team Sync\n\n- [ ] Draft the rollout plan\n- Shipped the cache #win\n\nSee [the task](ws:prioritizer/task/t_1)\n')
            pg.keyboard.press('Control+s'); pg.wait_for_timeout(1200)
            check('a ws: link shows as a chip with the app name', pg.locator('#preview .app-link .app-chip').inner_text().lower() == 'docket')
            check('on its own and not paired, there are no send buttons', pg.locator('[data-act=send]').count() == 0)
            check('a plain bullet beside a task keeps its marker', pg.evaluate("getComputedStyle(document.querySelector('#preview li[data-line=\"3\"]')).listStyleType") != 'none')
            pg.click('#preview input[data-task="2"]'); pg.wait_for_timeout(1200)
            check('ticking a box in the preview changes that line and saves', '- [x] Draft the rollout plan' in pg.input_value('#editor') and 'saved' in pg.inner_text('#head .status').lower())
            pg.click('#preview input[data-task="2"]'); pg.wait_for_timeout(1200)

            pg.click('[data-mode=preview]'); pg.wait_for_timeout(300)
            pg.dblclick('#preview li[data-line="3"]'); pg.wait_for_timeout(400)
            check('double-clicking the preview opens the editor on that line',
                  pg.evaluate("document.activeElement.classList.contains('cm-content')") and pg.evaluate("(e => e.value.slice(0, e.selectionStart).split('\\n').length - 1)(document.getElementById('editor').editor)") == 3)
            check('double-clicking the preview switches to Live', 'mode-live' in pg.get_attribute('#body', 'class'))
            pg.click('[data-mode=split]'); pg.wait_for_timeout(300)

            pg.click('#head [data-act=menu]'); pg.wait_for_timeout(200)
            check('the ⋯ menu holds Copy, Download, Rename and Save as template', all(x in pg.inner_text('.menu') for x in ['Copy Markdown', 'Download', 'Rename', 'Save as template']))
            pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
            check('Escape closes the menu', pg.locator('.menu').count() == 0)

            check('the panel offers the earlier version', '1 earlier version' in pg.inner_text('#panel'))
            pg.click('#panel [data-act=history]'); pg.wait_for_selector('dialog[open] .history')
            check('History shows the earlier version', 'Action items' in pg.inner_text('.ver-preview'))
            pg.click('dialog[open] button[value=ok]'); pg.wait_for_timeout(1200)
            check('restoring brings back the earlier text', '## Attendees' in pg.input_value('#editor'))
            check('history/ is not in the tree', pg.locator('#side [data-folder="history"]').count() == 0)

            pg.click('.sec-templates'); pg.wait_for_timeout(400)
            check('the Templates section lists templates by name, starters too, not {{title}}', 'Meeting notes' in pg.inner_text('#side') and 'Retro' in pg.inner_text('#side') and '{{title}}' not in pg.inner_text('#side'))
            pg.click('#side [data-edit-template="templates/retro.md"]'); pg.wait_for_timeout(1000)
            check('opening a starter template writes its file and shows name and description boxes', pg.inner_text('#head').startswith('templates/retro.md') and pg.locator('[data-tpl-field=name]').count() == 1)
            pg.fill('[data-tpl-field=name]', 'Team retro'); pg.wait_for_timeout(1200)
            check('the Name box writes template: to the frontmatter', pg.input_value('#editor').startswith('---\ntemplate: Team retro\n---'))
            check('the preview shows placeholders as chips', pg.locator('#preview .ph').count() >= 1)
            pg.click('.sec-notes'); pg.wait_for_timeout(300)

            pg.click('#side li.note[data-path="team-sync.md"] a.row'); pg.wait_for_timeout(600)
            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            check('leaving a new note names its file from the title', pg.locator('#side li.note[data-path="team-sync.md"]').count() == 1
                  and pg.locator('#side li.note[data-path="untitled.md"]').count() == 1)
            fill_editor(pg, '# Scratch\n\nA line.\n'); pg.wait_for_timeout(300)
            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            pg.click('#side li.note[data-path="team-sync.md"] a.row'); pg.wait_for_timeout(800)
            check('a new note left blank goes to the trash', pg.locator('#side li.note[data-path^="untitled"]').count() == 0)
            pg.hover('#side li.note[data-path="scratch.md"]')
            pg.click('#side li.note[data-path="scratch.md"] [data-act=trash-path]'); pg.wait_for_timeout(800)
            check('a note nothing links to is trashed in one click, no dialog', pg.locator('dialog[open]').count() == 0 and pg.locator('#side li.note[data-path="scratch.md"]').count() == 0)

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

            # Diagrams: every starter draws under the page's CSP; a broken one shows its error; the toolbar exports.
            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            body = '# Diagrams\n\n' + ''.join('```mermaid\n' + code.encode().decode('unicode_escape') + '\n```\n\n' for _, code in KITS) + '```mermaid\nflowchart LR\n  A -->\n```\n'
            fill_editor(pg, body)
            wait_js(pg, f"document.querySelectorAll('#preview figure.diagram.drawn').length >= {len(KITS)}", 30000)
            drawn = pg.evaluate("[...document.querySelectorAll('#preview figure.diagram')].map(f => f.classList.contains('drawn') && !!f.querySelector('.diagram-out svg'))")
            check(f'all {len(KITS)} diagram starters draw as SVG', drawn[:len(KITS)] == [True] * len(KITS))
            if drawn[:len(KITS)] != [True] * len(KITS): print('      not drawn:', [k for (k, _), d in zip(KITS, drawn) if not d], pg.evaluate("[...document.querySelectorAll('.diagram-err')].map(e => e.textContent.slice(0, 120))"))
            pg.wait_for_selector('#preview figure.diagram.has-error', timeout=15000)
            check('a broken diagram shows its source and the error', pg.locator('#preview figure.diagram.has-error .diagram-err').count() == 1
                  and pg.locator('#preview figure.diagram.has-error .diagram-src').is_visible())
            first = pg.locator('#preview figure.diagram').first
            first.hover()
            with pg.expect_download() as dl:
                first.locator('[data-diagram-act=png]').click()
            check('a diagram downloads as a PNG', dl.value.suggested_filename.endswith('.png') and open(dl.value.path(), 'rb').read(8) == b'\x89PNG\r\n\x1a\n')
            with pg.expect_download() as dl:
                first.locator('[data-diagram-act=svg]').click()
            check('a diagram downloads as an SVG', open(dl.value.path()).read().lstrip().startswith('<?xml') and '<svg' in open(dl.value.path()).read())
            line = body.split('\n').index('sequenceDiagram')
            pg.evaluate(f"(() => {{ const e = document.getElementById('editor').editor; const at = e.value.split('\\n').slice(0, {line + 2}).join('\\n').length; e.focus(); e.setSelectionRange(at, at); e.dispatchEvent(new KeyboardEvent('keyup')); }})()")
            pg.wait_for_timeout(200)
            check('Split view highlights the diagram the cursor is in', pg.evaluate("document.querySelector('#preview figure.diagram.at-cursor')?.textContent.includes('Click save') || document.querySelector('#preview figure.diagram.at-cursor .diagram-src')?.textContent.includes('sequenceDiagram')") is True)
            fill_editor(pg, '# Diagrams\n\nBefore.\n')
            pg.evaluate("(() => { const e = document.getElementById('editor').editor; e.focus(); e.setSelectionRange(e.value.length, e.value.length); })()")
            pg.keyboard.type('x'); pg.keyboard.press('Backspace')
            pg.click('#head [data-act=menu]')
            check('clicking ⋯ right after typing opens the menu', pg.locator('.menu').count() == 1)
            pg.click('.menu [data-act=insert-diagram]'); pg.wait_for_selector('dialog[open] .kit-grid')
            pg.click('dialog[open] [data-kit=erd]'); pg.wait_for_timeout(300)
            check('Insert diagram puts a starter in on lines of its own', '\nBefore.\n\n```mermaid\nerDiagram\n' in pg.input_value('#editor'))
            pg.wait_for_selector('#preview figure.diagram.drawn', timeout=15000)
            check('the inserted diagram draws', pg.locator('#preview figure.diagram.drawn svg').count() >= 1)

            # Developer docs: syntax colors and Copy on code, callouts, footnotes, [[# heading links, search filters.
            fill_editor(pg, '# Dev\n\n## Setup steps\n\n```sql\nselect id from users\n```\n\n> [!WARNING]\n> Careful.\n\nText[^1].\n\n[^1]: A foot note.\n\n')
            pg.keyboard.press('Control+s'); pg.wait_for_timeout(900)
            check('code blocks get syntax colors and a Copy button', pg.locator('#preview pre .tok-k').count() >= 2 and pg.locator('#preview pre .code-copy').count() == 1)
            check('a > [!WARNING] block is a callout', pg.locator('#preview .callout-warning .callout-title').inner_text() == 'Warning')
            check('footnotes are numbered and listed at the end', pg.locator('#preview sup.fn-ref').inner_text() == '1' and 'A foot note.' in pg.inner_text('#preview .footnotes'))
            pg.evaluate("(() => { const e = document.getElementById('editor').editor; e.focus(); e.setSelectionRange(e.value.length, e.value.length); })()")
            pg.keyboard.type('See [[#setup'); pg.wait_for_timeout(300)
            check('[[# lists this note\'s headings', pg.is_visible('#picker') and 'Setup steps' in pg.inner_text('#picker'))
            pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
            check('choosing a heading writes a link to it', pg.input_value('#editor').rstrip().endswith('See [Setup steps](#setup-steps)'))
            pg.keyboard.press('Control+s'); pg.wait_for_timeout(900)
            pg.fill('#side [data-search]', 'has:code'); pg.wait_for_timeout(400)
            check('search has:code finds notes with code blocks', 'Dev' in pg.inner_text('#side') and 'Diagrams' not in pg.inner_text('#side'))
            pg.fill('#side [data-search]', 'lang:sql'); pg.wait_for_timeout(400)
            check('search lang:sql finds the note with a sql block', 'Dev' in pg.inner_text('#side'))
            pg.fill('#side [data-search]', ''); pg.wait_for_timeout(300)

            # The editor (CodeMirror): Enter continues a list, the slash menu, Ctrl+B, Format table and undo, Ctrl+F.
            to_end = "(() => { const e = document.getElementById('editor').editor; e.focus(); e.setSelectionRange(e.value.length, e.value.length); })()"
            check('the editor is CodeMirror', pg.locator('#body .cm-editor .cm-content').count() == 1 and not pg.is_visible('textarea#editor'))
            fill_editor(pg, '# Keys\n\n- one'); pg.evaluate(to_end)
            pg.keyboard.press('Enter'); pg.keyboard.type('two'); pg.wait_for_timeout(200)
            check('Enter continues a list', pg.input_value('#editor').endswith('- one\n- two'))
            pg.keyboard.press('Enter'); pg.keyboard.press('Enter'); pg.keyboard.type('/tab'); pg.wait_for_timeout(300)
            check('/ at the start of a line opens the slash menu', pg.is_visible('#picker') and 'Table' in pg.inner_text('#picker'))
            pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
            check('choosing Table puts a table in', '| Column | Column |\n| --- | --- |' in pg.input_value('#editor') and '/tab' not in pg.input_value('#editor'))
            fill_editor(pg, '# Keys\n\nmake this bold\n')
            pg.evaluate("(() => { const e = document.getElementById('editor').editor; e.focus(); e.setSelectionRange(13, 17); })()")
            pg.keyboard.press('Control+b'); pg.wait_for_timeout(200)
            check('Ctrl+B makes the selection bold', 'make **this** bold' in pg.input_value('#editor'))
            fill_editor(pg, '# Keys\n\n|a|bb|\n|-|-|\n|ccc|d|\n')
            pg.evaluate("(() => { const e = document.getElementById('editor').editor; e.focus(); e.setSelectionRange(10, 10); })()")
            pg.keyboard.press('Control+Alt+t'); pg.wait_for_timeout(200)
            check('Ctrl+Alt+T lines up the table', '| a   | bb  |\n| --- | --- |\n| ccc | d   |' in pg.input_value('#editor'))
            pg.keyboard.press('Control+z'); pg.wait_for_timeout(200)
            check('Ctrl+Z undoes it', '|a|bb|\n|-|-|' in pg.input_value('#editor'))
            pg.keyboard.press('Control+f'); pg.wait_for_timeout(300)
            check('Ctrl+F opens find and replace in the note', pg.locator('.cm-search').count() == 1)
            pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
            pg.keyboard.press('Control+s'); pg.wait_for_timeout(800)

            # Knowledge hub: an embed shows another note's section; the map opens linked notes; Download HTML; print.
            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            fill_editor(pg, '# Runbook\n\n## Steps\n\n1. Deploy it\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n## Roll back\n\nUndo it.\n')
            pg.keyboard.press('Control+s'); pg.wait_for_timeout(800)
            pg.click('[data-act=new-note]'); pg.wait_for_timeout(800)
            fill_editor(pg, '# Hub\n\n![[Runbook#Steps]]\n\nSee [the runbook](runbook.md).\n')
            pg.keyboard.press('Control+s'); pg.wait_for_timeout(900)
            emb = pg.inner_text('#preview .embed') if pg.locator('#preview .embed').count() else ''
            check('![[note#heading]] shows that section in place', 'Deploy it' in emb and 'Undo it' not in emb and 'Runbook › Steps' in emb)
            check('a diagram inside an embed draws', wait_js(pg, "!!document.querySelector('#preview .embed figure.diagram.drawn svg')"))
            pg.click('#head [data-act=menu]'); pg.click('.menu [data-act=map]'); pg.wait_for_selector('dialog[open] .map-view')
            check('the map draws the note and the notes it links to', wait_js(pg, "document.querySelectorAll('dialog[open] g.node').length >= 2"))
            # Copy for wiki: the embed is expanded, other-note links are text, the diagram is a PNG in the HTML.
            pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            pg.click('#head [data-act=copy-wiki]'); pg.wait_for_timeout(2500)
            clip = pg.evaluate("(async () => { const [it] = await navigator.clipboard.read(); return { md: await (await it.getType('text/plain')).text(), html: await (await it.getType('text/html')).text() }; })()")
            check('Copy for wiki expands embeds and makes note links text', '## Steps\n\n1. Deploy it' in clip['md'] and '![[' not in clip['md'] and 'See the runbook.' in clip['md'] and '```mermaid' in clip['md'])
            check('Copy for wiki HTML has the diagram as a PNG', '<img src="data:image/png;base64,' in clip['html'] and 'Deploy it' in clip['html'])
            pg.click('#head [data-act=menu]'); pg.click('.menu [data-act=map]'); pg.wait_for_selector('dialog[open] .map-view'); wait_js(pg, "document.querySelectorAll('dialog[open] g.node').length >= 2")
            pg.locator('dialog[open] g.node', has_text='Runbook').click(); pg.wait_for_timeout(800)
            check('clicking a note in the map opens it', pg.inner_text('#head').split()[0].endswith('runbook.md') and pg.locator('dialog[open]').count() == 0)
            pg.click('#head [data-act=menu]')
            with pg.expect_download() as dl:
                pg.click('.menu [data-act=download-html]')
            page = open(dl.value.path()).read()
            check('Download HTML saves one page with the diagram inside it', page.startswith('<!doctype html>') and 'Deploy it' in page and 'data:image/svg+xml;base64,' in page and '<script' not in page)
            pg.evaluate("(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; })()")
            pg.click('[data-mode=edit]'); pg.wait_for_timeout(200)
            pg.click('#head [data-act=menu]'); pg.click('.menu [data-act=print]'); pg.wait_for_timeout(1500)
            pg.emulate_media(media='print')
            check('Print shows only the note, drawn even from Edit view', pg.evaluate("window.__printed") == 1 and pg.is_visible('#preview') and not pg.is_visible('#side')
                  and not pg.is_visible('.cm-editor') and 'Deploy it' in pg.inner_text('#preview'))
            pg.emulate_media(media='screen'); pg.evaluate("window.dispatchEvent(new Event('afterprint'))")
            pg.click('[data-mode=split]'); pg.wait_for_timeout(300)

            pg.goto(SITE + '#/today'); pg.reload(); pg.wait_for_selector('.side-head'); pg.wait_for_timeout(1000)
            check("the address #/today opens today's note on Notes' own site", 'daily/' in pg.inner_text('#head'))
            pg.click('.sec-notes'); pg.wait_for_timeout(300)
            check('after a reload, the notes are still there', pg.locator('#side').inner_text().lower().count('team sync') >= 1)

            pg.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller !== null', timeout=15000)
            check('the service worker controls the page', True)
            ctx.set_offline(True)
            pg.reload(); pg.wait_for_selector('.side-head', timeout=15000)
            check('offline, the page still loads from the service worker', pg.is_visible('.side-head'))
            ctx.set_offline(False)

            phone = b.new_context(viewport={'width': 390, 'height': 844})
            pp = phone.new_page()
            pp.goto(SITE + '#/today'); pp.wait_for_selector('.side-head', state='attached'); pp.wait_for_timeout(1200)
            sizes = pp.evaluate("[document.documentElement.scrollHeight, window.innerHeight]")
            check('phone: the page fits the window', sizes[0] <= sizes[1])
            check('phone: #/today opens straight into the note, pages drawer closed', 'daily/' in pp.inner_text('#head') and not pp.is_visible('#side'))
            check('phone: no Split, one header row', pp.locator('[data-mode=split]').count() == 0 and pp.evaluate("document.querySelector('.note-head').getBoundingClientRect().height") < 70)
            pp.click('[data-act=drawer]'); pp.wait_for_timeout(400)
            check('phone: the pages button opens the drawer', pp.is_visible('#side'))
            pp.keyboard.press('Escape'); pp.wait_for_timeout(400)
            phone.close()

            live_checks(b)

            # Without the editor bundle, notes open in the plain textarea and still save.
            plain = b.new_context()
            pl = plain.new_page()
            plain_errors = []
            pl.on('pageerror', lambda e: plain_errors.append(str(e)))
            pl.route('**/vendor/codemirror.js', lambda r: r.abort())
            pl.goto(SITE); pl.wait_for_selector('.side-head', timeout=15000)
            pl.click('[data-act=new-note]'); pl.wait_for_timeout(800)
            check('without the editor bundle there is no Live view, and Split is the default', pl.locator('[data-mode=live]').count() == 0 and 'mode-split' in pl.get_attribute('#body', 'class'))
            pl.focus('#editor'); pl.keyboard.press('End'); pl.keyboard.type('Plain'); pl.keyboard.press('Control+s'); pl.wait_for_timeout(800)
            check('without the editor bundle, the textarea is the editor', pl.locator('.cm-editor').count() == 0 and pl.input_value('#editor').startswith('# Plain')
                  and 'saved' in pl.inner_text('#head .status').lower() and not plain_errors)
            plain.close()

            check('no page errors or failed requests', not errors)
            if errors: print('      ' + '\n      '.join(errors[:8]))
            b.close()
    finally:
        srv.shutdown()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
