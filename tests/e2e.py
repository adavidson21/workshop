#!/usr/bin/env python3
"""End-to-end check of Workshop in headless Chromium.

  pip install playwright && python -m playwright install chromium
  git clone https://github.com/adavidson21/docket .remote/prioritizer   # Docket (apps/remote.json)
  git clone https://github.com/adavidson21/receipts .remote/receipts    # Rapport
  git clone https://github.com/adavidson21/notes .remote/notes          # Notes
  python tests/e2e.py

Docket's and Rapport's code live in their own repos and the Worker serves them under /apps/prioritizer/ and
/apps/receipts/ (worker/index.js). Here the static server and the agent's apps folder do the same from the
checkouts in .remote/ (or DOCKET_DIR, RECEIPTS_DIR).

Five parts:
  1. Browser mode: serves this repo as a static site on 127.0.0.1:8802.
  2. The agent and the hosted site: the real agent (tests/e2e-agent.mjs) with a temporary home and the ADO
     and echo connectors. The hub comes from a static site on another origin paired with it (hosted mode;
     localhost:8804 also lists two sample apps). Workshop on this computer (the agent's Settings page): the
     data folder, connectors and their forms. Required connectors and data events through the hub.
  3. Hosted Settings is read-only, and the agent serves no hub.
  4. Prioritizer storage (WS5): the board in the data folder, the one-time move from the old browser
     copy, Excel and backup round trips, two windows in sync, and a failed write.
  5. Agents (WS6): the real agent with the opencode connector, a synthetic workspace and a fake opencode
     (apps/agents/test/fixture.mjs). The page, its buttons, prompts, the code review (Review, then Approve and
     Push PR to a bare origin), deep links, theme, and Prioritizer's
     stages and Start through the connector.
  6. The data folder (WS11c): browser mode on a folder (Chrome's private folder stands in for one picked by
     hand, since the picker cannot be automated), the move from IndexedDB, files, other tabs and outside
     changes, the access bar, and Settings in every mode.
Notes (WS15) runs in part 1 (browser storage) and part 6 (the folder): notes, links, backlinks, tags, search,
pasted images, renames that update links, copy, and what lands on disk.
Exit 1 if any check fails.
"""
import functools, http.server, json, os, re, shutil, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB = 'http://127.0.0.1:8802'
# The hosted site paired with the agent in parts 2 to 5 (the agent serves no hub: docs/run-modes.md).
HOSTED = 'http://localhost:8803'
# The same site plus two sample apps (tests/fixtures/apps), for the rail and required-connector checks.
SAMPLES = 'http://localhost:8804'
DOCKET = os.environ.get('DOCKET_DIR') or os.path.join(ROOT, '.remote', 'prioritizer')
# What the agent's apps folder gets from the Docket checkout: the site, not its tests, tools or Android project.
DOCKET_SKIP = shutil.ignore_patterns('.git', '.github', 'mobile', 'test', 'scripts', 'node_modules', '*.md', 'wrangler.jsonc', 'workshop-files.json')
# Runway and Rapport (apps/remote.json) are served the same way from their checkouts.
RUNWAY = os.environ.get('RUNWAY_DIR') or os.path.join(ROOT, '.remote', 'runway')
RECEIPTS = os.environ.get('RECEIPTS_DIR') or os.path.join(ROOT, '.remote', 'receipts')
NOTES = os.environ.get('NOTES_DIR') or os.path.join(ROOT, '.remote', 'notes')
REMOTE_DIRS = {'prioritizer': DOCKET, 'runway': RUNWAY, 'receipts': RECEIPTS, 'notes': NOTES}
# E2E_PART=hub runs part 1 (browser mode, Home, Docket on its own); E2E_PART=agent runs parts 2 to 6. CI runs the two
# halves side by side (.github/workflows/checks.yml). Unset runs everything.
PART = os.environ.get('E2E_PART') or 'all'


class Static(http.server.SimpleHTTPRequestHandler):
    """This repo as a static site, with each remote app (Docket, Runway, Rapport) served from its checkout like the Worker does."""
    def log_message(self, *a): pass

    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        for app, folder in REMOTE_DIRS.items():
            if clean.startswith(f'/apps/{app}/'):
                rest = clean[len(f'/apps/{app}/'):]
                return os.path.join(folder, *[p for p in rest.split('/') if p and p not in ('.', '..')])
        return super().translate_path(path)


class WithSamples(Static):
    """The site plus tests/fixtures/apps/pages and board, listed in its registry."""
    registry = None

    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if clean == '/apps/registry.json': return WithSamples.registry
        for app in ('pages', 'board'):
            if clean.startswith(f'/apps/{app}/'):
                rest = clean[len(f'/apps/{app}/'):]
                return os.path.join(ROOT, 'tests', 'fixtures', 'apps', app, *[p for p in rest.split('/') if p and p not in ('.', '..')])
        return super().translate_path(path)


def samples_registry(tmp):
    """apps/registry.json with the sample apps added (Board after the repo's apps, so Docket stays first)."""
    with open(os.path.join(ROOT, 'apps', 'registry.json')) as f: reg = json.load(f)
    # Like the Worker, list Docket with its live app.json (here, the checkout's) instead of the snapshot.
    live = os.path.join(DOCKET, 'app.json')
    if os.path.isfile(live):
        with open(live) as f: dm = json.load(f)
        for a in reg['apps']:
            if a['manifest'].get('id') == 'prioritizer': a['manifest'] = dm
    for app, order in (('pages', None), ('board', 50)):
        with open(os.path.join(ROOT, 'tests', 'fixtures', 'apps', app, 'app.json')) as f: m = json.load(f)
        if order is not None: m['order'] = order
        reg['apps'].append({'base': f'/apps/{app}/', 'manifest': m})
    out = os.path.join(tmp, 'registry.json')
    with open(out, 'w') as f: json.dump(reg, f)
    return out


def docket_declares(setting):
    try:
        with open(os.path.join(DOCKET, 'app.json')) as f: return any(x.get('id') == setting for x in json.load(f).get('settings', []))
    except OSError: return False


def pair(ctx, site, url, token):
    """What Connect leaves behind: this site's pairing with the agent, in the site's localStorage."""
    p = ctx.new_page()
    p.goto(site + '/manifest.webmanifest')
    p.evaluate(f"localStorage.setItem('workshop.agent', JSON.stringify({{url: '{url}', token: '{token}'}}))")
    p.close()


def local_page(ctx, url, token, watch=None):
    """Workshop on this computer: the agent's Settings page, signed in with the token."""
    p = ctx.new_page()
    if watch: watch(p)
    p.goto(f'{url}/?token={token}'); p.wait_for_selector('#content .card', timeout=15000); p.wait_for_timeout(800)
    return p


def copy_app(name, dest):
    """An app folder for the agent: a remote app (Docket, Runway, Rapport) from its checkout, the rest from apps/."""
    if name in REMOTE_DIRS: shutil.copytree(REMOTE_DIRS[name], dest, ignore=DOCKET_SKIP)
    else: shutil.copytree(os.path.join(ROOT, 'apps', name), dest)


def serve(port, handler):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()


failed = []
def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


SETTINGS_PAGE = {'general': 'overview', 'c-ado': 'connections', 'c-opencode': 'agents'}
def stab(frame, tab):
    """Settings has a page per job in its left nav (apps/settings/js/pages.js). Opens one, by page id or the old tab id."""
    frame.click(f'.nav-item[data-page="{SETTINGS_PAGE.get(tab, tab)}"]'); frame.wait_for_timeout(150)


def skip_docket_tour(frame):
    # Docket opens a first-run tour on a brand new board (docket #6). Skip it like a person would.
    skip = frame.locator('[data-skip]')
    if skip.count() and skip.first.is_visible():
        skip.first.click(); frame.wait_for_timeout(200)


def add_ado_task(frame, tid, title, ado_id, typ):
    skip_docket_tour(frame)
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
# A scratch app id no real app uses, so the counts below do not depend on what the apps saved earlier.
SDK_BROWSER = """async () => {
  const {connect} = await import('/shared/workshop-sdk.js');
  const a = await connect({app: 'scratch'}), b = await connect({app: 'scratch'});
  const out = {mode: a.mode, backend: a.backend, online: a.online};
  out.empty = await a.data.get('pages');
  let heard = null; b.data.subscribe('pages', e => { heard = e; });
  let self = null; a.data.subscribe('pages', e => { self = e; });
  const first = a.data.stamp(null, {schema: 'scratch.pages', version: 1, rev: 0, items: [{id: 'p1', title: 'One'}]});
  out.put1 = await a.data.put('pages', first);
  await new Promise(r => setTimeout(r, 300));
  out.heard = heard && heard.rev; out.self = self;
  const read = await b.data.get('pages');
  out.readRev = read.rev; out.updatedAt = typeof read.updatedAt;
  try { await a.data.put('pages', first); out.conflict = 'none'; } catch (e) { out.conflict = e.code; out.currentRev = e.current && e.current.rev; }
  try { await a.data.put('pages', {...read, version: 0}); } catch (e) { out.badVersion = e.code; }
  const v2 = await a.data.put('levels', {schema: 'scratch.levels', version: 2, rev: 0, items: []});
  try { await a.data.put('levels', {schema: 'scratch.levels', version: 1, rev: v2.rev, items: []}); } catch (e) { out.downgrade = e.code; }
  try { await a.data.put('pages', {...read, schema: 'scratch.other'}); } catch (e) { out.badSchema = e.code; }
  const edited = b.data.stamp(read, {...structuredClone(read), items: [...read.items, {id: 'p2', title: 'Two'}]});
  out.put2 = (await b.data.put('pages', edited)).rev;
  const bundle = await a.data.export({apps: ['scratch']});
  out.bundle = [bundle.schema, bundle.collections.length, bundle.source.backend];
  bundle.collections.push({app: 'scratch', collection: 'drafts', envelope: {...structuredClone(bundle.collections[0].envelope), schema: 'scratch.drafts'}});
  out.imported = await a.data.import(bundle);
  out.connectors = await a.connectors.list();
  try { await a.connectors.call('ado', 'sync'); } catch (e) { out.callCode = e.code; }
  return out;
}"""


def browser_mode_checks(ctx, pg, frame, watch):
    """Part 1, browser mode (static site, no agent): the platform pieces WS4 added."""
    rail = pg.eval_on_selector_all('.app-btn[data-app]', 'els => els.map(e => e.dataset.app)')
    check('rail is built from the app registry, Runway on its own button (Slate 2.0.0 stopped hosting it)', rail == ['prioritizer', 'slate', 'agents', 'receipts', 'notes', 'runway', 'settings'])
    pg.click('#capBtn'); pg.wait_for_timeout(800)
    check('the top bar Capture button opens the capture bar', pg.locator('.capbar').is_visible())
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('Esc closes the capture bar', pg.locator('.capbar').count() == 0 or not pg.locator('.capbar').is_visible())
    check('static site runs in browser mode', pg.evaluate('document.documentElement.dataset.mode') == 'browser')
    check('app icons are inlined so they take the theme color', pg.locator('.app-btn[data-app=settings] .ico svg circle').count() == 1)

    pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300); frame.click('#main'); pg.keyboard.press('Control+k'); pg.wait_for_timeout(300)
    check('Ctrl+K inside an app opens the shell palette, not the app\'s own', pg.locator('.cmdk-input').is_visible() and not frame.evaluate("document.getElementById('cmd').classList.contains('open')"))
    pg.keyboard.type('add a task'); pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    check('a palette command reaches the app through the SDK', frame.evaluate("document.getElementById('cmd').classList.contains('open')"))
    frame.press('#cmdInput', 'Escape'); pg.wait_for_timeout(200)

    tid = frame.evaluate("window.__prioritizer.state.tasks.find(t => t.title === 'Fix login').id")
    pg.evaluate(f"location.hash = '#/prioritizer/task/{tid}'"); pg.wait_for_timeout(600)
    # Docket is the first rail app, so its plain address is the bare page; from Docket 8.0.0 it writes where it is.
    check('a deep link opens the task', frame.evaluate("document.getElementById('app').classList.contains('drawer-open')") and pg.url in (HUB + '/', HUB + f'/#/prioritizer/task/{tid}'))
    frame.press('#drawer', 'Escape'); pg.wait_for_timeout(200)

    pg.keyboard.press('Alt+4'); pg.wait_for_timeout(1200)
    rf = next((f for f in pg.frames if '/apps/receipts/' in f.url), None)
    check('Rapport opens from the rail', rf is not None and pg.url.endswith('#/receipts'))
    if rf:
        rf.fill('.composer textarea', 'Shipped the e2e check'); rf.press('.composer textarea', 'Control+Enter'); pg.wait_for_timeout(500)
        check('Rapport saves a receipt in browser storage', rf.locator('.entry').count() == 1)
        check('Rapport has a 1:1s tab', rf.locator('.tabs [data-path="1on1s"]').count() == 1)

    pg.keyboard.press('Alt+5'); pg.wait_for_timeout(1200)
    nf = next((f for f in pg.frames if '/apps/notes/' in f.url), None)
    check('Notes opens from the rail', nf is not None and pg.url.endswith('#/notes'))
    if nf: notes_flow(pg, nf, 'browser')
    if nf: notes_ecosystem(pg, nf)

    # The running Docket task in the top bar (ws.status), on every app, with Pause asking for a breadcrumb.
    pg.evaluate(f"location.hash = '#/prioritizer/task/{tid}'"); pg.wait_for_timeout(1500)
    frame = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)  # Notes reloaded the page
    # Needs a Docket that sends its running task (docket#19). CI checks out Docket's main, so until that is merged
    # these checks are skipped instead of failing.
    docket_status = frame.evaluate("() => fetch('js/focus.js').then(r => r.text()).then(t => t.includes('w.status.set'))")
    if not docket_status:
        print('SKIP  the top bar status checks: this Docket does not send ws.status yet')
        frame.press('#drawer', 'Escape'); pg.wait_for_timeout(200)
    else:
        frame.click('#drawer [data-d="focus-start"]'); pg.wait_for_timeout(300); frame.press('#drawer', 'Escape')
        pg.wait_for_function("() => !document.querySelector('#wstatus').hidden", timeout=5000)
        check('a running Docket task shows in the top bar, and Docket\'s own band steps aside',
              'Fix login' in pg.inner_text('#wstatus .ws-main') and pg.inner_text('#wstatus .ws-time').strip() == '0m'
              and not frame.is_visible('#nowbar') and pg.title().startswith('\u25CF 0m Fix login'))
        pg.keyboard.press('Alt+5'); pg.wait_for_timeout(500)
        check('the top bar keeps it on other apps', pg.is_visible('#wstatus') and pg.url.endswith('#/notes'))
        pg.click('#wstatus [aria-label="Pause"]'); pg.wait_for_timeout(200)
        check('Pause in the top bar asks where you left off', pg.locator('.ws-prompt').is_visible() and 'Where did you leave off?' in pg.inner_text('.ws-prompt'))
        pg.fill('.ws-prompt input', 'check the token refresh'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
        check('and pauses the task with that breadcrumb, from Notes',
              pg.locator('#wstatus').is_hidden() and frame.evaluate(f"window.__prioritizer.focusModel.activeOf(window.__prioritizer.focusLog, new Date().toLocaleDateString('en-CA'))") is None
              and frame.evaluate(f"window.__prioritizer.state.tasks.find(t => t.id === '{tid}').crumbs.at(-1).text") == 'check the token refresh'
              and pg.url.endswith('#/notes'))
        pg.evaluate(f"location.hash = '#/prioritizer/task/{tid}'"); pg.wait_for_timeout(600)
        frame.click('#drawer [data-d="focus-start"]'); pg.wait_for_timeout(300); frame.press('#drawer', 'Escape')
        frame.evaluate('window.__prioritizer.saved()'); pg.wait_for_timeout(500)
        pg.goto(HUB + '/#/notes'); pg.wait_for_timeout(2500)
        frame = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
        check('Docket loads in the background, so the task is in the top bar before Docket is opened',
              pg.url.endswith('#/notes') and pg.is_visible('#wstatus') and 'check the token refresh' in pg.inner_text('#wstatus .ws-detail'))
        pg.click('#wstatus [aria-label="Pause"]'); pg.wait_for_timeout(200); pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
        check('Esc skips the breadcrumb and still pauses', pg.locator('#wstatus').is_hidden() and pg.locator('.ws-prompt').count() == 0)

    # 1:1s are part of Rapport (2.0.0): the tab, then the copy of the old 1:1s app's data on a fresh open.
    pg.evaluate("location.hash = '#/receipts/1on1s'"); pg.wait_for_timeout(800)
    of = next((f for f in pg.frames if '/apps/receipts/' in f.url), None)
    check('1:1s in Rapport with no people asks who you meet with', of is not None and 'Who do you meet with?' in of.inner_text('#app'))
    op = ctx.new_page(); watch(op); op.goto(HUB + '/apps/settings/'); op.wait_for_timeout(500)
    op.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'oneonones'});
      await ws.data.put('people', {schema: 'oneonones.people', version: 1, rev: 0, deleted: {}, items: [{id: 'p_old1', updatedAt: 1, name: 'Old Peer', links: {}, cadenceDays: 7, archived: false}]});
      await ws.files.write('notes/p-old1/2026-10-01.md', '# 1:1 with Old Peer\\n', {create: true}); }""")
    op.goto(HUB + '/apps/receipts/#/1on1s')
    op.wait_for_function("() => document.querySelector('.oo-row')", timeout=10000)
    check('Rapport copies the old 1:1s people in on first open', 'Old Peer' in op.inner_text('.oo-people'))
    moved = op.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js');
      const r = await connect({app: 'receipts'}); const o = await connect({app: 'oneonones'});
      const files = await r.files.list('oneonones/notes'); const old = await o.files.list('notes');
      const people = await r.data.get('oneonones/people'); return [files.map(f => f.path), old.length, people && people.schema]; }""")
    check('Rapport copies old 1:1 notes and keeps the old ones', moved == [['oneonones/notes/p-old1/2026-10-01.md'], 1, 'receipts.oneonones/people'])
    op.close()

    pg.evaluate("location.hash = '#/runway'"); pg.wait_for_timeout(2500)
    wf = next((f for f in pg.frames if '/apps/runway/' in f.url), None)
    check('#/runway opens Runway itself', wf is not None and pg.url.endswith('#/runway'))
    if not os.path.isfile(os.path.join(RUNWAY, 'app.json')):
        print(f'SKIP  Runway in browser mode (no checkout in {RUNWAY}; git clone https://github.com/adavidson21/runway .remote/runway)')
    elif wf:
        wf.wait_for_function('() => window.__runway && window.__runway.store.v.loaded', timeout=10000)
        check('Runway in browser mode makes ad hoc roadmaps, with no ADO offer', wf.locator('[data-new]').count() > 0 and wf.locator('[data-fromado]').count() == 0)

    pg.keyboard.press('Alt+2'); pg.wait_for_timeout(1500)
    slf = next((f for f in pg.frames if '/apps/slate/' in f.url), None)
    check('Slate is on the rail and opens', slf is not None and pg.url.endswith('#/slate'))
    if slf:
        slf.click('.top [data-act=tab][data-id=board]'); pg.wait_for_timeout(400)
        slf.wait_for_selector('.empty, .board', timeout=10000)
        # Two setup notes (ADO and Dispatch) fold into one line that opens (docs/layout.md, .ws-notices).
        check('Slate in browser mode says the agent steps need Workshop on this computer', 'Connect Workshop on this computer' in slf.text_content('#top')
              and '2 setup notes' in slf.text_content('#top .ws-notices summary'))
        slf.click('.top [data-act=new]'); slf.fill('dialog input[name=title]', 'Export orders to CSV'); slf.fill('dialog textarea[name=description]', 'Finance asked for it')
        slf.click('dialog button[type=submit]'); pg.wait_for_timeout(600)
        check('a new request lands in Inbox and opens its panel; without Dispatch it offers Write it myself', slf.locator('.col[aria-label=Inbox] .card').count() == 1 and 'Export orders to CSV' in slf.input_value('#ptitle')
              and slf.locator('.panel .next [data-act=write-myself]').count() == 1)
        cols = slf.eval_on_selector_all('.col', 'cs => cs.map(c => c.getAttribute("aria-label"))')
        check('one board of six columns, no lane switcher, Board and Health tabs', cols == ['Inbox', 'Shape', 'Define', 'Who builds it?', 'In flight', 'Resolved']
              and slf.locator('.top [data-act=lane]').count() == 0
              and slf.eval_on_selector_all('.top [data-act=tab]', 'bs => bs.map(b => b.dataset.id)') == ['board', 'health'])
        shown = slf.eval_on_selector_all('.panel .next .acts button', 'bs => bs.map(b => b.dataset.act)')
        check('without Dispatch the request shows Write it myself and Who builds it?; Add to roadmap and Move to are in More', shown == ['write-myself', 'to-decide']
              and slf.locator('.panel details.more:not([open])').count() == 1)
        stored = slf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'slate'}); const e = await ws.data.get('items'); return [e.schema, e.items.length, e.items[0].stage]; }""")
        check('Slate keeps items in its own collection (slate.items v1)', stored == ['slate.items', 1, 'new'])
        slf.click('.panel details.more > summary'); pg.wait_for_timeout(200)
        slf.click('.panel .more [data-act=roadmap-add]'); pg.wait_for_timeout(600)
        offered = slf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'slate'}); const e = await ws.data.get('handoffs'); return e.items.map(h => [h.to, h.accepted, h.payload.kind]); }""")
        check('Add to roadmap (in More) offers the idea to Runway, and the menu closes', offered == [['runway', True, 'idea']] and slf.locator('.panel details.more[open]').count() == 0)
        slf.click('.top [data-act=fields]'); slf.wait_for_selector('dialog form[data-form=fields]')
        card_defaults = slf.eval_on_selector_all('dialog input[name=card]:checked', 'is => is.map(i => i.value)')
        check('cards show Assigned to, Priority and Tags by default', sorted(card_defaults) == ['assignee', 'priority', 'tags'])
        slf.uncheck('dialog input[name=card][value=tags]'); slf.check('dialog input[name=detail-story][value=severity]')
        slf.fill('dialog input[name=custom-feature]', 'Custom.Team, bad name!'); slf.click('dialog button[type=submit]'); pg.wait_for_timeout(600)
        fields = slf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'slate'}); const e = await ws.data.get('items'); const f = e.meta.fields; return [f.card.includes('tags'), f.detail.story.includes('severity'), f.custom.feature, e.items.length]; }""")
        check('Fields saves which ADO fields show in the items meta, dropping bad field names', fields == [False, True, ['Custom.Team'], 1])
        slf.click('.panel details.more > summary'); pg.wait_for_timeout(200)
        skip_opts = slf.eval_on_selector_all('#backTo optgroup[label="Skip ahead"] option', 'os => os.map(o => o.value)')
        check('a card in Inbox can only skip ahead (to Who builds it? or Define), from More', skip_opts == ['decide', 'defining'] and slf.locator('#backTo optgroup[label="Move back"]').count() == 0)
        slf.select_option('#backTo', 'decide'); slf.click('.panel [data-act=back]'); slf.wait_for_selector('dialog form[data-form=confirm]')
        slf.click('dialog button[type=submit]'); pg.wait_for_timeout(600)
        check('Skip ahead moves a card straight to Who builds it?, on the same board', slf.locator('.col[aria-label="Who builds it?"] .card').count() == 1
              and slf.locator('.panel .next [data-act=delegate]').count() == 1)
        slf.click('.panel details.more > summary'); pg.wait_for_timeout(200)
        slf.click('.panel .more [data-act=done]'); pg.wait_for_timeout(600)
        slf.click('.panel details.more > summary'); pg.wait_for_timeout(200)
        slf.select_option('#backTo', 'new'); slf.click('.panel [data-act=back]'); slf.wait_for_selector('dialog form[data-form=confirm]')
        slf.click('dialog button[type=submit]'); pg.wait_for_timeout(600)
        moved = slf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'slate'}); const e = await ws.data.get('items'); const it = e.items[0]; return [it.stage, it.reopened, it.history.map(h => h.stage)]; }""")
        check('Move back takes a done card back to Inbox and holds it there', moved == ['new', 'new', ['new', 'decide', 'done', 'new']] and slf.locator('.col[aria-label=Inbox] .card').count() == 1)
        areas = slf.eval_on_selector_all('#area option', 'os => os.map(o => o.value)')
        slf.select_option('#area', '-'); pg.wait_for_timeout(300)
        shown_none = slf.locator('.col[aria-label=Inbox] .card').count()
        slf.evaluate("() => { const s = document.getElementById('area'); const o = new Option('x', 'Proj\\\\Elsewhere'); s.add(o); s.value = o.value; s.dispatchEvent(new Event('change', {bubbles: true})); }"); pg.wait_for_timeout(300)
        shown_other = slf.locator('.board .card').count()
        empty_msg = 'match the area path' in slf.inner_text('#main')
        slf.select_option('#area', ''); pg.wait_for_timeout(300)
        check('the area path view picks which cards show (a request with no area under No area path)', areas == ['', '-'] and shown_none == 1 and shown_other == 0 and empty_msg
              and slf.locator('.col[aria-label=Inbox] .card').count() == 1)
        slf.click('.top [data-act=new-idea]'); slf.fill('dialog input[name=title]', 'Bulk export'); slf.fill('dialog textarea[name=description]', 'For account managers')
        slf.click('dialog button[type=submit]'); pg.wait_for_timeout(600)
        check('a new idea lands in Inbox, marked Idea, with Write it myself (no Dispatch here)', slf.locator('.col[aria-label=Inbox] .card').count() == 2
              and slf.locator('.col[aria-label=Inbox] .card:has-text("Bulk export") .chip:text-is("Idea")').count() == 1
              and slf.locator('.panel .next [data-act=write-myself]').count() == 1 and slf.locator('.panel [data-act=skip]').count() == 0)
        slf.click('.panel details.more > summary'); pg.wait_for_timeout(200)
        slf.select_option('#backTo', 'decide'); slf.click('.panel [data-act=back]'); slf.wait_for_selector('dialog form[data-form=confirm]')
        slf.click('dialog button[type=submit]'); pg.wait_for_timeout(700)
        skipped = slf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'slate'}); const e = await ws.data.get('items'); const it = e.items.find(x => x.title === 'Bulk export'); return [it.kind, it.stage, it.history.at(-1).skipped === true]; }""")
        check('Skip ahead to Who builds it? marks it skipped', skipped == ['idea', 'decide', True] and slf.locator('.col[aria-label="Who builds it?"] .card').count() == 1)
        slf.click('.panel details.more > summary'); pg.wait_for_timeout(200)
        slf.select_option('#backTo', 'new'); slf.click('.panel [data-act=back]'); slf.wait_for_selector('dialog form[data-form=confirm]')
        slf.click('dialog button[type=submit]'); pg.wait_for_timeout(600)
        check('Move back undoes it, back in Inbox', slf.locator('.col[aria-label=Inbox] .card').count() == 2)
        details = slf.locator('.panel details.fold[data-fold=details]')
        check('Details starts closed', details.count() == 1 and details.get_attribute('open') is None)
        slf.click('.panel details.fold[data-fold=details] > summary'); pg.wait_for_timeout(200)
        check('opening Details is remembered in this browser', slf.evaluate("localStorage.getItem('slate.fold.details')") == '1')
        slf.click('.top [data-act=tab][data-id=health]'); pg.wait_for_timeout(1500)
        hrows = slf.eval_on_selector_all('.htable tbody th', 'ts => ts.map(t => t.textContent)')
        check('Health lists the six columns, with Sprints inside it', hrows == ['Inbox', 'Shape', 'Define', 'Who builds it?', 'In flight', 'Resolved'] and slf.locator('#sprints #sprintsBox').count() == 1)
        check('Health links to Runway\'s team reports instead of framing them', slf.locator('iframe').count() == 0 and slf.locator('[data-act=reports]').count() == 1)
        slf.click('[data-act=reports]'); pg.wait_for_timeout(2000)
        rwf = next((f for f in pg.frames if '/runway/' in f.url), None)
        check('Open team reports opens Runway on its reports page', '#/runway' in pg.url and rwf is not None
              and rwf.evaluate("document.getElementById('app').dataset.view") == 'reports')
        pg.evaluate("location.hash = '#/slate/roadmaps'"); pg.wait_for_timeout(2000)
        check('an old #/slate/roadmaps link opens Runway', pg.url.endswith('#/runway'))
    pg.keyboard.press('Alt+7'); pg.wait_for_timeout(1200)  # Notes is Alt+5, Runway Alt+6
    sf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
    check('Settings opens from the rail', sf is not None and pg.url.endswith('#/settings'))
    check('Settings in browser mode offers the data folder and data, no connectors', sf is not None and 'not running' in sf.inner_text('#content') and sf.locator('[data-export]').count() == 1 and sf.locator('.conn:not(.app-row)').count() == 0)
    if sf: stab(sf, 'data')
    check('Settings in browser mode shows the data folder: this browser, with Choose folder', sf is not None and sf.locator('[data-folder=indexeddb]').count() == 1
          and 'Saved in this browser' in sf.inner_text('[data-folder]') and sf.locator('[data-folder] [data-choose]').inner_text() == 'Choose folder')
    check('Settings loads the self-hosted fonts', sf is not None and sf.evaluate("() => document.fonts.ready.then(() => [...document.fonts].some(f => f.family.includes('Figtree') && f.status === 'loaded'))"))

    nav = sf.evaluate("[...document.querySelectorAll('.nav-item')].map(b => b.dataset.page)") if sf else []
    check('Settings in browser mode: Overview, Apps, Focus hours, People & teams, Data & backups and Products in the nav, nothing that needs the agent', nav == ['overview', 'apps', 'focus', 'data', 'people', 'team', 'products'])

    # People directory (docs/people.md), in Settings' People & teams: add yourself, then a report whose name is markup.
    # The old People app's address opens it (shell RENAMED).
    pg.evaluate("location.hash = '#/people'"); pg.wait_for_timeout(1500)
    sf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
    check('#/people opens Settings at People & groups, and People has no rail button', sf is not None and pg.locator('.app-btn[data-app=people]').count() == 0
          and sf.locator('#page-people').is_visible() and pg.url.endswith('#/settings'))
    if sf:
        sf.wait_for_selector('[data-person-new]', timeout=5000)
        sf.click('[data-person-new]'); sf.fill('#pName', 'Engineer A'); sf.click('[data-person-form] button.primary'); sf.wait_for_timeout(500)
        sf.click('[data-person-new]'); sf.fill('#pName', '<b>Dev</b> One')
        sf.select_option('#pRel', 'report'); sf.fill('#pAdo', 'dev.one@example.com')
        sf.click('[data-person-form] button.primary'); sf.wait_for_timeout(500)
        names = sf.locator('.people .person b').all_inner_texts()
        check('People: add yourself and a report, you first', names == ['Engineer A', '<b>Dev</b> One'])
        sf.click('[data-person-new]'); sf.fill('#pName', 'Someone Else'); sf.select_option('#pRel', 'self'); sf.click('[data-person-form] button.primary'); sf.wait_for_timeout(300)
        check('People: a second "you" is refused', 'already you' in sf.inner_text('[data-person-form] .msg'))
        sf.select_option('#pRel', 'manager'); sf.fill('#pName', 'Boss Person')
        check('People: "On my team" follows the relation', not sf.is_checked('#pTeam'))
        sf.click('[data-person-form] button.primary'); sf.wait_for_timeout(500)
        rp = ctx.new_page(); watch(rp); rp.goto(HUB + '/apps/settings/'); rp.wait_for_timeout(500)
        stored = rp.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          const e = await ws.data.get('people', {app: 'settings'}); return e && [e.schema, e.version, e.items.map(p => [p.kind, p.handle, p.relation, p.team, p.adoIdentity])]; }""")
        check('People: saved as settings.people v2 with handles', stored == ['settings.people', 2, [['person', 'engineer', 'self', True, ''], ['person', 'b-dev-b', 'report', True, 'dev.one@example.com'], ['person', 'boss', 'manager', False, '']]])
        # A group, assigned like a person: Leadership with the report and the manager.
        sf.click('[data-group-new]'); sf.fill('#gName', 'Leadership')
        sf.check('[data-group-form] input[name=member] >> nth=1'); sf.check('[data-group-form] input[name=member] >> nth=2')
        sf.click('[data-group-form] button.primary'); sf.wait_for_timeout(500)
        group = rp.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const P = await import('/shared/people.js'); const ws = await connect({app: 'notes'});
          const d = await ws.people.get(); const g = P.find(d, '@leadership'); const boss = d.people.find(p => p.relation === 'manager');
          return g && [g.kind, P.membersOf(d, g.id).map(p => p.relation), [...P.reach(d, boss.id)].includes(g.id)]; }""")
        check('People: a group by @handle, its members, and reach() through it', group == ['group', ['manager', 'report'], True])
        # Import from a spreadsheet: a preview first, then one save for the people and one for the groups.
        csv = 'Name,Handle,Relation,Role,Groups\n<b>Dev</b> One,,,Senior engineer,@platform\nNew Peer,,Peer,,@platform\nBad Row,,Boss,,\n'
        sf.set_input_files('[data-sheet]', files=[{'name': 'people.csv', 'mimeType': 'text/csv', 'buffer': csv.encode()}])
        sf.wait_for_selector('.preview', timeout=5000)
        acts = sf.locator('.rows tbody tr').evaluate_all('rs => rs.map(r => r.dataset.act)')
        check('People import: preview shows update, add and a skipped row before saving', acts == ['update', 'new', 'skip'] and 'Boss' in sf.inner_text('.rows'))
        sf.click('[data-import-go]'); sf.wait_for_timeout(800)
        imported = rp.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const P = await import('/shared/people.js'); const ws = await connect({app: 'notes'});
          const d = await ws.people.get(); const g = P.find(d, '@platform'); const dev = d.people.find(p => p.relation === 'report');
          return [d.people.length, dev.role, g && P.membersOf(d, g.id).map(p => p.name).sort()]; }""")
        check('People import: updated, added and grouped', imported == [4, 'Senior engineer', ['<b>Dev</b> One', 'New Peer']] and sf.locator('.preview').count() == 0)
        # Products (docs/products.md): add one, a second with the same name is refused, rename keeps the slug.
        stab(sf, 'products'); sf.wait_for_selector('[data-product-new]', timeout=5000)
        sf.click('[data-product-new]'); sf.fill('#prName', 'Sample <i>Portal</i>'); sf.fill('#prAka', 'SP, Portal')
        sf.fill('#prRepos', 'Platform/portal-ui\nportal-api'); sf.fill('#prAreas', 'Project\\Team\\Portal')
        sf.click('[data-product-form] button.primary'); sf.wait_for_timeout(500)
        check('Products: added, listed with its note path and an Open Folio button', sf.locator('#products .person b').all_inner_texts() == ['Sample <i>Portal</i>']
              and 'products/sample-i-portal-i.md' in sf.inner_text('#products') and sf.locator('[data-product-open]').count() == 1)
        sf.click('[data-product-new]'); sf.fill('#prName', 'sample <I>portal</I>'); sf.click('[data-product-form] button.primary'); sf.wait_for_timeout(300)
        check('Products: a second product with the same name is refused', 'already a product' in sf.inner_text('[data-product-form] .msg'))
        sf.click('[data-product-cancel]'); sf.click('[data-product-edit]'); sf.fill('#prName', 'Portal Next'); sf.click('[data-product-form] button.primary'); sf.wait_for_timeout(500)
        prods = rp.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          const e = await ws.data.get('products', {app: 'settings'}); return e && [e.schema, e.version, e.items.map(p => [p.id, p.name, p.slug, p.alsoCalled, p.repos, p.areas])]; }""")
        check('Products: saved as settings.products v1, renaming keeps the slug', prods == ['settings.products', 1, [['p_sample-i-portal-i', 'Portal Next', 'sample-i-portal-i', ['SP', 'Portal'], ['Platform/portal-ui', 'portal-api'], ['Project\\Team\\Portal']]]])
        stab(sf, 'people')
        rp.close()
        # Receipts lists the report from the directory (by hash, so new rail apps don't shift it).
        pg.evaluate("location.hash = '#/receipts/team'"); pg.wait_for_timeout(1500)
        rf2 = next((f for f in pg.frames if '/apps/receipts/' in f.url), None)
        check('Rapport lists reports from People, as text', rf2 is not None and rf2.locator('.roster .pname b').all_inner_texts() == ['<b>Dev</b> One']
              and rf2.locator('[data-act=people-settings]').count() >= 1 and rf2.locator('[data-act=add-person]').count() == 1)
        if rf2:
            # A report's page: start 1:1s, write today's note, log a win twice: one receipt.
            rf2.click('.roster .prow'); rf2.wait_for_selector('[data-start-report]', timeout=5000)
            rf2.click('[data-start-report]'); rf2.wait_for_selector('[data-start-note]', timeout=5000)
            rf2.click('[data-start-note]'); rf2.wait_for_selector('#oo-editor', timeout=5000)
            text = rf2.input_value('#oo-editor')
            check("Rapport's report page starts a 1:1 note, the name as text", text.startswith('# 1:1 with <b>Dev</b> One, '))
            rf2.fill('#oo-editor', text.replace('## Wins\n\n- ', '## Wins\n\n- Led the e2e review'))
            rf2.press('#oo-editor', 'Control+s'); rf2.wait_for_timeout(500)
            for _ in range(2):
                rf2.click('[data-log]'); rf2.wait_for_selector('dialog.oo-dlg[open]', timeout=3000)
                rf2.click('dialog.oo-dlg button[value=ok]'); rf2.wait_for_timeout(600)
            check('a win logged after a 1:1 becomes one receipt about the report', rf2.inner_text('.list').count('Led the e2e review') == 1
                  and 'From a 1:1' in rf2.inner_text('.list'))
            # Rapport Goals: start the team's goals, then the report's; the report's objective sits under the team's.
            pg.evaluate("location.hash = '#/receipts/goals'"); pg.wait_for_timeout(1200)
            gf = next((f for f in pg.frames if '/apps/receipts/' in f.url), None)
            check('Goals: an empty quarter offers Start team goals', gf is not None and 'No team goals for' in gf.inner_text('main') and gf.locator('[data-g-start=team]').count() == 1)
            if gf:
                gf.click('[data-g-start=team]'); gf.wait_for_selector('[data-g-editor]', timeout=5000)
                gf.click('[data-g-back]'); gf.wait_for_selector('.g-tree', timeout=5000)
                check('Goals: the tree lists the team template', gf.locator('[data-g-node="o:0"] .g-otitle').first.inner_text() == 'First objective')
                gf.click('.g-missing [data-g-start]'); gf.wait_for_selector('[data-g-editor]', timeout=5000)
                gf.click('[data-g-back]'); gf.wait_for_selector('.g-tree', timeout=5000)
                gf.click('[data-g-expand=all]'); gf.wait_for_timeout(300)
                check("Goals: the report's first objective sits under the first team objective, the name as text",
                      gf.locator('[data-g-node="s:0:0"] .g-who').text_content() == '<b>Dev</b> One' and gf.locator('[data-g-node="s:0:0"] .g-otitle').inner_text() == 'First objective')
                gf.locator('[data-g-node="o:0"] > ul .g-krs button.g-prog').first.click(); gf.wait_for_selector('#g-pop-progress', timeout=3000)
                gf.fill('#g-pop-progress', '50%'); gf.select_option('.g-pop select', 'at risk'); gf.click('.g-pop button.primary'); gf.wait_for_timeout(800)
                team = gf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'receipts'});
                  const q = document.querySelector('[data-g-quarter]').value; return (await ws.files.read('goals/team/' + q + '.md')).content; }""")
                lines = team.split('\n')
                check('Goals: updating a KR from the tree rewrites only that line', "- First key result, with how you'll measure it: 50% [at risk]" in lines
                      and len([l for l in lines if '[at risk]' in l]) == 1 and lines.count('- Second key result: 0%') == 2 and lines.count('- Third key result: 0%') == 2
                      and lines[0].startswith('# Team goals, Q'))
                gf.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'receipts'});
                  const f = (await ws.files.list('goals')).find(x => !x.path.includes('/team/')); const r = await ws.files.read(f.path);
                  await ws.files.write(f.path, r.content.replace('Supports: Second objective', 'Supports: Nothing by this name') + '\\n## <script>alert(1)</script>\\n\\n- x: 1%\\n', {mtime: r.mtime}); }""")
                gf.wait_for_timeout(1200); gf.click('[data-g-expand=all]'); gf.wait_for_timeout(300)
                ua = gf.locator('[data-g-node="ua"]')
                check('Goals: an objective whose Supports names nothing is Not aligned', ua.count() == 1 and 'Second objective' in ua.inner_text())
                check('Goals: a <script> in an objective title shows as text', '<script>alert(1)</script>' in ua.inner_text() and gf.locator('main script').count() == 0)
        pg.evaluate("location.hash = '#/settings'"); pg.wait_for_timeout(800)

    b1 = ctx.new_page(); watch(b1); b1.goto(HUB + '/apps/settings/'); b1.wait_for_timeout(500)
    b2 = ctx.new_page(); watch(b2); b2.goto(HUB + '/apps/settings/'); b2.wait_for_timeout(500)
    b2.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'scratch'});
      window.__heard = []; ws.data.subscribe('pages', e => window.__heard.push(e.rev)); }""")
    r = b1.evaluate(SDK_BROWSER)
    check('SDK picks browser mode with no agent', [r['mode'], r['backend'], r['online']] == ['browser', 'browser', False])
    check('browser backend: a new collection reads as null', r['empty'] is None)
    check('browser backend: put sets rev and updatedAt like the agent', r['put1'] and r['put1']['rev'] == 1 and r['readRev'] == 1 and r['updatedAt'] == 'string')
    check('browser backend: a stale rev is a conflict with the stored copy', r['conflict'] == 'conflict' and r['currentRev'] == 1)
    check('browser backend: lower version and wrong schema are refused', r.get('downgrade') == 'downgrade' and r.get('badVersion') == 'bad_request' and r.get('badSchema') == 'bad_request')
    check('browser backend: other clients hear writes, the writer does not', r['heard'] == 1 and r['self'] is None and r['put2'] == 2)
    check('browser backend: another tab hears writes (BroadcastChannel)', b2.evaluate('window.__heard') == [1, 2, 3])  # 3: the import merges pages
    check('browser backend: export and import bundles', r['bundle'] == ['workshop.bundle', 2, 'browser'] and r['imported'] == {'created': 1, 'merged': 2})
    check('browser backend: connectors are unavailable', r['connectors'] == [] and r['callCode'] == 'unavailable')
    b1.close(); b2.close()

    cached = pg.evaluate("""async () => { await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 500));
      const k = (await caches.keys()).find(n => n.startsWith('workshop-')); if (!k) return [];
      return (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname); }""")
    check('service worker precaches every app\'s files from the registry', '/apps/prioritizer/js/people.js' in cached and '/apps/settings/js/forms.js' in cached and '/apps/settings/icon.svg' in cached)
    check('service worker caches nothing under /api', not any(p.startswith('/api') for p in cached))
    pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300)


PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg=='
PASTE_IMAGE = """(b64) => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([bytes], 'Screen Shot.png', {type: 'image/png'}));
  const ed = document.querySelector('.cm-content'); ed.focus();
  ed.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }"""


def notes_append(page, nf, text):
    """Add text at the end of the open note. Folio 3.3 edits in CodeMirror, which continues lists and closes brackets
    as you type, so set the whole text at once (as Folio's own e2e does) instead of typing it."""
    nf.fill('.cm-content', nf.input_value('#editor') + text)
    nf.press('.cm-content', 'Control+End')
    page.wait_for_timeout(150)


def notes_new(page, nf, title, folder_button=None):
    # Notes 2.7.0: New note opens a blank note with the caret on its title line (no dialog). It is named from that
    # title when you leave it; Control+s saves it as typed.
    nf.click(folder_button or '.side [data-act=new-note]')
    page.wait_for_timeout(400)
    nf.type('.cm-content', title)
    nf.press('.cm-content', 'Control+s')
    page.wait_for_timeout(600)


def notes_ecosystem(pg, nf):
    """Notes with the other apps: an action item sent to Docket, a ws: link that opens Docket, and Home's Recent notes."""
    pg.evaluate("location.hash = '#/notes'"); pg.wait_for_timeout(1200)
    nf = next(f for f in pg.frames if '/apps/notes/' in f.url)  # notes_flow reloaded the page
    seen(nf, '.side')
    notes_new(pg, nf, 'Team Sync')
    notes_append(pg, nf, '- [ ] Draft the rollout plan\n- Shipped the cache layer #win\n\nSee [today](ws:prioritizer/today)\n')
    nf.press('.cm-content', 'Control+s'); pg.wait_for_timeout(1200)
    check('Notes: the panel lists the action item and the win (For Rapport), each with a send button',
          nf.locator('[data-act=send][data-kind=task]').count() == 1 and nf.locator('[data-act=send][data-kind=rapport]').count() == 1)
    check('Notes: a ws: link shows as a chip with the app\'s name', nf.locator('#preview .app-link .app-chip').count() == 1 and nf.inner_text('#preview .app-chip').lower() == 'docket')
    nf.click('[data-act=send][data-kind=task]'); pg.wait_for_timeout(1200)
    check('Notes: a sent action item shows Sent', 'sent' in nf.inner_text('.sendables').lower())
    nf.click('#preview .app-link'); pg.wait_for_timeout(1500)
    # The shell opens Docket at the route, then tidies the address (Docket is the plain address), or Docket 8.0.0 writes its place.
    check('Notes: clicking a ws: link opens that app', pg.url == HUB + '/' or '#/prioritizer/' in pg.url)
    df = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
    pg.wait_for_timeout(1500)
    check('Docket adds the sent action item as a task, with no second click', 'Draft the rollout plan' in df.inner_text('body'))
    # Plan 3: Docket's wrap-up writes into today's note.
    pg.evaluate("location.hash = '#/prioritizer/shutdown'"); pg.wait_for_timeout(1500)
    df = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
    box = df.locator('.shutdown [data-wrapnote]')
    check('Docket: Wrap up offers to add a wrap-up to today\'s note, ticked', box.count() == 1 and box.is_checked())
    df.click('.shutdown footer .btn.primary'); pg.wait_for_timeout(1000)
    check('Docket: the toast offers Open today\'s note', "today's note" in df.inner_text('#toast').lower() if df.locator('#toast').count() else False)
    pg.evaluate("location.hash = '#/notes/today'"); pg.wait_for_timeout(2500)
    nf = next(f for f in pg.frames if '/apps/notes/' in f.url)
    today = nf.input_value('#editor')
    check('Notes: today\'s note has the wrap-up from Docket', '## Wrap-up' in today and '- Day: ' in today)
    if '## Wrap-up' not in today: print('      today:', today[:300].replace('\n', ' | '))
    # Plan 1: the [[ picker offers Docket's tasks; the task's details list the note.
    nf.click('.cm-content'); nf.press('.cm-content', 'Control+End')
    nf.type('.cm-content', '\nFollow up on [[Draft the')
    pg.wait_for_timeout(1500)
    picker_text = nf.inner_text('#picker') if nf.locator('#picker').count() else ''
    check('Notes: the [[ picker lists Docket tasks under In other apps', 'in other apps' in picker_text.lower() and 'Draft the rollout plan' in picker_text)
    nf.press('.cm-content', 'Enter'); nf.press('.cm-content', 'Control+s'); pg.wait_for_timeout(1500)
    m = re.search(r'\[Draft the rollout plan\]\(ws:prioritizer/task/([^)]+)\)', nf.input_value('#editor'))
    check('Notes: choosing a task writes its ws: link', bool(m))
    if m:
        pg.evaluate(f"location.hash = '#/prioritizer/task/{m.group(1)}'"); pg.wait_for_timeout(2500)
        df = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
        about = df.inner_text('.d-about') if df.locator('.d-about').count() else ''
        check("Docket: the task's details list the note that links to it, and Copy link", 'Copy link' in about and today.split('\n')[0].lstrip('# ') in about)
        if 'Copy link' not in about or today.split('\n')[0].lstrip('# ') not in about: print('      about:', about)
    # Plan 5: "n today: ..." in the top bar's Capture lands in today's note.
    pg.click('#capBtn'); pg.wait_for_timeout(800)
    pg.fill('.capbar .cap-in', 'n today: Priya asked about the offsite')
    check('quick capture: n today: says it goes to today\'s note', "today's note" in pg.inner_text('.capbar .cap-preview').lower())
    pg.press('.capbar .cap-in', 'Enter'); pg.wait_for_timeout(600)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.evaluate("location.hash = '#/notes/today'"); pg.wait_for_timeout(2500)
    nf = next(f for f in pg.frames if '/apps/notes/' in f.url)
    check('Notes: the capture is a bullet under ## Notes in today\'s note', '- Priya asked about the offsite' in nf.input_value('#editor'))
    pg.evaluate("location.hash = '#/notes'"); pg.wait_for_timeout(800)


def notes_flow(page, nf, where):
    """Notes (WS15) through its page: make notes, link and tag them, paste an image, search, rename, copy."""
    seen(nf, '.side')
    notes_new(page, nf, 'Deploy Runbook')
    # Folio 3.6.0 opens in Live; these checks read the preview beside the editor, so switch to Split (remembered).
    if nf.locator('[data-mode=split]').count(): nf.click('[data-mode=split]'); page.wait_for_timeout(200)
    check(f'Notes ({where}): a new note opens with its title as the heading', nf.input_value('#editor').startswith('# Deploy Runbook')
          and 'Deploy Runbook' in nf.inner_text('.tree .current'))
    notes_append(page, nf, 'Steps for a release. #ops\n\n<img src=x onerror="window.__xss=1">\n')
    page.wait_for_timeout(300)
    nf.evaluate(PASTE_IMAGE, PNG_B64); page.wait_for_timeout(1200)
    text = nf.input_value('#editor')
    check(f'Notes ({where}): a pasted image is saved under attachments/ and linked in the note', bool(re.search(r'!\[Screen Shot\]\(attachments/screen-shot-\d{8}-\d{6}\.png\)', text)))
    page.wait_for_timeout(600)
    check(f'Notes ({where}): the preview shows the image from the folder as a blob: URL', nf.evaluate("[...document.querySelectorAll('#preview img')].some(i => i.src.startsWith('blob:') && i.naturalWidth === 1)"))
    check(f'Notes ({where}): HTML in a note is shown as text, never run', not nf.evaluate('window.__xss') and 'onerror' in nf.inner_text('#preview') and nf.locator('#preview img[src=x]').count() == 0)

    notes_new(page, nf, 'Guide')
    nf.click('.cm-content'); nf.press('.cm-content', 'Control+End')
    nf.type('.cm-content', 'Read [[Depl'); page.wait_for_timeout(300)
    picker = nf.locator('#picker')
    check(f'Notes ({where}): typing [[ opens the note picker', picker.is_visible() and 'Deploy Runbook' in picker.inner_text())
    nf.press('.cm-content', 'Enter'); nf.type('.cm-content', ' first.\n'); page.wait_for_timeout(1500)
    check(f'Notes ({where}): the picker inserts a standard Markdown link', '[Deploy Runbook](deploy-runbook.md)' in nf.input_value('#editor'))
    check(f'Notes ({where}): edits save on their own', 'Saved' in nf.text_content('.status'))

    nf.click('.tree [data-open="deploy-runbook.md"]'); page.wait_for_timeout(600)
    check(f'Notes ({where}): the backlinks panel lists the note that links here', 'Guide' in nf.inner_text('.backlinks') and 'first' in nf.inner_text('.backlinks'))
    check(f'Notes ({where}): tags are listed with counts', '#ops' in nf.inner_text('.all-tags'))

    nf.fill('.side [data-search]', 'tag:ops'); page.wait_for_timeout(300)
    check(f'Notes ({where}): search by tag finds the note', nf.locator('.results .result').count() == 1 and 'Deploy Runbook' in nf.inner_text('.results'))
    nf.fill('.side [data-search]', 'release'); page.wait_for_timeout(300)
    check(f'Notes ({where}): search finds text with its line', 'Steps for a release' in nf.inner_text('.results'))
    nf.press('.side [data-search]', 'Escape'); page.wait_for_timeout(200)

    # Notebook 3.0: Rename, Copy and Download are in the note's ⋯ menu.
    nf.click('.note-head [data-act=menu]'); nf.click('.menu [data-act=rename]')
    nf.fill('#dlg input[name=value]', 'runbooks/deploy'); nf.click('#dlg button[value=ok]'); page.wait_for_timeout(400)
    check(f'Notes ({where}): a rename lists the notes whose links it will update', 'guide.md' in nf.inner_text('#dlg .updates'))
    nf.click('#dlg button[value=ok]'); page.wait_for_timeout(1500)
    moved = nf.input_value('#editor')
    check(f'Notes ({where}): the renamed note keeps its image link working from its new folder', bool(re.search(r'\]\(\.\./attachments/screen-shot-', moved))
          and nf.evaluate("[...document.querySelectorAll('#preview img')].some(i => i.src.startsWith('blob:'))"))
    nf.click('.tree [data-open="guide.md"]'); page.wait_for_timeout(500)
    check(f'Notes ({where}): links to the renamed note are updated', '[Deploy Runbook](runbooks/deploy.md)' in nf.input_value('#editor'))
    nf.click('#preview a.note-link'); page.wait_for_timeout(500)
    check(f'Notes ({where}): a link in the preview opens the note', nf.input_value('#editor').startswith('# Deploy Runbook'))
    nf.click('.note-head [data-act=menu]'); nf.click('.menu [data-act=copy]')
    check(f'Notes ({where}): Copy puts the Markdown on the clipboard', toast_has(page, 'Copied the Markdown'))
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=page.url.split('/#')[0].rstrip('/'))
    nf.click('.note-head [data-act=copy-wiki]')
    check(f'Notes ({where}): Copy for wiki says how many images it carried', toast_has(page, 'Copied for the wiki with 1 image'))
    clip = page.evaluate("""async () => { const it = (await navigator.clipboard.read())[0];
      return {types: [...it.types].sort(), text: await (await it.getType('text/plain')).text(), html: await (await it.getType('text/html')).text()}; }""")
    check(f'Notes ({where}): Copy for wiki puts Markdown with the image embedded on the clipboard', 'text/plain' in clip['types']
          and '](data:image/png;base64,iVBORw0KGgo' in clip['text'] and 'attachments/' not in clip['text'] and clip['text'].startswith('# Deploy Runbook'))
    check(f'Notes ({where}): and HTML with the image inside it, for a visual editor', 'text/html' in clip['types']
          and '<img src="data:image/png;base64,iVBORw0KGgo' in clip['html'] and 'data-note' not in clip['html'])

    page.reload(); page.wait_for_timeout(1800)
    nf2 = next((f for f in page.frames if '/apps/notes/' in f.url), None)
    if where == 'folder' and nf2:
        check('Notes (folder): while Chrome asks again, Notes says it is waiting for the folder', 'Waiting for your notes' in nf2.inner_text('#empty'))
        page.locator('#folderBar [data-allow]').click(); page.wait_for_timeout(1500)
    seen(nf2, '.tree .note')
    check(f'Notes ({where}): after a reload the last note opens with everything saved', nf2 is not None and nf2.input_value('#editor').startswith('# Deploy Runbook')
          and 'Steps for a release' in nf2.input_value('#editor') and nf2.locator('.tree [data-open="runbooks/deploy.md"]').count() == 1
          and nf2.locator('.tree [data-open="deploy-runbook.md"]').count() == 0)
    return nf2


def start_agent(tmp, config=None):
    """Starts the real agent with copies of the repo's apps plus test fixtures. Returns (process, url, token, home)."""
    apps, conns, home = (os.path.join(tmp, d) for d in ('apps', 'connectors', 'home'))
    for name in ('home', 'prioritizer', 'agents', 'settings'):
        copy_app(name, os.path.join(apps, name))
    for name in ('pages', 'board'):
        shutil.copytree(os.path.join(ROOT, 'tests', 'fixtures', 'apps', name), os.path.join(apps, name))
    board = os.path.join(apps, 'board', 'app.json')
    with open(board) as f: m = json.load(f)
    m['order'] = 50  # after the repo's apps, so Prioritizer stays first on the rail
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
    """Parts 2 and 3: the real agent, the hub on a hosted site paired with it, and Workshop on this computer."""
    tmp = tempfile.mkdtemp()
    proc, url, token, home = start_agent(tmp, {'configVersion': 1, 'port': 4380, 'allowedOrigins': [HOSTED, SAMPLES],
                                               'features': {'startAtLogin': False, 'hostedMode': True}, 'connectors': {}})
    try:
        # The agent serves Workshop on this computer only: "/" goes to Settings, and there is no hub or other app.
        lctx = b.new_context(viewport={'width': 1280, 'height': 800})
        sf = local_page(lctx, url, token, watch)
        check('the agent\'s address opens Workshop on this computer (Settings), in local mode', sf.url == url + '/apps/settings/'
              and sf.evaluate('document.title').startswith('Settings') and 'Workshop on this computer' in sf.inner_text('#modeNote'))
        check('it has one button to Workshop\'s site to pair from, not a list of sites', sf.locator('[data-open-site]').count() == 1 and sf.locator('a[data-open-site][href="' + HOSTED + '/"]').count() == 1)
        nav = sf.evaluate("[...document.querySelectorAll('.nav-group')].map(g => g.dataset.group + ':' + [...g.querySelectorAll('.nav-item')].map(b => b.dataset.page).join(','))")
        check('Settings has a left nav grouped by task', nav == ['workshop:overview,apps,focus,computer,data', 'people:people,team', 'ado:connections,work-items,pull-requests', 'code:products,repos', 'connectors:c-echo'])
        check('rarely changed settings are on their own page, This computer, not on Overview', sf.locator('#page-computer #port').count() == 1 and sf.locator('#page-computer #feat-startAtLogin').count() == 1
              and sf.locator('#page-overview #port').count() == 0 and sf.locator('details.adv').count() == 0)
        check('Overview says Azure DevOps is off, with Set up, and nothing in red', 'off' in sf.inner_text('[data-status-of=ado]').lower() and sf.locator('[data-status-of=ado] .state[data-state=error]').count() == 0)
        stab(sf, 'work-items')
        check('with Azure DevOps off, Work items says so in one line and shows no form', 'Azure DevOps is off. Turn it on in Connections.' in sf.inner_text('#page-work-items')
              and sf.locator('#page-work-items form.cfg:visible').count() == 0)
        stab(sf, 'repos')
        check('Repos works with no Azure DevOps: no ADO lines or other folders', sf.locator('#page-repos .repo-meta').count() == 0 and not sf.locator('#page-repos .cfg-section:not(.repo-hidden)').is_visible())
        gone = sf.evaluate("""async () => Promise.all(['/shell/shell.js', '/sw.js', '/apps/registry.json', '/apps/home/index.html', '/apps/agents/index.html']
          .map(p => fetch(p).then(r => r.status)))""")
        check('the agent serves no hub and no other app', gone == [404] * 5)
        check('and registers no service worker', sf.evaluate("navigator.serviceWorker.getRegistration().then(r => !r)"))

        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        streams = []
        ctx.on('request', lambda r: streams.append(r.url) if '/api/events' in r.url else None)
        pair(ctx, SAMPLES, url, token)
        ap = ctx.new_page(); watch(ap)
        ap.goto(SAMPLES + '/'); ap.wait_for_timeout(1500)
        check('the paired hub runs in hosted mode', ap.evaluate('document.documentElement.dataset.mode') == 'hosted')
        rail = ap.eval_on_selector_all('.app-btn[data-app]', 'els => els.map(e => e.dataset.app)')
        check('sample apps in the site\'s registry appear in the rail', rail[0] == 'prioritizer' and 'pages' in rail and 'board' in rail and rail[-1] == 'settings')
        check('the hub opens the first rail app at the plain address', ap.title() == 'Docket · Workshop' and not ap.is_visible('#spanel'))
        ap.evaluate("location.hash = '#/prioritizer'"); ap.wait_for_timeout(1200)
        check('Docket loads in the hub', any('/apps/prioritizer/' in f.url for f in ap.frames) and ap.title() == 'Docket · Workshop')
        pf = next(f for f in ap.frames if '/apps/prioritizer/' in f.url)
        check('Docket uses the agent backend', pf.evaluate("async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'prioritizer'}); return ws.mode + '/' + ws.backend; }") == 'hosted/agent')
        ap.evaluate("location.hash = '#/pages'"); ap.wait_for_timeout(800)
        check('the sample app opens in a frame', any(f.url.endswith('/apps/pages/index.html') for f in ap.frames))
        ap.evaluate("location.hash = '#/board'"); ap.wait_for_timeout(800)
        check('an app whose required connector is off shows a notice', 'Board needs Echo' in ap.inner_text('#pane-board') and not any('/apps/board/' in f.url for f in ap.frames))

        # Workshop on this computer: the settings a hosted site may not change.
        stab(sf, 'data')
        data_dir = sf.locator('[data-folder=agent] #dataDir')
        check('Settings shows the agent\'s data folder', data_dir.count() == 1 and os.path.realpath(sf.inner_text('[data-folder] .path-text')) == os.path.realpath(os.path.join(tmp, 'Workshop')))
        sf.locator('[data-folder] [data-change]').click()
        other = os.path.join(tmp, 'Elsewhere')
        data_dir.fill('not/absolute'); sf.locator('[data-folder] button.primary').click(); sf.wait_for_timeout(300)
        check('Settings asks for a full path', 'full path' in sf.inner_text('[data-folder] .msg'))
        data_dir.fill(other); sf.locator('[data-folder] button.primary').click(); sf.wait_for_timeout(800)
        with open(os.path.join(home, 'config.json')) as f: saved = json.load(f)
        check('changing the data folder saves dataDir and says to restart', saved.get('dataDir') == other and 'Restart Workshop' in sf.inner_text('[data-folder] .msg'))
        stab(sf, 'c-echo')
        echo = sf.locator('.conn[data-connector=echo]')
        echo_page = sf.locator('#page-c-echo')
        check('Settings lists every connector, off by default', echo.count() == 1 and sf.locator('.conn[data-connector=ado]').count() == 1 and echo.locator('[data-state]').text_content().strip() == 'Off')
        check('an unknown connector gets its own page, its form hidden while it is off', echo_page.locator('form.cfg:visible').count() == 0)
        echo.locator('[data-enable]').check(); sf.wait_for_timeout(1200)
        check('turning a connector on starts it', echo.locator('[data-state]').text_content().strip() == 'Ready')
        greeting = echo_page.get_by_label('Greeting (required)', exact=True)
        check('a connector form is generated from its configSchema', greeting.input_value() == 'Hello' and echo_page.locator('select').count() == 1 and echo_page.locator('.cfg-env-status').inner_text() == 'set on this computer')
        greeting.fill('Hi from e2e')
        check('typing marks the page unsaved', sf.locator('.nav-item[data-page=c-echo] .dirty-dot').is_visible())
        echo_page.locator('form.cfg button.btn.primary').click(); sf.wait_for_timeout(1000)
        check('saving clears the unsaved mark', not sf.locator('.nav-item[data-page=c-echo] .dirty-dot').is_visible())
        with open(os.path.join(home, 'config.json')) as f: saved = json.load(f)
        check('connector settings save to config.json', saved['connectors']['echo']['config'].get('greeting') == 'Hi from e2e')
        echo.locator('[data-test] input').fill('ping'); echo.locator('[data-test] button').click(); sf.wait_for_timeout(800)
        check('the Test field runs the connector and shows the answer', 'ping' in echo.locator('.test-out').inner_text())

        stab(sf, 'c-ado')
        ado = sf.locator('.conn[data-connector=ado]')
        conns_page = sf.locator('#page-connections')
        ado.locator('[data-enable]').check(); sf.wait_for_timeout(1200)
        check('ADO on with no connection reads as not set up, not as a problem', ado.locator('[data-state]').text_content().strip() == 'Not set up'
              and sf.get_attribute('[data-group=ado] .nav-dot', 'data-state') == 'empty')
        stab(sf, 'pull-requests')
        check('Pull requests asks for a connection first', 'Add a connection first, in Connections.' in sf.inner_text('#page-pull-requests'))
        stab(sf, 'c-ado')
        check('Connections lists connections, and repo mapping is not on this page', 'No connections yet' in conns_page.inner_text() and conns_page.locator('legend', has_text='Repo and path mapping').count() == 0)
        conns_page.locator('[data-conn-new]').click(); sf.wait_for_timeout(200)
        item = conns_page.locator('.conn-form').first
        item.get_by_label('Name (required)', exact=True).fill('work')
        item.get_by_label('Server URL (required)', exact=True).fill('https://ado.example.com')
        item.get_by_label('Collection (required)', exact=True).fill('Main')
        pat = item.locator('.cfg-row', has=sf.get_by_label('PAT environment variable (required)', exact=True))
        check('a PAT is never typed in: only the variable name', pat.locator('input').input_value() == 'ADO_PAT' and pat.locator('input[type=password]').count() == 0 and pat.locator('.cfg-env-status').inner_text() == 'save to check')
        item.locator('> .acts button.primary').click(); sf.wait_for_timeout(1200)
        with open(os.path.join(home, 'config.json')) as f: saved = json.load(f)
        conns = saved['connectors'].get('ado', {}).get('config', {}).get('connections', [])
        check('the ADO connection saves to config.json', len(conns) == 1 and conns[0]['serverUrl'] == 'https://ado.example.com' and 'ADO_PAT' not in json.dumps({k: v for k, v in os.environ.items() if k == 'ADO_PAT'}))
        check('after saving, its row says whether the variable is set', 'not set on this computer' in conns_page.locator('.conns [data-conn=work]').inner_text())
        stab(sf, 'work-items')
        sf.locator('#page-work-items fieldset').first.locator('input').first.fill('Task')
        sf.locator('#page-work-items form.cfg > .acts button.primary').click(); sf.wait_for_timeout(1200)
        with open(os.path.join(home, 'config.json')) as f: saved = json.load(f)
        ado_cfg = saved['connectors']['ado']['config']
        check('saving Work items keeps the connection (each page saves only its own fields)', ado_cfg['types'][0] == 'Task' and len(ado_cfg['connections']) == 1)
        check('team reports fold away on Work items', sf.locator('#page-work-items details.cfg-section:not([open]) summary', has_text='Team reports').count() == 1)
        stab(sf, 'c-ado'); ado.locator('[data-enable]').uncheck(); sf.wait_for_timeout(1200)

        streams.clear()  # the reload opens the hub's stream again; from here on, every page shares that one
        ap.reload(); ap.wait_for_timeout(1500)
        ap.evaluate("location.hash = '#/board'"); ap.wait_for_timeout(1200)
        check('turning on its connector lets the app load', any('/apps/board/' in f.url for f in ap.frames))

        # Data and files through the agent, from the hosted site: one event stream for the whole site.
        p1 = ctx.new_page(); watch(p1); p1.goto(SAMPLES + '/apps/settings/'); p1.wait_for_timeout(600)
        p2 = ctx.new_page(); watch(p2); p2.goto(SAMPLES + '/apps/settings/'); p2.wait_for_timeout(600)
        p2.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          window.__heard = []; ws.data.subscribe('pages', e => window.__heard.push(e.rev)); await new Promise(r => setTimeout(r, 500)); }""")
        rev = p1.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          const env = ws.data.stamp(null, {schema: 'notes.pages', version: 1, rev: 0, items: [{id: 'a', title: 'A'}]});
          return (await ws.data.put('pages', env)).rev; }""")
        p2.wait_for_timeout(800)
        check('agent backend: other pages hear writes through the event stream', rev == 1 and p2.evaluate('window.__heard') == [1])
        check(f'one event stream for every app and window of the site, not one each ({len(streams)} opened)', len(streams) == 1)
        with open(os.path.join(tmp, 'Workshop', 'notes', 'pages.json')) as f:
            check('agent backend: data is a file in the data folder', json.load(f)['items'][0]['title'] == 'A')
        # App settings (docs/app-settings.md): Docket's Use sprints, declared in its app.json, under it on Settings' Apps tab.
        stab(p1, 'apps'); p1.wait_for_timeout(300)
        sw = p1.locator('.app-row[data-app=prioritizer] [data-app-setting=sprints]')
        if not docket_declares('sprints'): print('SKIP  app settings (the Docket checkout declares no sprints setting yet)')
        else:
            check('Settings shows the switch an app declares in its manifest, at its default', sw.count() == 1 and sw.is_checked())
            sw.click(); p1.wait_for_timeout(600)
            got = p2.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'prioritizer'}); return ws.appSettings.get(); }""")
            check('turning it off saves it where the app reads it (ws.appSettings)', got.get('sprints') is False)
            with open(os.path.join(tmp, 'Workshop', 'settings', 'app-settings.json')) as f:
                check('app settings are a file in Settings\' folder', any(i['id'] == 'prioritizer' and i['values'] == {'sprints': False} for i in json.load(f)['items']))
        p2.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          window.__files = []; ws.files.subscribe('summaries', e => window.__files.push([e.path, typeof e.mtime])); await new Promise(r => setTimeout(r, 300)); }""")
        wrote = p1.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
          const f = await ws.files.write('summaries/q4.md', '# Q4\\n', {create: true});
          let conflict = null; try { await ws.files.write('summaries/q4.md', 'x', {mtime: f.mtime - 1}); } catch (e) { conflict = e.code; }
          return {mtime: typeof f.mtime, conflict, read: (await ws.files.read('summaries/q4.md')).content}; }""")
        p2.wait_for_timeout(800)
        check('agent backend: ws.files writes, reads and refuses a stale mtime', wrote == {'mtime': 'number', 'conflict': 'conflict', 'read': '# Q4\n'})
        check('agent backend: other pages hear file writes through the event stream', p2.evaluate('window.__files') == [['summaries/q4.md', 'number']])
        with open(os.path.join(tmp, 'Workshop', 'notes', 'summaries', 'q4.md')) as f:
            check('agent backend: a file is a file in the data folder', f.read() == '# Q4\n')
        cached = ap.evaluate("""async () => { await navigator.serviceWorker.ready; await new Promise(r => setTimeout(r, 500));
          const k = (await caches.keys()).find(n => n.startsWith('workshop-')); if (!k) return null;
          return (await (await caches.open(k)).keys()).map(r => r.url); }""")
        check('the hosted site\'s service worker caches its registry\'s apps and nothing from the agent', cached is not None
              and SAMPLES + '/apps/pages/index.html' in cached and not any(u.startswith(url) for u in cached))
        ctx.close()

        # Part 3: hosted Settings, paired with the agent, is read-only.
        hctx = b.new_context(viewport={'width': 1280, 'height': 800})
        pair(hctx, HOSTED, url, token)
        hp = hctx.new_page(); watch(hp)
        hp.goto(HOSTED + '/#/settings'); hp.wait_for_timeout(2000)
        check('a paired hosted page runs in hosted mode', hp.evaluate('document.documentElement.dataset.mode') == 'hosted')
        hs = next((f for f in hp.frames if '/apps/settings/' in f.url), None)
        check('hosted Settings is read-only and links to Workshop on this computer', hs is not None and 'open Workshop on this computer' in hs.inner_text('#modeNote')
              and hs.locator(f'#modeNote a[href="{url}/"]').count() == 1
              and hs.locator('[data-enable]:not([disabled])').count() == 0 and hs.locator('.conn:not(.app-row)').count() == 2)
        put = hs.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'settings'});
          try { await ws.config.put({features: {startAtLogin: true}}); return 'saved'; } catch (e) { return e.code; } }""") if hs else None
        check('the agent refuses config changes from a hosted page', put == 'local_only')
        check('hosted Settings shows the data folder, read-only', hs is not None and hs.locator('[data-folder=agent] #dataDir[disabled]').count() == 1 and hs.locator('[data-folder] button.primary').count() == 0)
        if hs:
            stab(hs, 'people')
            hs.click('[data-person-new]'); hs.fill('#pName', 'Hosted Person'); hs.click('[data-person-form] button.primary'); hs.wait_for_timeout(800)
        check('hosted Settings still edits People & teams', hs is not None and 'Hosted Person' in hs.inner_text('#page-people'))
        hctx.close()
        lctx.close()
    finally:
        proc.terminate(); proc.wait(10)
        shutil.rmtree(tmp, ignore_errors=True)

# Rows of every sheet of an xlsx file, read with the page's SheetJS. Score is left out: it depends on today.
SHEET_ROWS = """(b64) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const wb = XLSX.read(bytes, {type: 'array'});
  return Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], {defval: ''}).map(r => { delete r.Score; return r; })])); }"""
FIX = os.path.join(DOCKET, 'test', 'fixtures')


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
    # t2 has no names on it; t1's names become directory ids once the directory loads, which is a change.
    check('the move keeps the old change stamps', stored and {t['id']: t['updatedAt'] for t in stored['items']}['t2'] == next(t['updatedAt'] for t in legacy['tasks'] if t['id'] == 't2'))
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
          and {'lists', 'settings', 'tasks'} <= {c['collection'] for c in bundle['collections']})
    ctx.close()

    tmp = tempfile.mkdtemp()
    proc, url, token, home = start_agent(tmp, {'configVersion': 1, 'port': 4380, 'allowedOrigins': [HOSTED],
                                               'features': {'startAtLogin': False, 'hostedMode': True}, 'connectors': {}})
    data = os.path.join(tmp, 'Workshop', 'prioritizer')
    try:
        # Docket on the hosted site, paired with the agent.
        actx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        pair(actx, HOSTED, url, token)
        p1 = actx.new_page(); watch(p1)
        p1.goto(HOSTED + '/apps/prioritizer/'); p1.wait_for_timeout(1200)

        # Round trip: export from today's app (the fixture), import, export again: identical tasks.
        p1.set_input_files('#importFile', os.path.join(FIX, 'today-export.xlsx')); p1.wait_for_timeout(600)
        p1.evaluate('window.__prioritizer.saved()')
        with open(os.path.join(data, 'tasks.json')) as f: on_disk = json.load(f)
        check('with Workshop running, the board is a file in the data folder', on_disk['schema'] == 'prioritizer.tasks' and sorted(t['title'] for t in on_disk['items']) == want)
        check('lists and settings are files too', all(os.path.exists(os.path.join(data, c + '.json')) for c in ('lists', 'settings')))
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
        p2.goto(HOSTED + '/apps/prioritizer/'); p2.wait_for_timeout(1200)
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
        p3.goto(HOSTED + '/apps/prioritizer/'); p3.wait_for_timeout(1200)
        p3.evaluate("() => { const P = window.__prioritizer; P.state.capacity = 7; P.commit(); }"); p3.wait_for_timeout(800)
        with open(os.path.join(data, 'tasks.json')) as f: damaged = f.read()
        check('a damaged data file: Prioritizer says it can\'t load and never writes over it', damaged == '{not json'
              and p3.evaluate("document.querySelector('#syncBtn').dataset.sync") == 'error' and 'Could not load your board' in p3.inner_text('#toast'))
        actx.close()
    finally:
        proc.terminate(); proc.wait(10)
        shutil.rmtree(tmp, ignore_errors=True)


# Chrome's private folder for this site (OPFS) stands in for a folder picked by hand: a real directory handle,
# but with no picker. These read and write it the way another program would. HANDLES keeps the chosen folder's
# name in localStorage instead of the handle in IndexedDB (headless Chromium can crash reading a handle back
# from IndexedDB), so every page and frame of the site finds the same folder, as with a real saved handle.
OPFS = """async ([path, text]) => { let d = await navigator.storage.getDirectory(); const parts = path.split('/');
  try { for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, {create: text !== null});
    const h = await d.getFileHandle(parts.at(-1), {create: text !== null});
    if (text === null) return await (await h.getFile()).text();
    const w = await h.createWritable(); await w.write(text); await w.close(); return text;
  } catch (e) { return null; } }"""
IDB_GET = """([store, key]) => new Promise(res => { const r = indexedDB.open('workshop'); r.onsuccess = () => {
  const q = r.result.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result === undefined ? null : q.result); }; })"""
HANDLES = """window.__workshopHandleStore = {
  async load() { const n = localStorage.getItem('e2e.folder'); return n ? (await navigator.storage.getDirectory()).getDirectoryHandle(n) : null; },
  async save(h) { localStorage.setItem('e2e.folder', h.name); } };"""
PICK = """async () => { const root = await navigator.storage.getDirectory(); const dir = await root.getDirectoryHandle('Workshop', {create: true});
  window.showDirectoryPicker = async () => dir; }"""
# Chrome forgets a granted folder when the browser restarts. This makes every page of the site report "ask
# again" until a click allows it, shared through the top window like Chrome's per-site permission.
ASK_AGAIN = """(() => { if (!window.FileSystemHandle) return; const P = FileSystemHandle.prototype;
  P.queryPermission = async function () { return top.__allowed ? 'granted' : 'prompt'; };
  P.requestPermission = async function () { top.__allowed = true; return 'granted'; }; })()"""
FOLDER_FILES = """async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
  const out = {storage: ws.storage, online: ws.online};
  const f = await ws.files.write('summaries/h2.md', '# H2', {create: true});
  try { await ws.files.write('summaries/h2.md', 'x', {create: true}); } catch (e) { out.exists = e.code; }
  const g = await ws.files.write('summaries/h2.md', '# H2, edited', {mtime: f.mtime});
  try { await ws.files.write('summaries/h2.md', 'y', {mtime: f.mtime}); } catch (e) { out.stale = e.code; out.current = e.current && e.current.content; }
  out.newer = g.mtime !== f.mtime;
  out.list = (await ws.files.list('summaries')).map(x => x.path);
  out.trash = (await ws.files.trash('summaries/h2.md', {mtime: g.mtime})).trash;
  out.after = (await ws.files.list('summaries')).map(x => x.path);
  out.status = await ws.folder.status();
  return out; }"""


def folder_checks(b, watch):
    """Part 6: the data folder in browser mode, and the move from IndexedDB (WS11c)."""
    titles = "() => window.__prioritizer.state.tasks.map(t => t.title).sort()"
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    ctx.add_init_script(HANDLES)
    pg = ctx.new_page(); watch(pg)
    pg.goto(HUB + '/#/prioritizer'); pg.wait_for_timeout(1500)
    pf = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
    pf.evaluate("""() => { const P = window.__prioritizer; P.state.tasks.push({id: 'b1', title: 'Saved in the browser first', listId: P.state.lists[0].id, value: 3, effort: 'S'});
      P.state = P.sanitize(P.state); P.commit(); return P.saved(); }""")
    pg.evaluate("""async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'notes'});
      await ws.files.write('summaries/q4.md', '# Q4 from the browser', {create: true}); }""")
    check('before a folder is chosen, browser mode saves in IndexedDB, files too', pg.evaluate(IDB_GET, ['data', 'prioritizer/tasks']) is not None
          and (pg.evaluate(IDB_GET, ['files', 'notes/summaries/q4.md']) or {}).get('content') == '# Q4 from the browser')
    pg.evaluate(OPFS, ['Workshop/notes/summaries/q4.md', '# Q4 already in the folder'])

    # Settings: Choose folder. The picker is replaced by the stand-in folder; everything after it is real.
    pg.evaluate("location.hash = '#/settings'"); pg.wait_for_timeout(1200)
    sf = next(f for f in pg.frames if '/apps/settings/' in f.url)
    stab(sf, 'data')
    sf.evaluate(PICK)
    with pg.expect_navigation(timeout=15000): sf.click('[data-folder] [data-choose]')
    pg.wait_for_timeout(1500)
    sf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
    text = sf.inner_text('[data-folder]') if sf else ''
    check('choosing a folder reloads into folder mode, and Settings names the folder', sf is not None and sf.locator('[data-folder=folder]').count() == 1
          and sf.inner_text('[data-folder-name]') == 'Workshop' and sf.locator('[data-folder] [data-choose]').inner_text() == 'Change folder')
    check('Settings summarizes what was copied', 'Now using Workshop' in text and bool(re.search(r'[1-9] collections? copied in \([1-9] new, 0 merged', text)) and 'kept as it was' in text)
    check('a different file already in the folder is kept, the browser copy is written beside it',
          pg.evaluate(OPFS, ['Workshop/notes/summaries/q4.md', None]) == '# Q4 already in the folder'
          and pg.evaluate(OPFS, ['Workshop/notes/summaries/q4-from-browser.md', None]) == '# Q4 from the browser' and 'q4-from-browser.md' in text)
    on_disk = json.loads(pg.evaluate(OPFS, ['Workshop/prioritizer/tasks.json', None]) or '{}')
    check('the board is copied into the folder as prioritizer/tasks.json', on_disk.get('schema') == 'prioritizer.tasks' and 'Saved in the browser first' in [t['title'] for t in on_disk.get('items', [])])
    moved = pg.evaluate(IDB_GET, ['data', '_moved'])
    check('the IndexedDB copy is kept and marked moved', pg.evaluate(IDB_GET, ['data', 'prioritizer/tasks']) is not None and bool(moved) and moved['movedTo'] == 'Workshop')

    # Prioritizer on the folder: round trip through files.
    pg.evaluate("location.hash = '#/prioritizer'"); pg.wait_for_timeout(1500)
    pf = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
    check('Prioritizer runs on the folder store', pf.evaluate("async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'prioritizer'}); return [ws.backend, ws.storage, ws.online]; }") == ['browser', 'folder', True])
    check('the board loads from the folder', 'Saved in the browser first' in pf.evaluate(titles))
    pf.evaluate("""() => { const P = window.__prioritizer; P.state.tasks.push({id: 'f1', title: 'Saved in the folder', listId: P.state.lists[0].id, value: 3, effort: 'S'});
      P.state = P.sanitize(P.state); P.commit(); return P.saved(); }""")
    on_disk = json.loads(pg.evaluate(OPFS, ['Workshop/prioritizer/tasks.json', None]))
    check('an edit is written to the folder', 'Saved in the folder' in [t['title'] for t in on_disk['items']])
    pg.reload(); pg.wait_for_timeout(1500)
    pf = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
    check('the board round-trips through the folder across a reload', {'Saved in the browser first', 'Saved in the folder'} <= set(pf.evaluate(titles)))
    pf.evaluate("document.querySelector('#syncBtn').click()"); pg.wait_for_timeout(200)
    check('the file menu says the board is in the Workshop folder', 'Saved in your Workshop folder' in pf.inner_text('.menu'))
    pf.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))")

    # Another tab hears writes (BroadcastChannel); a change made outside Workshop is found by lastModified.
    p2 = ctx.new_page(); watch(p2)
    p2.goto(HUB + '/apps/prioritizer/'); p2.wait_for_timeout(1500)
    pf.evaluate("() => { const P = window.__prioritizer; P.state.tasks.find(t => t.id === 'f1').title = 'Edited in tab one'; P.commit(); return P.saved(); }")
    p2.wait_for_timeout(1000)
    check('folder store: another tab shows an edit without reloading', 'Edited in tab one' in p2.evaluate(titles))
    env = json.loads(pg.evaluate(OPFS, ['Workshop/prioritizer/tasks.json', None]))
    env['rev'] += 1
    env['items'].append(dict(env['items'][0], id='o1', title='Added outside Workshop', updatedAt=int(time.time() * 1000)))
    pg.evaluate(OPFS, ['Workshop/prioritizer/tasks.json', json.dumps(env, indent=2) + '\n'])
    p2.wait_for_timeout(6500)
    check('folder store: a change made outside Workshop shows up within the 5-second check', 'Added outside Workshop' in p2.evaluate(titles))
    p2.close()

    r = pg.evaluate(FOLDER_FILES)
    check('folder store: ws.files creates, refuses create over a file, replaces with mtime, refuses a stale one',
          r['storage'] == 'folder' and r['online'] and r.get('exists') == 'conflict' and r.get('stale') == 'conflict' and r.get('current') == '# H2, edited' and r['newer'])
    check('folder store: ws.files lists and trashes into .trash/', r['list'] == ['summaries/h2.md', 'summaries/q4-from-browser.md', 'summaries/q4.md']
          and r['trash'].startswith('.trash/notes/summaries/h2.') and r['after'] == ['summaries/q4-from-browser.md', 'summaries/q4.md']
          and pg.evaluate(OPFS, ['Workshop/' + r['trash'], None]) == '# H2, edited')
    check('folder status names the folder', r['status'] == {'storage': 'folder', 'name': 'Workshop', 'permission': 'granted', 'moved': True, 'missing': False})

    # After a browser restart Chrome asks again: the shell shows one bar; apps wait, then load on Allow.
    ctx.add_init_script(ASK_AGAIN)
    p3 = ctx.new_page(); watch(p3)
    p3.goto(HUB + '/#/prioritizer'); p3.wait_for_timeout(1800)
    bar = p3.locator('#folderBar')
    check('when Chrome must ask again, the shell shows a bar with the Allow button', bar.count() == 1 and 'Allow Workshop to use the folder Workshop' in bar.inner_text())
    pf3 = next(f for f in p3.frames if '/apps/prioritizer/' in f.url)
    check('meanwhile Prioritizer shows no board, says to allow the folder, and says it is not saving',
          'Allow Workshop to use your folder to see your board' in pf3.inner_text('#main') and 'in the bar at the top of Workshop' in pf3.inner_text('#main')
          and pf3.locator('.row').count() == 0 and pf3.evaluate("document.querySelector('#syncBtn').dataset.sync") == 'error')
    pf3.click('#main'); p3.keyboard.press('n'); p3.wait_for_timeout(300)
    no_key = not pf3.evaluate("document.getElementById('cmd').classList.contains('open')")
    p3.keyboard.press('Control+k'); p3.wait_for_timeout(300); p3.keyboard.type('add a task'); p3.keyboard.press('Enter'); p3.wait_for_timeout(400)
    no_palette = not pf3.evaluate("document.getElementById('cmd').classList.contains('open')")
    check('while waiting, adding a task is not possible (N, the palette, New list)', no_key and no_palette and pf3.locator('#phead [data-scopemenu]').count() == 0)   # Docket 9.0.0: New list is in the list pill's menu
    before = pg.evaluate(OPFS, ['Workshop/prioritizer/tasks.json', None])
    pf3.evaluate("() => { const P = window.__prioritizer; P.state.tasks.push({id: 'w9', title: 'Typed while waiting', listId: P.state.lists[0].id}); P.commit(); }")
    p3.wait_for_timeout(1200)
    check('while waiting, nothing is saved over the folder', pg.evaluate(OPFS, ['Workshop/prioritizer/tasks.json', None]) == before and pf3.locator('.row').count() == 0)
    bar.locator('[data-allow]').click(); p3.wait_for_timeout(1500)
    check('Allow removes the bar', p3.locator('#folderBar').count() == 0)
    got = pf3.evaluate(titles)
    check('after Allow, the saved board appears', 'Edited in tab one' in got and 'Typed while waiting' not in got and pf3.locator('.waiting-empty').count() == 0
          and pf3.evaluate("document.querySelector('#syncBtn').dataset.sync") == 'on')
    pf3.click('#main'); p3.keyboard.press('n'); p3.wait_for_timeout(300)
    check('and adding a task works again', pf3.evaluate("document.getElementById('cmd').classList.contains('open')") and pf3.locator('#phead [data-scopemenu]').is_visible())   # Docket 9.0.0: lists are in the list pill

    # Home waits the same way: a message instead of an empty page, no profile editing, then loads on Allow.
    p4 = ctx.new_page(); watch(p4)
    p4.goto(HUB + '/#/home'); p4.wait_for_timeout(1800)
    hf4 = next(f for f in p4.frames if '/apps/home/' in f.url)
    seen(hf4, '.waiting')
    check('meanwhile the Needs you panel says to allow the folder instead of showing an empty list',
          'Allow Workshop to use your folder to see your day' in hf4.inner_text('#app') and 'in the bar at the top of Workshop' in hf4.inner_text('#app')
          and hf4.locator('.card.inbox').count() == 0)
    check('while waiting, the panel saves nothing', pg.evaluate(OPFS, ['Workshop/home/setup.json', None]) is None)
    p4.keyboard.press('Escape'); p4.wait_for_timeout(200)
    p4.locator('#folderBar [data-allow]').click()
    seen(hf4, '.card.inbox')
    check('after Allow, the panel loads Needs you without a reload', hf4.locator('.waiting').count() == 0 and hf4.locator('.card.inbox').count() == 1)

    # Notes on the folder: the notes and images are files in Workshop/notes/.
    p4.evaluate("location.hash = '#/notes'"); p4.wait_for_timeout(1500)
    nf4 = next((f for f in p4.frames if '/apps/notes/' in f.url), None)
    check('Notes (folder): notes another app already wrote in notes/ show in the tree', nf4 is not None and nf4.locator('.tree [data-open="summaries/q4.md"]').count() == 1)
    if nf4: notes_flow(p4, nf4, 'folder')
    on_disk = pg.evaluate(OPFS, ['Workshop/notes/runbooks/deploy.md', None]) or ''
    check('Notes (folder): the note is a Markdown file in the folder', on_disk.startswith('# Deploy Runbook') and 'Steps for a release' in on_disk)
    check('Notes (folder): links in other notes were rewritten on disk', '](runbooks/deploy.md)' in (pg.evaluate(OPFS, ['Workshop/notes/guide.md', None]) or ''))
    img = pg.evaluate("""async () => { const root = await navigator.storage.getDirectory(); const d = await (await (await root.getDirectoryHandle('Workshop')).getDirectoryHandle('notes')).getDirectoryHandle('attachments');
      for await (const [name, h] of d.entries()) { const b = new Uint8Array(await (await h.getFile()).arrayBuffer()); return [name, b.length, b[0], b[1]]; } return null; }""")
    check('Notes (folder): the pasted image is stored as PNG bytes in notes/attachments/', bool(img) and img[0].endswith('.png') and img[1] == 67 and img[2:] == [0x89, 0x50])
    check('Notes (folder): the old file went to the trash, nothing was deleted', pg.evaluate(OPFS, ['Workshop/notes/deploy-runbook.md', None]) is None
          and pg.evaluate("""async () => { const root = await navigator.storage.getDirectory(); try { const d = await (await (await root.getDirectoryHandle('Workshop')).getDirectoryHandle('.trash')).getDirectoryHandle('notes');
            for await (const [name] of d.entries()) if (name.startsWith('deploy-runbook.')) return true; } catch (e) {} return false; }"""))
    ctx.close()


def seen(frame, selector, ms=20000, state='attached'):
    """True once selector is in frame (or gone, with state='detached'), waiting up to ms. For steps that wait on
    the .work parser (PowerShell)."""
    try:
        frame.wait_for_selector(selector, timeout=ms, state=state); return True
    except Exception:
        return False


def toast_has(page, text, ms=10000):
    """True once the shell's toast says text, waiting up to ms."""
    try:
        page.wait_for_function('t => (document.querySelector("#toast") || {}).innerText?.includes(t)', arg=text, timeout=ms); return True
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
        copy_app(name, os.path.join(apps, name))
    shutil.copytree(os.path.join(ROOT, 'connectors', 'opencode'), os.path.join(conns, 'opencode'))
    os.makedirs(home)
    with open(os.path.join(home, 'config.json'), 'w') as f:
        json.dump({'configVersion': 1, 'port': 4380, 'allowedOrigins': [HOSTED], 'features': {'startAtLogin': False, 'hostedMode': True},
                   'connectors': {'opencode': {'enabled': True, 'config': {'workspace': info['workspace'], 'opencode': {'url': info['opencode'], 'startServer': False}, 'pollSeconds': 20}}}}, f)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', conns],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    a = json.loads(proc.stdout.readline())
    url = a['url']
    try:
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        pair(ctx, HOSTED, url, a['token'])
        pg = ctx.new_page(); watch(pg)
        pg.goto(HOSTED + '/#/agents/41610'); pg.wait_for_timeout(1000)
        af = next((f for f in pg.frames if '/apps/agents/' in f.url), None)
        if af: seen(af, '.pill.on'); pg.wait_for_timeout(500)
        check('Agents is a same-origin app on the SDK, no frame from another origin', af is not None and all(f.url.startswith(HOSTED) or f.url == 'about:blank' for f in pg.frames))
        check('Agents reads the opencode connector and shows Live', af is not None and af.inner_text('.pill') == 'Live')
        check('Dispatch 3.0 has four tabs and no sidebar', af.eval_on_selector_all('.tabs .tab', 'els => els.map(e => e.dataset.tab)') == ['inbox', 'chat', 'work', 'reviews']
              and af.locator('.side, aside').count() == 0)
        check('#/agents/<id> opens that run on its own page, on Work', seen(af, '.run-page#item-41610') and af.get_attribute('.tab.on', 'data-tab') == 'work')
        check('the shell keeps the address, and the name and theme are the shell\'s', pg.url.endswith('#/agents') and af.locator('.brand').count() == 0 and af.locator('[data-theme-menu]').count() == 0)

        want = 'light' if pg.evaluate('document.documentElement.dataset.theme') == 'dark' else 'dark'
        pg.click('#topbar [data-theme-toggle]'); pg.wait_for_timeout(400)
        check('the light/dark toggle applies to Agents', af.evaluate('document.documentElement.dataset.theme') == want)
        bg = af.evaluate("getComputedStyle(document.body).backgroundColor")
        check('Agents draws with shared/themes.css colors', bg == ('rgb(22, 21, 20)' if want == 'dark' else 'rgb(244, 241, 234)'))

        # Every .work folder has one place: what waits on you in the Inbox, everything else on Work.
        found = []
        for tab in ('inbox', 'work'):
            af.click(f'.tabs [data-tab={tab}]'); pg.wait_for_timeout(250)
            found += af.eval_on_selector_all('.page [id^="item-"]', 'els => els.map(e => e.id)')
        check('every .work folder is in one place', sorted(found) == sorted(['item-41207', 'item-41300', 'item-41455', 'item-41502', 'item-41610', 'item-spike-cache-options', 'item-tsd-billing-api']))
        af.click('.tabs [data-tab=inbox]'); pg.wait_for_timeout(250)
        inbox = af.text_content('.page')
        check('the Inbox has the run to review and the code review to do', 'Ready for your review' in inbox and '#41300' in inbox and 'Code reviews to do' in inbox and '#41610' in inbox)
        check('the Inbox card shows the file you are approving (file.read)', seen(af, '#item-41300 .finline .doc') and 'Root cause' in af.inner_text('#item-41300 .finline'))

        # Go through them: one at a time, with keys.
        af.click('[data-walk=start]'); pg.wait_for_timeout(300)
        check('Go through them shows one row at a time', af.locator('.walk .icard, .walk .rrow').count() == 1 and '1 of' in af.inner_text('.walk-n').lower())
        af.locator('body').press('n'); pg.wait_for_timeout(250)
        check('N skips to the next one', '2 of' in af.inner_text('.walk-n').lower())
        af.locator('body').press('Escape'); pg.wait_for_timeout(250)
        check('Esc stops', af.locator('.walk').count() == 0 and af.locator('#g-gates').count() == 1)

        # The run page: the flow track, the main button, and a write action sent with confirm from the click.
        af.click('.page [data-open-run="41300-export-retry-fails"] >> nth=0')
        run = af.locator('.run-page')
        seen(af, '.run-page#item-41300')
        check('a run opens its page with its own Abandon button', run.get_attribute('id') == 'item-41300' and run.locator('.item-head [data-remove]').inner_text() == 'Abandon')
        check('the flow track: checked, current and later steps', run.locator('.fstep.done').count() == 1 and run.locator('.fstep.here .nm').inner_text() == 'Root cause' and run.locator('.fstep.later').count() == 4)
        approve = run.locator('.do [data-run]')
        check('one main button per step; the command is in the tooltip', run.locator('.do .btn.primary').count() == 1 and '/approve 41300' in approve.get_attribute('title'))
        approve.click(); pg.wait_for_timeout(1500)
        r = ask({'requests': True})
        cmds = [x['body'] for x in r['bodies'] if x['route'].endswith('/command')]
        check('Approve only runs /approve in opencode through the connector', {'command': 'approve', 'arguments': '41300'} in cmds and 'Started /approve 41300' in pg.inner_text('#toast'))
        af.click('.run-page .run-details > summary')
        check('the run page folds Repos, files and activity under the step', af.locator('.run-details[open] [data-name="bug.md"]').count() == 1 and af.locator('.rtab').count() == 0)

        # A file opens in the app.
        run.locator('.run-details [data-file][data-name="bug.md"]').click(); pg.wait_for_timeout(800)
        check('Open bug.md shows the file in the app (file.read)', 'Bug' in af.inner_text('.doc') and af.locator('#file-h').inner_text() == '.work/41300-export-retry-fails/bug.md')
        check('the file sheet offers Open in Folio', af.locator('.sheet [data-open-notebook]').count() == 1)
        # Approve just started a session on this run, so the sheet is read-only until Tandem stops (lib/docs.mjs refuses too).
        check('while Tandem works on the run, Edit is off and the sheet says why',
              af.locator('.sheet [data-file-mode=edit]').is_disabled() and 'read-only until it stops' in af.inner_text('.sheet'))
        af.press('.sheet', 'Escape'); pg.wait_for_timeout(200)
        af.click('[data-close-run]')
        check('Back from a run page returns to the Inbox it was opened from', seen(af, '#g-code') and af.get_attribute('.tab.on', 'data-tab') == 'inbox')

        # Prompts: shown in the Inbox with where they came from, counted on the rail badge, answered there.
        before = int(pg.inner_text('.app-btn[data-app=agents] .badge') or 0)
        af.click('.tabs [data-tab=inbox]')
        ask({'ask': {'id': 'per_e2e', 'session': None, 'title': 'npm test'}}); pg.wait_for_timeout(1200)
        check('a prompt from opencode shows in the Inbox under Agents asking you', 'npm test' in af.inner_text('#g-asks'))
        check('the rail badge counts what is in the Inbox', pg.inner_text('.app-btn[data-app=agents] .badge') == str(before + 1))
        af.click('#g-asks [data-perm=per_e2e][data-answer=once]'); pg.wait_for_timeout(1200)
        r = ask({'requests': True})
        check('Allow once answers it in opencode', 'POST /session/ses_tui0/permissions/per_e2e' in r['requests'] and af.locator('#g-asks').count() == 0)
        check('and the badge goes back down', pg.inner_text('.app-btn[data-app=agents] .badge') == str(before))

        # Chat: the hub is the Ask or capture pane, the first entry and the default.
        af.click('.tabs [data-tab=chat]'); pg.wait_for_timeout(400)
        check('Chat opens on Ask or capture, with the hub box in it', af.locator('.chat-item.new.on').count() == 1 and af.locator('.chat-home #hub .cap-in').is_visible())

        # Ship: the run's page has the PR box, with copy buttons, then Review instead of Push. The code review
        # (review.html) reads the diff from git through the connector. Approve pushes nothing; Push to origin, after the
        # shared git confirm, pushes the pr.md branch.
        af.click('.tabs [data-tab=inbox]'); pg.wait_for_timeout(300)
        af.click('#item-41610 [data-open-run] >> nth=0'); pg.wait_for_timeout(300)
        ship = af.locator('.run-page#item-41610')
        branch = 'dev/bug/41610-rate-limit-headers'
        check('the PR card has Copy title, Copy description, and Review instead of Push', ship.locator('button.copy', has_text='Copy title').count() == 1
              and ship.locator('button.copy', has_text='Copy description').count() == 1 and ship.locator('[data-review]', has_text='Review').count() == 1
              and ship.locator('[data-push]').count() == 0 and 'git -C gateway push' not in ship.inner_text())
        ship.locator('[data-review]').click()
        af.wait_for_selector('.monaco-diff-editor', timeout=30000)
        check('Review opens the code review for gateway from the connector', 'Revision 1' in af.inner_text('.rv-meta')
              and branch in af.inner_text('.rv-meta') and af.locator('.rv-file').count() >= 1)
        check('nothing is pushed before Approve', branch not in ask({'requests': True})['branches'])
        af.locator('[data-act=approve]').click()
        af.wait_for_selector('[data-act=push]', timeout=20000)
        check('Approve pushes nothing', branch not in ask({'requests': True})['branches'])
        af.locator('[data-act=push]').click()
        af.wait_for_selector('dialog.out-dialog[open]')
        af.locator('dialog.out-dialog [data-out-ok]').click()
        pushed = False
        for _ in range(60):
            pushed = branch in ask({'requests': True})['branches']
            if pushed: break
            pg.wait_for_timeout(250)
        review_state = os.path.join(info['workspace'], '.work', '41610-rate-limit-headers', 'code-review', 'gateway', 'state.json')
        approved = os.path.exists(review_state) and json.load(open(review_state))['status'] == 'approved'
        check('Approve records the verdict, and Push to origin pushes the pr.md branch', pushed and approved)
        # The branch reaches origin before Push answers; wait for its toast so it cannot replace the next one.
        toast_has(pg, 'Pushed ')
        af.locator('[data-act=back]').click()
        af.wait_for_selector('#item-41610', timeout=20000)
        check('Back to Dispatch returns to the run', af.locator('.run-page#item-41610').count() == 1)

        # Remove: the dialog, typing the name, and the folder gone (from the spike's page on Work).
        af.click('.tabs [data-tab=work]'); pg.wait_for_timeout(300)
        af.click('#item-spike-cache-options [data-open-run] >> nth=0'); pg.wait_for_timeout(300)
        af.locator('.run-page#item-spike-cache-options .item-head [data-remove]').click(); pg.wait_for_timeout(300)
        go = af.locator('[data-remove-go]')
        check('Remove asks you to type the name first', go.is_disabled() and 'cannot be undone' in af.inner_text('.sheet'))
        af.fill('.sheet input[data-draft]', 'spike-cache-options'); go.click(); pg.wait_for_timeout(1500)
        gone = seen(af, '#item-spike-cache-options', state='detached')
        check('Remove deletes the .work folder', gone and not os.path.exists(os.path.join(info['workspace'], '.work', 'spike-cache-options')) and toast_has(pg, 'Deleted .work/spike-cache-options'))

        # Prioritizer: stages and Start through the connector.
        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(1500)
        pf = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
        add_ado_task(pf, 'w1', 'Login timeout', '41207', 'User Story')
        add_ado_task(pf, 'w2', 'Brand new', '77777', 'User Story'); pg.wait_for_timeout(800)
        chip = pf.locator('.chip.eng')
        check('Prioritizer shows the stage from connectors.call(opencode, status)', chip.count() == 1 and 'Build 2/3' in chip.inner_text())
        chip.click(); pg.wait_for_timeout(1200)
        check('the stage chip opens that run\'s page in Agents', pg.url.endswith('#/agents') and seen(af, '.run-page#item-41207'))
        pg.keyboard.press('Alt+1'); pg.wait_for_timeout(400)
        # Open its details directly: where a task's row sits depends on Docket's layout (Today's columns since 6.0).
        pf.evaluate("id => window.__prioritizer.openDrawer(id)", 'w2'); pg.wait_for_timeout(400)
        pf.click('[data-d=eng-start][data-lane=feature]'); pg.wait_for_timeout(1500)
        cmds = [x['body'] for x in ask({'requests': True})['bodies'] if x['route'].endswith('/command')]
        check('Start as feature runs /start in opencode through the connector', {'command': 'start', 'arguments': '77777 feature'} in cmds)
        pf.press('#drawer', 'Escape')

        # Turning the connector off (on Workshop on this computer): both apps notice without a reload.
        sf = local_page(ctx, url, a['token'], watch)
        pg.bring_to_front()
        stab(sf, 'c-opencode')
        sf.locator('.conn[data-connector=opencode] [data-enable]').uncheck(); pg.wait_for_timeout(1500)
        check('with the connector off, Agents says how to turn it on', 'Turn on the opencode connector' in af.inner_text('#app'))
        check('and Prioritizer drops the stages', pf.locator('.chip.eng').count() == 0)
        sf.locator('.conn[data-connector=opencode] [data-enable]').check()
        check('turned on again, Agents comes back by itself', seen(af, '#item-41207') and af.locator('.pill').count() == 1)

        # On its own, the page has the name and a theme menu.
        sp = ctx.new_page(); watch(sp)
        sp.goto(HOSTED + '/apps/agents/#41502'); seen(sp, '#item-41502'); sp.wait_for_timeout(300)
        check('Dispatch works on its own page, with the top bar (crumbs and light/dark toggle)', 'Dispatch' in sp.text_content('.ws-bar .here') and sp.locator('.ws-bar [data-theme-toggle]').count() == 1 and sp.locator('.run-page#item-41502').count() == 1)

        # Projects (through the connector) as a filter on Work; the filter stays in this browser.
        check('the Inbox tab counts what waits on you', int(sp.inner_text('.tabs [data-tab=inbox] .cnt') or 0) >= 1)
        sp.click('.tabs [data-tab=work]')
        check('Work lists what is in flight, on one column, and points at the Inbox', seen(sp, '#item-41207') and sp.inner_text('.scope-head h2') == 'Work' and sp.locator('aside').count() == 0 and sp.locator('.inbox-prs.waiting').count() == 1)
        sp.click('#item-41207 [data-open-run]')
        check('a row opens its run page', seen(sp, '.run-page#item-41207'))
        sp.click('.tabs [data-tab=reviews]')
        check('Reviews is its own tab', seen(sp, '.scope-head h2') and sp.inner_text('.scope-head h2') == 'Reviews')
        sp.click('[data-more-menu]'); sp.click('[data-projects-open]'); sp.click('[data-proj-new]')
        sp.fill('[data-draft="proj:name"]', 'Orders API'); sp.click('[data-proj-save]'); sp.wait_for_timeout(800)
        sp.click('.tabs [data-tab=work]')
        check('New project saves through the connector and Work shows only its runs', seen(sp, '.fchip.on[data-filter-project]') and 'Orders API' in sp.inner_text('.fchip.on[data-filter-project]') and sp.locator('.page .rrow').count() == 0)
        sp.click('[data-filter-project=all]'); sp.click('[data-move="41207-fix-login-timeout"] >> nth=0'); sp.click('[data-move-to]:has-text("Orders API")'); sp.wait_for_timeout(800)
        sp.click('.fchip:has-text("Orders API")')
        check('a run moves to a project from its chip', seen(sp, '.page .rrow#item-41207') and sp.locator('.page .rrow').count() == 1)
        sp.click('.top-start')
        check('Start work opens on the flow picker, the presets in order', seen(sp, '.fcards') and sp.eval_on_selector_all('.fcard', 'els => els.map(e => e.dataset.flow)') == ['feature', 'bug', 'quick', 'spike', 'epic', 'docs', 'tsd'])
        sp.click('.fcard[data-flow=quick]')
        check('a flow shows its steps, and starts in the project filtered to', seen(sp, '.fline') and sp.eval_on_selector('[data-start-project]', 'e => e.selectedOptions[0].textContent') == 'Orders API')
        sp.keyboard.press('Escape')
        sp.reload(); seen(sp, '.tabs'); sp.click('.tabs [data-tab=work]')
        check('the project filter stays in this browser after a reload', seen(sp, '.fchip.on[data-filter-project]') and 'Orders API' in sp.inner_text('.fchip.on[data-filter-project]'))

        # Settings, Repos: Hide leaves a workspace repo out (opencode hiddenRepos), Show brings it back.
        pg.goto(HOSTED + '/#/settings/repos'); pg.wait_for_timeout(800)
        sf = next((f for f in pg.frames if '/apps/settings/' in f.url), None)
        check('Repos lists the workspace repo with a Hide button', sf is not None and seen(sf, '[data-repo-hide="gateway"]'))
        sf.click('[data-repo-hide="gateway"]')
        sf.wait_for_function('() => !document.querySelector(\'[data-repo-hide="gateway"]\') && !!document.querySelector(\'[data-unhide="gateway"]\')', timeout=20000)
        sf.click('.repo-hidden > summary')
        # The list is the connector's state, so the row going away means the connector left it out.
        check('Hide saves it under Hidden folders and the connector leaves it out', 'gateway' in sf.inner_text('.repo-hidden') and sf.locator('.repos .repo').count() == 0)
        sf.click('[data-unhide="gateway"]')
        check('Show brings it back', seen(sf, '[data-repo-hide="gateway"]') and sf.locator('[data-unhide]').count() == 0)
        pg.wait_for_timeout(1500)  # the connector restarts after a save; let the page settle before typing
        sf.fill('[data-hide-add] [name=folder]', 'a/b/c/d/e'); sf.click('[data-hide-add] button')
        try: sf.wait_for_function('() => (document.querySelector("[data-hide-add] .msg") || {}).textContent?.includes("like Tools or Tools/workshop")', timeout=5000); bad = True
        except Exception: bad = False
        check('Hiding a path deeper than 4 folders says what to give', bad)
        ctx.close()
    finally:
        proc.terminate(); proc.wait(10)
        fx.stdin.close(); fx.wait(10)
        shutil.rmtree(tmp, ignore_errors=True)


def string_waits():
    """wait_for_function calls in tests/*.py that pass an expression instead of a function. Playwright compiles an
    expression inside the page when the condition is not already true; Workshop's CSP refuses that, so the wait
    fails at once and sometimes leaves an EvalError page error behind (the old flaky "no page errors")."""
    bad = []
    for name in sorted(os.listdir(os.path.join(ROOT, 'tests'))):
        if not name.endswith('.py'): continue
        with open(os.path.join(ROOT, 'tests', name)) as f:
            for i, line in enumerate(f, 1):
                for m in re.finditer(r"wait_for_function\((['\"])(.*?)\1", line):
                    if not re.match(r"\s*(\(|[A-Za-z_$][\w$]*\s*=>|async\b|function\b)", m.group(2)): bad.append(f'tests/{name}:{i}')
    return bad


def main():
    if PART not in ('all', 'hub', 'agent'): sys.exit(f'E2E_PART is hub, agent or unset, not {PART!r}.')
    bad = string_waits()
    if bad: sys.exit('Pass a function to wait_for_function, for example "() => ...", not an expression (CSP refuses it): ' + ', '.join(bad))
    if not os.path.isfile(os.path.join(DOCKET, 'app.json')):
        sys.exit(f'Docket is not checked out at {DOCKET}. Run: git clone https://github.com/adavidson21/docket .remote/prioritizer')
    if not os.path.isfile(os.path.join(RECEIPTS, 'app.json')):
        sys.exit(f'Rapport is not checked out at {RECEIPTS}. Run: git clone https://github.com/adavidson21/receipts .remote/receipts')
    if not os.path.isfile(os.path.join(NOTES, 'app.json')):
        sys.exit(f'Notes is not checked out at {NOTES}. Run: git clone https://github.com/adavidson21/notes .remote/notes')
    serve(8802, functools.partial(Static, directory=ROOT))
    serve(8803, functools.partial(Static, directory=ROOT))
    WithSamples.registry = samples_registry(tempfile.mkdtemp())
    serve(8804, functools.partial(WithSamples, directory=ROOT))
    with sync_playwright() as p:
        b = p.chromium.launch()
        # The Needs you panel opens by itself once per browser while Get started is unfinished (apps/home). Every
        # context here is a new browser, so mark it seen, except where the first-run check asks for a fresh one.
        new_context = b.new_context
        def seen_context(*a, fresh=False, **k):
            c = new_context(*a, **k)
            if not fresh: c.add_init_script("try { localStorage.setItem('workshop.home.introduced', '1') } catch (e) {}")
            return c
        b.new_context = seen_context
        ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        errors, csp, requests = [], [], []
        # Every request from every page and frame, including the service worker's.
        ctx.on('request', lambda r: requests.append(r.url))
        def watch(page):
            # Where it happened, so a failure names the page and the code (the message alone is not enough).
            page.on('pageerror', lambda e, page=page: errors.append(f"{str(e)[:300]} | page {page.url} | stack {(getattr(e, 'stack', '') or '')[:800]}"))
            page.on('console', lambda m: csp.append(m.text) if 'Content Security Policy' in m.text else None)
        pg = ctx.new_page(); watch(pg)

        if PART in ('all', 'hub'):
            # Settings saved under the EM Hub names, as an existing install has them.
            pg.goto(HUB + '/manifest.webmanifest')
            pg.evaluate("""() => { localStorage.setItem('em.theme', 'dracula'); localStorage.setItem('prioritizer.theme', 'ivory'); }""")

            pg.goto(HUB + '/'); pg.wait_for_timeout(800)
            keys = pg.evaluate("() => Object.fromEntries(['workshop.theme', 'em.theme', 'prioritizer.theme'].map(k => [k, localStorage.getItem(k)]))")
            check('theme survives the rename, and a retired theme becomes Light or Dark', keys['workshop.theme'] == 'dark' and pg.evaluate('document.documentElement.dataset.theme') == 'dark')
            check('old setting keys are removed', keys['em.theme'] is None and keys['prioritizer.theme'] is None)
            check('old globals are gone, and the Dashboard pane with them', pg.evaluate("() => !window.EmHub && !window.EmTheme && !window.EmSw && !window.EmDashboard && !window.WorkshopHub && !window.WorkshopDashboard && !window.EngClient && !!window.WorkshopTheme && !!window.WorkshopSw"))
            # Docket is the first rail app: the plain address, which Docket 8.0.0 and later then sets to its place (#/prioritizer/today).
            docket_at = lambda: pg.url == HUB + '/' or pg.url.startswith(HUB + '/#/prioritizer/')
            check('opens on Docket, the first rail app, at the plain address', docket_at() and pg.title() == 'Docket · Workshop')
            check('Needs you is a button in the top bar, not a page or a rail button', pg.locator('.app-btn[data-app=home]').count() == 0 and pg.locator('#panelBtn').is_visible()
                  and pg.inner_text('#panelBtn .lbl') == 'Needs you' and pg.locator('#rail .mark.on').count() == 0)
            fresh = b.new_context(fresh=True, viewport={'width': 1280, 'height': 800}); fp = fresh.new_page(); watch(fp)
            fp.goto(HUB + '/'); fp.wait_for_timeout(3000)
            ff = next((f for f in fp.frames if '/apps/home/' in f.url), None)
            check('on a new browser the Needs you panel opens once, with Get started', fp.is_visible('#spanel') and ff is not None and 'Set up Workshop' in ff.inner_text('#app'))
            fp.reload(); fp.wait_for_timeout(3000)
            check('and only once', not fp.is_visible('#spanel'))
            fresh.close()
            pg.click('.app-btn[data-app=prioritizer]'); pg.wait_for_timeout(1200)
            check('the rail button for the first app keeps the plain address (or Docket\'s place)', docket_at())
            frame = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
            check('theme reaches Prioritizer after the rename', frame.evaluate('document.documentElement.dataset.theme') == 'dark')
            check('Prioritizer hides its theme button in the hub', not frame.locator('#themeBtn').is_visible())
            add_ado_task(frame, 'a1', 'Fix login', '123', 'Bug')
            add_ado_task(frame, 'a2', 'New story', '456', 'User Story')
            check('no stage chips without the opencode connector', frame.locator('.chip.eng').count() == 0)
            frame.evaluate("id => window.__prioritizer.openDrawer(id)", 'a1'); pg.wait_for_timeout(300)
            check('no Start buttons without the opencode connector', frame.locator('[data-d=eng-start]').count() == 0 and frame.locator('.deng').count() == 0)
            frame.press('#drawer', 'Escape'); pg.wait_for_timeout(200)

            pg.click('.app-btn[data-app=agents]'); pg.wait_for_timeout(1200)
            af = next((f for f in pg.frames if '/apps/agents/' in f.url), None)
            check('Agents opens from the rail, as an app in the shell', af is not None and pg.url.endswith('#/agents'))
            check('Dispatch in browser mode shows the setup guide', af is not None and 'Connect Dispatch to your computer' in af.inner_text('#app') and af.locator('.gstep').count() == 2)
            if af:
                check('the hub in browser mode shows AI as unavailable and says why', af.get_attribute('#hub .hub-ai', 'data-state') == 'na' and 'needs Workshop on this computer' in (af.get_attribute('#hub .hub-ai', 'title') or ''))
                af.click('#hub .hub-ai'); pg.wait_for_timeout(200)
                check('clicking the unavailable AI button explains it under the input', 'needs Workshop on this computer' in af.inner_text('#hub .hub-status'))
                af.fill('#hub .cap-in', 'n retro ideas for friday'); af.press('#hub .cap-in', 'Enter'); pg.wait_for_timeout(300)
                check('without Tandem the hub captures with rules and waits for Accept', 'captured with rules' in af.inner_text('#hub .hub-card').lower() and af.locator('#hub [data-hub-accept]').count() == 1)
                af.click('#hub [data-hub-accept]'); pg.wait_for_timeout(600)
                sent = af.evaluate("async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'agents'}); const e = await ws.data.get('handoffs'); return e && e.items.map(i => [i.to, i.accepted, i.payload.kind]); }")
                check('Accept in the hub saves an accepted note handoff', sent == [['notes', True, 'note']] and af.locator('#hub .hub-row.sent').count() == 1)
                af.click('#hub [data-hub-undo]'); pg.wait_for_timeout(600)  # withdrawn, so Notes later has nothing to add
                check('Undo in the hub withdraws it', af.locator('#hub .hub-row.sent').count() == 0 and af.evaluate("async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'agents'}); return (await ws.data.get('handoffs')).items.length; }") == 0)
                af.fill('#hub .cap-in', 'what version is the sample api on?'); af.press('#hub .cap-in', 'Enter'); pg.wait_for_timeout(300)
                check('a question without Tandem says how to turn the hub on', 'needs Workshop on this computer' in af.inner_text('#hub .hub-card .hub-error'))
            check('no frame from another origin: the old dashboard frame is gone', all(f.url.startswith(HUB) or f.url == 'about:blank' for f in pg.frames))
            pg.goto(HUB + '/#/dashboard'); pg.wait_for_timeout(1000)
            check('the old #/dashboard address opens Agents', pg.url.endswith('#/agents') and pg.title() == 'Dispatch · Workshop')

            pg.click('#panelBtn'); pg.wait_for_timeout(800)
            hf = next(f for f in pg.frames if '/apps/home/' in f.url)
            seen(hf, '.card.inbox')
            check('the Needs you panel opens over the app, with no copy of Docket\'s day', pg.is_visible('#spanel') and hf.locator('.yourday').count() == 0
                  and hf.locator('#capture').count() == 0 and pg.url.endswith('#/agents'))
            pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            check('Esc closes the panel', not pg.is_visible('#spanel'))
            pg.evaluate("location.hash = '#/home'"); pg.wait_for_timeout(800)
            check('#/home opens the panel over the app you are in, and keeps its address', pg.is_visible('#spanel') and pg.url.endswith('#/agents') and pg.title() == 'Dispatch · Workshop')
            pg.click('#spanelScrim', position={'x': 40, 'y': 300}); pg.wait_for_timeout(300)
            check('a click on the page behind closes the panel', not pg.is_visible('#spanel'))
            pg.click('#capBtn'); pg.wait_for_timeout(800)
            pg.fill('.capbar .cap-in', 'w keys from the vendor fri')
            check('quick capture previews a waiting-on task before Enter', 'waiting on' in pg.inner_text('.capbar .cap-preview').lower())
            pg.press('.capbar .cap-in', 'Enter'); pg.wait_for_timeout(600)
            saved = pg.evaluate("async () => { const {connect} = await import('/shared/workshop-sdk.js'); const ws = await connect({app: 'home'}); const e = await ws.data.get('handoffs'); return e && e.items.map(i => [i.to, i.accepted, i.payload.waiting, i.text]); }")
            check('quick capture saves an accepted handoff to Docket', saved == [['prioritizer', True, True, 'Keys from the vendor']] and pg.locator('.capbar .cap-recent li').count() == 1)
            pg.locator('.capbar .cap-undo').first.click(); pg.wait_for_timeout(600)
            check('Undo withdraws the capture', pg.locator('.capbar .cap-recent li').count() == 0)
            pg.click('.capbar .cb-backdrop', position={'x': 20, 'y': 400}); pg.wait_for_timeout(200)
            for alias, ok in (('#/docket', docket_at), ('#/rapport', lambda: pg.url == HUB + '/#/receipts'), ('#/folio', lambda: pg.url.startswith(HUB + '/#/notes'))):
                pg.evaluate(f"location.hash = '{alias}'"); pg.wait_for_timeout(900)
                check(f'the app name works as an address: {alias}', ok())
            pg.click('.app-btn[data-app=prioritizer]'); pg.wait_for_timeout(1000)
            frame = next(f for f in pg.frames if '/apps/prioritizer/' in f.url)
            want = 'light' if pg.evaluate('document.documentElement.dataset.theme') == 'dark' else 'dark'
            pg.click('#topbar [data-theme-toggle]'); pg.wait_for_timeout(500)
            check('the light/dark toggle reaches Prioritizer', frame.evaluate('document.documentElement.dataset.theme') == want)
            pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300); frame.click('#main'); pg.keyboard.press('Alt+2'); pg.wait_for_timeout(400)
            check('Alt+2 inside Prioritizer switches apps', pg.url.endswith('#/slate'))
            pg.keyboard.press('Alt+1'); pg.wait_for_timeout(300)

            browser_mode_checks(ctx, pg, frame, watch)

            sp = ctx.new_page(); watch(sp)
            sp.goto(HUB + '/apps/prioritizer/')
            # Wait for Docket to draw instead of a fixed pause: the service worker may still be precaching
            # every app's files (Dispatch's code viewer among them) on this first visit.
            try:
                sp.wait_for_function("() => document.querySelectorAll('#snav .sitem').length >= 4 && !!document.querySelector('.ws-bar [data-theme-toggle]')", timeout=15000)
            except Exception:
                pass
            check('Docket still works on its own, with the top bar and light/dark toggle', sp.locator('.ws-bar [data-theme-toggle]').is_visible() and 'Docket' in sp.text_content('.ws-bar .here') and sp.locator('#snav .sitem').count() in (4, 5))  # Docket 6.0: Today, Day, People, Done (before: Today, Day, Triage, Prioritize, People)
            check('Prioritizer defines no globals except its test hook', sp.evaluate(PRIORITIZER_GLOBALS) == ['__prioritizer'])
            tasks = "() => window.__prioritizer.state.tasks.map(t => [t.title, t.ado ? String(t.ado.id) : '']).sort()"
            before = sp.evaluate(tasks)
            check('tasks survive reloads', ['Fix login', '123'] in before and ['New story', '456'] in before)

            # Excel round trip through the vendored SheetJS: export, then import the file with Replace.
            # Docket has its own look since 8.1.0 (brand/brand.css): Schibsted Grotesk headings, Docket Text for the rest.
            check('self-hosted fonts load', sp.evaluate("() => document.fonts.ready.then(() => ['Schibsted Grotesk', 'Docket Text'].every(n => [...document.fonts].some(f => f.family.replace(/\"/g, '') === n && f.status === 'loaded')))"))
            check('SheetJS is the vendored current release', sp.evaluate('window.XLSX && XLSX.version') == '0.20.3')
            with sp.expect_download() as dl: sp.evaluate('window.__prioritizer.exportXlsx()')
            xlsx = os.path.join(tempfile.mkdtemp(), 'export.xlsx'); dl.value.save_as(xlsx)
            with open(xlsx, 'rb') as f: check('Excel export writes an xlsx file', f.read(2) == b'PK')
            sp.evaluate("() => { const P = window.__prioritizer; P.state.tasks = P.state.tasks.filter(t => t.title !== 'Fix login'); P.commit(); }")
            sp.set_input_files('#importFile', xlsx); sp.wait_for_timeout(500)
            sp.click('[data-imp=replace]'); sp.wait_for_timeout(300)
            check('Excel import restores the exported tasks', sp.evaluate(tasks) == before)

        if PART in ('all', 'agent'):
            agent_checks(b, watch)
            storage_checks(b, watch)
            folder_checks(b, watch)
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
