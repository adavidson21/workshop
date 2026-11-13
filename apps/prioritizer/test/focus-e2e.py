#!/usr/bin/env python3
"""Docket with focus hours and lunch (Workshop docs/focus.md), on its own site in headless Chrome, with a fake clock.

  python apps/prioritizer/test/focus-e2e.py

Monday 9 November 2026. Settings' focus hours (09:00 to 12:00, lunch 12:00 to 13:00) are written here through the
SDK as Workshop's Settings would. Checks: with focus hours off Docket looks as before; during focus the Inbox folds
to a rail that still counts captures, Needs you shows only PRs blocked on you; the summary's day.focus, day.lunch
and blocking cards; the Maker/Manager template and "Overlaps lunch"; breadcrumbs at lunch, the first step, an old left-off note copied in. Exit 1 if any check fails."""
import datetime, functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

# Docket is apps/prioritizer/ in Workshop: its files are in APP_DIR, and the static site is Workshop's root (Docket's
# page loads Workshop's shared files).
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(APP_DIR))
PORT = 8813
SITE = f'http://127.0.0.1:{PORT}'
APP = SITE + '/apps/prioritizer/'
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
        pg.goto(APP); tick(pg, 3000)
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
        check('during focus the Inbox folds to a rail with its count and when it comes back', pg.locator('.col-inbox.rail.held').count() == 1 and pg.inner_text('.col-inbox.rail .num').strip() == '1' and 'until 1:00' in (pg.get_attribute('.col-inbox.rail', 'aria-label') or ''))
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

        # One breadcrumb system: working on a task when focus runs into lunch asks once, through the breadcrumb prompt.
        view(pg, '1'); tick(pg, 600)
        pg.evaluate(f"() => {P}.openDrawer('wk1')"); tick(pg, 400)
        pg.fill('#drawer .d-first', 'Open the <i>grammar</i> file'); tick(pg, 600)
        pg.evaluate("() => document.querySelector('#drawer .d-first').blur()"); tick(pg, 600)
        check('the drawer has a First step field under the title, saved on the task',
              pg.evaluate("() => { const d = document.querySelector('#drawer .d-title'); return d.nextElementSibling.classList.contains('d-first'); }")
              and pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === 'wk1').firstStep") == 'Open the <i>grammar</i> file')
        jsclick(pg, '#drawer [data-d=focus-start]'); tick(pg, 400)
        pg.keyboard.press('Escape'); tick(pg, 300)
        check('a running task with a first step shows it large in the band and the title small, escaped',
              pg.locator('#nowbar.hasstep .nstep').count() == 1 and '<i>grammar</i>' in pg.inner_text('#nowbar .nstep')
              and pg.locator('#nowbar .nstep i').count() == 0 and 'Write the parser' in pg.inner_text('#nowbar .nsub .ntitle'))
        check('starting the task keeps its first step', pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === 'wk1').firstStep") == 'Open the <i>grammar</i> file')
        pg.clock.pause_at(at(12, 0)); tick(pg, 3000)
        check('when focus runs into lunch, one breadcrumb prompt asks where you left off',
              pg.locator('.modal .crumbsheet').count() == 1 and 'Lunch' in pg.inner_text('.modal .crumbsheet h3') and 'Write the parser' in pg.inner_text('.modal .crumbsheet'))
        check('the old Today banner is gone', pg.locator('.leftoff').count() == 0)
        pg.fill('.modal .crumbsheet input', 'Tokens done; <b>next</b> the grammar'); pg.keyboard.press('Enter'); tick(pg, 800)
        crumbs = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === 'wk1').crumbs")
        check('it is saved as the newest breadcrumb, and nothing writes leftOff',
              crumbs[-1]['text'] == 'Tokens done; <b>next</b> the grammar' and pg.evaluate(f"() => 'leftOff' in {P}.state.tasks.find(t => t.id === 'wk1')") is False)
        if os.environ.get('DEBUG'): print('CRUMB:', pg.evaluate("() => [document.querySelector('.row[data-id=wk1] .crumb')?.textContent, document.querySelector('#nowbar .ncrumb')?.textContent, [...document.querySelectorAll('main b')].map(b => b.outerHTML)]"))
        check('it shows under the task on Today and in the focus band, escaped',
              '<b>next</b>' in pg.inner_text('.row[data-id="wk1"] .crumb') and '<b>next</b>' in pg.inner_text('#nowbar .ncrumb') and pg.locator('.row[data-id="wk1"] .crumb b, #nowbar .ncrumb b').count() == 0)
        tick(pg, 1500)
        check('no second prompt for the same moment', pg.locator('.modal .crumbsheet').count() == 0)
        # During lunch the strip folds entirely.
        check('during lunch Reviews folds to one line (nothing breaks through lunch)', pg.locator('.treviews.held').count() == 1 and 'held until 1:00' in pg.inner_text('.treviews') and pg.locator('.treviews .row').count() == 0)
        jsclick(pg, '.row[data-id="wk1"] [data-act="done"]'); tick(pg, 800)
        check('marking the task done clears its first step', pg.evaluate(f"() => 'firstStep' in {P}.state.tasks.find(t => t.id === 'wk1')") is False)

        # A board saved before Docket 10.1.0 with focus hours' left-off note: copied into breadcrumbs once on load.
        pg.evaluate(f"""() => {{ const P = {P}, base = P.state.tasks.find(t => t.id === 'wk1');
          P.state.tasks.push(Object.assign({{}}, base, {{id: 'old1', title: 'Old task', done: false, doneAt: null, rank: 99,
            leftOff: {{text: 'halfway through the doc', at: '2026-11-06T16:00:00.000Z'}}}}));
          delete P.state.tasks.at(-1).crumbs;
          // Three loads, as a board read back from the data folder.
          for (let i = 0; i < 3; i++) P.state = P.sanitize(JSON.parse(JSON.stringify(P.state)));
          P.commit(); }}""")
        tick(pg, 600)
        old = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === 'old1')")
        check('an old left-off note becomes the newest breadcrumb once, at its time, and stays in place',
              old['crumbs'] == [{'at': '2026-11-06T16:00:00.000Z', 'text': 'halfway through the doc'}] and old['leftOff']['text'] == 'halfway through the doc')
        # Stuck, on the band next to Pause: Step away 5 min, then I'm back; Make it smaller, a first step or Split.
        pg.clock.pause_at(at(13, 0)); tick(pg, 2000)
        check('after lunch the Inbox and Reviews are back', pg.locator('.col-inbox:not(.rail)').count() == 1 and pg.locator('.treviews:not(.held) .row').count() == 1)
        add_tasks(pg, [{'id': 'st1', 'title': 'Draft the migration plan', 'value': 3, 'effort': 'L', 'focusOn': '2026-11-09', 'due': '2026-11-20', 'who': ['p_ada']}]); tick(pg, 800)
        pg.evaluate(f"() => {P}.openDrawer('st1')"); tick(pg, 400)
        jsclick(pg, '#drawer [data-d=focus-start]'); tick(pg, 400)
        pg.keyboard.press('Escape'); tick(pg, 300)
        check('the band has Stuck next to Pause', pg.evaluate("() => { const s = document.querySelector('#nowbar [data-now=stuck]'); return !!s && s.nextElementSibling.dataset.now === 'pause'; }"))
        jsclick(pg, '#nowbar [data-now=stuck]'); tick(pg, 300)
        check('Stuck opens a menu with Step away 5 min and Make it smaller',
              pg.locator('.menu [data-m=away]').count() == 1 and pg.locator('.menu [data-m=smaller]').count() == 1 and 'Step away 5 min' in pg.inner_text('.menu'))
        jsclick(pg, '.menu [data-m=away]'); tick(pg, 300)
        check('Step away pauses the task and asks for a breadcrumb', pg.locator('.modal .crumbsheet').count() == 1
              and pg.evaluate(f"() => {P}.focusModel.activeOf({P}.focusLog, '2026-11-09')") is None)
        pg.fill('.modal .crumbsheet input', 'outline has three parts'); pg.keyboard.press('Enter'); tick(pg, 600)
        check('before 5 minutes, nothing asks you back', not pg.is_visible('#nowbar'))
        pg.clock.run_for(5 * 60000 + 2000); pg.wait_for_timeout(400)
        check('after 5 minutes one quiet line offers I\'m back (no toast)', pg.is_visible('#nowbar.back') and 'Draft the migration plan' in pg.inner_text('#nowbar')
              and pg.locator('#nowbar [data-now=back]').count() == 1 and not pg.is_visible('#toast.show'))
        jsclick(pg, '#nowbar [data-now=back]'); tick(pg, 400)
        check('I\'m back starts the task again', pg.evaluate(f"() => {P}.focusModel.activeOf({P}.focusLog, '2026-11-09')") == 'st1' and pg.locator('#nowbar.back').count() == 0
              and pg.locator('.modal .crumbsheet').count() == 0)
        jsclick(pg, '#nowbar [data-now=stuck]'); tick(pg, 300)
        jsclick(pg, '.menu [data-m=smaller]'); tick(pg, 300)
        check('Make it smaller asks for a first step, with Split', pg.locator('.modal .smallersheet [name=step]').count() == 1 and pg.locator('.modal .smallersheet [data-split]').count() == 1)
        pg.fill('.modal .smallersheet [name=step]', 'List the three tables'); pg.keyboard.press('Enter'); tick(pg, 500)
        check('the first step is saved and shows large in the band', pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === 'st1').firstStep") == 'List the three tables'
              and 'List the three tables' in pg.inner_text('#nowbar .nstep'))
        jsclick(pg, '#nowbar [data-now=stuck]'); tick(pg, 300)
        jsclick(pg, '.menu [data-m=smaller]'); tick(pg, 300)
        pg.fill('.modal .smallersheet [name=rest]', 'Write the rollback section')
        jsclick(pg, '.modal .smallersheet [data-split]'); tick(pg, 600)
        sp = pg.evaluate(f"""() => {{ const s = {P}.state.tasks, a = s.find(t => t.id === 'st1'), b = s.find(t => t.title === 'Write the rollback section');
          return b && {{list: b.listId === a.listId, who: b.who, due: b.due, focusOn: b.focusOn, firstOn: a.focusOn, below: b.rank === a.rank + 1, active: {P}.focusModel.activeOf({P}.focusLog, '2026-11-09')}}; }}""")
        check('Split makes the rest its own task with the same list, people and due date, right below; the first stays on Today and running',
              sp is not None and sp['list'] and sp['who'] == ['p_ada'] and sp['due'] == '2026-11-20' and sp['focusOn'] is None
              and sp['firstOn'] == '2026-11-09' and sp['below'] and sp['active'] == 'st1')

        check('no page errors', not errors)
        for e in errors: print('  ', e)
        b.close()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
