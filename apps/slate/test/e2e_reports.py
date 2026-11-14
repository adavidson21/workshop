#!/usr/bin/env python3
"""Loom's team reports, in Health, in headless Chrome: this repo served together with a small mock Workshop agent
whose ADO connector answers `dataset` from synthetic data. Checks the section asks for a team profile, fills area
paths from Settings' team, pulls one read-only dataset, renders the six reports with ADO text escaped, exports to
Excel, shows the cached pull after a reload, takes Runway's old profile, and explains itself with the connector off.
Moved from Runway's e2e (Runway 3.0.0).

  pip install playwright && python -m playwright install chromium
  python apps/slate/test/e2e_reports.py

Exit 1 if any check fails."""
import functools, http.server, json, os, re, sys, threading
from playwright.sync_api import sync_playwright

# Workshop's root: Loom is apps/slate/, and its page loads Workshop's shared files.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
PORT = 8816
SITE = f'http://127.0.0.1:{PORT}'
APP = SITE + '/apps/slate/'

STATE = {
    'connector': 'ready',
    'calls': [],
    'data': {'settings/people': {'schema': 'settings.people', 'version': 2, 'rev': 1, 'updatedAt': '2026-11-03T12:00:00.000Z', 'deleted': {}, 'items': [
        {'id': 'p_one', 'kind': 'person', 'updatedAt': 1, 'name': 'Dev One', 'handle': 'one', 'relation': 'report', 'adoIdentity': 'dev.one@example.test'}]},
        'settings/teams': {'schema': 'settings.teams', 'version': 1, 'rev': 1, 'updatedAt': '2026-11-03T12:00:00.000Z', 'deleted': {}, 'items': [
            {'id': 't_mine', 'updatedAt': 1, 'name': 'My team', 'areas': ['Platform\\Wiki'], 'connection': ''}]}},
}
DATASET = {
    'schema': 1, 'days': 42, 'since': '2026-09-23', 'base': 'https://ado.example.test/Main', 'connection': 'work',
    'generatedAt': '2026-11-04T12:00:00.000Z', 'areas': ['Platform\\Wiki'], 'people': ['dev.one@example.test'], 'truncated': False, 'scanned': 2,
    'config': {'highPriorities': [1, 2], 'escalationPriority': 1, 'bugTypes': ['Bug'], 'closedStates': ['Closed'], 'removedStates': ['Removed']},
    'iterations': {},
    'items': [
        {'id': 501, 'title': 'Escalated thing', 'url': 'https://ado.example.test/_workitems/edit/501', 'type': 'User Story', 'state': 'Active', 'priority': 1,
         'area': 'Platform\\Wiki', 'iteration': '', 'assignedTo': 'Dev One', 'assignedEmail': 'dev.one@example.test', 'created': '2026-10-01', 'effort': None, 'effortField': ''},
        {'id': 502, 'title': '<img src=x onerror="window.__pwned=1">', 'url': 'javascript:window.__pwned=1', 'type': 'Bug', 'state': 'Active', 'priority': 2,
         'area': 'Other\\Team', 'iteration': '', 'assignedTo': 'Dev One', 'assignedEmail': 'dev.one@example.test', 'created': '2026-10-20', 'effort': None, 'effortField': ''}
    ],
    'events': [{'id': 501, 'kind': 'priority', 'date': '2026-10-21T10:00:00Z', 'by': 'Exec A', 'from': 3, 'to': 1}]
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

    def send_json(self, code, body):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        p = self.path.split('?')[0]
        if not p.startswith('/api/'):
            return super().do_GET()
        if p == '/api/health': return self.send_json(200, {'app': 'workshop-agent', 'api': 1, 'version': 'mock'})
        if p == '/api/session': return self.send_json(200, {'token': 'mock-token'})
        if p == '/api/apps': return self.send_json(200, {'apps': []})
        if p == '/api/config': return self.send_json(200, {'dataDir': '/mock/Workshop'})
        if p == '/api/connectors':
            on = STATE['connector'] == 'ready'
            return self.send_json(200, {'connectors': [{'id': 'ado', 'enabled': on, 'status': {'state': 'ready' if on else 'disabled', 'message': '' if on else 'Off'}}]})
        if p == '/api/events':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            try:
                self.wfile.write(b': hello\n\n'); self.wfile.flush()
            except Exception:
                pass
            return
        m = re.match(r'^/api/data/([a-z0-9-]+)/(.+)$', p)
        if m:
            env = STATE['data'].get(m.group(1) + '/' + m.group(2))
            return self.send_json(200, env) if env else self.send_json(404, {'code': 'not_found', 'error': 'Not found'})
        if re.match(r'^/api/data/[a-z0-9-]+$', p): return self.send_json(200, {'collections': []})
        return self.send_json(404, {'code': 'not_found', 'error': 'Not found'})

    def do_PUT(self):
        p = self.path.split('?')[0]
        m = re.match(r'^/api/data/([a-z0-9-]+)/(.+)$', p)
        if not m: return self.send_json(404, {'code': 'not_found', 'error': 'Not found'})
        key = m.group(1) + '/' + m.group(2)
        env = self.body()
        cur = STATE['data'].get(key)
        if (cur['rev'] if cur else 0) != env.get('rev'):
            return self.send_json(409, {'code': 'conflict', 'error': 'Changed', 'current': cur})
        env['rev'] = env['rev'] + 1
        env['updatedAt'] = '2026-11-03T12:00:00.000Z'
        STATE['data'][key] = env
        return self.send_json(200, {'rev': env['rev'], 'updatedAt': env['updatedAt']})

    def do_POST(self):
        p = self.path.split('?')[0]
        m = re.match(r'^/api/connectors/([a-z]+)/(.+)$', p)
        if not m: return self.send_json(404, {'code': 'not_found', 'error': 'Not found'})
        body = self.body()
        conn, action, args = m.group(1), m.group(2), body.get('args', {})
        STATE['calls'].append([action, args, bool(body.get('confirm'))])
        if conn != 'ado' or STATE['connector'] != 'ready': return self.send_json(503, {'code': 'unavailable', 'error': 'The connector is off.'})
        if action == 'dataset': return self.send_json(200, {'result': DATASET})
        if action == 'backlog': return self.send_json(200, {'result': {'items': [], 'connection': 'work'}})
        if action == 'iterations.list': return self.send_json(200, {'result': {'iterations': []}})
        return self.send_json(400, {'code': 'bad_request', 'error': 'Unknown action'})


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)

BOX = '#reportsBox'


def open_reports(pg):
    pg.goto(APP + '#/health/reports')
    pg.wait_for_selector(BOX, timeout=15000)


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))

        open_reports(pg)
        pg.wait_for_function("() => (document.querySelector('#reportsBox')?.innerText || '').includes('Set up your team profile')", timeout=10000)
        check('#/health/reports opens Health with Team reports, asking for a team profile', 'Set up your team profile' in pg.inner_text(BOX))
        pg.click(f'{BOX} [data-rp="profile"]')
        pg.wait_for_selector('dialog textarea[name="areas"]', timeout=3000)
        check('the team profile fills area paths from your team in Settings', pg.input_value('dialog textarea[name="areas"]') == 'Platform\\Wiki'
              and 'Filled in from your team' in pg.inner_text('dialog'))
        pg.click('dialog [data-rp-cancel]'); pg.wait_for_timeout(200)
        check('Cancel closes the profile and pulls nothing', not pg.evaluate("document.getElementById('dlg').open") and not any(c[0] == 'dataset' for c in STATE['calls']))
        pg.click(f'{BOX} [data-rp="profile"]')
        pg.wait_for_selector('dialog textarea[name="areas"]', timeout=3000)
        pg.fill('dialog textarea[name="areas"]', '')
        pg.click('dialog button[value="ok"]'); pg.wait_for_timeout(200)
        check('an empty profile is not saved', pg.evaluate("document.getElementById('dlg').open") and 'Add at least one' in pg.inner_text('dialog'))
        pg.fill('dialog textarea[name="areas"]', 'Platform\\Wiki')
        pg.fill('dialog textarea[name="people"]', 'dev.one@example.test')
        pg.click('dialog button[value="ok"]')
        pg.wait_for_selector(f'{BOX} .wl-kpis', timeout=8000)
        ds = [c for c in STATE['calls'] if c[0] == 'dataset']
        check('saving the profile pulls one dataset with the areas, people and window', len(ds) == 1 and ds[0][1].get('areas') == ['Platform\\Wiki']
              and ds[0][1].get('people') == ['dev.one@example.test'] and ds[0][1].get('days') == 42)
        check('nothing is written to ADO', not any(c[2] for c in STATE['calls']))
        check('Priority churn shows the escalation', 'escalated to p1' in pg.inner_text(BOX).lower())
        pg.click(f'{BOX} [data-tab="other"]'); pg.wait_for_timeout(200)
        txt = pg.inner_text(f'{BOX} .reports')
        check("Other teams' work lists the item outside the areas, as text", '<img src=x' in txt and pg.evaluate('() => !window.__pwned')
              and pg.query_selector(f'{BOX} a[href^="javascript"]') is None)
        tabs = pg.evaluate("() => [...document.querySelectorAll('#reportsBox .rp-tabs [role=tab]')].map(b => b.textContent)")
        for t in ['carry', 'scope', 'load', 'aging']:
            pg.click(f'{BOX} [data-tab="{t}"]'); pg.wait_for_timeout(100)
        check('all six report tabs render', len(tabs) == 6 and pg.query_selector(f'{BOX} .rp-sec') is not None)
        check('the tab you picked stays picked (Board did not take the click)', pg.evaluate("document.querySelector('#reportsBox [data-tab=aging]').getAttribute('aria-selected')") == 'true')
        with pg.expect_download(timeout=15000) as dl: pg.click(f'{BOX} [data-rp="export"]')
        check('Export to Excel saves a workbook', dl.value.suggested_filename.startswith('team-reports-') and dl.value.suggested_filename.endswith('.xlsx'))
        check('the profile is kept as slate.reports', json.loads(pg.evaluate("localStorage.getItem('slate.reports')") or '{}').get('areas') == 'Platform\\Wiki')

        pg.reload()
        pg.wait_for_selector(f'{BOX} .wl-kpis', timeout=10000)
        check('after a reload the last pull shows without asking ADO again', len([c for c in STATE['calls'] if c[0] == 'dataset']) == 1)

        # Someone who used reports in Runway: the profile comes along the first time.
        ctx2 = b.new_context(viewport={'width': 1400, 'height': 900})
        pg2 = ctx2.new_page()
        pg2.goto(APP + '#/')
        pg2.evaluate("""localStorage.setItem('runway.reports', JSON.stringify({areas: 'Platform\\\\Old', people: '', days: 30, tab: 'load'}))""")
        open_reports(pg2)
        pg2.wait_for_function("() => (document.querySelector('#reportsBox')?.innerText || '').includes('No report data yet')", timeout=10000)
        check("Runway's old team profile carries over (one area, 30 days)", '1 area' in pg2.inner_text(BOX) and pg2.input_value(f'{BOX} [data-rp-days]') == '30')
        ctx2.close()

        # The connector off: the section explains it needs Azure DevOps.
        STATE['connector'] = 'disabled'
        open_reports(pg); pg.reload()
        pg.wait_for_function("() => (document.querySelector('#reportsBox')?.innerText || '').includes('Connect Azure DevOps')", timeout=10000)
        check('connector off: Team reports explains it needs the connector', 'Connect Azure DevOps' in pg.inner_text(BOX))
        check('no page errors', not errors or print(errors))
        b.close()
    srv.shutdown()
    print('all passed' if not failed else f'{len(failed)} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
