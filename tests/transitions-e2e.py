#!/usr/bin/env python3
"""End-to-end check of focus hours' transitions (docs/focus.md, Heads-up and Day's done) in headless Chromium,
with a fake clock.

  pip install playwright && python -m playwright install chromium
  python tests/transitions-e2e.py

Browser mode on a static site (127.0.0.1:8813). Monday 9 November 2026: focus 09:00 to 11:00 and 14:00 to 16:30,
lunch 12:00 to 13:00, and Docket's day card says the day runs 09:00 to 17:00 (written here through the SDK, as
Docket would, with Docket switched off so it stays as written). Checks the heads-up lines (two tabs, dismiss, reload),
the Day's done cover (Just a minute, quick capture under it, Wrap up), the morning release, Keep working tonight,
and the Settings switch. CHROME_PATH runs a Chrome already on the machine instead of Playwright's Chromium.
Exit 1 if any check fails.
"""
import datetime, functools, os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
e2e = import_module('e2e')

HUB = 'http://127.0.0.1:8813'
MON, TUE, WED = '2026-11-09', '2026-11-10', '2026-11-11'
failed = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def when(day, hh, mm=0):
    y, m, d = (int(x) for x in day.split('-'))
    return datetime.datetime(y, m, d, hh, mm, 0)


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


def advance(page, t):
    """Moves the fake clock (one per browser context) to a minute before t, then runs the timers through t (the
    shell's minute tick runs once in that minute), ending a second after t."""
    page.clock.pause_at(t - datetime.timedelta(minutes=1))
    page.clock.run_for(61000)
    page.wait_for_timeout(500)


def clear_toast(*pages):
    for x in pages: x.evaluate("() => { const t = document.getElementById('toast'); t.classList.remove('show'); t.innerHTML = ''; }")


def toast_shows(page, text):
    return page.evaluate("t => { const el = document.getElementById('toast'); return !!el && el.classList.contains('show') && el.innerText.includes(t); }", text)


def menu(page, label):
    page.click('#wfocus .wf-btn'); page.wait_for_timeout(150)
    page.click(f'#wfocus .wf-menu [role=menu] button:has-text("{label}")'); page.wait_for_timeout(600)


def day_entry(start='09:00', end='17:00', wrapped=False):
    return {'blocks': [], 'wrapAt': '16:00', 'wrapped': wrapped, 'offered': 0, 'start': start, 'end': end}


def main():
    e2e.serve(8813, functools.partial(e2e.Static, directory=e2e.ROOT))
    with sync_playwright() as p:
        exe = os.environ.get('CHROME_PATH')
        b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1360, 'height': 860})
        errors = []
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | {pg.url}'))
        pg.clock.install(time=when(MON, 10, 49))
        pg.clock.pause_at(when(MON, 10, 50))
        pg.goto(HUB + '/manifest.webmanifest')
        pg.evaluate("() => localStorage.setItem('workshop.appsOff', JSON.stringify(['prioritizer']))")
        pg.goto(HUB + '/'); pg.clock.run_for(2500); pg.wait_for_timeout(800)

        # Focus hours on, with a focus block that does not run into lunch, and Docket's day card with the day's end.
        pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const F = await import('/shared/focus.js');
          const ws = await connect({app: 'settings'}); const meta = F.defaults();
          meta.week.mon = [{start: '09:00', end: '11:00'}, {start: '14:00', end: '16:30'}];
          meta.week.tue = [{start: '09:00', end: '11:00'}];
          await ws.data.put('focus', {schema: 'settings.focus', version: 1, rev: 0, items: [], deleted: {}, meta}); }""")
        summary_card(pg, 'prioritizer', {'id': 'day', 'kind': 'day', 'days': {MON: day_entry(), TUE: day_entry(), WED: day_entry()}})
        pg.reload(); pg.clock.run_for(2500); pg.wait_for_timeout(1000)
        check('focus hours on: the bar says Focus until 11:00', wait_bar(pg, 'Focus until 11:00'))
        check('no heads-up line 10 minutes before', pg.locator('#wfocus .wf-heads').count() == 0)

        # 1. Heads-up: 5 minutes before a focus block ends, in both tabs; dismissed once for the browser.
        pg2 = ctx.new_page(); pg2.on('pageerror', lambda e: errors.append(f'{str(e)[:300]} | tab 2'))
        pg2.goto(HUB + '/#/settings'); pg.clock.run_for(2500); pg2.wait_for_timeout(1500)
        advance(pg, when(MON, 10, 55))
        check('heads-up: "Focus ends in 5 min" in the bar', wait_bar(pg, 'Focus ends in 5 min'))
        check('heads-up: the second tab shows it too', wait_bar(pg2, 'Focus ends in'))
        check('heads-up: no toast for it', not toast_shows(pg, 'Focus ends') and not toast_shows(pg2, 'Focus ends'))
        pg.click('#wfocus [data-fx=heads-dismiss]'); pg.wait_for_timeout(600)
        check('dismissing hides it in this tab', pg.locator('#wfocus .wf-heads').count() == 0)
        try: pg2.wait_for_function("() => !document.querySelector('#wfocus .wf-heads')", timeout=4000); gone2 = True
        except Exception: gone2 = False
        check('and in the other tab (once per event per browser)', gone2)
        pg.reload(); pg.clock.run_for(2500); pg.wait_for_timeout(1200)
        advance(pg, when(MON, 10, 57))
        check('a reload does not bring it back', wait_bar(pg, 'Focus until 11:00') and pg.locator('#wfocus .wf-heads').count() == 0)
        advance(pg, when(MON, 11, 55))
        check('heads-up: "Lunch in 5 min" before lunch', wait_bar(pg, 'Lunch in 5 min'))
        advance(pg, when(MON, 12, 1))
        check('the line is gone once lunch starts', pg.locator('#wfocus .wf-heads').count() == 0)
        for x in (pg, pg2):
            if x.locator('.lunch-cover [data-fx=end-lunch]').count(): x.click('.lunch-cover [data-fx=end-lunch]'); x.wait_for_timeout(600)
        advance(pg, when(MON, 16, 55))
        check('heads-up: "Day ends in 5 min" before the day\'s end', wait_bar(pg, 'Day ends in 5 min'))
        check('the day end line shows in the other tab as well', wait_bar(pg2, 'Day ends in'))

        # 2. Day's done: the cover in each tab, held like lunch, Just a minute, quick capture under it.
        pg.evaluate("location.hash = '#/settings'"); pg.wait_for_timeout(500)
        stf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
        stf.evaluate("() => window.parent.postMessage({workshop: 1, kind: 'request', id: 'b1', method: 'badge', params: {count: 3}}, location.origin)"); pg.wait_for_timeout(300)
        check('before the day ends a badge shows', pg.inner_text('.app-btn[data-app=settings] .badge') == '3')
        clear_toast(pg, pg2)
        advance(pg, when(MON, 17, 0))
        check('after the end the bar reads Day\'s done', wait_bar(pg, "Day's done"))
        check('the Day\'s done cover shows in every tab', pg.locator('.done-cover').is_visible() and pg2.locator('.done-cover').is_visible())
        check('the cover offers Wrap up when the day is not wrapped', pg.locator('.done-cover [data-fx=wrap-up]').count() == 1 and "Day's done." in pg.inner_text('.done-cover'))
        check('during Day\'s done the badge is hidden', pg.locator('.app-btn[data-app=settings] .badge').is_hidden())
        summary_card(pg, 'home', {'id': 'held', 'kind': 'held', 'block': f'{TUE}T00:00', 'count': 2, 'label': '2 captures picked up', 'route': ''})
        pg.clock.run_for(61000); pg.wait_for_timeout(800)
        hf = next((f for f in pg.frames if '/apps/home/' in f.url), None)
        hf.evaluate("() => window.parent.postMessage({workshop: 1, kind: 'request', id: 't2', method: 'toast', params: {text: 'PR 41 blocked on you', hold: true, breakThrough: true}}, location.origin)"); pg.wait_for_timeout(300)
        check('nothing breaks through Day\'s done, not even a blocking PR', not toast_shows(pg, 'PR 41 blocked on you'))
        pg.click('.done-cover [data-fx=done-minute]'); pg.wait_for_timeout(300)
        check('Just a minute hides the cover', pg.locator('.done-cover').count() == 0)
        pg.keyboard.press('Control+.'); pg.wait_for_timeout(500)
        check('quick capture still works', pg.locator('.capbar').count() > 0 and pg.locator('.capbar').first.is_visible())
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        advance(pg, when(MON, 17, 10))
        check('the cover stays hidden inside the 15 minutes', pg.locator('.done-cover').count() == 0)
        advance(pg, when(MON, 17, 18))
        check('the cover comes back after 15 minutes', pg.locator('.done-cover').count() == 1)
        pg.evaluate("() => { window.__goes = []; window.addEventListener('hashchange', e => window.__goes.push(new URL(e.newURL).hash)); }")
        pg.click('.done-cover [data-fx=wrap-up]'); pg.wait_for_timeout(600)
        goes = pg.evaluate('window.__goes')
        if os.environ.get('DEBUG'): print('WRAP:', goes, pg.evaluate('location.hash'))
        check('Wrap up opens Docket\'s Wrap up', '#/prioritizer/shutdown' in goes and pg.locator('.done-cover').count() == 0)
        pg.evaluate("location.hash = '#/home'"); pg.wait_for_timeout(300)
        pg.click('#wfocus .wf-btn'); pg.wait_for_timeout(200)
        pg.click('#wfocus [data-fx=peek]'); pg.wait_for_timeout(800)
        check('Peek lists what is held until morning', 'until morning' in pg.inner_text('#wfocus .wf-peek') and '2 captures picked up' in pg.inner_text('#wfocus .wf-peek'))
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        if pg2.locator('.done-cover [data-fx=done-minute]').count(): pg2.click('.done-cover [data-fx=done-minute]')

        # 3. Midnight goes on quietly; the morning releases once, in one toast, in one tab.
        clear_toast(pg, pg2)
        advance(pg, when(TUE, 0, 1))
        check('midnight: no release toast (the night goes on)', not toast_shows(pg, 'held') and not toast_shows(pg2, 'held'))
        advance(pg, when(TUE, 8, 30))
        check('morning: the bar says Day starts at 9:00', wait_bar(pg, 'Day starts at 9:00'))
        check('the morning has no cover', pg.locator('.done-cover').count() == 0)
        clear_toast(pg, pg2)
        advance(pg, when(TUE, 9, 0)); pg.wait_for_timeout(1000)
        shown = [toast_shows(x, 'Good morning. 2 held') for x in (pg, pg2)]
        check('at the start of the day: one release toast in one of two tabs', shown.count(True) == 1)
        which = pg if shown[0] else pg2
        check('the morning toast names what was held overnight', '2 captures picked up' in which.inner_text('#toast'))
        check('the day starts straight into focus', wait_bar(pg, 'Focus until 11:00'))
        pg2.close()
        advance(pg, when(TUE, 11, 1))
        try: pg.wait_for_function("() => { const b = document.querySelector('.app-btn[data-app=settings] .badge'); return !!b && !b.hidden && b.textContent.trim() === '3'; }", timeout=5000); badge = True
        except Exception: badge = False
        check('the badge is back once nothing is held', badge)

        # 4. Keep working tonight: lifts it until midnight, releases at once, no morning hold, worked late in History.
        advance(pg, when(TUE, 17, 5))
        check('Tuesday evening: Day\'s done again', wait_bar(pg, "Day's done"))
        if pg.locator('.done-cover [data-fx=done-minute]').count(): pg.click('.done-cover [data-fx=done-minute]'); pg.wait_for_timeout(200)
        summary_card(pg, 'home', {'id': 'held', 'kind': 'held', 'block': f'{WED}T00:00', 'count': 1, 'label': '1 capture picked up', 'route': ''})
        clear_toast(pg)
        menu(pg, 'Keep working tonight')
        check('Keep working tonight lifts the hold', wait_bar(pg, 'Focus') and "Day's done" not in bar_text(pg))
        check('what was held is released at once', toast_shows(pg, 'Working late. 1 held'))
        env = get(pg, 'settings', 'focus')
        tue = next((i for i in env['items'] if i['id'] == TUE), {})
        check('the day item says when, and logs worked late', tue.get('late') == '17:05' and tue.get('log', {}).get('workedLate') is True)
        advance(pg, when(TUE, 23, 0))
        check('still off at 23:00', "Day's done" not in bar_text(pg))
        advance(pg, when(WED, 7, 0))
        check('no morning hold after working late', 'Day starts' not in bar_text(pg) and wait_bar(pg, 'Focus'))

        # 5. Settings: History shows worked late; "After my day ends" off means no Day's done.
        pg.evaluate("location.hash = '#/settings/focus'"); pg.clock.run_for(2000); pg.wait_for_timeout(1200)
        sf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
        sf.evaluate("() => location.reload()"); pg.clock.run_for(3000); pg.wait_for_timeout(2000)
        pg.evaluate("location.hash = '#/home'"); pg.wait_for_timeout(300); pg.evaluate("location.hash = '#/settings/focus'"); pg.clock.run_for(2000); pg.wait_for_timeout(1200)
        sf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
        try: sf.wait_for_selector('.fh-form', timeout=8000)
        except Exception: pass
        hist = sf.inner_text('.focus-history') if sf.locator('.focus-history').count() else ''
        check('History shows the evening worked late', 'Worked late' in hist)
        check('Settings has "After my day ends", on', sf.locator('[data-after]').count() == 1 and sf.locator('[data-after]').is_checked())
        check('with a hint that the end comes from Docket\'s Day settings', "Docket's Day settings" in sf.inner_text('.fh-form'))
        sf.click('label[for=fhAfter]'); pg.wait_for_timeout(300)
        sf.click('[data-save]'); pg.wait_for_timeout(1200); pg.clock.run_for(1000)
        env = get(pg, 'settings', 'focus')
        check('the switch is saved', env['meta'].get('afterEnd') is False)
        advance(pg, when(WED, 16, 55))
        check('switched off: no day end heads-up', 'Day ends' not in bar_text(pg))
        advance(pg, when(WED, 17, 30))
        check('switched off: no Day\'s done', "Day's done" not in bar_text(pg) and pg.locator('.done-cover').count() == 0)

        check('no page errors', not errors)
        for e in errors: print('  ', e)
        b.close()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
