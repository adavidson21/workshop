#!/usr/bin/env python3
"""End-to-end check of the hub in headless Chromium, against a mock eng-agents live dashboard.

  pip install playwright && python -m playwright install chromium
  python tests/e2e.py

Serves this repo on 127.0.0.1:8802 and a mock dashboard on 127.0.0.1:4300 (the mock speaks the
shell API from eng-agents docs/shell-api.md). Exit 1 if any check fails.
"""
import functools, http.server, json, os, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB = 'http://127.0.0.1:8802'
ENG = 'http://127.0.0.1:4300'
LOG = []

STATUS = {'app': 'eng-agents-dashboard', 'api': 1, 'version': '1.5.0', 'workspace': 'work', 'opencode': {'connected': True}, 'error': None,
          'items': [{'id': '123', 'title': 'Fix login', 'lane': 'bug', 'stage': 'build', 'tasks': {'done': 2, 'total': 5},
                     'next': {'command': '/do-task 123 3', 'text': 'Task 3: Add test', 'needsYou': False},
                     'paused': False, 'blocked': False, 'agent': 'busy', 'waiting': False, 'autopilot': None}],
          'starting': []}
PAGE = f"""<!doctype html><body><h3>Mock dashboard</h3><script>
addEventListener('message', e => {{ if (e.origin === '{HUB}') fetch('/log', {{method: 'POST', body: JSON.stringify(e.data)}}); }});
parent.postMessage({{type: 'eng-ready'}}, '{HUB}');
</script>"""


class Mock(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', HUB)
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def reply(self, code, body, ctype='application/json', shell=False):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        if shell: self.cors()
        if ctype == 'text/html': self.send_header('Content-Security-Policy', f"frame-ancestors 'self' {HUB}")
        self.end_headers(); self.wfile.write(body.encode())

    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.end_headers()

    def do_GET(self):
        if self.path == '/api/shell/status':
            return self.reply(200 if self.headers.get('Origin') == HUB else 403, json.dumps(STATUS), shell=True)
        self.reply(200, PAGE, 'text/html')

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode() or '{}'
        if self.path == '/log': LOG.append(json.loads(body)); return self.reply(200, '{}')
        if self.path == '/api/shell/start': LOG.append({'start': json.loads(body)}); return self.reply(200, '{"ok":true}', shell=True)
        self.reply(404, '{}')


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve(port, handler):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


def add_ado_task(frame, tid, title, ado_id, typ):
    frame.evaluate("""([tid, title, id, typ]) => { const P = window.__prioritizer;
      P.state.tasks.push({id: tid, title, listId: P.state.lists[0].id, value: 3, effort: 'S', created: '2026-10-14', ado: {id, type: typ, state: 'Active', url: 'http://ado/' + id, project: 'p'}});
      P.state = P.sanitize(P.state); P.commit(); }""", [tid, title, ado_id, typ])


def main():
    serve(8802, functools.partial(Static, directory=ROOT))
    serve(4300, Mock)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        errors, csp, requests = [], [], []
        # Every request from every page and frame, including the service worker's.
        ctx.on('request', lambda r: requests.append(r.url))
        def watch(page):
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: csp.append(m.text) if 'Content Security Policy' in m.text else None)
        pg = ctx.new_page(); watch(pg)

        # Settings saved under the EM Hub names, as an existing install has them.
        pg.goto(HUB + '/manifest.webmanifest')
        pg.evaluate("""() => { localStorage.setItem('em.theme', 'dracula'); localStorage.setItem('prioritizer.theme', 'ivory');
          localStorage.setItem('em.eng', JSON.stringify({on: false, port: 4300})); }""")

        pg.goto(HUB + '/'); pg.wait_for_timeout(800)
        keys = pg.evaluate("() => Object.fromEntries(['workshop.theme', 'em.theme', 'prioritizer.theme', 'workshop.eng', 'em.eng'].map(k => [k, localStorage.getItem(k)]))")
        check('theme survives the rename', keys['workshop.theme'] == 'dracula' and pg.evaluate('document.documentElement.dataset.theme') == 'dracula')
        check('dashboard settings survive the rename', json.loads(keys['workshop.eng'] or '{}') == {'on': False, 'port': 4300})
        check('old setting keys are removed', keys['em.theme'] is None and keys['prioritizer.theme'] is None and keys['em.eng'] is None)
        check('old globals are gone', pg.evaluate("() => !window.EmHub && !window.EmTheme && !window.EmSw && !!window.WorkshopHub && !!window.WorkshopTheme && !!window.WorkshopSw"))
        check('opens on Prioritizer at the plain address', pg.url == HUB + '/' and pg.title() == 'Prioritizer · Workshop')
        frame = next(f for f in pg.frames if f.url.endswith('/prioritizer/'))
        check('theme reaches Prioritizer after the rename', frame.evaluate('document.documentElement.dataset.theme') == 'dracula')
        check('Prioritizer hides its theme button in the hub', not frame.locator('#themeBtn').is_visible())
        add_ado_task(frame, 'a1', 'Fix login', '123', 'Bug')
        check('no stage chips before the Dashboard connects', frame.locator('.chip.eng').count() == 0)

        pg.click('.app-btn[data-app=dashboard]'); pg.wait_for_timeout(1500)
        check('Dashboard connects and shows the frame', pg.locator('#pane-dashboard iframe').count() == 1)
        check('Dashboard header shows version and workspace', 'eng-agents 1.5.0 · work' in pg.inner_text('#pane-dashboard .dhead'))
        check('theme sent to the dashboard', any(m.get('type') == 'eng-theme' for m in LOG))

        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(1500)
        chip = frame.locator('.chip.eng')
        check('Alt+1 returns to Prioritizer, plain address', pg.url == HUB + '/')
        check('ADO task shows its stage', chip.count() == 1 and 'Build 2/5' in chip.inner_text())
        chip.click(); pg.wait_for_timeout(1000)
        check('stage chip opens the Dashboard at that item', pg.url.endswith('#/dashboard') and {'type': 'eng-focus', 'id': '123'} in LOG)

        pg.click('#themeBtn'); pg.click('.menu [data-th=nord]'); pg.wait_for_timeout(500)
        check('theme reaches Prioritizer', frame.evaluate('document.documentElement.dataset.theme') == 'nord')
        check('theme reaches the dashboard', {'type': 'eng-theme', 'theme': 'nord'} in LOG)

        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300); frame.click('#main'); pg.keyboard.press('Alt+2'); pg.wait_for_timeout(400)
        check('Alt+2 inside Prioritizer switches apps', pg.url.endswith('#/dashboard'))

        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300)
        add_ado_task(frame, 'a2', 'New story', '456', 'User Story'); pg.wait_for_timeout(300)
        frame.locator('.row', has_text='New story').first.click(); pg.wait_for_timeout(300)
        frame.click('[data-d=eng-start][data-lane=feature]'); pg.wait_for_timeout(600)
        check('Start as feature reaches the dashboard', {'start': {'id': '456', 'lane': 'feature'}} in LOG)

        pg.goto(HUB + '/#/dashboard'); pg.wait_for_timeout(1200)
        pg.click('[data-eng=settings]'); pg.click('[data-eng=off]'); pg.wait_for_timeout(300)
        check('Disconnect turns stages off', pg.evaluate("JSON.parse(localStorage.getItem('workshop.eng')).on") is False)

        sp = ctx.new_page(); watch(sp)
        sp.goto(HUB + '/prioritizer/'); sp.wait_for_timeout(600)
        check('Prioritizer still works on its own', sp.locator('#themeBtn').is_visible() and sp.locator('#snav .sitem').count() == 6)
        tasks = "() => window.__prioritizer.state.tasks.map(t => [t.title, t.ado ? String(t.ado.id) : '']).sort()"
        before = sp.evaluate(tasks)
        check('tasks survive reloads', ['Fix login', '123'] in before and ['New story', '456'] in before)

        # Excel round trip through the vendored SheetJS: export, then import the file with Replace.
        check('self-hosted fonts load', sp.evaluate("() => document.fonts.ready.then(() => ['Inter', 'JetBrains Mono'].every(n => [...document.fonts].some(f => f.family.replace(/\"/g, '') === n && f.status === 'loaded')))"))
        check('SheetJS is the vendored current release', sp.evaluate('window.XLSX && XLSX.version') == '0.20.3')
        with sp.expect_download() as dl: sp.evaluate('exportXlsx()')
        xlsx = os.path.join(tempfile.mkdtemp(), 'export.xlsx'); dl.value.save_as(xlsx)
        with open(xlsx, 'rb') as f: check('Excel export writes an xlsx file', f.read(2) == b'PK')
        sp.evaluate("() => { const P = window.__prioritizer; P.state.tasks = P.state.tasks.filter(t => t.title !== 'Fix login'); P.commit(); }")
        sp.set_input_files('#importFile', xlsx); sp.wait_for_timeout(500)
        sp.click('[data-imp=replace]'); sp.wait_for_timeout(300)
        check('Excel import restores the exported tasks', sp.evaluate(tasks) == before)

        check('no page errors', not errors)
        if errors: print('  ' + '\n  '.join(errors))
        check('no Content Security Policy violations', not csp)
        if csp: print('  ' + '\n  '.join(csp))
        # Only this site and the local helpers on 127.0.0.1. blob: and data: never leave the browser.
        outside = sorted({u for u in requests if not (u.startswith(HUB + '/') or u.startswith('http://127.0.0.1:') or u.startswith(('blob:', 'data:')))})
        check(f'no requests leave the page origin except to 127.0.0.1 ({len(requests)} seen)', not outside)
        if outside: print('  ' + '\n  '.join(outside))
        b.close()
    print('\nAll checks passed.' if not failed else f'\n{len(failed)} failed.')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
