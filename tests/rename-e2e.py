#!/usr/bin/env python3
"""End-to-end check that data saved before the app rename (November 2026) carries over, in headless Chromium.

  pip install playwright && python -m playwright install chromium
  python tests/rename-e2e.py

Docket, Loom, Rapport, Folio and Runway became Tasks, Builds, People, Notes and Roadmaps, with app ids tasks,
builds, people, notes and roadmaps (shared/app-folders.js). Two parts:
  1. The agent: a data folder from before (docket/ and folio/ folders, schemas and handoffs that say prioritizer,
     apps.json turning runway off). On start the folders are renamed, the old ids rewritten with a copy kept, and
     Tasks shows the tasks; an old address and an old ws: link in a note open Tasks; Roadmaps stays off.
  2. Browser mode: IndexedDB version 2 with "prioritizer/..." keys and localStorage keys under old names. The
     page moves them, and Tasks shows the tasks.
Exit 1 if any check fails.
"""
import functools, http.server, json, os, shutil, subprocess, sys, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'http://localhost:8816'
failed = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok: failed.append(name)


class Static(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def serve(port):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Static, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()


def example(name, **over):
    with open(os.path.join(ROOT, 'docs', 'examples', name)) as f: v = json.load(f)
    v.update(over)
    return v


def frame_of(pg, app):
    return next((f for f in pg.frames if f'/apps/{app}/' in f.url), None)


def write(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f: f.write(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')


def read(path):
    with open(path) as f: return json.load(f)


def old_data(data):
    """A data folder as Workshop left it before the rename."""
    write(os.path.join(data, 'docket', 'tasks.json'), example('data-envelope.tasks.json', schema='prioritizer.tasks'))
    write(os.path.join(data, 'docket', 'lists.json'), example('data-envelope.lists.json', schema='prioritizer.lists'))
    write(os.path.join(data, 'folio', 'plan.md'), '# Plan\n\n- [Draft Q4 plan](ws:prioritizer/task/t_k2f9)\n')
    hand = example('handoff-item.task-accepted.json', to='prioritizer', id='hub_old1', text='Carried over from the old hub', source={'app': 'home', 'id': 'hub_old1'})
    hand['payload'] = dict(hand['payload'], title='Carried over from the old hub')
    write(os.path.join(data, 'home', 'handoffs.json'), {'schema': 'home.handoffs', 'version': 1, 'rev': 1, 'updatedAt': '2026-11-03T22:15:00.000Z', 'items': [hand]})


def agent_part(b):
    tmp = tempfile.mkdtemp()
    home, data, apps = (os.path.join(tmp, d) for d in ('home', 'Workshop', 'apps'))
    for name in ('tasks', 'builds', 'notes', 'roadmaps', 'home', 'settings'):
        shutil.copytree(os.path.join(ROOT, 'apps', name), os.path.join(apps, name))
    os.makedirs(home)
    write(os.path.join(home, 'config.json'), {'configVersion': 1, 'port': 4382, 'allowedOrigins': [SITE], 'features': {'startAtLogin': False, 'hostedMode': True}})
    write(os.path.join(home, 'apps.json'), {'off': ['runway']})
    old_data(data)
    proc = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'e2e-agent.mjs'), '--home', home, '--apps', apps, '--connectors', os.path.join(tmp, 'none'), '--data-dir', data],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        a = json.loads(proc.stdout.readline())
        check('the old folders are renamed to the app ids', os.path.isdir(os.path.join(data, 'tasks')) and os.path.isdir(os.path.join(data, 'notes'))
              and not os.path.exists(os.path.join(data, 'docket')) and not os.path.exists(os.path.join(data, 'folio')))
        t = read(os.path.join(data, 'tasks', 'tasks.json'))
        check('saved collections say the new id, everything else as it was', t['schema'] == 'tasks.tasks' and t['rev'] == 14 and t['items'][0]['title'] == 'Draft Q4 plan')
        check('handoffs to the old id now go to the new one', read(os.path.join(data, 'home', 'handoffs.json'))['items'][0]['to'] == 'tasks')
        backups = os.path.join(data, '.backups')
        day = sorted(os.listdir(backups))[0] if os.path.isdir(backups) else ''
        check('the files as they were are kept in .backups', day and read(os.path.join(backups, day, 'renamed-ids', 'tasks', 'tasks.json'))['schema'] == 'prioritizer.tasks')

        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        ctx.add_init_script("try { localStorage.setItem('workshop.home.introduced', '1') } catch (e) {}")
        p = ctx.new_page(); p.goto(SITE + '/manifest.webmanifest')
        p.evaluate(f"localStorage.setItem('workshop.agent', JSON.stringify({{url: '{a['url']}', token: '{a['token']}'}}))"); p.close()
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)[:300]))
        pg.goto(SITE + '/#/prioritizer'); pg.wait_for_timeout(3500)
        tf = frame_of(pg, 'tasks')
        check('an old address opens the app it became', tf is not None and pg.url.split('#')[1].startswith('/tasks'))
        skip = tf.locator('[data-skip]') if tf else None
        if skip is not None and skip.count() and skip.first.is_visible(): skip.first.click(); pg.wait_for_timeout(300)
        body = tf.inner_text('body') if tf else ''
        check('Tasks shows the tasks saved before the rename', 'Draft Q4 plan' in body)
        try: tf.wait_for_function("() => document.body.innerText.includes('Carried over from the old hub')", timeout=8000); got = True
        except Exception: got = False
        check('and adds the capture that was sent to the old id', got)
        rail = pg.eval_on_selector_all('.app-btn[data-app]', 'els => els.map(e => e.dataset.app)')
        check('an app turned off under its old id stays off', 'roadmaps' not in rail and 'tasks' in rail)
        pg.evaluate("location.hash = '#/notes/plan.md'"); pg.wait_for_timeout(2500)
        nf = frame_of(pg, 'notes')
        if nf and nf.locator('[data-mode=preview]').count(): nf.click('[data-mode=preview]'); pg.wait_for_timeout(400)
        link = nf.locator('#preview .app-link').first if nf else None
        check('a ws: link to the old id shows as a link in the note', link is not None and link.count() == 1)
        if link is not None and link.count():
            link.click(); pg.wait_for_timeout(2000)
        check('and opens Tasks', pg.url.split('#')[1].startswith('/tasks'))
        check('no page errors (agent)', not errors)
        for e in errors: print('      ', e)
        ctx.close()
    finally:
        proc.stdin.close(); proc.terminate()
        shutil.rmtree(tmp, ignore_errors=True)


SEED_IDB = """async ([tasks, lists]) => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('workshop', 2);
    req.onupgradeneeded = () => { for (const s of ['data', 'files', 'trash', 'handles']) req.result.createObjectStore(s); };
    req.onsuccess = () => {
      const d = req.result, t = d.transaction(['data', 'files'], 'readwrite');
      t.objectStore('data').put(tasks, 'prioritizer/tasks');
      t.objectStore('data').put(lists, 'prioritizer/lists');
      t.objectStore('files').put({ content: '# Old', mtime: 1 }, 'receipts/summaries/a.md');
      t.oncomplete = () => { d.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
  localStorage.setItem('slate.view', 'kept');
  localStorage.setItem('prioritizer.v1.moved', 'kept as it is');
}"""

IDB_KEYS = """async () => new Promise((resolve) => {
  const req = indexedDB.open('workshop');
  req.onsuccess = () => {
    const d = req.result, out = {};
    const t = d.transaction(['data', 'files'], 'readonly');
    let left = 2;
    for (const s of ['data', 'files']) {
      const r = t.objectStore(s).getAllKeys();
      r.onsuccess = () => { out[s] = r.result.map(String).sort(); if (--left === 0) { out.version = d.version; d.close(); resolve(out); } };
    }
  };
})"""


def browser_part(b):
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    ctx.add_init_script("try { localStorage.setItem('workshop.home.introduced', '1') } catch (e) {}")
    p = ctx.new_page(); p.goto(SITE + '/manifest.webmanifest')
    p.evaluate(SEED_IDB, [example('data-envelope.tasks.json', schema='prioritizer.tasks'), example('data-envelope.lists.json', schema='prioritizer.lists')])
    p.close()
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:300]))
    pg.goto(SITE + '/#/tasks'); pg.wait_for_timeout(3500)
    tf = frame_of(pg, 'tasks')
    skip = tf.locator('[data-skip]') if tf else None
    if skip is not None and skip.count() and skip.first.is_visible(): skip.first.click(); pg.wait_for_timeout(300)
    check('browser mode: Tasks shows tasks saved under the old id in this browser', tf is not None and 'Draft Q4 plan' in tf.inner_text('body'))
    keys = pg.evaluate(IDB_KEYS)
    check('browser storage moved to the new ids', keys.get('version') == 3 and 'tasks/tasks' in keys['data'] and not any(k.startswith('prioritizer/') for k in keys['data'])
          and keys['files'] == ['people/summaries/a.md'])
    ls = pg.evaluate("() => [localStorage.getItem('builds.view'), localStorage.getItem('slate.view'), localStorage.getItem('prioritizer.v1.moved')]")
    check('this browser\'s settings moved to the new names, the old board\'s marker kept', ls == ['kept', None, 'kept as it is'])
    check('no page errors (browser)', not errors)
    for e in errors: print('      ', e)
    ctx.close()


def main():
    serve(8816)
    with sync_playwright() as p:
        b = p.chromium.launch()
        agent_part(b)
        browser_part(b)
        b.close()
    print(f'\n{len(failed)} failed' if failed else '\nAll passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
