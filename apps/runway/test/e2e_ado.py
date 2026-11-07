#!/usr/bin/env python3
"""Runway with Azure DevOps, in headless Chrome: this repo served together with a small mock Workshop agent whose
ADO connector answers `roadmap`, `iterations.list` and `dataset` from synthetic data. Checks a live ADO roadmap (read only,
refresh rebuilds it, owners from Assigned To), team reports (area paths filled in from Settings' team), a linked one (your edit is kept and shows
as differing), mixing in an ad hoc item, Publish (preview, confirm, workitem.update with confirm: true for titles, owners, dates and sprints, conflicts skipped), and that with the
connector off Runway shows no ADO controls and still opens every roadmap.

  pip install playwright && python -m playwright install chromium
  python test/e2e_ado.py

Exit 1 if any check fails."""
import functools, http.server, json, os, re, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8815
SITE = f'http://127.0.0.1:{PORT}'

STATE = {
    'connector': 'ready',
    'calls': [],
    'data': {'settings/people': {'schema': 'settings.people', 'version': 2, 'rev': 1, 'updatedAt': '2026-11-03T12:00:00.000Z', 'deleted': {}, 'items': [
        {'id': 'p_one', 'kind': 'person', 'updatedAt': 1, 'name': 'Dev One', 'handle': 'one', 'relation': 'report', 'adoIdentity': 'dev.one@example.test'},
        {'id': 'p_two', 'kind': 'person', 'updatedAt': 1, 'name': 'Dev Two', 'handle': 'two', 'relation': 'report', 'adoIdentity': 'dev.two@example.test'}]},
        'settings/teams': {'schema': 'settings.teams', 'version': 1, 'rev': 1, 'updatedAt': '2026-11-03T12:00:00.000Z', 'deleted': {}, 'items': [
            {'id': 't_mine', 'updatedAt': 1, 'name': 'My team', 'areas': ['Platform\\Wiki'], 'connection': ''}]}},
    'race': set(),  # work item ids someone changes in ADO between Runway's refresh and its Publish
    'items': [
        {'id': 101, 'rev': 1, 'type': 'Epic', 'title': 'Docs Portal', 'state': 'Active', 'area': 'Platform\\Docs', 'iteration': '', 'parentId': None,
         'startDate': '2027-01-04', 'targetDate': '2027-03-31', 'url': 'https://ado.example.test/_workitems/edit/101'},
        {'id': 102, 'rev': 1, 'type': 'Feature', 'title': 'Content migration', 'state': 'Active', 'area': 'Platform\\Docs', 'iteration': 'Platform\\Sprint 1',
         'parentId': 101, 'startDate': None, 'targetDate': None, 'assignee': {'name': 'Dev One', 'email': 'dev.one@example.test'}, 'storiesTotal': 4, 'storiesDone': 1, 'url': 'https://ado.example.test/_workitems/edit/102'},
        {'id': 103, 'rev': 1, 'type': 'Feature', 'title': 'Search cutover', 'state': 'New', 'area': 'Platform\\Docs', 'iteration': '',
         'parentId': 101, 'startDate': '2027-02-01', 'targetDate': '2027-02-20', 'assignee': {'name': 'New Person', 'email': 'new.person@example.test'}, 'url': 'https://ado.example.test/_workitems/edit/103'},
        {'id': 104, 'rev': 1, 'type': 'Feature', 'title': '<img src=x onerror="window.__pwned=1">', 'state': 'Closed', 'area': 'Platform\\Monitor',
         'iteration': '', 'parentId': None, 'startDate': '2027-01-10', 'targetDate': '2027-01-30', 'url': 'javascript:window.__pwned=1'}
    ]
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
ITER = {'Platform': [{'path': 'Platform\\Sprint 1', 'name': 'Sprint 1', 'start': '2027-01-06', 'finish': '2027-01-19', 'current': False},
                     {'path': 'Platform\\Sprint 2', 'name': 'Sprint 2', 'start': '2027-01-20', 'finish': '2027-02-02', 'current': False}]}


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
            msg = {'ready': '', 'disabled': 'Off'}.get(STATE['connector'], '')
            return self.send_json(200, {'connectors': [{'id': 'ado', 'status': {'state': STATE['connector'], 'message': msg}}]})
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
            key = m.group(1) + '/' + m.group(2)
            env = STATE['data'].get(key)
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
        m = re.match(r'^/api/connectors/ado/(.+)$', p)
        if not m: return self.send_json(404, {'code': 'not_found', 'error': 'Not found'})
        body = self.body()
        action, args = m.group(1), body.get('args', {})
        STATE['calls'].append([action, args, bool(body.get('confirm'))])
        if STATE['connector'] != 'ready': return self.send_json(503, {'code': 'unavailable', 'error': 'The ADO connector is off.'})
        if action == 'roadmap':
            items = [i for i in STATE['items'] if any(i['area'].lower().startswith(a.lower()) for a in args.get('areas', []))]
            return self.send_json(200, {'result': {'connection': 'work', 'items': items, 'total': len(items), 'truncated': False, 'fetchedAt': '2026-11-03T12:00:00Z'}})
        if action == 'dataset':
            return self.send_json(200, {'result': DATASET})
        if action == 'iterations.list':
            return self.send_json(200, {'result': {'connection': 'work', 'project': args.get('project'), 'iterations': ITER.get(args.get('project'), [])}})
        if action == 'workitem.update':
            # Like the agent and the connector: a write needs confirm: true, and a stale rev changes nothing.
            if not body.get('confirm'): return self.send_json(403, {'code': 'forbidden', 'error': 'This action changes ADO and needs confirm.'})
            item = next((i for i in STATE['items'] if i['id'] == args.get('id')), None)
            if not item: return self.send_json(404, {'code': 'not_found', 'error': f"Work item {args.get('id')} was not found."})
            if item['id'] in STATE['race']:
                STATE['race'].discard(item['id']); item['rev'] += 1
            if item['rev'] != args.get('rev'):
                return self.send_json(409, {'code': 'conflict', 'error': f"Work item {item['id']} changed in ADO since you loaded it. Review the change and try again."})
            ch = args.get('changes', {})
            if 'assignedTo' in ch:
                who = ch['assignedTo']
                ppl = STATE['data']['settings/people']['items']
                name = next((x['name'] for x in ppl if x.get('adoIdentity') == who), who)
                item['assignee'] = {'name': name, 'email': who} if who else None
            if 'iteration' in ch: item['iteration'] = ch['iteration']
            if 'title' in ch: item['title'] = ch['title']
            for k in ('startDate', 'targetDate'):
                if k in ch: item[k] = ch[k] or None
            item['rev'] += 1
            return self.send_json(200, {'result': {'id': item['id'], 'rev': item['rev'], 'iteration': item['iteration'], 'connection': 'work'}})
        return self.send_json(400, {'code': 'bad_request', 'error': 'Unknown action'})


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)

R = 'window.__runway'


def ado_dialog(pg, name, areas, mode=None):
    if name is not None: pg.fill('dialog input[name="title"]', name)
    pg.fill('dialog textarea[name="areas"]', areas)
    if mode: pg.check(f'dialog input[name="mode"][value="{mode}"]')
    pg.click('dialog button[value="ok"]')


def main():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1400, 'height': 900})
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and not m.text.startswith('Failed to load resource') and errors.append(m.text))

        pg.goto(SITE + '/')
        pg.wait_for_function('() => window.__runway && window.__runway.store.v.loaded', timeout=15000)
        check('runs on the agent backend', pg.evaluate(f'() => {R}.ws.backend') == 'agent')
        pg.wait_for_selector('[data-fromado]', timeout=8000)
        check('the list offers From Azure DevOps when the connector is ready', pg.is_visible('[data-fromado]'))

        # A live ADO roadmap.
        pg.click('[data-fromado]')
        ado_dialog(pg, 'Live platform', 'Platform\\Docs\nPlatform\\Monitor', 'live')
        pg.wait_for_function(f'() => {R}.store.v.doc && {R}.store.v.doc.items.length === 4', timeout=8000)
        doc = pg.evaluate(f'() => {R}.store.v.doc')
        check('live roadmap holds the Epics and Features, in a lane per area path', [l['title'] for l in sorted(doc['lanes'], key=lambda l: l['order'])] == ['Docs', 'Monitor'])
        check('live roadmap: meta says live', doc['meta']['ado']['mode'] == 'live')
        check('sprint dates place an item with none of its own',
              any(i['title'] == 'Content migration' and i['start'] == '2027-01-06' and i['end'] == '2027-01-19' for i in doc['items']))
        check('the strip says live view', 'Live view' in pg.inner_text('.adobar'))
        check('live roadmap: outline is read only', pg.get_attribute('[data-outline]', 'readonly') is not None)
        check('live roadmap: no add item button', pg.query_selector('[data-additem]') is None)
        check('ADO text is escaped', pg.evaluate('() => !window.__pwned') and pg.query_selector('.tl img') is None)
        mig = next(i for i in doc['items'] if i['title'] == 'Content migration')
        pg.evaluate(f'() => {{ {R}.ui.selected = "{mig["id"]}"; {R}.paint(); }}')
        pg.wait_for_selector('[data-adobox] a', timeout=3000)
        check('panel links to the work item', pg.get_attribute('[data-adobox] a', 'href') == 'https://ado.example.test/_workitems/edit/102')
        check('panel fields are disabled in a live roadmap', pg.is_disabled('[data-panel] [data-f="title"]'))
        bad = next(i for i in doc['items'] if i['ado']['id'] == 104)
        pg.evaluate(f'() => {{ {R}.ui.selected = "{bad["id"]}"; {R}.paint(); }}')
        check('a javascript: work item link is not clickable', pg.query_selector('[data-adobox] a') is None)
        pg.keyboard.press('Escape')

        STATE['items'][1]['title'] = 'Content migration v2'
        pg.click('[data-adorefresh]')
        pg.wait_for_function(f'() => {R}.store.v.doc.items.some(i => i.title === "Content migration v2")', timeout=8000)
        check('refresh rebuilds a live roadmap from ADO', True)
        check('roadmap action got the area paths', any(c[0] == 'roadmap' and c[1].get('areas') == ['Platform\\Docs', 'Platform\\Monitor'] for c in STATE['calls']))
        check('only read actions were called', all(c[0] in ('roadmap', 'iterations.list') for c in STATE['calls']))

        # Owners from Assigned To: matched by ADO identity; someone People lacks can be added from the panel.
        doc = pg.evaluate(f'() => {R}.store.v.doc')
        mig = next(i for i in doc['items'] if i['ado']['id'] == 102)
        cut = next(i for i in doc['items'] if i['ado']['id'] == 103)
        check('Assigned To becomes the owner when People has that ADO identity', mig['who'] == ['p_one'])
        check('an Assigned To People lacks leaves no owner', cut['who'] == [])
        pg.evaluate(f'() => {{ {R}.ui.selected = "{cut["id"]}"; {R}.paint(); }}')
        pg.wait_for_selector('[data-ado-person]', timeout=3000)
        check('panel names the ADO assignee People lacks', 'New Person' in pg.inner_text('[data-adobox]'))
        pg.click('[data-ado-person]')
        pg.wait_for_function(f'() => {R}.store.v.doc.items.some(i => i.ado && i.ado.id === 103 && i.who.length === 1)', timeout=8000)
        added = [x for x in STATE['data']['settings/people']['items'] if x.get('adoIdentity') == 'new.person@example.test']
        check('Add to People adds a contact with that ADO identity', len(added) == 1 and added[0]['relation'] == 'contact' and added[0]['name'] == 'New Person')
        check('and the refresh makes them the owner', pg.evaluate(f'() => {R}.store.v.doc.items.find(i => i.ado && i.ado.id === 103).who[0]') == added[0]['id'])
        try:
            pg.wait_for_selector('[data-ado-person]', state='detached', timeout=3000); gone = True
        except Exception:
            gone = False
        check('the hint is gone', gone)
        pg.keyboard.press('Escape')

        pg.click('[data-adostop]')
        pg.click('dialog button[value="ok"]')
        pg.wait_for_function(f'() => !{R}.store.v.doc.meta.ado', timeout=3000)
        pg.wait_for_selector('[data-additem]', timeout=3000)
        check('Make editable turns a live roadmap into an ordinary one', pg.get_attribute('[data-outline]', 'readonly') is None)

        # A linked roadmap with an ad hoc item mixed in.
        pg.evaluate(f'() => {R}.route("")')
        pg.wait_for_selector('[data-fromado]', timeout=5000)
        pg.click('[data-fromado]')
        ado_dialog(pg, 'Linked platform', 'Platform\\Docs', 'linked')
        pg.wait_for_function(f'() => {R}.store.v.doc && {R}.store.v.doc.meta.title === "Linked platform" && {R}.store.v.doc.items.length === 3', timeout=8000)
        check('linked roadmap is editable', pg.query_selector('[data-additem]') is not None)
        pg.keyboard.press('Escape')
        pg.click('[data-tl]')
        pg.keyboard.press('n')
        pg.wait_for_function(f'() => {R}.store.v.doc.items.length === 4', timeout=3000)
        check('an ad hoc item mixes in with linked ones', pg.evaluate(f'() => {R}.store.v.doc.items.filter(i => !i.ado).length') == 1)
        cut = pg.evaluate(f'() => {R}.store.v.doc.items.find(i => i.ado && i.ado.id === 103).id')
        pg.evaluate(f'() => {R}.edit(d => {{ const it = d.items.find(i => i.id === "{cut}"); it.end = "2027-03-15"; }})')
        STATE['items'][2]['targetDate'] = '2027-02-27'
        STATE['items'][1]['title'] = 'Content migration v3'
        pg.click('[data-adorefresh]')
        pg.wait_for_selector('[data-adodiff]', timeout=8000)
        doc = pg.evaluate(f'() => {R}.store.v.doc')
        it = next(i for i in doc['items'] if i['id'] == cut)
        check('linked refresh keeps your edit', it['end'] == '2027-03-15')
        check('and records ADO\'s value as differing', it['ado'].get('remote', {}).get('end') == '2027-02-27')
        check('an item you did not change takes ADO\'s change', any(i['title'] == 'Content migration v3' for i in doc['items']))
        check('the ad hoc item is untouched', sum(1 for i in doc['items'] if not i.get('ado')) == 1)
        pg.click('[data-adodiff]')
        pg.wait_for_selector('[data-ado-use]', timeout=3000)
        check('the panel shows the difference', 'Differs from ADO' in pg.inner_text('[data-adobox]'))
        pg.click('[data-ado-use]')
        pg.wait_for_function(f'() => {R}.store.v.doc.items.find(i => i.id === "{cut}").end === "2027-02-27"', timeout=3000)
        check('Use ADO\'s applies it', True)
        pg.keyboard.press('Escape')

        # Publish: titles, owners (Assigned To), own dates and sprint moves go to ADO, after a preview, with confirm: true.
        check('no Publish button without changes ADO can take', pg.query_selector('[data-adopublish]') is None)
        ids = pg.evaluate(f'() => Object.fromEntries({R}.store.v.doc.items.filter(i => i.ado).map(i => [i.ado.id, i.id]))')
        pg.evaluate(f'() => {R}.edit(d => {{ d.items.find(i => i.id === "{ids["103"]}").status = "done"; }})')
        pg.wait_for_timeout(200)
        check('a status change alone does not offer Publish', pg.query_selector('[data-adopublish]') is None)
        pg.evaluate(f"""() => {R}.edit(d => {{
            const epic = d.items.find(i => i.id === "{ids["101"]}"); epic.who = ["p_two"]; epic.title = "  Docs Portal   v2 "; epic.end = "2027-04-07";
            const mig = d.items.find(i => i.id === "{ids["102"]}"); mig.who = ["p_two"]; mig.start = "2027-01-20"; mig.end = "2027-02-02";
            const cut = d.items.find(i => i.id === "{ids["103"]}"); cut.who = ["p_one"]; cut.title = "Renamed here";
        }})""")
        pg.wait_for_selector('[data-adopublish]', timeout=3000)
        check('Publish shows with changes ADO can take', 'Publish (3)' in pg.inner_text('[data-adopublish]'))
        # Meanwhile in ADO: someone reassigns 103 (it will differ), and someone edits 102 right before Publish sends.
        STATE['items'][2]['assignee'] = {'name': 'Dev Two', 'email': 'dev.two@example.test'}; STATE['items'][2]['rev'] += 1
        STATE['race'].add(102)
        before = len(STATE['calls'])
        pg.click('[data-adopublish]')
        pg.wait_for_selector('dialog .pubsheet', timeout=8000)
        rows = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('dialog [data-pub-row]')].map(r => [r.dataset.adoId, r.dataset.pubRow]))")
        check('the preview lists each item: sends, and a conflict for one ADO changed too', rows == {'101': 'send', '102': 'send', '103': 'conflict'})
        cells = lambda i: [list(x) for x in pg.evaluate(f"() => [...document.querySelectorAll('dialog [data-ado-id=\"{i}\"] tbody tr')].map(r => [r.cells[0].textContent, r.cells[1].textContent, r.hasAttribute('data-sent')])")]
        epic_rows, mig_rows = cells(101), cells(102)
        check('the preview shows old and new values per field: title and target date',
              ['Title', 'Docs Portal', True] in epic_rows and ['Target date', 'Mar 31, 2027', True] in epic_rows and not any(r[0] == 'Start date' for r in epic_rows))
        check('the preview shows Assigned To and the sprint', ['Assigned To', 'Dev One (dev.one@example.test)', True] in mig_rows
              and any(x[0] == 'Sprint' and x[1] == 'Platform\\Sprint 1' and x[2] for x in mig_rows))
        check('a conflict lists its title change as not sent', 'Not sent' in pg.inner_text('dialog [data-ado-id="103"]') and 'Renamed here' in pg.inner_text('dialog [data-ado-id="103"]'))
        check('nothing is written before you confirm', not any(c[0].startswith('workitem.') for c in STATE['calls'][before:]))
        check('confirm says how many', pg.inner_text('dialog [data-pub-confirm]').strip() == 'Publish 2')
        pg.click('dialog [data-pub-confirm]')
        pg.wait_for_selector('dialog [data-pub-result]', timeout=8000)
        res = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('dialog [data-pub-result]')].map(r => [r.dataset.adoId, r.dataset.pubResult]))")
        check('results: updated, and conflicts skipped', res == {'101': 'updated', '102': 'conflict', '103': 'conflict'})
        check('the connector\'s conflict message is shown', 'changed in ADO since you loaded it' in pg.inner_text('dialog [data-ado-id="102"]'))
        writes = [c for c in STATE['calls'][before:] if c[0].startswith('workitem.')]
        check('only workitem.update, each with confirm: true, and none for the conflict found before sending',
              [c[0] for c in writes] == ['workitem.update', 'workitem.update'] and all(c[2] for c in writes) and sorted(c[1]['id'] for c in writes) == [101, 102])
        epic_call = next(c for c in writes if c[1]['id'] == 101)
        mig_call = next(c for c in writes if c[1]['id'] == 102)
        check('Publish sends the title (trimmed), Assigned To and the moved target date, with the revision Runway read',
              epic_call[1]['changes'] == {'assignedTo': 'dev.two@example.test', 'title': 'Docs Portal v2', 'targetDate': '2027-04-07'} and epic_call[1]['rev'] == 1 and epic_call[1].get('connection') == 'work')
        check('and a sprint move for an item placed by its sprint', mig_call[1]['changes'] == {'assignedTo': 'dev.two@example.test', 'iteration': 'Platform\\Sprint 2'})
        check('ADO now has the update, and the conflict changed nothing', STATE['items'][0]['title'] == 'Docs Portal v2' and STATE['items'][0]['targetDate'] == '2027-04-07'
              and STATE['items'][1]['iteration'] == 'Platform\\Sprint 1')
        pg.click('dialog button[value="ok"]')
        pg.wait_for_function(f'() => {{ const it = {R}.store.v.doc.items.find(i => i.ado && i.ado.id === 101); return it.ado.rev === 2 && it.ado.base.title === "Docs Portal v2"; }}', timeout=8000)
        epic = pg.evaluate(f'() => {R}.store.v.doc.items.find(i => i.ado && i.ado.id === 101)')
        check('the refresh after Publish leaves the published item with no local changes',
              epic['ado']['base']['who'] == ['p_two'] and epic['ado']['base']['end'] == '2027-04-07' and epic['title'] == epic['ado']['base']['title'] and 'remote' not in epic['ado'])
        check('no work item was created or commented on', not any(c[0] in ('workitem.create', 'workitem.comment') for c in STATE['calls']))
        pg.evaluate(f'() => {R}.flush()')
        linked_id = pg.evaluate(f'() => {R}.store.v.mapId')

        # Team reports (moved from Docket): the page, the profile, one dataset pull, tabs, escaped ADO text, export.
        pg.goto(SITE + '/#/')
        pg.wait_for_selector('[data-reports]', timeout=5000)
        pg.click('[data-reports]')
        pg.wait_for_selector('.rpage .engcard', timeout=8000)
        check('Team reports opens from the list and asks for a team profile', 'Set up your team profile' in pg.inner_text('.rpage'))
        pg.click('.rpage [data-rp="profile"]')
        pg.wait_for_selector('dialog textarea[name="areas"]', timeout=3000)
        check('the team profile fills area paths from your team in Settings', pg.input_value('dialog textarea[name="areas"]') == 'Platform\\Wiki'
              and 'Filled in from your team' in pg.inner_text('dialog'))
        pg.fill('dialog textarea[name="areas"]', 'Platform\\Wiki')
        pg.fill('dialog textarea[name="people"]', 'dev.one@example.test')
        pg.click('dialog button[value="ok"]')
        pg.wait_for_selector('.rpage .wl-kpis', timeout=8000)
        ds = [c for c in STATE['calls'] if c[0] == 'dataset']
        check('saving the profile pulls one dataset with the areas, people and window', len(ds) == 1 and ds[0][1].get('areas') == ['Platform\\Wiki']
              and ds[0][1].get('people') == ['dev.one@example.test'] and ds[0][1].get('days') == 42)
        check('Priority churn shows the escalation', 'escalated to P1' in pg.inner_text('.rpage').lower() or 'ESCALATED TO P1' in pg.inner_text('.rpage'))
        pg.click('.rpage [data-tab="other"]'); pg.wait_for_timeout(200)
        txt = pg.inner_text('.rpage .reports')
        check("Other teams' work lists the item outside the areas, as text", '<img src=x' in txt and pg.evaluate('() => !window.__pwned')
              and pg.query_selector('.rpage a[href^="javascript"]') is None)
        tabs = pg.evaluate("() => [...document.querySelectorAll('.rp-tabs [role=tab]')].map(b => b.textContent)")
        for t in ['carry', 'scope', 'load', 'aging']:
            pg.click(f'.rpage [data-tab="{t}"]'); pg.wait_for_timeout(100)
        check('all six report tabs render', len(tabs) == 6 and pg.query_selector('.rpage .rp-sec') is not None)
        with pg.expect_download(timeout=15000) as dl: pg.click('.rpage [data-rp="export"]')
        check('Export to Excel saves a workbook', dl.value.suggested_filename.startswith('team-reports-') and dl.value.suggested_filename.endswith('.xlsx'))
        pg.reload()
        pg.wait_for_function('() => window.__runway && window.__runway.store.v.loaded', timeout=15000)
        pg.wait_for_selector('.rpage .wl-kpis', timeout=8000)
        check('after a reload the last pull shows without asking ADO again', len([c for c in STATE['calls'] if c[0] == 'dataset']) == 1)
        pg.click('.rpage [data-rp="home"]'); pg.wait_for_timeout(300)
        check('Runway goes back to the roadmap list', pg.evaluate("document.getElementById('app').dataset.view") == 'list')

        # The connector turned off: no ADO controls, roadmaps still open and edit.
        STATE['connector'] = 'disabled'
        pg.goto(SITE + '/#/')
        pg.reload()
        pg.wait_for_function('() => window.__runway && window.__runway.store.v.loaded', timeout=15000)
        pg.wait_for_function(f'() => {R}.ado && {R}.ado.state.checked && !{R}.ado.state.ready', timeout=8000)
        check('connector off: no From Azure DevOps on the list', pg.query_selector('[data-fromado]') is None)
        check('connector off: no Team reports link on the list (it needs Azure DevOps)', pg.query_selector('[data-reports]') is None)
        pg.evaluate(f'() => {R}.route("reports")'); pg.wait_for_selector('.rpage .engcard', timeout=5000)
        check('connector off: Team reports explains it needs the connector', 'Connect Azure DevOps' in pg.inner_text('.rpage'))
        pg.evaluate(f'() => {R}.route("")'); pg.wait_for_timeout(200)
        calls = len(STATE['calls'])
        pg.evaluate(f'() => {R}.route("{linked_id}")')
        pg.wait_for_selector('.adobar', timeout=5000)
        check('connector off: a linked roadmap shows the last copy', 'Showing the last copy' in pg.inner_text('.adobar'))
        check('connector off: no refresh button and no calls', pg.query_selector('[data-adorefresh]') is None and len(STATE['calls']) == calls)
        check('connector off: the roadmap is still editable', pg.query_selector('[data-additem]') is not None)

        check('no page errors', not errors)
        if errors: print('\n'.join(errors))
        b.close()
    srv.shutdown()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
