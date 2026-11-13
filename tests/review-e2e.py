#!/usr/bin/env python3
"""End-to-end check of Dispatch's code review screen (apps/slate/review.html) in headless Chromium.

  pip install playwright && python -m playwright install chromium
  python tests/review-e2e.py

Serves this repo as a static site and opens review.html?mock=1, which uses mockReviewApi
(apps/slate/js/dispatch/review-api.js) instead of the opencode connector, under the page's real CSP. Covers the
spec's acceptance criteria for the screen: line and range selection, the comment box, gutter markers and
the Review panel, drafts surviving a refresh, the request changes payload, revision 2 with the agent's
answers and "changes since last review", a stale head, approve, deep links and the theme.
Exit 1 if any check fails.
"""
import functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8811
BASE = f'http://127.0.0.1:{PORT}/apps/slate/review.html?mock=1'
failures = []


LAST = {'name': 'start'}


def check(name, ok):
    LAST['name'] = name
    print(('ok    ' if ok else 'FAIL  ') + name)
    if not ok:
        failures.append(name)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def side(pg, which):
    return pg.locator(f'.monaco-diff-editor .editor.{which}')


def gutter(pg, which, n):
    # Monaco draws each line number as a .line-numbers element in the margin.
    return side(pg, which).locator('.margin-view-overlays .line-numbers').filter(has_text=str(n)).locator('xpath=self::*[normalize-space(.)="%d"]' % n).first


def open_file(pg, name):
    pg.locator('.rv-file', has_text=name).click()
    pg.wait_for_function('() => !document.querySelector("#rv-diff").hidden && document.querySelector(".monaco-diff-editor .editor.modified .view-lines")?.textContent.length > 0')
    pg.wait_for_timeout(300)


def main():
    srv = serve()
    problems = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        pg = ctx.new_page()

        def on_console(m):
            # The SDK looks for a local Workshop agent; a static server answers 404 to that.
            if m.type == 'error' and 'status of 404' not in m.text:
                problems.append(m.text[:300])
        pg.on('console', on_console)
        pg.on('pageerror', lambda e: problems.append(f"pageerror after '{LAST['name']}': {str(e)[:200]} {(getattr(e, 'stack', '') or '')[:600]}"))

        pg.goto(BASE)
        pg.wait_for_selector('.monaco-diff-editor', timeout=30000)
        check('page loads the sample review with the work item title', 'Round order totals' in pg.locator('.rv-title').inner_text())
        badges = pg.eval_on_selector_all('.rv-file .rv-badge', 'els => els.map(e => e.textContent)')
        check('three changed files with status badges R, A, M', sorted(badges) == ['A', 'M', 'R'])
        check('top bar shows branch, base, revision and file count', all(t in pg.locator('.rv-meta').inner_text() for t in ['dev/feature/L1-round-order-totals', 'origin/main', 'Revision 1', '3 files']))
        check('Request changes starts disabled', pg.locator('[data-act=request]').is_disabled())

        # Click a line number, then shift-click another: the range is selected and the box opens under it.
        open_file(pg, 'totals.ts')
        gutter(pg, 'modified', 4).click()
        gutter(pg, 'modified', 9).click(modifiers=['Shift'])
        pg.wait_for_selector('.rv-form textarea[name=body]')
        check('click then shift-click selects the range (hash is linkable)', pg.evaluate('location.hash') == '#file=src/orders/totals.ts&L=4-9')
        check('selected lines stay highlighted while the box is open', side(pg, 'modified').locator('.rv-sel').count() >= 1)
        check('box names the file and range', 'src/orders/totals.ts L4-9' in pg.locator('.rv-form .rv-range').inner_text())
        check('Must fix is the default type', 'on' in pg.locator('.rv-form .rv-tchip.t-must_fix').get_attribute('class'))
        pg.locator('.rv-form .rv-tchip.t-suggestion').click()
        pg.locator('.rv-form [name=body]').fill('Round once, at the end.')
        pg.locator('.rv-form [data-act=c-suggest]').click()  # the box redraws, so check the new element
        pg.wait_for_selector('.rv-form [name=suggested]')
        check('Suggest change stays on and keeps the text typed so far', pg.locator('.rv-form [data-act=c-suggest]').is_checked() and pg.locator('.rv-form [name=body]').input_value() == 'Round once, at the end.')
        code = pg.locator('.rv-form [name=suggested]').input_value()
        check('Suggest change prefills the selected lines', code.startswith('export function orderTotal') and code.rstrip().endswith('return roundMoney(total);'))
        pg.locator('.rv-form [name=body]').press('Control+Enter')
        pg.wait_for_selector('.rv-card')
        check('Ctrl+Enter saves the comment as a collapsed card', pg.locator('.rv-card').count() == 1 and pg.locator('.rv-form').count() == 0)
        check('saved comment shows a gutter marker', side(pg, 'modified').locator('.rv-cglyph').count() == 1)
        check('saved comment is in the Review panel', 'L4-9' in pg.locator('.rv-entry').first.inner_text())
        check('file shows its comment count', pg.locator('.rv-file.on .rv-ccount').inner_text() == '1')

        # Esc cancels a new box.
        gutter(pg, 'modified', 13).click()
        pg.wait_for_selector('.rv-form')
        pg.locator('.rv-form [name=body]').press('Escape')
        check('Esc cancels', pg.locator('.rv-form').count() == 0)

        # C opens a comment on the cursor line; old-side comments are allowed side by side.
        side(pg, 'original').locator('.view-line').nth(10).click()
        pg.keyboard.press('c')
        pg.wait_for_selector('.rv-form')
        check('C opens a comment on the cursor line', 'L11' in pg.locator('.rv-form .rv-range').inner_text())
        pg.locator('.rv-form .rv-tchip.t-question').click()
        pg.locator('.rv-form [name=body]').fill('Why not round the tax here as well?')
        pg.locator('.rv-form button[type=submit]').click()
        pg.wait_for_function('() => document.querySelectorAll(".rv-card").length === 2')
        check('old-side comment saved', '(old)' in pg.locator('.rv-panel').inner_text())

        # Refresh keeps the drafts.
        pg.reload()
        pg.wait_for_selector('.rv-entry')
        check('refresh keeps every draft comment', pg.locator('.rv-entry').count() == 2)

        # Clicking a panel entry jumps to the lines and opens the card.
        open_file(pg, 'rounding.ts')
        pg.locator('.rv-entry', has_text='L4-9').click()
        pg.wait_for_selector('.rv-card.open')
        check('panel entry opens its file and expands the card', pg.locator('.rv-file.on .rv-name').inner_text() == 'totals.ts' and 'Round once' in pg.locator('.rv-card.open').inner_text())

        # Edit and delete from the card.
        pg.locator('.rv-card.open [data-act=c-edit]').click()
        pg.locator('.rv-form [name=body]').fill('Round once, at the end of orderTotal.')
        pg.locator('.rv-form button[type=submit]').click()
        pg.wait_for_function('() => !document.querySelector(".rv-form")')
        check('editing keeps the id and updates the text', 'at the end of orderTotal' in pg.locator('.rv-panel').inner_text() and pg.locator('.rv-entry').count() == 2)

        # Request changes sends one payload with every comment and its quoted code.
        pg.locator('#rv-summary').fill('Close. Two things to look at.')
        check('Request changes is enabled with comments', pg.locator('[data-act=request]').is_enabled())
        pg.locator('[data-act=request]').click()
        pg.locator('.rv-banner', has_text='revising').wait_for()
        fb = pg.evaluate('window.__reviewMock.lastFeedback')
        by = {c['id']: c for c in fb['comments']}
        check('one payload with every comment', fb['verdict'] == 'request_changes' and len(fb['comments']) == 2 and fb['summary'] == 'Close. Two things to look at.')
        check('quoted code is the exact new-side lines', by['c1']['quotedCode'].startswith('export function orderTotal') and by['c1']['quotedCode'].endswith('return roundMoney(total);') and by['c1']['side'] == 'new' and (by['c1']['startLine'], by['c1']['endLine']) == (4, 9))
        check('suggested code and the chosen type are sent', 'suggestedCode' in by['c1'] and by['c1']['type'] == 'suggestion')
        check('old-side quote is line 11 of the base file', by['c2']['side'] == 'old' and by['c2']['startLine'] == 11 and by['c2']['quotedCode'] == 'export function orderTax(order: Order, rate: number): number {' and by['c2']['type'] == 'question')
        check('the item moves to revising and verdict buttons go away', pg.locator('[data-act=request]').count() == 0)

        # The mock agent returns revision 2.
        pg.locator('.rv-meta', has_text='Revision 2').wait_for(timeout=10000)
        check('revision 2 starts with an empty draft', pg.locator('.rv-entry[data-act=jump]').count() == 0)
        prev = pg.locator('.rv-prev').inner_text().lower()
        check('previous comments show as resolved with the agent\'s answers', 'fixed' in prev and 'answered' in prev and pg.locator('.rv-resolved').count() == 2)
        check('"Changes since last review" toggle is offered', pg.locator('[data-act=since]').count() == 1)
        pg.locator('[data-act=since]').click()
        pg.wait_for_function('() => document.querySelectorAll(".rv-file").length === 1')
        open_file(pg, 'totals.ts')
        left = side(pg, 'original').locator('.view-lines').inner_text().replace('\xa0', ' ')
        check('since last review: only the new commit\'s files, left side is the last reviewed head', 'Math.round(tax * 100)' in left)
        pg.locator('[data-act=since]').click()
        pg.wait_for_function('() => document.querySelectorAll(".rv-file").length === 3')
        check('default is base to new head again', True)

        # A stale head is refused and the draft is kept.
        open_file(pg, 'rounding.ts')
        gutter(pg, 'modified', 2).click()
        pg.wait_for_selector('.rv-form')
        pg.locator('.rv-form [name=body]').fill('Name the rounding mode.')
        pg.locator('.rv-form [name=body]').press('Control+Enter')
        pg.evaluate('window.__reviewMock.moveHead("shop-api")')
        pg.locator('[data-act=request]').click()
        pg.wait_for_selector('.rv-banner.bad')
        check('stale head: clear error, nothing sent, draft kept', 'changed since this review was loaded' in pg.locator('.rv-banner.bad').inner_text() and pg.locator('.rv-entry[data-act=jump]').count() == 1)

        # Approve with drafts asks first. Approve only approves; pushing is its own button with the shared git confirm.
        check('the approve button only approves', pg.locator('[data-act=approve]').inner_text() == 'Approve')
        check('nothing is pushed before Approve', pg.evaluate('window.__reviewMock.pushes.length') == 0)
        pg.locator('[data-act=approve]').click()
        check('approve with drafts asks before discarding them', pg.locator('.rv-confirm').count() == 1)
        pg.locator('[data-act=approve-confirm]').click()
        pg.wait_for_selector('[data-act=push]')
        check('Approve pushes nothing', pg.evaluate('window.__reviewMock.lastFeedback.verdict') == 'approve'
              and pg.evaluate('window.__reviewMock.pushes.length') == 0 and 'not pushed yet' in pg.locator('.rv-banner.ok').inner_text())
        check('Push to origin carries the git mark', pg.locator('[data-act=push] .out-mark[data-out=git]').count() == 1)
        pg.locator('[data-act=push]').click()
        pg.wait_for_selector('dialog.out-dialog[open]')
        check('the push confirm says it changes the git remote, with Cancel focused',
              'Changes the git remote' in pg.locator('dialog.out-dialog .out-banner').inner_text()
              and pg.evaluate('() => document.activeElement && document.activeElement.dataset.act') == 'cancel')
        pg.locator('dialog.out-dialog [data-act=cancel]').click()
        pg.wait_for_function('() => !document.querySelector("dialog.out-dialog")')
        check('Cancel pushes nothing', pg.evaluate('window.__reviewMock.pushes.length') == 0)
        pg.evaluate('window.__reviewMock.failNextPush()')
        pg.locator('[data-act=push]').click()
        pg.locator('dialog.out-dialog [data-out-ok]').click()
        pg.wait_for_selector('.rv-banner.bad')
        check('a failed push keeps the verdict and says so', pg.evaluate('window.__reviewMock.lastFeedback.verdict') == 'approve'
              and 'push did not go through' in pg.locator('.rv-banner.bad').inner_text() and pg.locator('[data-act=approve]').count() == 0)
        pg.locator('[data-act=push]').click()
        pg.locator('dialog.out-dialog [data-out-ok]').click()
        pg.locator('.rv-banner.ok', has_text='Approved and pushed').wait_for()
        check('Push to origin retries, and the branch is pushed once', pg.evaluate('window.__reviewMock.pushes') == ['shop-api'] and pg.locator('[data-act=push]').count() == 0)

        # The repo switcher.
        check('repo switcher lists both repos', pg.eval_on_selector_all('[data-act=repo] option', 'els => els.map(e => e.value)') == ['shop-api', 'shop-web'])

        # A deep link opens that file with the lines selected.
        pg.goto(BASE + '#file=src/orders/rounding.ts&L=2-3')
        pg.wait_for_selector('.monaco-diff-editor')
        pg.wait_for_function('() => document.querySelector(".rv-file.on .rv-name")?.textContent === "rounding.ts"')
        pg.wait_for_selector('.monaco-diff-editor .editor.modified .rv-sel')
        check('deep link opens the file and selects the lines', True)

        # Inline view, theme, and the panel toggle, on a fresh load (a new mock review).
        pg.goto('about:blank')
        pg.goto(BASE)
        pg.wait_for_selector('.monaco-diff-editor')
        pg.locator('[data-act=layout][data-v=inline]').click()
        check('inline view says where comments go', 'Inline view' in pg.locator('#rv-banner').inner_text())
        pg.locator('.theme-toggle').click()
        pg.wait_for_timeout(300)
        check('dark theme reaches the editor', pg.evaluate('document.documentElement.dataset.theme') == 'dark' and pg.locator('.monaco-editor.vs-dark').count() > 0)
        pg.locator('[data-act=panel]').click()
        check('review panel collapses', pg.locator('#rv-panel').is_hidden())
        pg.screenshot(path=os.path.join(os.environ.get('SHOT_DIR', '.'), 'review-e2e.png')) if os.environ.get('SHOT_DIR') else None

        check('no page errors or CSP violations', not problems)
        for msg in problems:
            print('      ' + msg)
        b.close()
    srv.shutdown()
    if failures:
        print(f'\n{len(failures)} failed')
        sys.exit(1)
    print('\nall review checks passed')


if __name__ == '__main__':
    main()
