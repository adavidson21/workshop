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
        check('a board that already has tasks never opens the tour', pg.locator('.sheet.tour').count() == 0)
        check('it has the standalone top bar', pg.locator('.ws-bar .here').text_content() == 'Docket')
        check('only its test hook is left on window', pg.evaluate(GLOBALS) == ['__prioritizer'])
        check('with no Workshop, it uses browser storage', pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js');
          const ws = await connect({app: 'prioritizer'}); return ws.mode + '/' + ws.backend; }""") == 'browser/browser')
        check('the old browser board moves in on first load', pg.evaluate(titles) == want)
        stored = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').get('prioritizer/tasks'); q.onsuccess = () => res(q.result); }; })""")
        check('the board is saved as a prioritizer.tasks envelope, the format Workshop reads', stored and stored['schema'] == 'prioritizer.tasks' and len(stored['items']) == len(want))
        check('the old copy is kept, and marked as moved', pg.evaluate("localStorage.getItem('prioritizer.v1') !== null && localStorage.getItem('prioritizer.v1.moved') !== null"))
        # Names on the old board become contacts in this browser's people directory, and tasks keep their ids.
        pg.wait_for_function("() => !window.__prioritizer.state.tasks.some(t => t.people)", timeout=10000)
        who = pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'prioritizer'});
          const d = await ws.people.get(); const P = window.__prioritizer;
          return [d.people.map(p => [p.name, p.relation]).sort(), P.state.tasks.filter(t => t.who.length).every(t => t.who.every(id => d.byId.has(id)))]; }""")
        check('names on old tasks become directory contacts, and tasks keep ids', who[0] == [['DevA', 'contact'], ['DevB', 'contact']] and who[1])
        # Quick add: @group assigns the group; a new @name adds a contact.
        pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'prioritizer'});
          const d = await ws.people.get(); await ws.people.add({kind: 'group', name: 'Leadership', members: d.people.map(p => p.id)}); }""")
        pg.wait_for_timeout(600)
        added = pg.evaluate("""async () => { const m = await import('/js/actions.js'); const t1 = m.addTask('Ask about budget @leadership'); const t2 = m.addTask('Call @newperson');
          await new Promise(r => setTimeout(r, 800)); const {getDirectory, namesOf} = await import('/js/directory-model.js');
          const out = [namesOf(t1.who), namesOf(window.__prioritizer.state.tasks.find(t => t.id === t2.id).who)];
          const P = window.__prioritizer; P.state.tasks = P.state.tasks.filter(t => t.id !== t1.id && t.id !== t2.id); P.commit(); await P.saved(); return out; }""")
        check('Quick add: @leadership assigns the group, @newperson adds a contact', added == [['Leadership'], ['Newperson']])

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
        check('a backup is a Workshop bundle with all three collections', bundle['schema'] == 'workshop.bundle'
              and sorted(c['collection'] for c in bundle['collections']) == ['lists', 'settings', 'tasks'])

        # ---------- The Inbox (Triage in Today's first column): title, notes and list edit in place; typing there never fires shortcuts ----------
        P = 'window.__prioritizer'
        tid = pg.evaluate(f"""() => {{ const P = {P}, t = P.state.tasks.filter(t => !t.done).sort((a, b) => a.rank - b.rank)[0];
          t.value = null; t.effort = null; P.commit(); return t.id; }}""")
        pg.keyboard.press('3'); pg.wait_for_timeout(300)
        check('3 focuses Today\'s Inbox, with an editable triage card', pg.evaluate(f'{P}.state.view') == 'today' and pg.locator('.col-inbox.colon #triTitle').count() == 1)
        for _ in range(20):  # skip ahead to the task this test cleared
            if pg.locator('#triTitle').count() == 0 or pg.input_value('#triTitle') == pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{tid}').title"): break
            pg.keyboard.press('s'); pg.wait_for_timeout(150)
        pg.click('#triTitle'); pg.keyboard.press('Control+a'); pg.keyboard.type('Write the Q4 guide'); pg.wait_for_timeout(100)
        pg.click('#triNotes'); pg.keyboard.press('Control+a'); pg.keyboard.type('Start with setup\nthen 2 examples')
        lists = pg.evaluate("() => [...document.querySelectorAll('#triList option')].map(o => o.value)")
        target = lists[-1]
        pg.select_option('#triList', target)
        pg.locator('body').click(position={'x': 5, 'y': 5}); pg.wait_for_timeout(100)
        d = pg.evaluate(f'() => {{ const t = {P}.state.tasks.find(t => t.id === "{tid}"); return [t.value, t.effort]; }}')
        check('typing a q or a digit in the title or notes sets no value or effort', d == [None, None])
        pg.keyboard.press('4'); pg.keyboard.press('w'); pg.wait_for_timeout(150)
        check('the typed title survives picking value and effort', pg.input_value('#triTitle') == 'Write the Q4 guide')
        pg.click('#triTitle'); pg.keyboard.press('End'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
        t = pg.evaluate(f'() => {P}.state.tasks.find(t => t.id === "{tid}")')
        check('Enter in the title saves title, notes, list, value and effort', t['title'] == 'Write the Q4 guide' and t['notes'] == 'Start with setup\nthen 2 examples'
              and t['listId'] == target and t['value'] == 4 and t['effort'] == 'S')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        if pg.locator('.col.colon').count(): pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        check('Esc leaves the Inbox', pg.locator('.col.colon').count() == 0)

        # ---------- Today: three columns, moves between them, lenses ----------
        check('Today has the Inbox, Ranked and Today columns', pg.evaluate("() => [...document.querySelectorAll('main .col')].map(c => c.dataset.col)") == ['inbox', 'rank', 'today'])
        check('Triage and Prioritize are gone from the sidebar; Review has Day, People and Done',
              pg.evaluate("() => [...document.querySelectorAll('#snav .sitem')].map(b => b.dataset.nav)") == ['today', 'day', 'people', 'archive'])
        pg.keyboard.press('4'); pg.wait_for_timeout(250)
        check('4 focuses the Ranked column', pg.locator('.col-rank.colon').count() == 1)
        pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(150)
        check('Right moves to the Today column', pg.locator('.col-today.colon').count() == 1)
        pg.keyboard.press('Escape')
        ids = pg.evaluate(f"""() => {{ const P = {P}, t0 = new Date().toLocaleDateString('en-CA');
          P.state.tasks.filter(t => !t.done).forEach(t => {{ t.value = t.value || 3; t.effort = t.effort || 'S'; t.focusOn = null; t.waiting = false; t.nudgeOn = null; t.who = []; t.ageFrom = t0; delete t.cameBack; }});
          P.commit(); return P.state.tasks.filter(t => !t.done).sort((a, b) => a.rank - b.rank).map(t => t.id); }}""")
        pg.wait_for_timeout(200)
        pg.locator(f'.col-rank .row[data-id="{ids[1]}"]').drag_to(pg.locator('.col-today [data-zone=today]')); pg.wait_for_timeout(300)
        check('dragging a task from Ranked to Today picks it', pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{ids[1]}').focusOn") == pg.evaluate("new Date().toLocaleDateString('en-CA')"))
        check('a picked task stays in Ranked, dimmed', pg.locator(f'.col-rank .row.ontoday[data-id="{ids[1]}"]').count() == 1)
        pg.locator(f'.col-today .row[data-id="{ids[1]}"]').drag_to(pg.locator(f'.col-rank .row[data-id="{ids[0]}"]')); pg.wait_for_timeout(300)
        check('dragging it back to Ranked takes it off Today', pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{ids[1]}').focusOn") is None)
        pg.evaluate(f"() => {{ const P = {P}, t = P.state.tasks.find(t => t.id === '{ids[2]}'); t.value = null; t.effort = null; P.commit(); }}"); pg.wait_for_timeout(200)
        if pg.locator(f'.col-inbox .row[data-id="{ids[2]}"]').count(): pg.locator(f'.col-inbox .row[data-id="{ids[2]}"]').drag_to(pg.locator('.col-rank [data-zone=rank]')); pg.wait_for_timeout(300)
        check('a task with no estimate cannot skip the Inbox: it becomes the triage card', pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{ids[2]}').effort") is None and pg.locator('#triTitle').count() == 1
              and pg.input_value('#triTitle') == pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{ids[2]}').title"))
        pg.evaluate(f"() => {{ const P = {P}, t = P.state.tasks.find(t => t.id === '{ids[2]}'); t.value = 3; t.effort = 'S'; P.commit(); }}"); pg.wait_for_timeout(150)
        pg.click('.col-rank [data-lens=eisen]'); pg.wait_for_timeout(200)
        check('Eisenhower in Ranked turns Inbox and Today into rails', pg.locator('.col-inbox.rail').count() == 1 and pg.locator('.col-today.rail').count() == 1 and pg.locator('.quad').count() == 4)
        pg.click('.col-today.rail .railbtn'); pg.wait_for_timeout(200)
        check('a rail goes back to List', pg.evaluate(f'{P}.state.lens') == 'rank' and pg.locator('.col.rail').count() == 0)
        pg.evaluate(f"() => {{ const P = {P}; P.state.view = 'eisen'; P.render(); }}"); pg.wait_for_timeout(150)
        check('an old view name (eisen) opens Today with that lens', pg.evaluate(f'[{P}.state.view, {P}.state.lens]') == ['today', 'eisen'])
        pg.evaluate(f"() => {{ const P = {P}; P.state.lens = 'rank'; P.render(); }}")
        pg.set_viewport_size({'width': 1000, 'height': 800}); pg.wait_for_timeout(200)
        check('a narrower window folds the Inbox to a button', not pg.is_visible('.col-inbox .colbody') and pg.is_visible('.col-inbox .railx'))
        pg.click('.col-inbox .railx'); pg.wait_for_timeout(200)
        check('which opens the Inbox over the page', pg.is_visible('.col-inbox .colbody'))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        pg.set_viewport_size({'width': 1280, 'height': 800}); pg.wait_for_timeout(200)
        pg.keyboard.press('1'); pg.wait_for_timeout(150)
        added = pg.evaluate("""async () => { window.__prioritizer.state.view = 'today'; const m = await import('/js/actions.js'); const t = m.addTask('Fresh idea'); return [t.focusOn, window.__prioritizer.inboxQueue ? 1 : 1]; }""")
        pg.wait_for_timeout(150)
        check('a new task on Today lands in the Inbox, not on Today', added[0] is None and pg.locator('.col-today .row').filter(has_text='Fresh idea').count() == 0)
        pg.evaluate(f"() => {{ const P = {P}; P.state.tasks = P.state.tasks.filter(t => t.title !== 'Fresh idea'); P.commit(); }}")

        # ---------- Day view (WS12): set the sprint, templates, plan tasks, lose a block, shift, undo, reload ----------
        P = 'window.__prioritizer'
        pg.keyboard.press('2'); pg.wait_for_timeout(300)
        check('2 opens the Day view, which asks when a sprint starts', pg.evaluate(f'{P}.state.view') == 'day' and pg.locator('#dpSetup').count() == 1)
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
        check('it shows the Every sprint symbol', pg.locator('main .sig.recur[aria-label^="Every sprint"]').count() >= 1)
        pg.evaluate(f"() => {{ const P = {P}; P.state.tasks = P.state.tasks.filter(t => !t.recur); P.commit(); }}")
        made = pg.evaluate(f"() => {P}.recurTick()")
        check('deleting it does not bring it back this sprint', made == 0 and pg.evaluate(f"() => {P}.state.tasks.filter(t => t.recur).length") == 0)
        # 12-hour clock: block times show AM or PM, and a typed "1:30" in a time field is read as 1:30 PM.
        times = pg.locator('main .dtime').all_inner_texts()
        check('block times show on a 12-hour clock', times and all(('AM' in t or 'PM' in t) and not any(f'{h}:' in t for h in range(13, 24)) for t in times))
        # Repeating tasks: make one from a task's drawer, every workday at a typed time.
        pg.evaluate(f"() => {{ const P = {P}; P.state.view = 'today'; P.commit(); }}"); pg.wait_for_timeout(200)
        pg.keyboard.press('n'); pg.fill('#cmdInput', 'Check logs !2 ~xs'); pg.keyboard.press('Enter'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        tid = pg.evaluate(f"() => {P}.state.tasks.find(t => t.title === 'Check logs').id")
        pg.evaluate(f"id => {P}.openDrawer(id)", tid); pg.wait_for_timeout(200)
        pg.select_option('#dRepeat', 'daily'); pg.wait_for_timeout(300)
        pg.fill('.drawer [data-f=repeatAt]', '930a'); pg.keyboard.press('Tab'); pg.wait_for_timeout(300)
        item = pg.evaluate(f"id => {{ const P = {P}, t = P.state.tasks.find(x => x.id === id); return t.recur && P.dp.recurring.find(r => r.id === t.recur.id); }}", tid)
        check('a task can be made to repeat every day at a time from its drawer', item is not None and item['repeat'] == 'daily' and item['at'] == '09:30')
        check('the typed time is tidied to 9:30 AM', pg.input_value('.drawer [data-f=repeatAt]') == '9:30 AM')
        check('the task row shows its repeat time', '9:30 AM' in pg.inner_text(f'main .row[data-id="{tid}"] .sig.recur'))
        check('it does not make a second task for today', pg.evaluate(f"() => {P}.recurTick()") == 0)
        # Tomorrow's task replaces an unfinished one from today, which is closed as skipped.
        nxt = pg.evaluate(f"""id => {{ const P = {P}, t = P.state.tasks.find(x => x.id === id), r = P.dp.recurring.find(x => x.id === t.recur.id);
          const d = new Date(); d.setDate(d.getDate() + 1); const tom = d.toLocaleDateString('en-CA'); const due = P.dayModel.recurDue(P.dp, tom); return due.map(x => x.id); }}""", tid)
        check('the next day makes a fresh one', len(nxt) == 1 and nxt[0].startswith('r_'))
        pg.select_option('#dRepeat', ''); pg.wait_for_timeout(300)
        check("Doesn't repeat stops it and keeps the task", pg.evaluate(f"id => !{P}.state.tasks.find(x => x.id === id).recur && !{P}.dp.recurring.some(r => r.title === 'Check logs')", tid))
        pg.keyboard.press('Escape')
        # Pasting ADO's Copy to clipboard (text plus an HTML link) into the add box keeps the link.
        pg.keyboard.press('n'); pg.wait_for_timeout(100)
        pg.evaluate("""() => { const el = document.querySelector('#cmdInput'); el.focus(); const dt = new DataTransfer();
          dt.setData('text/plain', 'Issue 12345: Fix login');
          dt.setData('text/html', '<a href="https://dev.azure.com/acme/Platform/_workitems/edit/12345">Issue 12345</a>: Fix login');
          el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }""")
        check('the pasted text goes in the box', pg.input_value('#cmdInput') == 'Issue 12345: Fix login')
        pg.keyboard.press('Enter'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        # A new task lands in the Inbox; give it an estimate so it is a row in Ranked.
        pg.evaluate(f"() => {{ const P = {P}, t = P.state.tasks.find(t => t.title === 'Issue 12345: Fix login'); t.value = 2; t.effort = 'S'; P.commit(); }}"); pg.wait_for_timeout(150)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.title === 'Issue 12345: Fix login')")
        check('the task keeps the ADO link', t and t.get('ado', {}).get('url') == 'https://dev.azure.com/acme/Platform/_workitems/edit/12345' and t['ado']['type'] == 'Issue' and t['ado']['pasted'] is True)
        check('its row has a link that opens the item in ADO', pg.locator(f'main .row[data-id="{t["id"]}"] a.sig.ado[href*="_workitems/edit/12345"][target=_blank]').count() == 1)
        # The Quick add cheat sheet: hidden by default, opens with its button or Ctrl+/, clicking a tag inserts it,
        # and it stays open next time (per window).
        pg.keyboard.press('n'); pg.wait_for_timeout(100)
        check('the cheat sheet starts hidden', pg.locator('#cmdCheat').is_hidden())
        pg.click('#cmdCheatBtn'); pg.wait_for_timeout(100)
        check('its button opens it', pg.locator('#cmdCheat').is_visible() and pg.get_attribute('#cmdCheatBtn', 'aria-expanded') == 'true')
        pg.fill('#cmdInput', 'Plan offsite'); pg.click('#cmdCheat [data-ins="!!"]'); pg.wait_for_timeout(100)
        check('clicking a tag adds it to the box', pg.input_value('#cmdInput') == 'Plan offsite !!' and 'Urgent' in pg.inner_text('#cmdParsed'))
        pg.fill('#cmdInput', ''); pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        pg.keyboard.press('n'); pg.wait_for_timeout(100)
        check('it stays open the next time', pg.locator('#cmdCheat').is_visible())
        pg.keyboard.press('Control+/'); pg.wait_for_timeout(100)
        check('Ctrl+/ hides it', pg.locator('#cmdCheat').is_hidden())
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        # +product: Settings' products (settings.products) name a task's product in Quick add and its details.
        pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'settings'});
          await ws.data.put('products', {schema: 'settings.products', version: 1, rev: 0, deleted: {}, items: [
            {id: 'p_wiki', slug: 'wiki', name: 'Wiki'}, {id: 'p_lighthouse', slug: 'lighthouse', name: 'Lighthouse', alsoCalled: ['Beacon']}]}); }""")
        pg.wait_for_timeout(1200)
        pg.keyboard.press('n'); pg.wait_for_timeout(100)
        pg.fill('#cmdInput', 'Fix nav +beac'); pg.wait_for_timeout(100)
        check('+product shows in the preview', 'Product Lighthouse' in pg.inner_text('#cmdParsed'))
        pg.click('#cmdCheatBtn'); pg.wait_for_timeout(100)
        check('the cheat sheet lists your products', pg.locator('#cmdCheat [data-ins="+wiki"]').count() == 1)
        pg.click('#cmdCheatBtn'); pg.keyboard.press('Enter'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.title === 'Fix nav')")
        check('+product sets the task product and leaves the title clean', t and t.get('product') == 'p_lighthouse')
        pg.evaluate(f"id => {P}.openDrawer(id)", t['id']); pg.wait_for_timeout(200)
        check('its details show the Product field', pg.input_value('#dProduct') == 'p_lighthouse')
        pg.select_option('#dProduct', 'p_wiki'); pg.wait_for_timeout(200)
        check('changing it in details saves', pg.evaluate(f"id => {P}.state.tasks.find(t => t.id === id).product", t['id']) == 'p_wiki')
        pg.select_option('#dProduct', ''); pg.wait_for_timeout(200)
        check('None clears it', pg.evaluate(f"id => !('product' in {P}.state.tasks.find(t => t.id === id))", t['id']))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        check('a sync never closes a pasted item it does not list', pg.evaluate(f"""() => {{ const P = {P}; P.adoApply({{items: [], gone: [{{id: 12345, reason: 'reassigned'}}]}}); return !P.state.tasks.find(t => t.ado && t.ado.id === 12345).done; }}"""))
        # ---------- Tandem's first-pass PR reviews (js/pr-ai.js, js/pr-ai-model.js) ----------
        pr = lambda i, tier, c: "{key: 'c|P|%d', id: %d, title: 'Change %d', repo: 'api', project: 'P', url: 'https://ado.example.test/c/P/_git/api/pullrequest/%d', author: 'Dev One', tier: '%s', via: [], commit: '%s'}" % (i, i, i, i, tier, c)
        r = pg.evaluate(f"""() => {{ const P = {P}; const n = P.adoApply({{items: [], prs: {{items: [{pr(701, 'blocking', 'aaaaaaa1')}, {pr(702, 'pool', 'bbbbbbb2')}, {pr(704, 'asked', 'ddddddd4')}]}}}}, {{ai: true}});
          P.state.scope = 'all'; P.state.view = 'prioritize'; P.state.lens = 'rank'; P.commit();
          return [n.prAdded, n.prHeld, P.state.ado.prHeld.map(h => h.item.id), P.state.tasks.filter(t => t.pr && t.pr.id > 700).map(t => [t.pr.id, t.pr.ai && t.pr.ai.state])]; }}""")
        check('with Tandem on, a blocking PR lands at once as being reviewed; asked and team PRs are held', r == [1, 2, [702, 704], [[701, 'pending']]])
        pg.wait_for_timeout(300)
        id701 = pg.evaluate(f"() => {P}.state.tasks.find(t => t.pr && t.pr.id === 701).id")
        check('its row shows the reviewing chip and is dimmed', pg.locator(f'main .row.aipend[data-id="{id701}"] .chip.ai').count() == 1 and 'AI reviewing' in pg.locator(f'main .row[data-id="{id701}"] .chip.ai').text_content())
        r = pg.evaluate(f"""() => {{ const P = {P}, M = P.prAiModel;
          const st = new Map([['701', {{id: '701', state: 'done', recommendation: 'Request changes', risk: 'high', counts: {{blocking: 1, shouldFix: 0, optional: 0}}}}],
            ['702', {{id: '702', state: 'done', recommendation: 'Approve', risk: 'low', counts: {{blocking: 0, shouldFix: 0, optional: 1}}}}], ['704', {{id: '704', state: 'running'}}]]);
          const out = M.applyStatuses({{tasks: P.state.tasks, held: P.state.ado.prHeld, statuses: st, now: new Date(), holdMs: 3600000}});
          P.state.ado.prHeld = out.held; P.prRelease(out.release); P.commit();
          const t = P.state.tasks.find(x => x.pr && x.pr.id === 702);
          return [P.state.ado.prHeld.map(h => h.item.id), t && t.title, t && t.pr.ai.state, t && t.pr.ai.rec, t && t.value]; }}""")
        check('a held PR lands once its review is done, already reviewed, with its tier value', r == [[704], 'Review: Change 702', 'done', 'Approve', 2])
        pg.wait_for_timeout(300)
        chip = pg.locator(f'main .row[data-id="{id701}"] .chip.ai')
        check('a reviewed PR shows the recommendation, in the warning look for high risk', chip.count() == 1 and chip.text_content() == 'AI: Changes' and 'warn' in chip.get_attribute('class') and pg.locator(f'main .row.aipend[data-id="{id701}"]').count() == 0)
        pg.evaluate(f"id => {P}.openDrawer(id)", id701); pg.wait_for_timeout(200)
        check('the drawer says what Tandem found and opens it in Dispatch', 'Request changes, high risk. 1 blocking draft comments.' in pg.inner_text('.deng.prai') and pg.locator('.deng.prai [data-d=prai-open]').count() == 1)
        pg.keyboard.press('Escape')
        r = pg.evaluate(f"""() => {{ const P = {P}; P.adoApply({{items: [], prs: {{items: [{pr(701, 'blocking', 'eeeeeee5')}, {pr(702, 'pool', 'bbbbbbb2')}, {pr(704, 'asked', 'ddddddd4')}]}}}}, {{ai: true}});
          const s = id => P.state.tasks.find(t => t.pr && t.pr.id === id).pr.ai.state; return [s(701), s(702)]; }}""")
        check('a new commit starts the review over; an unchanged PR keeps its result', r == ['pending', 'done'])
        r = pg.evaluate(f"""() => {{ const P = {P}; P.adoApply({{items: [], prs: {{items: [{pr(701, 'blocking', 'eeeeeee5')}, {pr(702, 'pool', 'bbbbbbb2')}, {pr(704, 'asked', 'ddddddd4')}, {pr(705, 'pool', 'fffffff6')}]}}}}, {{ai: false}});
          const t = id => P.state.tasks.find(x => x.pr && x.pr.id === id); return [P.state.ado.prHeld.length, !!t(704), !!t(705), !!(t(705) && t(705).pr.ai), !!t(701).pr.ai]; }}""")
        check('with Tandem off, held and new PRs land as before and reviewing chips go away', r == [0, True, True, False, False])
        r = pg.evaluate(f"""() => {{ const P = {P}; P.adoApply({{items: [], prs: {{items: [{pr(706, 'pool', 'abcdef77')}]}}}}, {{ai: true}});
          const held = P.state.ado.prHeld.length; P.adoApply({{items: [], prs: {{items: []}}}}, {{ai: true}}); return [held, P.state.ado.prHeld.length, P.state.tasks.some(t => t.pr && t.pr.id === 706)]; }}""")
        check('a held PR that drops off ADO never becomes a task', r == [1, 0, False])
        pg.evaluate(f"() => {{ const P = {P}; P.state.tasks = P.state.tasks.filter(t => !(t.pr && t.pr.id > 700)); P.state.ado.prHeld = []; P.commit(); }}")
        # ---------- PR filter: per window, in the scope menu; Team PRs hide with "Only ones that need me" ----------
        # ---------- PR groups planned into Day plan blocks by kind (Blocking: reviews, Pending: admin) ----------
        r = pg.evaluate(f"""() => {{ const P = {P}, dp = P.dp;
          dp.templates = [{{id: 'tpr', name: 'PR day', weekdays: [0, 1, 2, 3, 4, 5, 6], days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            sections: [{{id: 'rvw', name: 'Reviews', kind: 'reviews', color: 'sage', around: null, minutes: null, capacity: null}},
                       {{id: 'adm', name: 'Admin', kind: 'admin', color: 'sky', around: null, minutes: null, capacity: null}}]}}];
          const keep = dp.days; dp.days = {{}};
          P.adoApply({{prs: {{items: [{{key: 'c|p|r|811', id: 811, repo: 'web', title: 'Req', tier: 'blocking', created: '2026-01-01'}},
            {{key: 'c|p|r|812', id: 812, repo: 'web', title: 'Opt', tier: 'asked', created: '2026-01-01'}}]}}}});
          const where = id => {{ const t = P.state.tasks.find(x => x.pr && x.pr.id === id);
            for (const [d, rec] of Object.entries(dp.days)) {{ const s = rec.slots.find(x => x.taskId === t.id); if (s) return s.sectionId; }} return null; }};
          const out = [where(811), where(812), P.state.ado.prSlots.blocking, P.state.ado.prSlots.pending];
          P.adoApply({{prs: {{items: [], gone: [{{key: 'c|p|r|812', reason: 'notneeded'}}]}}}});
          const t = P.state.tasks.find(x => x.pr && x.pr.id === 812); out.push(t.done, t.wontDo, t.pr.gone);
          P.state.tasks = P.state.tasks.filter(x => !(x.pr && x.pr.id > 810)); dp.days = keep; dp.templates = []; P.commit();
          return out; }}""")
        check('Blocking PRs go into the reviews block and Pending ones into admin', r[:4] == ['rvw', 'adm', 'reviews', 'admin'])
        check('a PR that stops needing you is marked won\'t do', r[4:] == [True, True, 'notneeded'])
        pg.evaluate("() => import('./js/ado.js').then(m => { m.adoSetup(); })"); pg.wait_for_selector('.sheet [data-slot=pending]')
        r = pg.evaluate("() => [...document.querySelectorAll('.sheet [data-slot]')].map(e => e.dataset.slot + '=' + e.value)")
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        check('ADO Settings has the Day plan kind for each PR group', r == ['blocking=reviews', 'pending=admin'])
        pg.evaluate(f"() => {{ const P = {P}; P.state.ado.prSlots = {{blocking: '', pending: ''}}; }}")
        pg.evaluate(f"""() => {{ const P = {P}; P.state.scope = 'all'; P.state.view = 'rank'; P.adoApply({{prs: {{items: [
          {{key: 'c|p|r|801', id: 801, repo: 'web', title: 'Mine', tier: 'blocking', created: '2026-01-01'}},
          {{key: 'c|p|r|802', id: 802, repo: 'web', title: 'Team one', tier: 'pool', via: ['Team'], created: '2026-01-01'}}]}}}}); P.commit(); }}""")
        pg.wait_for_timeout(200)
        titles_shown = "() => [...document.querySelectorAll('main .col-rank .row .title, main .col-today [data-zone=today] .row .title')].map(e => e.textContent)"
        shown_now = pg.evaluate(titles_shown)
        check('PR rows drop the "Review: " prefix (the PR chip says it)', 'Mine' in shown_now and 'Team one' in shown_now and not any(x.startswith('Review:') for x in shown_now))
        check('an old PR never goes stale or back to Triage', pg.evaluate(f"() => {P}.triageQueue().every(t => !t.pr)"))
        pg.click('.phead [data-scopemenu]'); pg.wait_for_timeout(150)
        check('the scope menu has the PR filter', pg.locator('.menu [data-prs]').count() == 3)
        pg.click('.menu [data-prs="mine"]'); pg.wait_for_timeout(200)
        shown_now = pg.evaluate(titles_shown)
        check('Only ones that need me hides Team PRs and keeps yours', 'Mine' in shown_now and 'Team one' not in shown_now)
        check('the header says what the filter hides', '1 team pr hidden' in pg.inner_text('.phead .scopebtn').lower())
        check('the filter is per window, kept with the UI state', pg.evaluate("JSON.parse(localStorage.getItem('prioritizer.ui')).prs") == 'mine')
        pg.evaluate(f"() => {{ const P = {P}; P.state.prs = 'none'; P.state.scope = P.state.ado.prListId; P.commit(); }}"); pg.wait_for_timeout(200)
        check('None still shows PRs when you pick the Pull requests list', len(pg.evaluate(titles_shown)) == 2)
        pg.evaluate(f"() => {{ const P = {P}; P.state.scope = 'all'; P.commit(); }}"); pg.wait_for_timeout(200)
        check('None hides every PR elsewhere', not any(x in ('Mine', 'Team one') for x in pg.evaluate(titles_shown)))
        pg.evaluate(f"() => {{ const P = {P}; P.state.prs = 'all'; P.state.tasks = P.state.tasks.filter(t => !t.pr); P.commit(); }}")
        pg.evaluate(f"() => {{ const P = {P}; P.state.tasks = P.state.tasks.filter(t => !(t.ado && t.ado.id === 12345)); P.state.view = 'day'; P.commit(); }}")
        # ---------- ADO goes only through Workshop's connector; a board synced by the retired helper keeps its tasks ----------
        r = pg.evaluate(f"""() => {{ const P = {P}; const choose = P.state.ado.choose; P.state.ado.choose = false; P.adoApply({{items: [{{id: 9101, title: 'Old bug', type: 'Bug', state: 'Active', url: 'https://tfs.example.test/tfs/Main%20Collection/Platform/_workitems/edit/9101', project: 'Platform', priority: 2}}],
            prs: {{items: [{{key: 'https://TFS.example.test/tfs/Main%20Collection/|Platform|901', id: 901, repo: 'api', project: 'Platform', title: 'Old PR', tier: 'asked', created: '2026-01-01'}}]}}}});
          const w = P.state.tasks.find(t => t.ado && t.ado.id === 9101), pr = P.state.tasks.find(t => t.pr && t.pr.id === 901);
          w.notes = 'mine'; w.value = 1; pr.notes = 'mine too'; P.commit();
          const before = P.state.tasks.length;
          const n = P.adoApply({{items: [{{id: 9101, title: 'Old bug, renamed', type: 'Bug', state: 'Active', url: 'https://tfs.example.test/tfs/Main Collection/Platform/_workitems/edit/9101', project: 'Platform', priority: 2}}],
            prs: {{items: [{{key: 'https://tfs.example.test/tfs/Main Collection|Platform|901', id: 901, repo: 'api', project: 'Platform', title: 'Old PR', tier: 'blocking', created: '2026-01-01'}}]}}}});
          const n2 = P.adoApply({{items: [], gone: [{{id: 9101, reason: 'closed', state: 'Closed'}}], prs: {{items: [], gone: [{{key: 'https://tfs.example.test/tfs/Main Collection|Platform|901', reason: 'merged'}}]}}}});
          const out = [n.added, n.prAdded, P.state.tasks.length - before, w.title, w.notes, w.value, pr.notes.split('\\n')[0], pr.pr.key, pr.pr.tier, w.done, pr.done];
          P.state.ado.choose = choose; P.state.tasks = P.state.tasks.filter(t => t !== w && t !== pr); P.commit(); return out; }}""")
        check('a board synced by the helper keeps working through the connector: same tasks, no duplicates, your fields kept',
              r == [0, 0, 0, 'Old bug, renamed', 'mine', 1, 'mine too', 'https://tfs.example.test/tfs/Main Collection|Platform|901', 'blocking', True, True])
        pg.wait_for_timeout(200)
        pg.click('#adoBtn'); pg.wait_for_timeout(400)
        sheet = pg.locator('.sheet[aria-label="Connect Azure DevOps"]')
        text = sheet.inner_text() if sheet.count() else ''
        check('ADO Settings with no Workshop says what to do: install or start Workshop, pair this site, turn on the connector',
              'Install or start Workshop' in text and 'pair this site' in text and 'turn on the ADO connector in Workshop Settings' in text)
        check('ADO Settings has no helper download, steps or port', sheet.locator('a[href*="ado_helper"], #adoPort, ol.steps').count() == 0 and 'ado_helper' not in text and 'helper' not in text.lower())
        sheet.locator('[data-ado-go]').click(); pg.wait_for_timeout(400)
        check('Connect without Workshop keeps sync off and repeats the message', 'pair this site' in pg.inner_text('#adoMsg') and pg.evaluate(f"() => !{P}.ui.ado.on"))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        r = pg.evaluate(f"""async () => {{ const P = {P}; P.ui.ado.on = true; P.ui.ado.last = 0; await P.adoSync(true);
          const b = document.querySelector('#adoBtn'); const out = [b.dataset.ado, b.dataset.tip, P.ui.ado.error]; P.ui.ado.on = false; P.ui.ado.error = ''; return out; }}""")
        check('sync turned on before (the helper) but no Workshop: the ADO button is red and its tip says what to do', r[0] == 'error' and 'pair this site' in r[1] and 'pair this site' in r[2])
        pg.wait_for_timeout(300)
        r = pg.evaluate("async () => (await fetch('/ado-helper/ado_helper.py', {cache: 'no-store'})).status")
        check('the helper is no longer served', r == 404)
        # ---------- every-sprint offers from another app (Workshop docs/handoffs.md): inside Workshop only ----------
        # A sender (app id example-app) writes an offer to its own handoffs collection, in this browser's storage.
        offer_put = """async ([id, dueDay]) => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'example-app'});
          const before = (await ws.data.get('handoffs')) || {schema: 'example-app.handoffs', version: 1, rev: 0, items: [], deleted: {}};
          const after = structuredClone(before);
          after.items = after.items.filter(h => h.id !== id).concat([{id, to: 'prioritizer', date: '2026-11-03', createdAt: '2026-11-03T13:40:00.000Z',
            text: 'Refinement <b>x</b>', payload: {kind: 'every-sprint', title: id === 'h_cer_ref' ? 'Refinement <b>x</b>' : 'Demo', dueDay, planKind: 'admin', value: 3, effort: 'M',
            notes: 'Role: Facilitator.'}, source: {app: 'example-app', id: id.slice(2)}}]);
          ws.data.stamp(before, after); return (await ws.data.put('handoffs', after)).rev; }"""
        pg.evaluate(offer_put, ['h_cer_ref', 2])
        pg.keyboard.press('2'); pg.wait_for_timeout(300)
        check('on its own site, Docket shows no offers from other apps', pg.evaluate(f'{P}.offers().length') == 0 and pg.locator('[data-dp=settings].has-dot').count() == 0)
        pg.keyboard.press('1'); pg.wait_for_timeout(200)
        # Inside a same-origin frame (as in Workshop's shell), with the same data.
        host = ctx.new_page()
        host.on('pageerror', lambda e: errors.append('host: ' + str(e)))
        host.goto(SITE + '/manifest.webmanifest')
        host.evaluate("() => { document.body.innerHTML = ''; const f = document.createElement('iframe'); f.src = '/'; f.style.cssText = 'width:1240px;height:760px;border:0'; document.body.appendChild(f); }")
        host.wait_for_timeout(500)
        fr = next(f for f in host.frames if f.url.rstrip('/') == SITE)
        for _ in range(80):
            if fr.evaluate('() => !!(window.__prioritizer && window.__prioritizer.dp && window.__prioritizer.dp.sprint.anchor)'): break
            host.wait_for_timeout(250)
        host.wait_for_timeout(1500)
        # No Workshop app sends these today, so the test adds its sender the way a SENDERS entry would.
        fr.evaluate(f"() => {P}.watchSender('example-app')"); host.wait_for_timeout(300)
        check('inside Workshop, Docket sees the every-sprint offer', fr.evaluate(f'{P}.offers().length') == 1)
        fr.click('main'); host.keyboard.press('2'); host.wait_for_timeout(300)
        check('the Day view gear shows that offers are waiting', fr.locator('[data-dp=settings].has-dot').count() == 1)
        fr.click('[data-dp=settings]'); host.wait_for_timeout(200)
        sheet = fr.text_content('.dsettings')
        check('settings show it as Offered by example-app, escaped', 'Offered by example-app' in sheet and 'Refinement <b>x</b>' in sheet and fr.locator('.doffers b b').count() == 0)
        fr.click('.dsettings [data-offer-accept]'); host.wait_for_timeout(300)
        rec = fr.evaluate(f"() => {P}.dp.recurring.filter(r => r.from && r.from.app === 'example-app')")
        check('Accept adds an every-sprint task marked with where it came from', len(rec) == 1 and rec[0]['from'] == {'app': 'example-app', 'id': 'cer_ref'} and rec[0]['dueDay'] == 2 and rec[0]['value'] == 3 and rec[0]['effort'] == 'M')
        check('it shows in the open settings, with From example-app, and the offer is gone', fr.locator('.dsettings .dfrom', has_text='From example-app').count() == 1 and fr.locator('.dsettings .doffers').count() == 0)
        fr.click('.dsettings [data-savesettings]'); host.wait_for_timeout(300)
        fr.evaluate(f'{P}.saved()'); host.wait_for_timeout(300)
        meta = fr.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').get('prioritizer/dayplan/settings'); q.onsuccess = () => res(q.result && q.result.meta); }; })""")
        check('what was handled is kept in Docket\'s own dayplan/settings', meta is not None and len(meta.get('handled', [])) == 1 and meta['handled'][0].startswith('example-app:h_cer_ref:'))
        # The sender changes the offer: it shows again, and accepting updates the same task.
        rev = host.evaluate(offer_put, ['h_cer_ref', 5]); host.wait_for_timeout(1200)
        check('a changed offer from the same source shows again, as an update', fr.evaluate(f'{P}.offers().length') == 1)
        fr.click('[data-dp=settings]'); host.wait_for_timeout(200)
        check('its button says Update', fr.locator('.dsettings [data-offer-accept]').inner_text() == 'Update')
        fr.click('.dsettings [data-offer-accept]'); host.wait_for_timeout(300)
        rec = fr.evaluate(f"() => {P}.dp.recurring.filter(r => r.from && r.from.app === 'example-app')")
        check('accepting it updates that task instead of adding another', len(rec) == 1 and rec[0]['dueDay'] == 5)
        fr.click('.dsettings [data-close]'); host.wait_for_timeout(200)
        # Dismiss: gone, nothing added. Docket never writes the sender's collection.
        rev = host.evaluate(offer_put, ['h_cer_demo', 3]); host.wait_for_timeout(1200)
        fr.click('[data-dp=settings]'); host.wait_for_timeout(200)
        fr.click('.dsettings [data-offer-dismiss]'); host.wait_for_timeout(300)
        fr.click('.dsettings [data-close]'); host.wait_for_timeout(200)
        fr.evaluate(f'{P}.saved()'); host.wait_for_timeout(300)
        check('Dismiss hides it and adds nothing', fr.evaluate(f'{P}.offers().length') == 0 and fr.evaluate(f"() => {P}.dp.recurring.filter(r => r.from).length") == 1)
        sender = fr.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').get('example-app/handoffs'); q.onsuccess = () => res(q.result && q.result.rev); }; })""")
        check('Docket never writes the sender\'s collection', sender == rev)
        # An accepted capture from the Dispatch hub (Workshop docs/handoffs.md, rule 4) is added as a task with no click.
        host.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'agents'});
          const before = (await ws.data.get('handoffs')) || {schema: 'agents.handoffs', version: 1, rev: 0, items: [], deleted: {}};
          const after = structuredClone(before);
          after.items.push({id: 'c_hub1', to: 'prioritizer', date: '2026-11-03', createdAt: '2026-11-03T22:00:00.000Z', text: 'Keys <b>x</b>',
            payload: {kind: 'task', title: 'Keys <b>x</b> @nobody', who: ['p_one'], waiting: true, urgent: true}, source: {app: 'agents', id: 'c_hub1'}, accepted: true});
          ws.data.stamp(before, after); await ws.data.put('handoffs', after); }"""); host.wait_for_timeout(1500)
        got = fr.evaluate(f"() => {P}.state.tasks.filter(t => t.from && t.from.app === 'agents').map(t => [t.title, t.waiting, t.urgentFlag, t.who])")
        check('an accepted capture from Dispatch becomes a Docket task, once, with its fields', got == [['Keys <b>x</b> @nobody', True, True, ['p_one']]])
        fr.evaluate(f"() => {P}.watchSender('agents')"); host.wait_for_timeout(500)
        check('reading the sender again does not add it twice', fr.evaluate(f"() => {P}.state.tasks.filter(t => t.from && t.from.app === 'agents').length") == 1)
        host.close()
        pg.reload(); pg.wait_for_function('window.__prioritizer && document.querySelector("#syncBtn")', timeout=15000); pg.wait_for_timeout(1000)

        pg.keyboard.press('1'); pg.wait_for_timeout(200)

        # Focus: Start on Today, a switch asks for a breadcrumb, the now bar counts switches and interruptions,
        # finishing stops the task, and it all survives a reload. Then wrap up the day.
        fa, fb = pg.evaluate(f"""() => {{ const P = {P}, d = new Date().toLocaleDateString('en-CA');
          const open = P.state.tasks.filter(t => !t.done).sort((a, b) => a.rank - b.rank).slice(0, 2);
          open.forEach(t => t.focusOn = d); P.commit(); return open.map(t => t.id); }}""")
        pg.wait_for_timeout(200)
        pg.hover(f'.col-today [data-zone=today] > .row[data-id="{fa}"]'); pg.click(f'.col-today [data-zone=today] > .row[data-id="{fa}"] [data-act=start]'); pg.wait_for_timeout(200)
        check('Start on a Today row makes it the task in the now bar', pg.is_visible('#nowbar') and pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{fa}').title") in pg.inner_text('#nowbar .ntitle')
              and pg.locator(f'main .col-today [data-zone=today] > .row.active[data-id="{fa}"]').count() == 1)
        check('the focus band sits above the page header, with a timer, Pause and the tab title',
              pg.evaluate("() => document.querySelector('#nowbar').nextElementSibling.id") == 'phead'
              and pg.inner_text('#nowbar .ntime').strip() == '0m' and pg.locator('#nowbar .npause').count() == 1
              and pg.evaluate('document.title').startswith('\u25CF 0m '))
        pg.click('#phead [data-view="day"]') if pg.locator('#phead [data-view="day"]').count() else pg.keyboard.press('2'); pg.wait_for_timeout(200)
        check('the focus band stays on other views', pg.is_visible('#nowbar'))
        pg.keyboard.press('1'); pg.wait_for_timeout(200)
        pg.click('#nowbar [data-now=crumb]'); pg.wait_for_timeout(200)
        check('the band\'s breadcrumb button asks for one', pg.locator('.modal .crumbsheet').count() == 1)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        pg.hover(f'.col-today [data-zone=today] > .row[data-id="{fb}"]'); pg.click(f'.col-today [data-zone=today] > .row[data-id="{fb}"] [data-act=start]'); pg.wait_for_timeout(200)
        check('switching to another task asks where you left off', pg.locator('.modal .crumbsheet').count() == 1)
        pg.fill('.modal .crumbsheet input', 'next: <b>write</b> the test'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
        crumbs = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{fa}').crumbs")
        check('the breadcrumb is saved on the task it left', crumbs and crumbs[-1]['text'] == 'next: <b>write</b> the test')
        check('the now bar counts the switch', '1 switch' in pg.get_attribute('#nowbar .ncount', 'aria-label'))
        pg.click('#phead h1'); pg.keyboard.press('i'); pg.wait_for_timeout(200)
        check('I logs an interruption', '1 interruption' in pg.get_attribute('#nowbar .ncount', 'aria-label'))
        pg.click('#nowbar [data-now=done]'); pg.wait_for_timeout(300)
        check('Done in the now bar completes the task and stops it', pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{fb}').done")
              and pg.evaluate(f"() => {P}.focusModel.activeOf({P}.focusLog, new Date().toLocaleDateString('en-CA'))") is None)
        check('Today shows where you left off, escaped', 'write' in pg.inner_text(f'.col-today [data-zone=today] > .row[data-id="{fa}"] .crumb') and pg.locator('main .crumb b').count() == 0)
        pg.evaluate(f'{P}.saved()'); pg.wait_for_timeout(300)
        pg.reload(); pg.wait_for_function('window.__prioritizer', timeout=15000); pg.wait_for_timeout(1200)
        cols = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').getAllKeys(); q.onsuccess = () => res(q.result); }; })""")
        check('the focus log is saved as focus/days next to the board, and the counts survive a reload',
              f'prioritizer/focus/days/{y}' in cols and pg.evaluate(f"() => {P}.focusModel.dayCounts({P}.focusLog, new Date().toLocaleDateString('en-CA')).switches") == 1)
        check('with nothing running, the now bar is hidden and Today has a Start button', not pg.is_visible('#nowbar') and pg.locator('#phead [data-now=startnext]').count() == 1
              and not pg.evaluate('document.title').startswith('\u25CF'))
        pg.hover(f'.col-today [data-zone=today] > .row[data-id="{fa}"]'); pg.click(f'.col-today [data-zone=today] > .row[data-id="{fa}"] [data-act=start]'); pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(tempfile.gettempdir(), 'docket-nowbar.png'))
        pg.click('[data-shutdown]'); pg.wait_for_timeout(300)
        check('Wrap up opens the shutdown ritual with the active task to leave a breadcrumb on', pg.locator('.modal .shutdown').count() == 1
              and pg.locator(f'.modal [data-crumb="{fa}"]').count() == 1 and pg.locator(f'.modal [data-pick="{fa}"]:checked').count() == 1)
        pg.fill(f'.modal [data-crumb="{fa}"]', 'pick up at the date edge case')
        pg.screenshot(path=os.path.join(tempfile.gettempdir(), 'docket-shutdown.png'))
        pg.click('.modal .shutdown .btn.primary'); pg.wait_for_timeout(400)
        res = pg.evaluate(f"""() => {{ const P = {P}, d = new Date().toLocaleDateString('en-CA'), t = P.state.tasks.find(t => t.id === '{fa}');
          return {{focusOn: t.focusOn, crumb: t.crumbs.at(-1).text, today: d, wrapped: P.focusModel.dayCounts(P.focusLog, d).wrapped,
            next: P.dayModel.nextWorkday(P.dp.sprint, d), active: P.focusModel.activeOf(P.focusLog, d)}}; }}""")
        check('wrapping up lines the pick up for the next working day, saves the breadcrumb and stops the task',
              res['focusOn'] == res['next'] and res['crumb'] == 'pick up at the date edge case' and res['wrapped'] and res['active'] is None)

        # ---------- delegating: quick add >@, the Assign picker, follow-ups, Got it back, People tray ----------
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        pg.evaluate(f"() => {{ {P}.state.view = 'today'; {P}.commit(); }}"); pg.wait_for_timeout(200)
        dg = pg.evaluate(f"""async () => {{ const P = {P}, m = await import('/js/actions.js'), M = await import('/js/delegate-model.js');
          const t = m.addTask('Draft the RFC >@leadership'); await new Promise(r => setTimeout(r, 300));
          const d = new Date().toLocaleDateString('en-CA');
          return {{waiting: t.waiting, who: t.who.length, nudge: t.nudgeOn, want: M.addWorkdays(d, 2, P.dp.sprint), parsed: P.parseQuick('x >@sam @kim')}}; }}""")
        check('Quick add >@name delegates: waiting, with a follow-up 2 working days out', dg['waiting'] and dg['who'] == 1 and dg['nudge'] == dg['want'])
        check('Quick add: @name involves, >@name delegates', dg['parsed']['people'] == ['sam', 'kim'] and dg['parsed']['delegate'] is True)
        tid = pg.evaluate(f"""async () => {{ const m = await import('/js/actions.js'); const t = m.addTask('Hand this over !3 ~s'); return t.id; }}""")
        pg.evaluate(f"() => {{ {P}.state.view = 'rank'; {P}.commit(); }}"); pg.wait_for_timeout(200)
        pg.click(f'main .row[data-id="{tid}"] .title'); pg.wait_for_timeout(150)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        pg.keyboard.press('a'); pg.wait_for_timeout(200)
        check('A opens the Assign picker with the box focused', pg.locator('.menu .apick-body').count() == 1 and pg.evaluate("document.activeElement.id") == 'apickQ')
        pg.keyboard.type('Dev'); pg.wait_for_timeout(100)
        check('typing filters people and groups', pg.locator('.menu .apk').count() >= 1 and all('Dev' in x for x in pg.locator('.menu .apk .nm').all_inner_texts()))
        pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{tid}')")
        check('Enter delegates to the first match: waiting with a follow-up date', len(t['who']) == 1 and t['waiting'] and t['nudgeOn'] is not None)
        check('a toast offers Undo and Just involve them', 'Delegated to' in pg.inner_text('#toast') and 'Just involve them' in pg.inner_text('#toast'))
        pg.click('#toast button:has-text("Just involve them")'); pg.wait_for_timeout(200)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{tid}')")
        check('Just involve them keeps the person and stops waiting', len(t['who']) == 1 and not t['waiting'] and t['nudgeOn'] is None)
        pg.keyboard.press('w'); pg.wait_for_timeout(200)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{tid}')")
        check('W turns waiting on, with a follow-up date', t['waiting'] and t['nudgeOn'] is not None)
        # Due follow-up: Today shows it in Needs you, Nudged pushes it, Got it back ends the wait and marks it came back.
        pg.evaluate(f"""() => {{ const P = {P}, t = P.state.tasks.find(t => t.id === '{tid}'); const d = new Date(); d.setDate(d.getDate() - 1);
          t.nudgeOn = d.toLocaleDateString('en-CA'); P.state.view = 'today'; P.commit(); }}"""); pg.wait_for_timeout(200)
        check('Today: Needs you shows follow-ups due', pg.locator('.needs [data-need=nudges]').count() == 1)
        pg.click('.needs [data-need=nudges]'); pg.wait_for_timeout(150)
        check('the follow-ups panel lists the task with Nudged and Got it back', pg.locator(f'.needp .row[data-id="{tid}"] [data-act=nudged]').count() == 1)
        pg.click(f'.needp .row[data-id="{tid}"] [data-act=nudged]'); pg.wait_for_timeout(200)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{tid}')")
        check('Nudged moves the follow-up forward and leaves a breadcrumb', t['nudgeOn'] > pg.evaluate("new Date().toLocaleDateString('en-CA')") and t['crumbs'][-1]['text'].startswith('Nudged'))
        check('Waiting on others groups by person, with the follow-up buttons', pg.locator(f'.col-today .wgrp .row[data-id="{tid}"] [data-act=gotback]').count() == 1)
        pg.click(f'.col-today .wgrp .row[data-id="{tid}"] [data-act=gotback]'); pg.wait_for_timeout(200)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{tid}')")
        check('Got it back stops waiting and marks it came back', not t['waiting'] and t['nudgeOn'] is None and t.get('cameBack'))
        inbox_ids = lambda: pg.evaluate("() => [...document.querySelectorAll('.col-inbox .inrows .row[data-id]')].map(r => r.dataset.id)")
        card_title = lambda: pg.input_value('#triTitle') if pg.locator('#triTitle').count() else ''
        check('it shows in the Inbox, marked Came back', tid in inbox_ids() or card_title() == 'Hand this over')
        pg.keyboard.press('3'); pg.wait_for_timeout(200)
        for _ in range(12):
            if card_title() in ('Hand this over', ''): break
            pg.keyboard.press('s'); pg.wait_for_timeout(120)
        check('it can be the triage card, which says Came back', card_title() == 'Hand this over' and pg.locator('.tri-card .chip.cb').count() == 1)
        pg.keyboard.press(' '); pg.wait_for_timeout(100); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{tid}')")
        check('saving it from the Inbox (with Today on) handles Came back', 'cameBack' not in t and t['focusOn'] == pg.evaluate("new Date().toLocaleDateString('en-CA')"))
        inbox_n = "async () => (await import('/js/state.js')).inboxQueue().length"
        n0 = pg.evaluate(inbox_n)
        if n0:
            pg.keyboard.press('Escape'); pg.keyboard.press('3'); pg.wait_for_timeout(200); pg.keyboard.press('3'); pg.keyboard.press('w'); pg.wait_for_timeout(100); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
            check('triage keys in the Inbox save and go to the next one', pg.evaluate(inbox_n) == n0 - 1 and pg.evaluate(f"{P}.state.view") == 'today')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        if pg.locator('.col.colon').count(): pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
        check('Esc leaves the Inbox column', pg.locator('.col.colon').count() == 0)
        check('the sidebar has Today on top and the review views under it', pg.inner_text('#snav .snav-h') .strip().lower() == 'review')
        # People: the Unassigned tray, drag a task onto a card to delegate it.
        uid = pg.evaluate(f"""async () => {{ const m = await import('/js/actions.js'); return m.addTask('Tray task').id; }}""")
        pg.keyboard.press('5'); pg.wait_for_timeout(300)
        check('People has an Unassigned tray with tasks that have no one on them', pg.locator(f'.ptray .row[data-id="{uid}"]').count() == 1)
        pg.fill('#ptrayQ', 'zzz-no-match'); pg.wait_for_timeout(100)
        check('the tray filter narrows it', pg.locator('.ptray .row').count() == 0)
        pg.fill('#ptrayQ', 'Tray task'); pg.wait_for_timeout(100)
        target = pg.locator('.pcard').first.get_attribute('data-person')
        pg.drag_and_drop(f'.ptray .row[data-id="{uid}"]', f'.pcard[data-person="{target}"]'); pg.wait_for_timeout(300)
        t = pg.evaluate(f"() => {P}.state.tasks.find(t => t.id === '{uid}')")
        check('dragging from the tray onto a person delegates it to them', t['who'] == [target] and t['waiting'] and t['nudgeOn'] is not None)
        check('their card lists it under Waiting on them', pg.locator(f'.pcard[data-person="{target}"] .row[data-id="{uid}"]').count() == 1)
        pg.click('[data-pfilter=team]'); pg.wait_for_timeout(150)
        check('My team and Everyone filter the cards', pg.evaluate("window.__prioritizer.ui.peopleFilter") == 'team')
        pg.click('[data-pfilter=all]'); pg.wait_for_timeout(150)
        pg.fill('#ptrayQ', '')
        pg.evaluate(f"""() => {{ const P = {P}; P.state.tasks = P.state.tasks.filter(t => !['{tid}', '{uid}'].includes(t.id) && t.title !== 'Draft the RFC'); P.state.view = 'today'; P.commit(); return P.saved(); }}""")
        pg.wait_for_timeout(200)

        # ---------- row fields: hide optional fields on rows, alerts still show ----------
        rf = pg.evaluate(f"""() => {{ const P = {P}, d = new Date().toLocaleDateString('en-CA');
          const add = (n, x) => {{ const c = new Date(d + 'T12:00'); c.setDate(c.getDate() + n); return c.toLocaleDateString('en-CA'); }};
          const base = {{done: false, value: 3, effort: 'M', ageFrom: d, who: [], listId: P.state.lists[0].id, rank: 0}};
          const html = (t, o) => {{ const div = document.createElement('div'); div.innerHTML = P.row(Object.assign({{}}, base, t), o); return div.firstElementChild; }};
          const all = ['ado','pr','prai','agent','due','repeat','waiting','stale','people','list','crumb','score','start','today'];
          const soon = html({{id: 'x1', title: 'Soon', due: add(2), ado: {{id: 7}}}}, {{hidden: all}});
          const late = html({{id: 'x2', title: 'Late', due: add(-2)}}, {{hidden: all}});
          const pr = html({{id: 'x3', title: 'PR', pr: {{id: 9, repo: 'r', tier: 'blocking', via: []}}}}, {{hidden: all}});
          const nudge = html({{id: 'x4', title: 'Nudge', waiting: true, nudgeOn: add(-1)}}, {{hidden: all}});
          const shown = html({{id: 'x5', title: 'Shown', due: add(2), ado: {{id: 7}}}}, {{start: true, hidden: []}});
          return {{
            soonCal: !!soon.querySelector('.sig.soon'), soonAdo: !!soon.querySelector('.sig.ado'), soonScore: !!soon.querySelector('.score'), soonToday: !!soon.querySelector('.tday'),
            lateCal: !!late.querySelector('.sig.warn'), prNum: !!pr.querySelector('.sig.ado'), prBlock: !!pr.querySelector('.sig.warn'),
            nudge: !!nudge.querySelector('.sig.acc'), shownAll: !!(shown.querySelector('.sig.ado') && shown.querySelector('.sig.soon') && shown.querySelector('.score') && shown.querySelector('.tday') && shown.querySelector('.tstart'))
          }}; }}""")
        check('row fields hide optional fields', not rf['soonCal'] and not rf['soonAdo'] and not rf['soonScore'] and not rf['soonToday'])
        check('row fields keep alerts: overdue, blocking PR (number hidden), nudge due', rf['lateCal'] and rf['prBlock'] and not rf['prNum'] and rf['nudge'])
        check('with nothing hidden every field shows', rf['shownAll'])
        pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
        pg.evaluate(f"() => {{ {P}.state.view = 'today'; {P}.commit(); }}"); pg.wait_for_timeout(200)
        pg.click('#displayBtn'); pg.wait_for_timeout(200)
        check('the Display button opens Row fields with a preview row', pg.locator('.modal .rowfields').count() == 1 and pg.locator('.modal .rfprev .row').count() == 1
              and pg.locator('.modal .rfprev .row .who').count() == 1 and pg.locator('.modal [data-rf]').count() == 15 and pg.locator('.modal .rfprev .row .sig.prod').count() == 1)
        pg.uncheck('.modal [data-rf=score]'); pg.uncheck('.modal [data-rf=people]'); pg.wait_for_timeout(100)
        check('the preview follows the checkboxes', pg.locator('.modal .rfprev .row .score').count() == 0 and pg.locator('.modal .rfprev .row .who').count() == 0)
        pg.screenshot(path=os.path.join(tempfile.gettempdir(), 'docket-rowfields.png'))
        pg.click('.modal [data-close].btn'); pg.wait_for_timeout(150)
        check('Cancel changes nothing', pg.evaluate(f"{P}.state.rowFields.hidden") == [])
        pg.click('#displayBtn'); pg.wait_for_timeout(200)
        pg.uncheck('.modal [data-rf=score]'); pg.uncheck('.modal [data-rf=people]')
        pg.click('.modal [data-rfsave]'); pg.wait_for_timeout(300)
        check('Save hides the fields on the board', sorted(pg.evaluate(f"{P}.state.rowFields.hidden")) == ['people', 'score']
              and pg.locator('main .row').count() > 0 and pg.locator('main .row .score').count() == 0 and pg.locator('main .row .who').count() == 0)
        pg.evaluate(f'{P}.saved()'); pg.wait_for_timeout(300)
        pg.reload(); pg.wait_for_function('window.__prioritizer', timeout=15000); pg.wait_for_timeout(1200)
        check('row fields survive a reload', sorted(pg.evaluate(f"{P}.state.rowFields.hidden")) == ['people', 'score'] and pg.locator('main .row .score').count() == 0)
        pg.click('#displayBtn'); pg.wait_for_timeout(200)
        pg.click('.modal [data-rfreset]'); pg.click('.modal [data-rfsave]'); pg.wait_for_timeout(300)
        check('Reset to defaults shows everything again', pg.evaluate(f"{P}.state.rowFields.hidden") == [])

        pg.wait_for_function('navigator.serviceWorker.controller !== null || navigator.serviceWorker.getRegistration().then(r => !!r)', timeout=10000)
        scope = pg.evaluate("navigator.serviceWorker.getRegistration().then(r => r && r.scope)")
        check('it registers its own service worker for the whole site', scope == SITE + '/')
        pg.wait_for_timeout(1500)
        cached = pg.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(all => all.flat().map(r => new URL(r.url).pathname))")
        check('the service worker precaches the files app.json lists', '/js/people.js' in cached and '/shared/workshop-sdk.js' in cached and '/icons/favicon.svg' in cached)
        # ---------- first-run tour, on a brand new board in a fresh browser profile ----------
        ctx2 = b.new_context(viewport={'width': 1280, 'height': 800})
        p2 = ctx2.new_page()
        p2.on('pageerror', lambda e: errors.append('tour: ' + str(e)))
        p2.goto(SITE + '/'); p2.wait_for_function('window.__prioritizer', timeout=15000); p2.wait_for_timeout(1200)
        check('a brand new board opens the tour', p2.locator('.sheet.tour').count() == 1 and 'Welcome to Docket' in p2.inner_text('.sheet.tour'))
        check('it says where the board is saved', 'saved in this browser' in p2.inner_text('.sheet.tour'))
        p2.click('.tour [data-next]'); p2.wait_for_timeout(150)
        p2.fill('#tourIn', 'My first task'); p2.click('.tour [data-tag="!3"]'); p2.keyboard.press('Enter'); p2.wait_for_timeout(200)
        p2.click('.tour [data-samples]'); p2.wait_for_timeout(200)
        st = p2.evaluate("() => { const s = window.__prioritizer.state, l = s.lists.find(l => l.name === 'Samples'); return {first: s.tasks.find(t => t.title === 'My first task'), samples: l ? s.tasks.filter(t => t.listId === l.id).length : 0}; }")
        check('tasks added in the tour use the tags', st['first'] is not None and st['first']['value'] == 3)
        check('sample tasks land in their own Samples list', st['samples'] == 6)
        p2.click('.tour [data-next]'); p2.wait_for_timeout(150)
        check('the tour explains how Docket decides', 'How Docket decides' in p2.inner_text('.sheet.tour'))
        p2.click('.tour [data-next]'); p2.wait_for_timeout(150)
        p2.click('#tourSprint button.primary'); p2.wait_for_timeout(300)
        check('the optional sprint step saves a sprint and example templates', p2.evaluate("window.__prioritizer.dp.sprint.anchor") is not None and p2.evaluate("window.__prioritizer.dp.templates.length") == 3)
        p2.locator('.tour .trow [data-p=on]').first.check()
        p2.click('.tour [data-next]'); p2.wait_for_timeout(300)
        check('checked every-sprint presets are saved', p2.evaluate("window.__prioritizer.dp.recurring.map(r => r.title)") == ['Sprint planning'])
        p2.click('.tour [data-next]'); p2.wait_for_timeout(200)
        check('finishing closes the tour on Today', p2.locator('.sheet.tour').count() == 0 and p2.evaluate("window.__prioritizer.state.view") == 'today')
        p2.evaluate('window.__prioritizer.saved()'); p2.wait_for_timeout(300)
        p2.reload(); p2.wait_for_function('window.__prioritizer', timeout=15000); p2.wait_for_timeout(1200)
        check('the tour does not open again after reload', p2.locator('.sheet.tour').count() == 0 and p2.evaluate("!!window.__prioritizer.state.onboarded"))
        p2.keyboard.press('?'); p2.wait_for_timeout(150); p2.click('.modal [data-tour]'); p2.wait_for_timeout(200)
        check('the keyboard help can show the tour again', p2.locator('.sheet.tour').count() == 1)
        p2.click('.tour [data-skip]'); p2.wait_for_timeout(150)
        check('skip closes it', p2.locator('.sheet.tour').count() == 0)
        ctx2.close()

        # ---------- Use sprints off: the setup screen's skip, weekday templates, the gear switch ----------
        ctx3 = b.new_context(viewport={'width': 1280, 'height': 800})
        # A Workshop site's registry declares Docket's settings (Workshop docs/app-settings.md), so Docket links them.
        with open(os.path.join(ROOT, 'app.json')) as f: manifest = json.load(f)
        ctx3.route('**/apps/registry.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'apps': [{'base': '/apps/prioritizer/', 'manifest': manifest}]})))
        p3 = ctx3.new_page()
        p3.on('pageerror', lambda e: errors.append('sprints: ' + str(e)))
        p3.goto(SITE + '/'); p3.wait_for_function('window.__prioritizer', timeout=15000); p3.wait_for_timeout(1200)
        if p3.locator('.sheet.tour').count(): p3.click('.tour [data-skip]'); p3.wait_for_timeout(150)
        Q = 'window.__prioritizer'
        p3.keyboard.press('2'); p3.wait_for_timeout(300)
        check('sprints are on by default: Day asks when a sprint starts', p3.locator('#dpSetup').count() == 1 and p3.evaluate(f'{Q}.dp.sprint.enabled') is True)
        p3.click('[data-dp=nosprints]'); p3.wait_for_timeout(300)
        tpls = p3.evaluate(f'{Q}.dp.templates.map(t => [t.name, t.weekdays])')
        check('"Skip, I don\'t use sprints" turns sprints off and adds weekday templates', p3.evaluate(f'{Q}.dp.sprint.enabled') is False and len(tpls) == 2 and tpls[0][1] == [1, 2, 3, 4] and tpls[1][1] == [5])
        check('Day shows blocks without a sprint, and the header has no sprint', p3.locator('#dpSetup').count() == 0 and 'sprint' not in p3.inner_text('#phead').lower())
        app_set = """() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
          const q = r.result.transaction('data').objectStore('data').get('settings/app-settings'); q.onsuccess = () => res(q.result ? q.result.items : null); }; })"""
        p3.wait_for_timeout(300)
        items = p3.evaluate(app_set)
        check('inside a Workshop site, turning sprints off is saved to Workshop\'s app settings', items is not None and any(i['id'] == 'prioritizer' and i['values'].get('sprints') is False for i in items))
        p3.click('[data-dp=settings]'); p3.wait_for_timeout(200)
        check('settings show Use sprints off, weekday checkboxes, and no sprint start date', p3.locator('.dsettings [data-s=enabled]').is_checked() is False
              and p3.locator('.dsettings [data-tf=wd]').count() > 0 and p3.locator('.dsettings [data-s=anchor]').count() == 0 and 'Workshop' in p3.inner_text('.dsprints'))
        p3.locator('.dsettings [data-ti="1"] [data-tf=wd][data-n="1"]').check(); p3.wait_for_timeout(100)
        check('two templates on one weekday show an error', 'Monday is in' in p3.inner_text('.dsettings .derr'))
        p3.locator('.dsettings [data-ti="1"] [data-tf=wd][data-n="1"]').uncheck(); p3.wait_for_timeout(100)
        p3.click('.dsettings [data-close]'); p3.wait_for_timeout(200)
        # Settings (the Workshop app) turns sprints back on: Docket follows.
        p3.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'settings'}); await ws.appSettings.set({sprints: true}, {app: 'prioritizer'}); }""")
        p3.wait_for_timeout(1500)
        check('Workshop\'s Settings turning sprints on is followed by Docket', p3.evaluate(f'{Q}.dp.sprint.enabled') is True and p3.locator('#dpSetup').count() == 1)
        ctx3.close()

        check('no errors on the page', errors == [])
        if errors: print('\n'.join('  ' + e for e in errors))
        b.close()
    srv.shutdown()
    print(f'\n{len(failed)} failed' if failed else '\nAll checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
