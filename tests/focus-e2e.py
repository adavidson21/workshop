#!/usr/bin/env python3
"""End-to-end check of focus hours and lunch (docs/focus.md) in headless Chromium, with a fake clock.

  pip install playwright && python -m playwright install chromium
  python tests/focus-e2e.py

Browser mode on a static site (127.0.0.1:8812). Monday 9 November 2026, focus 09:00 to 12:00, lunch 12:00 to
13:00 (the defaults). Other apps' summaries (a held card, Docket's blocking PRs and Day plan) are written here
through the SDK as those apps would, so the shell, Home, Dispatch and Settings can be checked on their own.
CHROME_PATH runs a Chrome already on the machine instead of Playwright's Chromium.
Exit 1 if any check fails.
"""
import datetime, functools, os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
e2e = import_module('e2e')

HUB = 'http://127.0.0.1:8812'
DAY = '2026-11-09'
failed = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def at(hh, mm=0):
    return datetime.datetime(2026, 11, 9, hh, mm, 0)


def get(page, app, coll):
    return page.evaluate("""async ([app, coll]) => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'home'}); return ws.data.get(coll, {app}); }""", [app, coll])


def summary_card(page, app, card):
    """Adds or replaces one card in an app's summary, as that app would write it."""
    return page.evaluate("""async ([app, card]) => {
      const {connect} = await import('/shared/workshop-sdk.js');
      const ws = await connect({app});
      for (let i = 0; i < 3; i++) {
        const env = await ws.data.get('summary');
        const base = env || {schema: app + '.summary', version: 1, rev: 0, items: [], deleted: {}};
        const c = Object.assign({}, card, {updatedAt: Date.now()});
        const next = Object.assign({}, base, {items: base.items.filter(x => x.id !== c.id).concat([c])});
        try { await ws.data.put('summary', next); return true; } catch (e) { if (e.code !== 'conflict') throw e; }
      }
      return false;
    }""", [app, card])


def bar_text(page):
    return page.evaluate("() => { const el = document.getElementById('wfocus'); return el && !el.hidden ? el.innerText.replace(/\\s+/g, ' ').trim() : ''; }")


def wait_bar(page, text, ms=6000):
    try:
        page.wait_for_function("t => { const el = document.getElementById('wfocus'); return !!el && !el.hidden && el.innerText.includes(t); }", arg=text, timeout=ms); return True
    except Exception:
        return False


def frame_of(page, app):
    return next((f for f in page.frames if f'/apps/{app}/' in f.url), None)


def advance(page, hh, mm=0, day=None):
    """Moves the fake clock (one per browser context) to hh:mm and lets the timers due by then run."""
    t = (day or at(0)).replace(hour=hh, minute=mm, second=0)
    page.clock.pause_at(t)
    page.clock.run_for(2000)
    page.wait_for_timeout(400)


def menu(page, label):
    page.click('#wfocus .wf-btn'); page.wait_for_timeout(150)
    page.click(f'#wfocus .wf-menu [role=menu] button:has-text("{label}")'); page.wait_for_timeout(500)


def main():
    e2e.serve(8812, functools.partial(e2e.Static, directory=e2e.ROOT))
    with sync_playwright() as p:
        exe = os.environ.get('CHROME_PATH')
        b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1360, 'height': 860})
        errors = []
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | {pg.url}'))
        pg.clock.install(time=at(8, 29))
        pg.clock.pause_at(at(8, 30))
        # Docket is switched off here, so the summary written below for it (blocking PRs, Day plan) stays as written.
        pg.goto(HUB + '/manifest.webmanifest')
        pg.evaluate("() => localStorage.setItem('workshop.appsOff', JSON.stringify(['prioritizer']))")

        # 1. Focus hours off (nothing saved): the shell, Home and Docket look as before.
        pg.goto(HUB + '/'); pg.clock.run_for(2500); pg.wait_for_timeout(800)
        check('focus hours off: no focus item in the top bar', pg.evaluate("() => { const el = document.getElementById('wfocus'); return !!el && el.hidden; }"))
        hf = frame_of(pg, 'home')
        summary_card(pg, 'runway', {'id': 'needs', 'kind': 'list', 'title': 'Needs you in Runway', 'rows': [{'id': 'x1', 'title': 'Decide on the export format'}]})
        pg.evaluate("location.hash = '#/settings'"); pg.wait_for_timeout(300); pg.evaluate("location.hash = '#/home'"); pg.clock.run_for(61000); pg.wait_for_timeout(800)
        hf = frame_of(pg, 'home')
        check('focus hours off: Home shows every Needs you row, nothing held', 'Decide on the export format' in hf.inner_text('#app') and 'held until' not in hf.inner_text('#app'))

        # 2. Settings, Focus hours: defaults on first open, preview, save.
        pg.evaluate("location.hash = '#/settings/focus'"); pg.clock.run_for(2000); pg.wait_for_timeout(1500)
        sf = frame_of(pg, 'settings')
        sf.wait_for_selector('.fh-form', timeout=8000)
        check('Settings opens Focus hours with the defaults filled in', sf.locator('.fh-day[data-day=mon] input[data-f=start]').input_value() == '09:00' and sf.locator('.fh-day[data-day=sat] .fh-block').count() == 0)
        check('Settings previews today', 'Today: focus 09:00 to 12:00, lunch 12:00 to 13:00' in sf.inner_text('.fh-preview'))
        sf.click('.fh-day[data-day=tue] [data-add]'); pg.wait_for_timeout(200)
        sf.fill('.fh-day[data-day=tue] .fh-block >> nth=1 >> input[data-f=start]', '11:00'); sf.dispatch_event('.fh-day[data-day=tue] .fh-block >> nth=1 >> input[data-f=start]', 'change'); pg.wait_for_timeout(200)
        check('Settings refuses overlapping blocks and disables Save', sf.locator('[data-save][disabled]').count() == 1 and 'overlap' in sf.inner_text('.fh-form'))
        sf.click('.fh-day[data-day=tue] .fh-block >> nth=1 >> [data-remove]'); pg.wait_for_timeout(200)
        check('removing the block makes it valid again', sf.locator('[data-save][disabled]').count() == 0)
        sf.click('[data-save]'); pg.wait_for_timeout(1200); pg.clock.run_for(1000)
        check('saving turns focus hours on: the bar shows Focus', wait_bar(pg, 'Focus'))
        env = get(pg, 'settings', 'focus')
        check('settings.focus v1 is saved with the hours', env and env['schema'] == 'settings.focus' and env['meta']['enabled'] is True and env['meta']['week']['mon'] == [{'start': '09:00', 'end': '12:00'}])

        # 3. Inside focus: badges hidden, Needs you shows only the blocking PR, held count, Peek.
        summary_card(pg, 'prioritizer', {'id': 'blocking', 'kind': 'list', 'title': 'PRs blocked on you', 'rows': [{'id': 't1', 'title': 'PR 41: Fix the login timeout', 'route': 'task/t1', 'flag': 'urgent'}]})
        pg.evaluate("location.hash = '#/slate'"); pg.clock.run_for(2000); pg.wait_for_timeout(1200)
        pg.evaluate("location.hash = '#/settings'"); pg.wait_for_timeout(600)
        stf = frame_of(pg, 'settings')   # Settings sets no badge of its own, so this one stays as sent
        stf.evaluate("() => window.parent.postMessage({workshop: 1, kind: 'request', id: 'b1', method: 'badge', params: {count: 3}}, location.origin)"); pg.wait_for_timeout(300)
        check('before focus a badge shows', pg.inner_text('.app-btn[data-app=settings] .badge') == '3')
        advance(pg, 10, 0)
        check('at 10:00 the bar says Focus until 12:00', wait_bar(pg, 'Focus until 12:00'))
        check('during focus the badge is hidden', pg.locator('.app-btn[data-app=settings] .badge').is_hidden())
        summary_card(pg, 'home', {'id': 'held', 'kind': 'held', 'block': f'{DAY}T09:00', 'count': 2, 'label': '2 captures picked up', 'route': ''})
        pg.clock.run_for(61000)
        pg.wait_for_timeout(800)
        check('the bar counts what apps hold', wait_bar(pg, '2 held'))
        pg.evaluate("location.hash = '#/home'"); pg.clock.run_for(61000); pg.wait_for_timeout(1000)
        hf = frame_of(pg, 'home'); txt = hf.inner_text('#app')
        if os.environ.get('DEBUG'): print('HOME:', txt[-900:])
        check('Home Needs you during focus: only the blocking PR, the rest held until the span ends at 1:00', 'PR 41: Fix the login timeout' in txt and 'Decide on the export format' not in txt and '1 item held until 1:00' in txt)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        pg.click('#wfocus .wf-btn'); pg.wait_for_timeout(200)
        pg.click('#wfocus [data-fx=peek]'); pg.wait_for_timeout(800)
        if os.environ.get('DEBUG'): print('PEEK:', pg.inner_text('#wfocus'))
        check('Peek lists held items by app', 'needs you' in pg.inner_text('#wfocus .wf-peek').lower() and '2 captures picked up' in pg.inner_text('#wfocus .wf-peek'))
        # The held list reloads after a short wait and the bar redraws every minute; Peek must stay open through both.
        pg.clock.run_for(61000); pg.wait_for_timeout(800)
        check('Peek stays open after the held list reloads and the bar redraws', pg.locator('#wfocus .wf-menu .wf-peek').count() == 1 and '2 captures picked up' in pg.inner_text('#wfocus .wf-peek'))
        pg.click('#wfocus .wf-held'); pg.wait_for_timeout(800)
        check('following a Peek link opens the app and focus stays on', pg.is_visible('#spanel') and wait_bar(pg, 'Focus until 12:00'))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

        # A held toast is dropped by the shell during focus; a blocking one breaks through.
        hf = frame_of(pg, 'home')
        hf.evaluate("() => window.parent.postMessage({workshop: 1, kind: 'request', id: 't1', method: 'toast', params: {text: 'Held pickup', hold: true}}, location.origin)"); pg.wait_for_timeout(300)
        check('a held toast does not show during focus', 'Held pickup' not in (pg.inner_text('#toast') or ''))
        hf.evaluate("() => window.parent.postMessage({workshop: 1, kind: 'request', id: 't2', method: 'toast', params: {text: 'PR 41 blocked on you', hold: true, breakThrough: true}}, location.origin)"); pg.wait_for_timeout(300)
        check('a blocking PR toast breaks through focus', 'PR 41 blocked on you' in pg.inner_text('#toast'))

        # 4. Focus straight into lunch: no toast, the cover, Just a minute, working through, Take lunch now.
        pg2 = ctx.new_page(); pg2.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | tab 2'))
        pg2.goto(HUB + '/#/settings'); pg.clock.run_for(2500); pg2.wait_for_timeout(1500)
        advance(pg, 11, 59)
        pg.evaluate("() => { const t = document.getElementById('toast'); t.classList.remove('show'); t.innerHTML = ''; }")
        advance(pg, 12, 0)
        check('focus into lunch: no release toast', 'Focus done' not in (pg.inner_text('#toast') or ''))
        check('lunch: the bar says Lunch until 1:00', wait_bar(pg, 'Lunch until 1:00'))
        check('the lunch cover shows in every tab', pg.locator('.lunch-cover').is_visible() and pg2.locator('.lunch-cover').is_visible())
        check('the cover says when lunch ends', 'Back at 1:00' in pg.inner_text('.lunch-cover'))
        pg.click('.lunch-cover [data-fx=cover-minute]'); pg.wait_for_timeout(200)
        check('Just a minute hides the cover', pg.locator('.lunch-cover').count() == 0)
        pg2.click('.lunch-cover [data-fx=cover-minute]'); pg2.wait_for_timeout(200)
        # 10 active minutes after the 5 minute pause: a key press each minute.
        advance(pg, 12, 5)
        for m in range(6, 17):
            pg.clock.pause_at(at(12, m)); pg.clock.run_for(1000)
            pg.mouse.click(700, 400); pg.keyboard.press('Shift')
        pg.clock.run_for(61000); pg.wait_for_timeout(500)
        check('10 active minutes in lunch show the working-through bar', pg.locator('.focus-bar').is_visible() and 'Still working through lunch' in pg.inner_text('.focus-bar'))
        if pg.locator('.lunch-cover').count(): pg.click('.lunch-cover [data-fx=cover-minute]'); pg.wait_for_timeout(200)   # it came back after 5 minutes
        pg.click('.focus-bar [data-fx=take-60]'); pg.wait_for_timeout(1000)
        if os.environ.get('DEBUG'): print('BAR:', bar_text(pg), get(pg, 'settings', 'focus')['items'])
        check('Take lunch now starts a late lunch', wait_bar(pg, 'Lunch until 1:1'))
        check('the second tab follows', wait_bar(pg2, 'Lunch until 1:1', 8000))
        late = get(pg, 'settings', 'focus')
        day = next(i for i in late['items'] if i['id'] == DAY)
        check('the late lunch is in the day item', len(day['lunch']['late']) == 1)
        # Lunch (the late one) ends: one release toast, in one of the two tabs.
        until = day['lunch']['late'][0]['end']
        hh, mm = int(until[:2]), int(until[3:])
        for page in (pg, pg2): page.evaluate("() => { const t = document.getElementById('toast'); t.classList.remove('show'); t.innerHTML = ''; }")
        advance(pg, hh, mm); pg.wait_for_timeout(1000)
        shown = [('Lunch done' in (x.inner_text('#toast') or '')) and x.evaluate("() => document.getElementById('toast').classList.contains('show')") for x in (pg, pg2)]
        check('lunch end gives one release toast in one of two open tabs', shown.count(True) == 1)
        which = pg if shown[0] else pg2
        check('the release toast names what was held', '2 captures picked up' in which.inner_text('#toast'))
        check('the badge is back after the span', pg.inner_text('.app-btn[data-app=settings] .badge') == '3')
        pg2.close()

        # 5. Loom's Inbox shows the digest card after focus ends.
        pg.evaluate("location.hash = '#/slate/inbox'"); pg.wait_for_timeout(500)
        af = None
        for _ in range(20):   # Dispatch paints on timers, and the clock only moves when told to
            pg.clock.run_for(1000); pg.wait_for_timeout(300)
            af = frame_of(pg, 'slate')
            if af and af.locator('.digest').count(): break
        if os.environ.get('DEBUG'): print('DISPATCH:', af.inner_text('#app')[:300])
        check('Loom shows While you were focused after the span', af.locator('.digest').count() == 1 and '2 captures picked up' in af.inner_text('.digest'))
        if af.locator('.digest [data-digest-dismiss]').count(): af.click('.digest [data-digest-dismiss]'); pg.clock.run_for(2000); pg.wait_for_timeout(500)
        check('Dismiss hides the digest', af.locator('.digest').count() == 0)

        # 6. Start focus now, End early, Skip today, Undo skip, from the bar and the palette.
        advance(pg, 15, 0)
        menu(pg, 'Start focus now, 25 min')
        check('Start focus now from the bar', wait_bar(pg, 'Focus until 3:25'))
        menu(pg, 'End early')
        check('End early from the bar', wait_bar(pg, 'Focus') and 'until' not in bar_text(pg))
        pg.keyboard.press('Control+k'); pg.keyboard.type('Start focus'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
        if os.environ.get('DEBUG'): print('BAR2:', bar_text(pg))
        check('Start focus from the palette', wait_bar(pg, 'Focus until'))
        pg.keyboard.press('Control+k'); pg.keyboard.type('End focus early'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
        check('End focus early from the palette', 'until' not in bar_text(pg))

        # 7. Missed lunch offer the next day, Skip today and Undo skip, the Day plan.
        pg.clock.pause_at(datetime.datetime(2026, 11, 10, 8, 0)); pg.clock.run_for(61000); pg.wait_for_timeout(600)
        pg.keyboard.press('Control+k'); pg.keyboard.type('Skip focus today'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
        check('Skip today from the palette', wait_bar(pg, 'Focus skipped today'))
        menu(pg, 'Undo skip')
        check('Undo skip from the bar', wait_bar(pg, 'Focus') and 'skipped' not in bar_text(pg))
        # Lunch with 30 active minutes is missed; the offer takes a late lunch.
        pg.clock.pause_at(datetime.datetime(2026, 11, 10, 12, 0)); pg.clock.run_for(1000); pg.wait_for_timeout(500)
        if pg.locator('.lunch-cover [data-fx=cover-minute]').count(): pg.click('.lunch-cover [data-fx=cover-minute]')
        for m in range(1, 59):
            pg.clock.pause_at(datetime.datetime(2026, 11, 10, 12, m)); pg.clock.run_for(500)
            if pg.locator('.lunch-cover [data-fx=cover-minute]').count(): pg.click('.lunch-cover [data-fx=cover-minute]')
            pg.mouse.click(700, 400)
        if pg.locator('.focus-bar [data-fx=push-30]').count(): pg.locator('.focus-bar').evaluate('el => el.remove()')
        pg.clock.pause_at(datetime.datetime(2026, 11, 10, 13, 1)); pg.clock.run_for(61000); pg.wait_for_timeout(1500)
        check('an active lunch is missed and the bar offers a late lunch', wait_bar(pg, 'Lunch missed'))
        pg.click('#wfocus [data-fx=take-30]'); pg.wait_for_timeout(1000)
        check('Take 30 min starts a late lunch', wait_bar(pg, 'Lunch until 1:3'))
        check('the late lunch has its own cover', pg.locator('.lunch-cover').count() == 1)
        if pg.locator('.lunch-cover').count(): pg.click('.lunch-cover [data-fx=cover-minute]'); pg.wait_for_timeout(200)
        menu(pg, 'End lunch')
        check('End lunch from the bar', 'Lunch until' not in bar_text(pg))
        # Push lunch on the next day, from the palette.
        pg.clock.pause_at(datetime.datetime(2026, 11, 11, 11, 30)); pg.clock.run_for(61000); pg.wait_for_timeout(600)
        pg.keyboard.press('Control+k'); pg.keyboard.type('Push lunch'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
        pg.clock.pause_at(datetime.datetime(2026, 11, 11, 12, 10)); pg.clock.run_for(61000); pg.wait_for_timeout(600)
        check('Push lunch from the palette moves lunch to 12:30', 'Lunch' not in bar_text(pg))
        # Docket's Day plan blocks override Settings.
        summary_card(pg, 'prioritizer', {'id': 'day', 'kind': 'day', 'days': {'2026-11-11': {'blocks': [], 'wrapAt': None, 'wrapped': False, 'offered': 0, 'focus': [{'start': '14:00', 'end': '15:30'}], 'lunch': {'start': '13:15', 'end': '13:45'}}}})
        pg.clock.pause_at(datetime.datetime(2026, 11, 11, 14, 10)); pg.clock.run_for(61000); pg.wait_for_timeout(800)
        check('Day plan focus overrides Settings hours', wait_bar(pg, 'Focus until 3:30'))
        pg.clock.pause_at(datetime.datetime(2026, 11, 11, 15, 40)); pg.clock.run_for(61000); pg.wait_for_timeout(800)

        # 8. Settings History shows the days' outcomes.
        pg.evaluate("location.hash = '#/settings/focus'"); pg.clock.run_for(2000); pg.wait_for_timeout(1200)
        sf = frame_of(pg, 'settings')
        sf.evaluate("() => location.reload()"); pg.clock.run_for(3000); pg.wait_for_timeout(2000)
        sf = frame_of(pg, 'settings')
        try: sf.click('.fh-hist-fold > summary', timeout=8000)  # History folds away (Settings v3)
        except Exception: pass
        try: sf.wait_for_selector('.fh-hist', timeout=8000)
        except Exception: pass
        hist = sf.inner_text('.focus-history') if sf.locator('.focus-history').count() else ''
        if os.environ.get('DEBUG'): print('HIST:', hist, get(pg, 'settings', 'focus')['items'])
        check('History shows each day, a late lunch clearing the missed one', hist.count('Late') == 2 and 'Missed' not in hist and 'Nov 10' in hist)
        check('History shows focus kept against planned', 'of 3h' in hist)

        # 9. Docket inside the shell, during focus: the Inbox folds to a rail and a capture still counts there.
        ctx2 = b.new_context(viewport={'width': 1360, 'height': 860})
        dp = ctx2.new_page(); dp.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | docket'))
        dp.clock.install(time=at(9, 59)); dp.clock.pause_at(at(10, 0))
        dp.goto(HUB + '/'); dp.clock.run_for(3000); dp.wait_for_timeout(800)
        dp.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const F = await import('/shared/focus.js');
          const ws = await connect({app: 'settings'}); await ws.data.put('focus', {schema: 'settings.focus', version: 1, rev: 0, items: [], deleted: {}, meta: F.defaults()}); }""")
        dp.evaluate("location.hash = '#/prioritizer'")
        for _ in range(15):
            dp.clock.run_for(1000); dp.wait_for_timeout(300)
            df = frame_of(dp, 'prioritizer')
            if df and df.evaluate("() => !!window.__prioritizer && !!document.querySelector('.today3')"): break
        df = frame_of(dp, 'prioritizer')
        docket_focus = df.evaluate("() => fetch('js/focus-hours.js').then(r => r.ok)") if df else False
        if not docket_focus:
            print('SKIP  Docket inside the shell: this Docket has no focus hours yet')
        else:
            dp.clock.run_for(61000); dp.wait_for_timeout(600)
            check('Docket inside the shell folds its Inbox to a rail during focus', df.locator('.col-inbox.rail.held').count() == 1)
            before = df.evaluate("() => document.querySelector('.col-inbox.rail .num').textContent.trim()")
            df.evaluate("""() => { const P = window.__prioritizer, s = P.state; s.tasks.push({id: 'cap1', title: 'Captured in focus', notes: '', color: 'sage', rank: 99, value: null, effort: null, due: null, urgentFlag: false,
              listId: s.lists[0].id, done: false, doneAt: null, wontDo: false, createdAt: '2026-11-09', ageFrom: '2026-11-09', waiting: false, nudgeOn: null, focusOn: null, who: []}); P.commit(); }""")
            dp.clock.run_for(1500); dp.wait_for_timeout(400)
            after = df.evaluate("() => document.querySelector('.col-inbox.rail .num').textContent.trim()")
            check('a capture during focus still counts on the rail', int(after) == int(before) + 1)
        ctx2.close()

        check('no page errors', not errors)
        for e in errors: print('  ', e)
        b.close()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
