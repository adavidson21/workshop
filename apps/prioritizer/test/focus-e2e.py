#!/usr/bin/env python3
"""Docket with focus hours and lunch (Workshop docs/focus.md), on its own site in headless Chrome, with a fake clock.

  python test/focus-e2e.py

Monday 9 November 2026. Settings' focus hours (09:00 to 12:00, lunch 12:00 to 13:00) are written here through the
SDK as Workshop's Settings would. Checks: with focus hours off Docket looks as before; during focus the Inbox folds
to a rail that still counts captures, Needs you shows only PRs blocked on you; the summary's day.focus, day.lunch
and blocking cards; the Maker/Manager template and "Overlaps lunch"; where I left off. Exit 1 if any check fails."""
import datetime, functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8813
SITE = f'http://127.0.0.1:{PORT}'
P = 'window.__prioritizer'


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def at(hh, mm=0):
    return datetime.datetime(2026, 11, 9, hh, mm, 0)


SETTINGS = """async on => {
  const {connect} = await import('/shared/workshop-sdk.js');
  const F = await import('/shared/focus.js');
  const ws = await connect({app: 'settings'});
  const env = await ws.data.get('focus');
  const meta = Object.assign(F.defaults(), {enabled: on});
  await ws.data.put('focus', Object.assign({schema: 'settings.focus', version: 1, rev: env ? env.rev : 0, items: [], deleted: {}}, env || {}, {meta}));
  return true;
}"""
SUMMARY = """async () => {
  const {connect} = await import('/shared/workshop-sdk.js');
  const ws = await connect({app: 'home'});
  const env = await ws.data.get('summary', {app: 'prioritizer'});
  return env ? env.items : [];
}"""


def add_tasks(pg, tasks):
    """Adds tasks with every field Docket's own Add a task gives them."""
    pg.evaluate("""tasks => { const P = window.__prioritizer, s = P.state, l = s.lists[0].id;
      let rank = s.tasks.reduce((m, t) => Math.max(m, t.rank || 0), 0);
      for (const o of tasks) s.tasks.push(Object.assign({title: '', notes: '', color: 'sage', rank: ++rank, value: 2, effort: 'S', due: null, urgentFlag: false,
        listId: l, done: false, doneAt: null, wontDo: false, createdAt: '2026-11-09', ageFrom: '2026-11-09', waiting: false, nudgeOn: null, focusOn: null, who: []}, o));
      P.commit(); }""", tasks)


def jsclick(pg, sel):
    """A click by the element itself: Playwright's own waits for animation frames, which the paused clock holds."""
    pg.evaluate("s => document.querySelector(s).click()", sel)


def view(pg, key):
    """Switches view by its number key, from outside any field (the triage card may hold the focus)."""
    # The Day view is no longer in the sidebar (Docket 9.0.0): Today's Plan the day opens it.
    if key == '2':
        jsclick(pg, '#snav [data-nav="today"]'); jsclick(pg, '#phead [data-view="day"]')
    else:
        jsclick(pg, '#snav [data-nav="today"]')


def tick(pg, ms=61000):
    pg.clock.run_for(ms); pg.wait_for_timeout(400)


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome') if os.path.exists('/usr/bin/google-chrome') and not os.environ.get('CI') else p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1360, 'height': 860})
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.clock.install(time=at(8, 29)); pg.clock.pause_at(at(8, 30))
        pg.goto(SITE + '/'); tick(pg, 3000)
        pg.wait_for_function('() => window.__prioritizer && document.querySelector("#syncBtn")', timeout=15000)
        # A board: an Inbox task, a PR blocked on you, a follow-up due.
        add_tasks(pg, [
            {'id': 'in1', 'title': 'Untriaged idea', 'value': None, 'effort': None},
            {'id': 'pr1', 'title': 'PR 41: Fix the login timeout', 'value': 4, 'pr': {'key': 'https://dev.example.com|Proj|41', 'id': 41, 'repo': 'web', 'project': 'Proj', 'author': 'Dev', 'tier': 'blocking', 'via': [], 'waiting': False, 'lastBlocker': False, 'url': 'https://dev.example.com/pr/41'}},
            {'id': 'nd1', 'title': 'Ask about the release', 'waiting': True, 'nudgeOn': '2026-11-01'},
            {'id': 'wk1', 'title': 'Write the parser', 'value': 3, 'effort': 'M', 'focusOn': '2026-11-09'}])
        tick(pg, 2000)
        view(pg, '1'); tick(pg, 1000)

        # Focus hours off: as before.
        check('focus hours off: the Inbox is a full column', pg.locator('.col-inbox:not(.rail)').count() == 1)
        check('focus hours off: the blocking PR is pinned in Today\'s Reviews, nothing held', 'blocked on you' in pg.inner_text('.treviews') and pg.locator('.treviews.held').count() == 0 and pg.locator('.needs').count() == 0)

        # Focus hours on, 10:00: the Inbox folds, Needs you holds all but the blocking PR.
        pg.evaluate(SETTINGS, True); tick(pg, 2000)
        pg.clock.pause_at(at(10, 0)); tick(pg)
        check('during focus the Inbox folds to a rail with its count and when it comes back', pg.locator('.col-inbox.rail.held').count() == 1 and pg.inner_text('.col-inbox.rail .num').strip() == '1' and 'until 1:00' in pg.inner_text('.col-inbox.rail'))
        check('during focus the blocking PR still shows in Reviews (it breaks through)', 'blocked on you' in pg.inner_text('.treviews') and pg.locator('.treviews.held').count() == 0)
        add_tasks(pg, [{'id': 'in2', 'title': 'Captured during focus', 'value': None, 'effort': None}]); tick(pg, 1500)
        check('a capture during focus still lands in the Inbox and counts on the rail', pg.inner_text('.col-inbox.rail .num').strip() == '2')
        jsclick(pg, '.col-inbox.rail [data-inbox-anyway]'); tick(pg, 500)
        if os.environ.get('DEBUG'): print('INBOX:', pg.evaluate("() => document.querySelector('.col-inbox').outerHTML.slice(0, 300)"))
        check('the rail opens the Inbox anyway', pg.locator('.col-inbox:not(.rail)').count() == 1)

        # The summary for Workshop: blocking PRs and the held card.
        items = pg.evaluate(SUMMARY)
        blocking = next((c for c in items if c['id'] == 'blocking'), None)
        check('the summary has PRs blocked on you', blocking is not None and [r['id'] for r in blocking['rows']] == ['pr1'])

        # Day plan: the Maker/Manager template from Settings' times, and "Overlaps lunch".
        view(pg, '2'); tick(pg, 800)
        if pg.locator('#dpSetup').count():
            pg.evaluate("() => { document.querySelector('#dpSetup [name=example]').checked = false; }"); jsclick(pg, '#dpSetup button.primary'); tick(pg, 800)
        if os.environ.get('DEBUG'): print('DAY:', pg.evaluate(f'{P}.state.view'), pg.inner_text('#main')[:400])
        check('with no templates the Day view offers the Maker/Manager template', pg.locator('[data-dp=maker]').count() == 1)
        jsclick(pg, '[data-dp=maker]'); tick(pg, 4000)
        secs = pg.evaluate(f"() => {P}.dayModel.dayView({P}.dp, '2026-11-09').rec.sections.map(s => [s.kind, s.around, s.minutes])")
        check('the template is built from Settings: focus 09:00 for 180, lunch 12:00 for 60', secs[:2] == [['focus', '09:00', 180], ['lunch', '12:00', 60]] and len(secs) == 4)
        items = pg.evaluate(SUMMARY)
        day = next(c for c in items if c['id'] == 'day')['days']['2026-11-09']
        check('the summary day has focus and lunch from the Day plan', day.get('focus') == [{'start': '09:00', 'end': '12:00'}] and day.get('lunch') == {'start': '12:00', 'end': '13:00'})
        pg.evaluate(f"""() => {{ const d = '2026-11-09'; {P}.dayModel.addSection({P}.dp, d, {{name: 'Standup', kind: 'meetings', around: '11:45', minutes: 30, color: 'sky'}}); {P}.render(); }}"""); tick(pg, 600)
        check('a meetings block over lunch shows Overlaps lunch', 'Overlaps lunch' in pg.inner_text('.dayplan'))

        # Where I left off: working on a task when focus runs into lunch.
        view(pg, '1'); tick(pg, 600)
        pg.evaluate(f"() => {P}.openDrawer('wk1')"); tick(pg, 400)
        jsclick(pg, '#drawer [data-d=focus-start]'); tick(pg, 400)
        pg.keyboard.press('Escape'); tick(pg, 300)
        pg.clock.pause_at(at(12, 0)); tick(pg, 3000)
        check('when focus runs into lunch, Today asks where you left off', pg.locator('.leftoff[data-asking]').count() == 1 and 'Write the parser' in pg.inner_text('.leftoff'))
        pg.fill('.leftoff input', 'Tokens done; <b>next</b> the grammar'); pg.press('.leftoff input', 'Enter'); tick(pg, 800)
        lo = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === 'wk1').leftOff")
        check('it is saved on the task as leftOff', lo is not None and lo['text'] == 'Tokens done; <b>next</b> the grammar')
        check('back on the task, it shows at the top of Today, escaped', pg.locator('.leftoff:not([data-asking])').count() == 1 and pg.locator('.leftoff b').count() == 0 and '<b>next</b>' in pg.inner_text('.leftoff'))
        pg.evaluate(f"() => {P}.openDrawer('wk1')"); tick(pg, 400)
        check('the drawer shows it too', 'Tokens done' in pg.inner_text('#drawer'))
        pg.keyboard.press('Escape'); tick(pg, 300)
        # During lunch the strip folds entirely.
        check('during lunch Reviews folds to one line (nothing breaks through lunch)', pg.locator('.treviews.held').count() == 1 and 'held until 1:00' in pg.inner_text('.treviews') and pg.locator('.treviews .row').count() == 0)
        jsclick(pg, '.row[data-id="wk1"] [data-act="done"]'); tick(pg, 800)
        lo = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === 'wk1').leftOff")
        check('marking the task done clears it', lo is None)
        pg.clock.pause_at(at(13, 0)); tick(pg, 2000)
        check('after lunch the Inbox and Reviews are back', pg.locator('.col-inbox:not(.rail)').count() == 1 and pg.locator('.treviews:not(.held) .row').count() == 1)

        check('no page errors', not errors)
        for e in errors: print('  ', e)
        b.close()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
