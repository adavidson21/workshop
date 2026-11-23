#!/usr/bin/env python3
"""End-to-end check of dropping work into Tandem from anywhere (Loom 6.20.0), in headless Chromium.

  pip install playwright && python -m playwright install chromium
  python tests/drop-e2e.py

The real agent (tests/e2e-agent.mjs) with the opencode connector, a synthetic workspace and a fake opencode
(tests/fixtures/dispatch-fixture.mjs), paired with this repo served as the hosted site. Each way in must start the
work with one sentence and one key or click, no form:
  1. Capture: "b <text>" then Enter.
  2. Capture: "b" then a pasted error log, then Enter (one item, diagnosed).
  3. The palette's "Build with Tandem", then a sentence and Enter.
  4. A Docket task with no ADO link: Build with Tandem in its details, and B on a selected task.
  5. Chat's hub: "b <text>" then Enter.
Then: a reload does not start it again, and browser mode (no agent) keeps the drop box filled instead.
Also prints how long each took from the key press to Loom saying it started. Exit 1 if any check fails.
"""
import functools, http.server, json, os, shutil, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTED = 'http://localhost:8815'
failed = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve(port):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()


def frame_of(pg, app):
    return next((f for f in pg.frames if f'/apps/{app}/' in f.url), None)


def main():
    serve(8815)
    fx = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'fixtures', 'dispatch-fixture.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    info = json.loads(fx.stdout.readline())

    def starts():
        """What Loom asked the connector to start so far: the agent's work actions, as opencode saw them."""
        fx.stdin.write(json.dumps({'requests': True}) + '\n'); fx.stdin.flush()
        r = json.loads(fx.stdout.readline())
        return [x for x in r['bodies'] if x['route'].startswith('POST ')]

    def in_workspace(*texts):
        """True when one file in the workspace (where start.local and spikes write the work) holds every text."""
        for d, _, files in os.walk(info['workspace']):
            if '.git' in d.split(os.sep): continue
            for fn in files:
                try:
                    with open(os.path.join(d, fn), encoding='utf-8', errors='ignore') as f: body = f.read()
                except OSError: continue
                if all(t in body for t in texts): return True
        return False

    tmp = tempfile.mkdtemp()
    apps, conns, home = (os.path.join(tmp, d) for d in ('apps', 'connectors', 'home'))
    for name in ('prioritizer', 'chat', 'slate', 'settings'):
        shutil.copytree(os.path.join(ROOT, 'apps', name), os.path.join(apps, name))
    shutil.copytree(os.path.join(ROOT, 'connectors', 'opencode'), os.path.join(conns, 'opencode'))
    os.makedirs(home)
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4381, 'allowedOrigins': [HOSTED], 'features': {'startAtLogin': False, 'hostedMode': True},
                   'connectors': {'opencode': {'enabled': True, 'config': {'workspace': info['workspace'], 'opencode': {'url': info['opencode'], 'startServer': False}, 'pollSeconds': 20}}}}, f)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    a = json.loads(proc.stdout.readline())
    errors = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={'width': 1280, 'height': 800})
            ctx.add_init_script("try { localStorage.setItem('workshop.home.introduced', '1') } catch (e) {}")
            pp = ctx.new_page(); pp.goto(HOSTED + '/manifest.webmanifest')
            pp.evaluate(f"localStorage.setItem('workshop.agent', JSON.stringify({{url: '{a['url']}', token: '{a['token']}'}}))"); pp.close()
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(f"{str(e)[:300]} | {pg.url}"))

            def started(before, what, t0, toast='', ms=15000):
                """Waits for Loom's toast and a new start request; returns the seconds from t0."""
                end = time.time() + ms / 1000
                while time.time() < end:
                    now = starts()
                    if len(now) > before and (not toast or toast in (pg.inner_text('#toast') if pg.locator('#toast').count() else '')):
                        return time.time() - t0, now[before:]
                    pg.wait_for_timeout(150)
                return None, []

            pg.goto(HOSTED + '/#/slate'); pg.wait_for_timeout(1500)
            lf = frame_of(pg, 'slate')
            lf.wait_for_selector('.pill.on', timeout=20000)
            check('Loom is live on the connector', lf.inner_text('.pill') == 'Live')
            timings = {}

            # 1. Capture: b <text>, Enter.
            n = len(starts())
            pg.click('#capBtn'); pg.wait_for_timeout(400)
            pg.fill('.capbar .cap-in', 'b Add retry with backoff to the export job')
            check('Capture says b goes to Tandem and starts on Enter', 'build with tandem' in pg.inner_text('.capbar .cap-preview').lower())
            t0 = time.time(); pg.press('.capbar .cap-in', 'Enter')
            secs, new = started(n, 'capture', t0, 'Started')
            timings['Capture b'] = secs
            check('Capture b <text> + Enter opens Loom and starts it (no form)', secs is not None and pg.url.endswith('#/slate')
                  and in_workspace('Add retry with backoff'))
            if secs is None: print('      starts:', json.dumps(starts()[n:])[:600], '| toast:', pg.inner_text('#toast') if pg.locator('#toast').count() else '')
            check('the capture bar closed and Loom\'s drop box is empty again', not pg.locator('.capbar').is_visible() and frame_of(pg, 'slate').input_value('#ln-drop') == '')

            # Reload: nothing starts again.
            n = len(starts())
            pg.reload(); pg.wait_for_timeout(4000)
            check('a reload after a drop does not start it again', len(starts()) == n and pg.url.endswith('#/slate'))

            # 2. Capture: b, then a pasted log, then Enter: one item, diagnosed.
            n = len(starts())
            pg.click('#capBtn'); pg.wait_for_timeout(400)
            pg.fill('.capbar .cap-in', 'b')
            log = 'TypeError: Cannot read properties of undefined (reading \'id\')\n    at exportRows (export.js:41:12)\n    at retry (queue.js:88:5)'
            pg.evaluate("""t => { const el = document.querySelector('.capbar .cap-in'); el.focus(); const d = new DataTransfer(); d.setData('text/plain', t);
                el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: d, bubbles: true, cancelable: true})); }""", log)
            pg.wait_for_timeout(300)
            prev = pg.inner_text('.capbar .cap-preview').lower()
            check('a pasted log after b is one Tandem item, not one task per line', 'build with tandem' in prev and prev.count('build with tandem') == 1)
            t0 = time.time(); pg.press('.capbar .cap-in', 'Enter')
            secs, new = started(n, 'log', t0, 'Diagnosing')
            timings['Capture pasted log'] = secs
            check('the pasted log starts as a diagnosis, the whole log sent', secs is not None and in_workspace('exportRows', 'queue.js:88'))
            if secs is None: print('      starts:', json.dumps(starts()[n:])[:600], '| toast:', pg.inner_text('#toast') if pg.locator('#toast').count() else '')

            # 3. The palette's Build with Tandem.
            n = len(starts())
            pg.keyboard.press('Control+k'); pg.wait_for_timeout(300)
            pg.keyboard.type('build with tandem'); pg.wait_for_timeout(200); pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
            check('the palette\'s Build with Tandem opens Capture ready for a sentence', pg.locator('.capbar').is_visible() and pg.input_value('.capbar .cap-in').startswith('b '))
            pg.keyboard.type('Which services still call the v1 auth endpoint?')
            t0 = time.time(); pg.keyboard.press('Enter')
            secs, new = started(n, 'palette', t0, 'Looking into it')
            timings['Palette'] = secs
            check('a question from the palette starts as an Ask', secs is not None and (in_workspace('v1 auth endpoint') or 'v1 auth endpoint' in json.dumps(new)))

            # 4. Docket: a task with no ADO link.
            pg.evaluate("location.hash = '#/prioritizer'"); pg.wait_for_timeout(2500)
            df = frame_of(pg, 'prioritizer')
            skip = df.locator('[data-skip]')
            if skip.count() and skip.first.is_visible(): skip.first.click(); pg.wait_for_timeout(200)
            df.evaluate("""() => { const P = window.__prioritizer;
              P.state.tasks.push({id: 'd1', title: 'Make the CSV export include archived rows', notes: 'Finance asked for it.', listId: P.state.lists[0].id, value: 3, effort: 'S', created: '2026-11-20'});
              P.state.tasks.push({id: 'd2', title: 'Write the onboarding checklist for new hires', listId: P.state.lists[0].id, value: 2, effort: 'S', created: '2026-11-20'});
              P.state = P.sanitize(P.state); P.commit(); }""")
            pg.wait_for_timeout(600)
            df.evaluate("id => window.__prioritizer.openDrawer(id)", 'd1'); pg.wait_for_timeout(500)
            btn = df.locator('[data-d=build]')
            check('a plain Docket task has Build with Tandem in its details', btn.count() == 1 and btn.is_visible())
            n = len(starts())
            t0 = time.time(); btn.click() if btn.count() else None
            secs, new = started(n, 'docket', t0, 'Started')
            timings['Docket button'] = secs
            check('Build with Tandem starts the task in Loom, with its notes and a link back', secs is not None and pg.url.endswith('#/slate')
                  and in_workspace('archived rows'))
            if secs is None: print('      starts:', json.dumps(starts()[n:])[:600])
            check('the started work carries the task\'s notes and its Docket link', in_workspace('archived rows', 'Finance asked for it', 'ws:prioritizer/task/d1'))

            pg.evaluate("location.hash = '#/prioritizer'"); pg.wait_for_timeout(1500)
            df = frame_of(pg, 'prioritizer')
            df.evaluate("id => window.__prioritizer.openDrawer(id)", 'd2'); pg.wait_for_timeout(300)
            df.press('#drawer', 'Escape'); pg.wait_for_timeout(300)
            row = '.row[data-id="d2"]'
            check('the task is on the list to select', df.locator(row).count() >= 1)
            df.focus(row); pg.wait_for_timeout(200)
            n = len(starts())
            t0 = time.time(); df.press(row, 'b')
            secs, new = started(n, 'docket-b', t0, 'Started')
            timings['Docket B key'] = secs
            check('B on a selected Docket task starts it in Loom', secs is not None and in_workspace('onboarding checklist'))

            # 5. Chat's hub.
            pg.evaluate("location.hash = '#/chat'"); pg.wait_for_timeout(2500)
            cf = frame_of(pg, 'chat')
            cf.wait_for_selector('#hub .cap-in', timeout=10000)
            n = len(starts())
            cf.fill('#hub .cap-in', 'b Add a dark mode toggle to the report page')
            t0 = time.time(); cf.press('#hub .cap-in', 'Enter')
            secs, new = started(n, 'hub', t0, 'Started')
            timings['Chat hub'] = secs
            check('Chat\'s hub b <text> + Enter starts it in Loom', secs is not None and pg.url.endswith('#/slate') and in_workspace('dark mode toggle'))

            print('\nFrom the key press to "started" (seconds):')
            for k, v in timings.items(): print(f'  {k:20} {"-" if v is None else f"{v:.2f}"}')

            # Browser mode: no agent. The drop box keeps it filled, and says what works instead.
            bctx = b.new_context(viewport={'width': 1280, 'height': 800})
            bctx.add_init_script("try { localStorage.setItem('workshop.home.introduced', '1') } catch (e) {}")
            bp = bctx.new_page(); bp.on('pageerror', lambda e: errors.append(f"{str(e)[:300]} | browser mode"))
            bp.goto(HOSTED + '/#/slate/start/go/' + 'Add%20a%20health%20check%20endpoint'); bp.wait_for_timeout(2500)
            bf = frame_of(bp, 'slate')
            check('without the agent, start/go leaves the drop box filled (nothing lost)', bf is not None and bf.input_value('#ln-drop') == 'Add a health check endpoint')
            bctx.close()
            b.close()
    finally:
        proc.stdin.close(); proc.terminate(); fx.stdin.close(); fx.terminate()
        shutil.rmtree(tmp, ignore_errors=True)
    check('no page errors', not errors)
    for e in errors: print('      ', e)
    print(f'\n{len(failed)} failed' if failed else '\nAll passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
