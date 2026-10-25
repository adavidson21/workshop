#!/usr/bin/env python3
"""End-to-end check of Workshop in headless Chromium.

  pip install playwright && python -m playwright install chromium
  python tests/e2e.py

Five parts:
  1. Browser mode: serves this repo as a static site on 127.0.0.1:8802.
  2. Local mode: the real agent (tests/e2e-agent.mjs) with a temporary home, the repo's apps plus a sample
     app, and the ADO and echo connectors. Settings, required connectors, data events.
  3. Hosted mode: the static site on localhost:8803, paired with that agent. Settings is read-only.
  4. Prioritizer storage (WS5): the board in the data folder, the one-time move from the old browser
     copy, Excel and backup round trips, two windows in sync, and a failed write.
  5. Agents (WS6): the real agent with the opencode connector, a synthetic workspace and a fake opencode
     (apps/agents/test/fixture.mjs). The page, its buttons, prompts, deep links, theme, and Prioritizer's
     stages and Start through the connector.
Exit 1 if any check fails.
"""
import functools, http.server, json, os, shutil, subprocess, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB = 'http://127.0.0.1:8802'
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


# Globals a page defines beyond a blank page, minus the shared classic scripts (theme, service worker
# registration, SheetJS). Prioritizer is ES modules, so only its test hook should remain.
PRIORITIZER_GLOBALS = """() => {
  const f = document.createElement('iframe'); document.body.appendChild(f);
  const blank = new Set(Object.getOwnPropertyNames(f.contentWindow)); f.remove();
  const shared = new Set(['WorkshopTheme', 'WorkshopSw', 'XLSX', 'cptable', 'make_xlsx_lib', 'DO_NOT_EXPORT_CODEPAGE']);
  return Object.getOwnPropertyNames(window).filter(n => !blank.has(n) && !shared.has(n)).sort();
}"""

# Runs the SDK's browser backend (IndexedDB) in a page: the same rules as the agent's data API.
SDK_BROWSER = """async () => {
  const {connect} = await import('/shared/workshop-sdk.js');
  const a = await connect({app: 'notes'}), b = await connect({app: 'notes'});
  const out = {mode: a.mode, backend: a.backend, online: a.online};
  out.empty = await a.data.get('pages');
  let heard = null; b.data.subscribe('pages', e => { heard = e; });
  let self = null; a.data.subscribe('pages', e => { self = e; });
  const first = a.data.stamp(null, {schema: 'notes.pages', version: 1, rev: 0, items: [{id: 'p1', title: 'One'}]});
  out.put1 = await a.data.put('pages', first);
  await new Promise(r => setTimeout(r, 300));
  out.heard = heard && heard.rev; out.self = self;
  const read = await b.data.get('pages');
  out.readRev = read.rev; out.updatedAt = typeof read.updatedAt;
  try { await a.data.put('pages', first); out.conflict = 'none'; } catch (e) { out.conflict = e.code; out.currentRev = e.current && e.current.rev; }
  try { await a.data.put('pages', {...read, version: 0}); } catch (e) { out.badVersion = e.code; }
  try { await a.data.put('pages', {...read, schema: 'notes.other'}); } catch (e) { out.badSchema = e.code; }
  const edited = b.data.stamp(read, {...structuredClone(read), items: [...read.items, {id: 'p2', title: 'Two'}]});
  out.put2 = (await b.data.put('pages', edited)).rev;
  const bundle = await a.data.export({apps: ['notes']});
  out.bundle = [bundle.schema, bundle.collections.length, bundle.source.backend];
  bundle.collections.push({app: 'notes', collection: 'drafts', envelope: {...structuredClone(bundle.collections[0].envelope), schema: 'notes.drafts'}});
  out.imported = await a.data.import(bundle);
  out.connectors = await a.connectors.list();
  try { await a.connectors.call('ado', 'sync'); } catch (e) { out.callCode = e.code; }
  return out;
}"""


def browser_mode_checks(ctx, pg, frame, watch):
    """Part 1, browser mode (static site, no agent): the platform pieces WS4 added."""
    rail = pg.eval_on_selector_all('.app-btn[data-app]', 'els => els.map(e => e.dataset.app)')
    check('rail is built from the app registry', rail == ['prioritizer', 'agents', 'settings'])
    check('static site runs in browser mode', pg.evaluate('document.documentElement.dataset.mode') == 'browser')
    check('app icons are inlined so they take the theme color', pg.locator('.app-btn[data-app=settings] .ico svg circle').count() == 1)

    pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300); frame.click('#main'); pg.keyboard.press('Control+k'); pg.wait_for_timeout(300)
    check('Ctrl+K inside an app opens the shell palette, not the app\'s own', pg.locator('.cmdk-input').is_visible() and not frame.evaluate("document.getElementById('cmd').classList.contains('open')"))
    pg.keyboard.type('add a task'); pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    check('a palette command reaches the app through the SDK', frame.evaluate("document.getElementById('cmd').classList.contains('open')"))
    frame.press('#cmdInput', 'Escape'); pg.wait_for_timeout(200)

    tid = frame.evaluate("window.__prioritizer.state.tasks.find(t => t.title === 'Fix login').id")
    pg.evaluate(f"location.hash = '#/prioritizer/task/{tid}'"); pg.wait_for_timeout(600)
    check('a deep link opens the task', frame.evaluate("document.getElementById('app').classList.contains('drawer-open')") and pg.url == HUB + '/')
    frame.press('#drawer', 'Escape'); pg.wait_for_timeout(200)

    pg.keyboard.press('Alt+3'); pg.wait_for_timeout(1200)
    sf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
    check('Settings opens from the rail', sf is not None and pg.url.endswith('#/settings'))
    check('Settings in browser mode offers only data', sf is not None and 'not running' in sf.inner_text('#content') and sf.locator('[data-export]').count() == 1 and sf.locator('.conn').count() == 0)
    check('Settings loads the self-hosted fonts', sf is not None and sf.evaluate("() => document.fonts.ready.then(() => [...document.fonts].some(f => f.family.includes('Inter') && f.status === 'loaded'))"))

    b1 = ctx.new_page(); watch(b1); b1.goto(HUB + '/apps/settings/'); b1.wait_for_timeout(500)
    b2 = ctx.new_page(); watch(b2); b2.goto(HUB + '/apps/settings/'); b2.wait_for_timeout(500)
    b2.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
      window.__heard = []; ws.data.subscribe('pages', e => window.__heard.push(e.rev)); }""")
    r = b1.evaluate(SDK_BROWSER)
    check('SDK picks browser mode with no agent', [r['mode'], r['backend'], r['online']] == ['browser', 'browser', False])
    check('browser backend: a new collection reads as null', r['empty'] is None)
    check('browser backend: put sets rev and updatedAt like the agent', r['put1'] and r['put1']['rev'] == 1 and r['readRev'] == 1 and r['updatedAt'] == 'string')
    check('browser backend: a stale rev is a conflict with the stored copy', r['conflict'] == 'conflict' and r['currentRev'] == 1)
    check('browser backend: lower version and wrong schema are refused', r.get('badVersion') == 'downgrade' and r.get('badSchema') == 'bad_request')
    check('browser backend: other clients hear writes, the writer does not', r['heard'] == 1 and r['self'] is None and r['put2'] == 2)
    check('browser backend: another tab hears writes (BroadcastChannel)', b2.evaluate('window.__heard') == [1, 2, 3])  # 3: the import merges pages
    check('browser backend: export and import bundles', r['bundle'] == ['workshop.bundle', 1, 'browser'] and r['imported'] == {'created': 1, 'merged': 1})
    check('browser backend: connectors are unavailable', r['connectors'] == [] and r['callCode'] == 'unavailable')
    b1.close(); b2.close()

    cached = pg.evaluate("""async () => { await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 500));
      const k = (await caches.keys()).find(n => n.startsWith('workshop-')); if (!k) return [];
      return (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname); }""")
    check('service worker precaches every app\'s files from the registry', '/apps/prioritizer/js/people.js' in cached and '/apps/settings/js/forms.js' in cached and '/apps/settings/icon.svg' in cached)
    check('service worker caches nothing under /api', not any(p.startswith('/api') for p in cached))
    pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300)


def start_agent(tmp, config=None):
    """Starts the real agent with copies of the repo's apps plus test fixtures. Returns (process, url, token, home)."""
    apps, conns, home = (os.path.join(tmp, d) for d in ('apps', 'connectors', 'home'))
    for name in ('prioritizer', 'agents', 'settings'):
        shutil.copytree(os.path.join(ROOT, 'apps', name), os.path.join(apps, name))
    for name in ('notes', 'board'):
        shutil.copytree(os.path.join(ROOT, 'tests', 'fixtures', 'apps', name), os.path.join(apps, name))
    board = os.path.join(apps, 'board', 'app.json')
    with open(board) as f: m = json.load(f)
    m['order'] = 50  # after the repo's apps, so Prioritizer stays home
    with open(board, 'w') as f: json.dump(m, f)
    shutil.copytree(os.path.join(ROOT, 'connectors', 'ado'), os.path.join(conns, 'ado'))
    shutil.copytree(os.path.join(ROOT, 'tests', 'fixtures', 'connectors', 'echo'), os.path.join(conns, 'echo'))
    os.makedirs(home)
    if config:
        with open(os.path.join(home, 'config.json'), 'w') as f: json.dump(config, f)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns, '--env', 'ECHO_TOKEN=x'],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    info = json.loads(proc.stdout.readline())
    return proc, info['url'], info['token'], home


def agent_checks(b, watch):
    """Parts 2 and 3: the real agent (local mode), and a hosted page paired with it."""
    tmp = tempfile.mkdtemp()
    hosted = 'http://localhost:8803'
    proc, url, token, home = start_agent(tmp, {'configVersion': 1, 'port': 4380, 'allowedOrigins': [hosted],
                                               'features': {'startAtLogin': False, 'hostedMode': True}, 'connectors': {}})
    try:
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        streams = []
        ctx.on('request', lambda r: streams.append(r.url) if '/api/events' in r.url else None)
        ap = ctx.new_page(); watch(ap)
        ap.goto(f'{url}/?token={token}'); ap.wait_for_timeout(1500)
        check('agent page runs in local mode', ap.evaluate('document.documentElement.dataset.mode') == 'local')
        rail = ap.eval_on_selector_all('.app-btn[data-app]', 'els => els.map(e => e.dataset.app)')
        check('a sample app added as a folder appears in the rail', rail == ['prioritizer', 'agents', 'notes', 'board', 'settings'])
        check('Prioritizer loads from the agent', any('/apps/prioritizer/' in f.url for f in ap.frames) and ap.title() == 'Prioritizer · Workshop')
        pf = next(f for f in ap.frames if '/apps/prioritizer/' in f.url)
        check('Prioritizer uses the agent backend', pf.evaluate("async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'prioritizer'}); return ws.mode + '/' + ws.backend; }") == 'local/agent')
        ap.keyboard.press('Alt+3'); ap.wait_for_timeout(800)
        check('the sample app opens in a frame', any(f.url.endswith('/apps/notes/index.html') for f in ap.frames))
        ap.keyboard.press('Alt+4'); ap.wait_for_timeout(800)
        check('an app whose required connector is off shows a notice', 'Board needs Echo' in ap.inner_text('#pane-board') and not any('/apps/board/' in f.url for f in ap.frames))

        ap.keyboard.press('Alt+5'); ap.wait_for_timeout(1500)
        sf = next(f for f in ap.frames if '/apps/settings/' in f.url)
        echo = sf.locator('.conn[data-connector=echo]')
        check('Settings lists every connector, off by default', echo.count() == 1 and sf.locator('.conn[data-connector=ado]').count() == 1 and echo.locator('[data-state]').inner_text() == 'Off')
        echo.locator('[data-enable]').check(); ap.wait_for_timeout(1200)
        check('turning a connector on starts it', echo.locator('[data-state]').inner_text() == 'Ready')
        echo.locator('summary').click(); ap.wait_for_timeout(600)
        greeting = echo.get_by_label('Greeting (required)', exact=True)
        check('a connector form is generated from its configSchema', greeting.input_value() == 'Hello' and echo.locator('select').count() == 1 and echo.locator('.cfg-env-status').inner_text() == 'set on this computer')
        greeting.fill('Hi from e2e'); echo.locator('form.cfg button.btn.primary').click(); ap.wait_for_timeout(1000)
        with open(os.path.join(home, 'config.json')) as f: saved = json.load(f)
        check('connector settings save to config.json', saved['connectors']['echo']['config'].get('greeting') == 'Hi from e2e')
        echo.locator('[data-test] input').fill('ping'); echo.locator('[data-test] button').click(); ap.wait_for_timeout(800)
        check('the Test field runs the connector and shows the answer', 'ping' in echo.locator('.test-out').inner_text())

        ado = sf.locator('.conn[data-connector=ado]')
        ado.locator('summary').click(); ap.wait_for_timeout(800)
        legends = ado.locator('legend').all_inner_texts()
        check('the ADO form has connections and repo and path mapping', 'Connections' in legends and 'Repo and path mapping' in legends)
        conn = ado.locator('fieldset', has=sf.locator('legend', has_text='Connections')).first
        conn.locator('> .cfg-add').click(); ap.wait_for_timeout(200)
        item = conn.locator('.cfg-item').first
        item.get_by_label('Name (required)', exact=True).fill('work')
        item.get_by_label('Server URL (required)', exact=True).fill('https://ado.example.com')
        item.get_by_label('Collection (required)', exact=True).fill('Main')
        pat = item.locator('.cfg-row', has=sf.get_by_label('PAT environment variable (required)', exact=True))
        check('a PAT is never typed in: only the variable name', pat.locator('input').input_value() == 'ADO_PAT' and pat.locator('input[type=password]').count() == 0 and pat.locator('.cfg-env-status').inner_text() == 'save to check')
        ado.locator('form.cfg > .acts button.primary').click(); ap.wait_for_timeout(1200)
        with open(os.path.join(home, 'config.json')) as f: saved = json.load(f)
        conns = saved['connectors'].get('ado', {}).get('config', {}).get('connections', [])
        check('the ADO mapping saves to config.json', len(conns) == 1 and conns[0]['serverUrl'] == 'https://ado.example.com' and 'ADO_PAT' not in json.dumps({k: v for k, v in os.environ.items() if k == 'ADO_PAT'}))
        check('after saving, the form says whether the variable is set', ado.locator('.cfg-env-status').first.inner_text() == 'not set on this computer')

        ap.keyboard.press('Alt+4'); ap.wait_for_timeout(1200)
        check('turning on its connector lets the app load', any('/apps/board/' in f.url for f in ap.frames))

        p1 = ctx.new_page(); watch(p1); p1.goto(url + '/apps/settings/'); p1.wait_for_timeout(600)
        p2 = ctx.new_page(); watch(p2); p2.goto(url + '/apps/settings/'); p2.wait_for_timeout(600)
        p2.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          window.__heard = []; ws.data.subscribe('pages', e => window.__heard.push(e.rev)); await new Promise(r => setTimeout(r, 500)); }""")
        rev = p1.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          const env = ws.data.stamp(null, {schema: 'notes.pages', version: 1, rev: 0, items: [{id: 'a', title: 'A'}]});
          return (await ws.data.put('pages', env)).rev; }""")
        p2.wait_for_timeout(800)
        check('agent backend: other pages hear writes through the event stream', rev == 1 and p2.evaluate('window.__heard') == [1])
        check(f'one event stream for every app and window, not one each ({len(streams)} opened)', len(streams) == 1)
        with open(os.path.join(home, 'data', 'notes', 'pages.json')) as f:
            check('agent backend: data is a file in the data folder', json.load(f)['items'][0]['title'] == 'A')
        cached = ap.evaluate("""async () => { await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 500));
          const k = (await caches.keys()).find(n => n.startsWith('workshop-')); if (!k) return null;
          return (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname); }""")
        check('on the agent, the service worker caches apps from /api/apps and nothing under /api', cached is not None and '/apps/notes/index.html' in cached and not any(p.startswith('/api') for p in cached))
        ctx.close()

        # Part 3: hosted. The static site on another origin, paired with the agent.
        serve(8803, functools.partial(Static, directory=ROOT))
        hctx = b.new_context(viewport={'width': 1280, 'height': 800})
        hp = hctx.new_page(); watch(hp)
        hp.goto(hosted + '/manifest.webmanifest')
        hp.evaluate(f"localStorage.setItem('workshop.agent', JSON.stringify({{url: '{url}', token: '{token}'}}))")
        hp.goto(hosted + '/#/settings'); hp.wait_for_timeout(2000)
        check('a paired hosted page runs in hosted mode', hp.evaluate('document.documentElement.dataset.mode') == 'hosted')
        hs = next((f for f in hp.frames if '/apps/settings/' in f.url), None)
        check('hosted Settings is read-only and says where to change it', hs is not None and 'open Workshop on this computer' in hs.inner_text('#modeNote')
              and hs.locator('[data-enable]:not([disabled])').count() == 0 and hs.locator('.conn').count() == 2)
        put = hs.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'settings'});
          try { await ws.config.put({features: {startAtLogin: true}}); return 'saved'; } catch (e) { return e.code; } }""") if hs else None
        check('the agent refuses config changes from a hosted page', put == 'local_only')
        hctx.close()
    finally:
        proc.terminate(); proc.wait(10)
        shutil.rmtree(tmp, ignore_errors=True)

# Rows of every sheet of an xlsx file, read with the page's SheetJS. Score is left out: it depends on today.
SHEET_ROWS = """(b64) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const wb = XLSX.read(bytes, {type: 'array'});
  return Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], {defval: ''}).map(r => { delete r.Score; return r; })])); }"""
FIX = os.path.join(ROOT, 'apps', 'prioritizer', 'test', 'fixtures')


def b64(path):
    import base64
    with open(path, 'rb') as f: return base64.b64encode(f.read()).decode()


def storage_checks(b, watch):
    """Part 4: Prioritizer's board saved through the SDK (WS5)."""
    with open(os.path.join(FIX, 'today-localstorage.json')) as f: legacy = json.load(f)
    want = sorted(t['title'] for t in legacy['tasks'])
    titles = "() => window.__prioritizer.state.tasks.map(t => t.title).sort()"

    # Browser mode: a board saved by the localStorage versions moves into Workshop storage once.
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
    pg = ctx.new_page(); watch(pg)
    pg.goto(HUB + '/manifest.webmanifest')
    pg.evaluate("raw => localStorage.setItem('prioritizer.v1', raw)", json.dumps(legacy))
    pg.goto(HUB + '/apps/prioritizer/'); pg.wait_for_timeout(1200)
    check('the old browser board moves in on first load', pg.evaluate(titles) == want)
    stored = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
      const q = r.result.transaction('data').objectStore('data').get('prioritizer/tasks'); q.onsuccess = () => res(q.result); }; })""")
    check('browser mode saves the board as a prioritizer.tasks envelope', stored and stored['schema'] == 'prioritizer.tasks' and len(stored['items']) == len(want))
    check('the move keeps the old change stamps', stored and {t['id']: t['updatedAt'] for t in stored['items']}['t1'] == next(t['updatedAt'] for t in legacy['tasks'] if t['id'] == 't1'))
    check('the old copy is kept, and marked as moved', pg.evaluate("localStorage.getItem('prioritizer.v1') !== null && localStorage.getItem('prioritizer.v1.moved') !== null"))
    pg.evaluate("() => { const P = window.__prioritizer; P.state.tasks = P.state.tasks.filter(t => t.id !== 't7'); P.commit(); return P.saved(); }")
    pg.reload(); pg.wait_for_timeout(1200)
    check('it moves only once: a deleted task stays deleted after reload', pg.evaluate(titles) == [t for t in want if t != 'Untriaged idea'])
    check('the folder icon is a file menu now', pg.evaluate("document.querySelector('#syncBtn').dataset.sync") == 'on')
    pg.click('#syncBtn'); pg.wait_for_timeout(200)
    menu = pg.inner_text('.menu')
    check('the file menu says where the board is saved, and has no folder sync', 'Saved in this browser' in menu and 'Download a backup' in menu and 'folder' not in menu.lower())
    pg.keyboard.press('Escape')
    with pg.expect_download() as dl: pg.evaluate('window.__prioritizer.downloadBackup()')
    bundle_path = os.path.join(tempfile.mkdtemp(), dl.value.suggested_filename); dl.value.save_as(bundle_path)
    with open(bundle_path) as f: bundle = json.load(f)
    check('a backup is a Workshop bundle named workshop-<date>.json', bundle['schema'] == 'workshop.bundle' and dl.value.suggested_filename.startswith('workshop-')
          and sorted(c['collection'] for c in bundle['collections']) == ['lists', 'people', 'settings', 'tasks'])
    ctx.close()

    tmp = tempfile.mkdtemp()
    proc, url, token, home = start_agent(tmp)
    data = os.path.join(home, 'data', 'prioritizer')
    try:
        actx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        p1 = actx.new_page(); watch(p1)
        p1.goto(f'{url}/?token={token}'); p1.wait_for_timeout(800)
        p1.goto(url + '/apps/prioritizer/'); p1.wait_for_timeout(1200)

        # Round trip: export from today's app (the fixture), import, export again: identical tasks.
        p1.set_input_files('#importFile', os.path.join(FIX, 'today-export.xlsx')); p1.wait_for_timeout(600)
        p1.evaluate('window.__prioritizer.saved()')
        with open(os.path.join(data, 'tasks.json')) as f: on_disk = json.load(f)
        check('with Workshop running, the board is a file in the data folder', on_disk['schema'] == 'prioritizer.tasks' and sorted(t['title'] for t in on_disk['items']) == want)
        check('lists, people and settings are files too', all(os.path.exists(os.path.join(data, c + '.json')) for c in ('lists', 'people', 'settings')))
        p1.reload(); p1.wait_for_timeout(1200)
        with p1.expect_download() as dl: p1.evaluate('window.__prioritizer.exportXlsx()')
        again = os.path.join(tempfile.mkdtemp(), 'again.xlsx'); dl.value.save_as(again)
        first, second = p1.evaluate(SHEET_ROWS, b64(os.path.join(FIX, 'today-export.xlsx'))), p1.evaluate(SHEET_ROWS, b64(again))
        check('round trip: export from today\'s app, import, export again gives identical tasks', first == second and sum(len(v) for k, v in first.items() if k != 'Lists') == len(want))

        # Moving between backends: the browser-mode backup merges into the agent board.
        p1.set_input_files('#importFile', bundle_path); p1.wait_for_timeout(500)
        p1.click('[data-merge]'); p1.wait_for_timeout(600); p1.evaluate('window.__prioritizer.saved()')
        check('a backup from browser mode imports into the agent board without duplicates', p1.evaluate(titles) == want)

        # Two windows stay in sync through the event stream.
        p2 = actx.new_page(); watch(p2)
        p2.goto(url + '/apps/prioritizer/'); p2.wait_for_timeout(1200)
        p1.evaluate("""() => { const P = window.__prioritizer; P.state.tasks.push({id: 'w1', title: 'From window one', listId: P.state.lists[0].id, value: 3, effort: 'S'});
          P.state = P.sanitize(P.state); P.commit(); return P.saved(); }""")
        p2.wait_for_timeout(800)
        check('two windows: the other window shows a new task without reloading', 'From window one' in p2.evaluate(titles))
        p2.evaluate("() => { const P = window.__prioritizer; P.state.tasks.find(t => t.id === 'w1').title = 'Edited in window two'; P.commit(); return P.saved(); }")
        p1.wait_for_timeout(800)
        check('two windows: an edit in either one reaches the other', 'Edited in window two' in p1.evaluate(titles) and 'From window one' not in p1.evaluate(titles))
        p1.evaluate("() => { const P = window.__prioritizer; P.state.tasks.find(t => t.id === 't1').title = 'Plan (one)'; P.commit(); }")
        p2.evaluate("() => { const P = window.__prioritizer; P.state.tasks.find(t => t.id === 't2').title = 'Onboarding (two)'; P.commit(); }")
        p1.wait_for_timeout(1500)
        both = [p.evaluate(titles) for p in (p1, p2)]
        check('two windows editing at the same time merge instead of overwriting', both[0] == both[1] and 'Plan (one)' in both[0] and 'Onboarding (two)' in both[0])

        # A failed write never loses the previous file; the edit waits and is saved on retry.
        with open(os.path.join(data, 'tasks.json')) as f: before = f.read()
        os.makedirs(os.path.join(data, 'tasks.json.tmp'))  # the agent's temp file can't be created
        p1.evaluate("() => { const P = window.__prioritizer; P.state.tasks.push({id: 'f1', title: 'Written while the disk fails', listId: P.state.lists[0].id}); P.state = P.sanitize(P.state); P.commit(); }")
        p1.wait_for_timeout(1200)
        with open(os.path.join(data, 'tasks.json')) as f: during = f.read()
        check('a failed write leaves the previous file as it was', during == before)
        check('a failed write shows "not saved" and keeps the edit on screen', p1.evaluate("document.querySelector('#syncBtn').dataset.sync") == 'error'
              and 'Written while the disk fails' in p1.evaluate(titles))
        os.rmdir(os.path.join(data, 'tasks.json.tmp'))
        p1.wait_for_timeout(6500)
        with open(os.path.join(data, 'tasks.json')) as f: after = json.load(f)
        check('once the disk works again, the retry saves it', 'Written while the disk fails' in [t['title'] for t in after['items']]
              and p1.evaluate("document.querySelector('#syncBtn').dataset.sync") == 'on')
        p2.wait_for_timeout(300)
        check('and the other window gets it', 'Written while the disk fails' in p2.evaluate(titles))

        # A data file the agent can't read: Prioritizer says so and writes nothing over it.
        with open(os.path.join(data, 'tasks.json'), 'w') as f: f.write('{not json')
        p3 = actx.new_page(); watch(p3)
        p3.goto(url + '/apps/prioritizer/'); p3.wait_for_timeout(1200)
        p3.evaluate("() => { const P = window.__prioritizer; P.state.capacity = 7; P.commit(); }"); p3.wait_for_timeout(800)
        with open(os.path.join(data, 'tasks.json')) as f: damaged = f.read()
        check('a damaged data file: Prioritizer says it can\'t load and never writes over it', damaged == '{not json'
              and p3.evaluate("document.querySelector('#syncBtn').dataset.sync") == 'error' and 'Could not load your board' in p3.inner_text('#toast'))
        actx.close()
    finally:
        proc.terminate(); proc.wait(10)
        shutil.rmtree(tmp, ignore_errors=True)


def seen(frame, selector, ms=20000, state='attached'):
    """True once selector is in frame (or gone, with state='detached'), waiting up to ms. For steps that wait on
    the .work parser (PowerShell)."""
    try:
        frame.wait_for_selector(selector, timeout=ms, state=state); return True
    except Exception:
        return False


def agents_checks(b, watch):
    """Part 5: the Agents app on the opencode connector (WS6), with a synthetic workspace and a fake opencode."""
    fx = subprocess.Popen(['node', os.path.join(ROOT, 'apps', 'agents', 'test', 'fixture.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    info = json.loads(fx.stdout.readline())
    def ask(cmd):
        fx.stdin.write(json.dumps(cmd) + '\n'); fx.stdin.flush()
        return json.loads(fx.stdout.readline())
    tmp = tempfile.mkdtemp()
    apps, conns, home = (os.path.join(tmp, d) for d in ('apps', 'connectors', 'home'))
    for name in ('prioritizer', 'agents', 'settings'):
        shutil.copytree(os.path.join(ROOT, 'apps', name), os.path.join(apps, name))
    shutil.copytree(os.path.join(ROOT, 'connectors', 'opencode'), os.path.join(conns, 'opencode'))
    os.makedirs(home)
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4380, 'allowedOrigins': [], 'features': {'startAtLogin': False, 'hostedMode': False},
                   'connectors': {'opencode': {'enabled': True, 'config': {'workspace': info['workspace'], 'opencode': {'url': info['opencode'], 'startServer': False}, 'pollSeconds': 20}}}}, f)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    a = json.loads(proc.stdout.readline())
    url = a['url']
    try:
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        pg = ctx.new_page(); watch(pg)
        pg.goto(f"{url}/?token={a['token']}"); pg.wait_for_timeout(1000)
        pg.goto(url + '/#/agents/41610'); pg.wait_for_timeout(1000)
        af = next((f for f in pg.frames if '/apps/agents/' in f.url), None)
        if af: seen(af, '.pill.on'); pg.wait_for_timeout(500)
        check('Agents is a same-origin app on the SDK, no frame from another origin', af is not None and all(f.url.startswith(url) or f.url == 'about:blank' for f in pg.frames))
        check('Agents reads the opencode connector and shows Live', af is not None and af.inner_text('.pill') == 'Live')
        ids = af.eval_on_selector_all('.item, .pickup', 'els => els.map(e => e.id)')
        check('every .work folder is on the page', sorted(ids) == sorted(['item-41207', 'item-41300', 'item-41455', 'item-41502', 'item-41610', 'item-spike-cache-options', 'item-tsd-billing-api']))
        top = af.evaluate("document.getElementById('item-41610').getBoundingClientRect().top")
        check('#/agents/<id> focuses that item, also when the app is opened there', 0 <= top < 800 and af.evaluate('scrollY') > 0)
        check('the shell keeps the address, and the name and theme are the shell\'s', pg.url.endswith('#/agents') and af.locator('.brand').count() == 0 and af.locator('[data-theme-menu]').count() == 0)

        pg.click('#themeBtn'); pg.click('.menu [data-th=dracula]'); pg.wait_for_timeout(400)
        check('a theme change applies to Agents', af.evaluate('document.documentElement.dataset.theme') == 'dracula')
        bg = af.evaluate("getComputedStyle(document.body).backgroundColor")
        check('Agents draws with shared/themes.css colors', bg == 'rgb(40, 42, 54)')

        # The track, the main button, and a write action sent with confirm from the click.
        pick = af.locator('.pickup')
        check('Pick up here is the item that needs you, with its own Abandon button', pick.get_attribute('id') == 'item-41300' and pick.locator('[data-remove]').inner_text() == 'Abandon')
        check('the track: checked, current and faint stages', pick.locator('.stop.done').count() == 1 and pick.locator('.stop.here .name').inner_text() == 'Bug' and pick.locator('.stop:not(.done):not(.here)').count() == 3)
        approve = pick.locator('[data-run]')
        check('one main button per step; the command is in the tooltip', pick.locator('.do .btn.primary').count() == 1 and '/approve 41300' in approve.get_attribute('title'))
        approve.click(); pg.wait_for_timeout(1500)
        r = ask({'requests': True})
        cmds = [x['body'] for x in r['bodies'] if x['route'].endswith('/command')]
        check('Approve only runs /approve in opencode through the connector', {'command': 'approve', 'arguments': '41300'} in cmds and 'Started /approve 41300' in pg.inner_text('#toast'))

        # A file opens in the app.
        pick.locator('[data-file][data-name="bug.md"]').click(); pg.wait_for_timeout(800)
        check('Open bug.md shows the file in the app (file.read)', 'Bug' in af.inner_text('.filetext') and af.locator('.sheet h3').inner_text() == '.work/41300-export-retry-fails/bug.md')
        af.press('.sheet', 'Escape'); pg.wait_for_timeout(200)

        # Prompts: shown, counted on the rail badge, answered.
        ask({'ask': {'id': 'per_e2e', 'session': None, 'title': 'npm test'}}); pg.wait_for_timeout(1200)
        check('a prompt from opencode shows under Waiting for you', 'npm test' in af.inner_text('.waiting'))
        check('the rail badge counts open prompts', pg.inner_text('.app-btn[data-app=agents] .badge') == '1')
        af.click('.waiting [data-perm=per_e2e][data-answer=once]'); pg.wait_for_timeout(1200)
        r = ask({'requests': True})
        check('Allow once answers it in opencode', 'POST /session/ses_tui0/permissions/per_e2e' in r['requests'] and af.locator('.waiting').count() == 0)
        check('and the badge clears', pg.locator('.app-btn[data-app=agents] .badge').is_hidden())

        # Ready to ship: copy buttons and Push.
        ship = af.locator('#item-41610')
        check('the PR card has Copy title, Copy description and the push command', ship.locator('button.copy', has_text='Copy title').count() == 1
              and ship.locator('button.copy', has_text='Copy description').count() == 1 and 'git -C gateway push -u origin dev/bug/41610-rate-limit-headers' in ship.inner_text())
        ship.locator('[data-push]').click()
        pushed = False
        for _ in range(40):
            pushed = 'dev/bug/41610-rate-limit-headers' in ask({'requests': True})['branches']
            if pushed: break
            pg.wait_for_timeout(250)
        check('Push pushes the pr.md branch to origin', pushed)

        # Remove: the dialog, typing the name, and the folder gone.
        af.locator('#item-spike-cache-options [data-remove]').click(); pg.wait_for_timeout(300)
        go = af.locator('[data-remove-go]')
        check('Remove asks you to type the name first', go.is_disabled() and 'cannot be undone' in af.inner_text('.sheet'))
        af.fill('.sheet input[data-draft]', 'spike-cache-options'); go.click(); pg.wait_for_timeout(1500)
        gone = seen(af, '#item-spike-cache-options', state='detached')
        check('Remove deletes the .work folder', gone and not os.path.exists(os.path.join(info['workspace'], '.work', 'spike-cache-options')) and 'Deleted .work/spike-cache-options' in pg.inner_text('#toast'))

        # Prioritizer: stages and Start through the connector.
        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(1500)
        pf = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
        add_ado_task(pf, 'w1', 'Login timeout', '41207', 'User Story')
        add_ado_task(pf, 'w2', 'Brand new', '77777', 'User Story'); pg.wait_for_timeout(800)
        chip = pf.locator('.chip.eng')
        check('Prioritizer shows the stage from connectors.call(opencode, status)', chip.count() == 1 and 'Build 2/3' in chip.inner_text())
        chip.click(); pg.wait_for_timeout(1200)
        top = af.evaluate("document.getElementById('item-41207').getBoundingClientRect().top")
        check('the stage chip opens that item in Agents', pg.url.endswith('#/agents') and 0 <= top < 800)
        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(400)
        pf.locator('.row', has_text='Brand new').first.click(); pg.wait_for_timeout(400)
        pf.click('[data-d=eng-start][data-lane=feature]'); pg.wait_for_timeout(1500)
        cmds = [x['body'] for x in ask({'requests': True})['bodies'] if x['route'].endswith('/command')]
        check('Start as feature runs /start in opencode through the connector', {'command': 'start', 'arguments': '77777 feature'} in cmds)
        pf.press('#drawer', 'Escape')

        # Turning the connector off: both apps notice without a reload.
        pg.keyboard.press('Alt+3'); pg.wait_for_timeout(1500)
        sf = next(f for f in pg.frames if '/apps/settings/' in f.url)
        sf.locator('.conn[data-connector=opencode] [data-enable]').uncheck(); pg.wait_for_timeout(1500)
        check('with the connector off, Agents says how to turn it on', 'Turn on the opencode connector' in af.inner_text('#app'))
        check('and Prioritizer drops the stages', pf.locator('.chip.eng').count() == 0)
        sf.locator('.conn[data-connector=opencode] [data-enable]').check()
        check('turned on again, Agents comes back by itself', seen(af, '#item-41207') and af.locator('.pill').count() == 1)

        # On its own, the page has the name and a theme menu.
        sp = ctx.new_page(); watch(sp)
        sp.goto(url + '/apps/agents/#41502'); seen(sp, '#item-41502'); sp.wait_for_timeout(300)
        check('Agents works on its own page, with its name and theme menu', sp.inner_text('h1') == 'Agents' and sp.locator('[data-theme-menu]').count() == 1 and sp.locator('#item-41502').count() == 1)
        ctx.close()
    finally:
        proc.terminate(); proc.wait(10)
        fx.stdin.close(); fx.wait(10)
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    serve(8802, functools.partial(Static, directory=ROOT))
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
        pg.evaluate("""() => { localStorage.setItem('em.theme', 'dracula'); localStorage.setItem('prioritizer.theme', 'ivory'); }""")

        pg.goto(HUB + '/'); pg.wait_for_timeout(800)
        keys = pg.evaluate("() => Object.fromEntries(['workshop.theme', 'em.theme', 'prioritizer.theme'].map(k => [k, localStorage.getItem(k)]))")
        check('theme survives the rename', keys['workshop.theme'] == 'dracula' and pg.evaluate('document.documentElement.dataset.theme') == 'dracula')
        check('old setting keys are removed', keys['em.theme'] is None and keys['prioritizer.theme'] is None)
        check('old globals are gone, and the Dashboard pane with them', pg.evaluate("() => !window.EmHub && !window.EmTheme && !window.EmSw && !window.EmDashboard && !window.WorkshopHub && !window.WorkshopDashboard && !window.EngClient && !!window.WorkshopTheme && !!window.WorkshopSw"))
        check('opens on Prioritizer at the plain address', pg.url == HUB + '/' and pg.title() == 'Prioritizer · Workshop')
        frame = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
        check('theme reaches Prioritizer after the rename', frame.evaluate('document.documentElement.dataset.theme') == 'dracula')
        check('Prioritizer hides its theme button in the hub', not frame.locator('#themeBtn').is_visible())
        add_ado_task(frame, 'a1', 'Fix login', '123', 'Bug')
        add_ado_task(frame, 'a2', 'New story', '456', 'User Story')
        check('no stage chips without the opencode connector', frame.locator('.chip.eng').count() == 0)
        frame.locator('.row', has_text='Fix login').first.click(); pg.wait_for_timeout(300)
        check('no Start buttons without the opencode connector', frame.locator('[data-d=eng-start]').count() == 0 and frame.locator('.deng').count() == 0)
        frame.press('#drawer', 'Escape'); pg.wait_for_timeout(200)

        pg.click('.app-btn[data-app=agents]'); pg.wait_for_timeout(1200)
        af = next((f for f in pg.frames if '/apps/agents/' in f.url), None)
        check('Agents opens from the rail, as an app in the shell', af is not None and pg.url.endswith('#/agents'))
        check('Agents in browser mode says it needs Workshop on this computer', af is not None and 'needs Workshop running on this computer' in af.inner_text('#app'))
        check('no frame from another origin: the old dashboard frame is gone', all(f.url.startswith(HUB) or f.url == 'about:blank' for f in pg.frames))
        pg.goto(HUB + '/#/dashboard'); pg.wait_for_timeout(1000)
        check('the old #/dashboard address opens Agents', pg.url.endswith('#/agents') and pg.title() == 'Agents · Workshop')

        pg.goto(HUB + '/'); pg.wait_for_timeout(1000)
        frame = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
        pg.click('#themeBtn'); pg.click('.menu [data-th=nord]'); pg.wait_for_timeout(500)
        check('theme reaches Prioritizer', frame.evaluate('document.documentElement.dataset.theme') == 'nord')
        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300); frame.click('#main'); pg.keyboard.press('Alt+2'); pg.wait_for_timeout(400)
        check('Alt+2 inside Prioritizer switches apps', pg.url.endswith('#/agents'))
        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300)

        browser_mode_checks(ctx, pg, frame, watch)

        sp = ctx.new_page(); watch(sp)
        sp.goto(HUB + '/apps/prioritizer/'); sp.wait_for_timeout(600)
        check('Prioritizer still works on its own', sp.locator('#themeBtn').is_visible() and sp.locator('#snav .sitem').count() == 5)
        check('Prioritizer defines no globals except its test hook', sp.evaluate(PRIORITIZER_GLOBALS) == ['__prioritizer'])
        tasks = "() => window.__prioritizer.state.tasks.map(t => [t.title, t.ado ? String(t.ado.id) : '']).sort()"
        before = sp.evaluate(tasks)
        check('tasks survive reloads', ['Fix login', '123'] in before and ['New story', '456'] in before)

        # Excel round trip through the vendored SheetJS: export, then import the file with Replace.
        check('self-hosted fonts load', sp.evaluate("() => document.fonts.ready.then(() => ['Inter', 'JetBrains Mono'].every(n => [...document.fonts].some(f => f.family.replace(/\"/g, '') === n && f.status === 'loaded')))"))
        check('SheetJS is the vendored current release', sp.evaluate('window.XLSX && XLSX.version') == '0.20.3')
        with sp.expect_download() as dl: sp.evaluate('window.__prioritizer.exportXlsx()')
        xlsx = os.path.join(tempfile.mkdtemp(), 'export.xlsx'); dl.value.save_as(xlsx)
        with open(xlsx, 'rb') as f: check('Excel export writes an xlsx file', f.read(2) == b'PK')
        sp.evaluate("() => { const P = window.__prioritizer; P.state.tasks = P.state.tasks.filter(t => t.title !== 'Fix login'); P.commit(); }")
        sp.set_input_files('#importFile', xlsx); sp.wait_for_timeout(500)
        sp.click('[data-imp=replace]'); sp.wait_for_timeout(300)
        check('Excel import restores the exported tasks', sp.evaluate(tasks) == before)

        agent_checks(b, watch)
        storage_checks(b, watch)
        agents_checks(b, watch)

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
