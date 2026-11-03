#!/usr/bin/env python3
"""Docket on its own, in headless Chrome: this repo served as a static site, the way docket.alexisdavidson.org
serves it, with no Workshop agent. Checks that the page loads with no errors, picks browser storage, moves an
old localStorage board in once, saves and reloads, makes backups, and registers its own service worker.

  pip install playwright && python -m playwright install chromium
  python test/e2e.py

Docket inside Workshop (the shell, the agent, two windows in sync) is checked by Workshop's tests/e2e.py,
which runs against a checkout of this repo. Exit 1 if any check fails."""
import functools, http.server, json, os, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'test', 'fixtures')
PORT = 8812
SITE = f'http://127.0.0.1:{PORT}'


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


# Globals the page defines beyond a blank page, minus the shared classic scripts. Docket is ES modules, so only
# its test hook should remain.
GLOBALS = """() => {
  const f = document.createElement('iframe'); document.body.appendChild(f);
  const blank = new Set(Object.getOwnPropertyNames(f.contentWindow)); f.remove();
  const shared = new Set(['WorkshopTheme', 'WorkshopSw', 'XLSX', 'cptable', 'make_xlsx_lib', 'DO_NOT_EXPORT_CODEPAGE']);
  return Object.getOwnPropertyNames(window).filter(n => !blank.has(n) && !shared.has(n)).sort();
}"""


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with open(os.path.join(FIX, 'today-localstorage.json')) as f: legacy = json.load(f)
    want = sorted(t['title'] for t in legacy['tasks'])
    titles = "() => window.__prioritizer.state.tasks.map(t => t.title).sort()"

    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome') if os.path.exists('/usr/bin/google-chrome') and not os.environ.get('CI') else p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        # The SDK probes /api/health for a Workshop agent on this site; its 404 is expected here.
        pg.on('console', lambda m: m.type == 'error' and not m.text.startswith('Failed to load resource') and errors.append(m.text))

        # A board saved by the localStorage versions moves into browser storage once.
        pg.goto(SITE + '/manifest.webmanifest')
        pg.evaluate("raw => localStorage.setItem('prioritizer.v1', raw)", json.dumps(legacy))
        pg.goto(SITE + '/')
        pg.wait_for_function('window.__prioritizer && document.querySelector("#syncBtn")', timeout=15000)
        pg.wait_for_timeout(1200)
        check('Docket opens on its own at the site root', pg.title() == 'Docket')
        check('it has the standalone top bar', pg.locator('.ws-bar .here').text_content() == 'Docket')
        check('only its test hook is left on window', pg.evaluate(GLOBALS) == ['__prioritizer'])
        check('with no Workshop, it uses browser storage', pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js');
          const ws = await connect({app: 'prioritizer'}); return ws.mode + '/' + ws.backend; }""") == 'browser/browser')
        check('the old browser board moves in on first load', pg.evaluate(titles) == want)
        stored = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').get('prioritizer/tasks'); q.onsuccess = () => res(q.result); }; })""")
        check('the board is saved as a prioritizer.tasks envelope, the format Workshop reads', stored and stored['schema'] == 'prioritizer.tasks' and len(stored['items']) == len(want))
        check('the old copy is kept, and marked as moved', pg.evaluate("localStorage.getItem('prioritizer.v1') !== null && localStorage.getItem('prioritizer.v1.moved') !== null"))

        pg.evaluate("() => { const P = window.__prioritizer; P.state.tasks = P.state.tasks.filter(t => t.id !== 't7'); P.commit(); return P.saved(); }")
        pg.reload(); pg.wait_for_function('window.__prioritizer', timeout=15000); pg.wait_for_timeout(1200)
        check('it moves only once: a deleted task stays deleted after reload', pg.evaluate(titles) == [t for t in want if t != 'Untriaged idea'])

        pg.click('#syncBtn'); pg.wait_for_timeout(200)
        menu = pg.inner_text('.menu')
        check('the file menu says the board is saved in this browser', 'Saved in this browser' in menu and 'Download a backup' in menu)
        check('no Connect item off https (pairing needs the real site)', 'Use Workshop on this computer' not in menu)
        items = pg.evaluate("""async () => { const m = await import('/js/connect.js');
          return [m.connectItems({mode: 'browser', storage: 'indexeddb'}), m.connectItems({mode: 'hosted', storage: 'agent'}), m.connectItems({mode: 'browser', storage: 'device'})]; }""")
        check('paired, the file menu offers to stop using Workshop on this computer; never in the Android app', 'Stop using Workshop on this computer' in items[1] and items[2] == '')
        pg.keyboard.press('Escape')
        with pg.expect_download() as dl: pg.evaluate('window.__prioritizer.downloadBackup()')
        path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(path)
        with open(path) as f: bundle = json.load(f)
        check('a backup is a Workshop bundle with all four collections', bundle['schema'] == 'workshop.bundle'
              and sorted(c['collection'] for c in bundle['collections']) == ['lists', 'people', 'settings', 'tasks'])

        # ---------- Day view (WS12): set the sprint, templates, plan tasks, lose a block, shift, undo, reload ----------
        P = 'window.__prioritizer'
        pg.keyboard.press('6'); pg.wait_for_timeout(300)
        check('6 opens the Day view, which asks when a sprint starts', pg.evaluate(f'{P}.state.view') == 'day' and pg.locator('#dpSetup').count() == 1)
        pg.click('#dpSetup button.primary'); pg.wait_for_timeout(300)
        check('starting a sprint adds example templates', pg.evaluate(f'{P}.dp.templates.length') == 3 and pg.evaluate(f'{P}.dp.sprint.anchor') is not None)
        # Every day a workday, so today has blocks whatever day the test runs.
        pg.click('[data-dp=settings]'); pg.wait_for_timeout(200)
        for n in range(7):
            box = pg.locator(f'.dsettings [data-wd="{n}"]')
            if not box.is_checked(): box.check()
        # Two templates on the same day number show an error and block saving.
        pg.click('.dsettings [data-addtpl]'); pg.wait_for_timeout(100)
        pg.locator('.dsettings [data-tf=days]').last.fill('1'); pg.locator('.dsettings [data-tf=days]').last.dispatch_event('change')
        check('Settings shows an error when two templates match a day', 'Day 1 is in' in pg.inner_text('.dsettings .derr'))
        pg.click('.dsettings [data-savesettings]'); pg.wait_for_timeout(100)
        check('and does not save it', pg.locator('.dsettings').count() == 1)
        pg.locator('.dsettings [data-deltpl]').last.click(); pg.wait_for_timeout(100)
        pg.click('.dsettings [data-savesettings]'); pg.wait_for_timeout(300)
        check('settings save once the overlap is gone', pg.locator('.dsettings').count() == 0 and pg.evaluate(f'{P}.dp.sprint.workdays.length') == 7)
        secs = pg.evaluate("() => [...document.querySelectorAll('.dsec')].map(s => s.dataset.sec)")
        check('today shows the Planning day template (day 1)', len(secs) == 3 and 'sprint' in pg.inner_text('#phead').lower() and 'day 1 of' in pg.inner_text('#phead').lower())
        open_ids = pg.evaluate(f"() => {P}.state.tasks.filter(t => !t.done).sort((a, b) => a.rank - b.rank).map(t => t.id)")
        # 1) keyboard: select a task, P, then 2 for the second block
        pg.focus(f'.dtray .row[data-id="{open_ids[0]}"]'); pg.keyboard.press('p'); pg.wait_for_timeout(150); pg.keyboard.press('2'); pg.wait_for_timeout(300)
        # 2) drag a task onto the first block
        pg.locator(f'.dtray .row[data-id="{open_ids[1]}"]').drag_to(pg.locator(f'.dsec[data-sec="{secs[0]}"] .rows')); pg.wait_for_timeout(300)
        # 3) the task drawer's Plan for field
        pg.click(f'.dtray .row[data-id="{open_ids[2]}"] .title'); pg.wait_for_timeout(200)
        pg.select_option('#drawer [data-f=plansec]', secs[0]); pg.wait_for_timeout(200); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        slots = "() => { const d = window.__prioritizer.dp.days[new Date().toLocaleDateString('en-CA')]; return d ? Object.fromEntries(d.slots.map(s => [s.taskId, s.sectionId])) : {}; }"
        got = pg.evaluate(slots)
        check('tasks slot by keyboard, by drag and from the drawer', got.get(open_ids[0]) == secs[1] and got.get(open_ids[1]) == secs[0] and got.get(open_ids[2]) == secs[0])
        check('slotted tasks leave the tray', pg.locator(f'.dtray .row[data-id="{open_ids[0]}"]').count() == 0)
        # Lost this block: the first block's tasks go to the next open block (the default).
        pg.click(f'.dsec[data-sec="{secs[0]}"] [data-dp=secmenu]'); pg.click('.menu [data-sm=lose]'); pg.wait_for_timeout(150)
        pg.click('.modal [data-ok]'); pg.wait_for_timeout(300)
        got = pg.evaluate(slots)
        check('lost this block moves its tasks to the next open block', got.get(open_ids[1]) == secs[1] and got.get(open_ids[2]) == secs[1] and pg.locator(f'.dsec[data-sec="{secs[0]}"].lost').count() == 1)
        times = "() => window.__prioritizer.dp.days[new Date().toLocaleDateString('en-CA')].sections.map(s => s.around)"
        before = pg.evaluate(times)
        pg.click(f'.dsec[data-sec="{secs[1]}"] [data-dp=secmenu]'); pg.click('.menu [data-sm=shift]'); pg.wait_for_timeout(150)
        pg.click('.modal [data-m="30"]'); pg.wait_for_timeout(300)
        after = pg.evaluate(times)
        check('shift the rest of the day moves later blocks by 30 minutes', after[0] == before[0] and after[1] != before[1])
        pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
        check('Ctrl+Z undoes the shift', pg.evaluate(times) == before)
        pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(200); pg.keyboard.press('Control+z'); pg.wait_for_timeout(200)
        # Escaping: a block named <script> and a task titled <script> render as text.
        pg.evaluate(f"() => {{ const P = {P}; P.state.tasks.find(t => t.id === '{open_ids[1]}').title = '<script>alert(1)</script>'; P.commit(); }}")
        pg.click(f'.dsec[data-sec="{secs[2]}"] [data-dp=secmenu]'); pg.click('.menu [data-sm=edit]'); pg.wait_for_timeout(150)
        pg.fill('.modal [name=name]', '<img src=x onerror=alert(1)>'); pg.click('.modal .btn.primary'); pg.wait_for_timeout(300)
        check('block names and task titles are escaped', pg.locator('main img').count() == 0 and pg.locator('main script').count() == 0
              and '<img src=x' in pg.inner_text(f'.dsec[data-sec="{secs[2]}"] h3') and '<script>' in pg.inner_text('main'))
        pg.evaluate(f'{P}.saved()'); pg.wait_for_timeout(300)
        pg.reload(); pg.wait_for_function('window.__prioritizer', timeout=15000); pg.wait_for_timeout(1200)
        got = pg.evaluate(slots)
        check('after reload the Day view and its plan are still there', pg.evaluate(f'{P}.state.view') == 'day' and got.get(open_ids[0]) == secs[1] and pg.locator('.dsec.lost').count() == 1)
        cols = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').getAllKeys(); q.onsuccess = () => res(q.result); }; })""")
        y = pg.evaluate("new Date().getFullYear()")
        check('the day plan is saved as dayplan collections next to the board', all(c in cols for c in ['prioritizer/dayplan/settings', 'prioritizer/dayplan/templates', f'prioritizer/dayplan/days/{y}']))
        # Every-sprint tasks: added in settings, made at once on day 1 at Low value, due on their sprint day, once.
        pg.click('[data-dp=settings]'); pg.wait_for_timeout(200)
        pg.click('.dsettings [data-addrec]'); pg.wait_for_timeout(100)
        pg.fill('.dsettings [data-rf=title]', 'Backlog refinement')
        pg.select_option('.dsettings [data-rf=due]', '3')
        pg.select_option('.dsettings [data-rf=planKind]', 'admin')
        pg.click('.dsettings [data-savesettings]'); pg.wait_for_timeout(400)
        rec = pg.evaluate(f"() => {P}.state.tasks.find(t => t.recur)")
        want_due = pg.evaluate("() => { const d = new Date(); d.setDate(d.getDate() + 2); return d.toLocaleDateString('en-CA'); }")
        check('an every-sprint task is made on day 1 at Low value, due on its sprint day', rec is not None and rec['title'] == 'Backlog refinement' and rec['value'] == 2 and rec['due'] == want_due)
        planned = pg.evaluate(f"() => {{ const P = {P}, d = P.dp.days['{want_due}'], t = P.state.tasks.find(t => t.recur); if (!d || !t) return null; const s = d.slots.find(x => x.taskId === t.id); return s && d.sections.find(x => x.id === s.sectionId).kind; }}")
        check('with Plan into, it is planned in that kind of block on its due day', planned == 'admin')
        check('it shows an Every sprint chip', pg.locator('main .chip', has_text='Every sprint').count() >= 1)
        pg.evaluate(f"() => {{ const P = {P}; P.state.tasks = P.state.tasks.filter(t => !t.recur); P.commit(); }}")
        made = pg.evaluate(f"() => {P}.recurTick()")
        check('deleting it does not bring it back this sprint', made == 0 and pg.evaluate(f"() => {P}.state.tasks.filter(t => t.recur).length") == 0)
        pg.keyboard.press('1'); pg.wait_for_timeout(200)

        pg.wait_for_function('navigator.serviceWorker.controller !== null || navigator.serviceWorker.getRegistration().then(r => !!r)', timeout=10000)
        scope = pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r && r.scope)")
        check('it registers its own service worker for the whole site', scope == SITE + '/')
        pg.wait_for_timeout(1500)
        cached = pg.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(all => all.flat().map(r => new URL(r.url).pathname))")
        check('the service worker precaches the files app.json lists', '/js/people.js' in cached and '/shared/workshop-sdk.js' in cached and '/icons/favicon.svg' in cached)
        check('no errors on the page', errors == [])
        if errors: print('\n'.join('  ' + e for e in errors))
        b.close()
    srv.shutdown()
    print(f'\n{len(failed)} failed' if failed else '\nAll checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
