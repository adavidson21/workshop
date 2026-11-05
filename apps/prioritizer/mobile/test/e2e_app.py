"""Docket as the Android app sees it, in headless Chrome: mobile/www served as the app serves it, with a stand-in
for Capacitor's native bridge (window.Capacitor) whose Filesystem keeps files in the page's own storage, the way
the phone keeps them in the app's private folder. Checks that Docket picks the device store, saves the board as
files under workshop/prioritizer/, keeps it across a restart, says where it is saved, never registers a service
worker, shows no breadcrumbs, hands backups to the share sheet, handles the Back button, keeps the status bar
icons in step with the theme, and reorders tasks with a press-and-hold drag.

    node mobile/scripts/build-web.mjs && python mobile/test/e2e_app.py

The real Android WebView and plugins are covered by installing the APK from the Android workflow."""
import http.server
import json
import os
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

WWW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www')

# The native bridge, backed by sessionStorage so a reload is an app restart with the same files.
BRIDGE = r"""
(() => {
  const KEY = 'fake-device-fs';
  const load = () => JSON.parse(sessionStorage.getItem(KEY) || '{"files":{},"dirs":{"":1},"clock":1000,"shared":[]}');
  const save = (s) => sessionStorage.setItem(KEY, JSON.stringify(s));
  const err = (code, message) => Object.assign(new Error(message), { code });
  const missing = (m, p) => err('OS-PLUG-FILE-0008', `'${m}' failed because file at '${p}' does not exist.`);
  const parent = (p) => p.split('/').slice(0, -1).join('/');
  const ops = {
    stat(s, o) {
      const k = o.directory + ':' + o.path;
      if (s.files[k]) return { type: 'file', size: new TextEncoder().encode(s.files[k].data).length, mtime: s.files[k].mtime };
      if (s.dirs[k] || o.path === '') return { type: 'directory', size: 0, mtime: 0 };
      throw missing('stat', o.path);
    },
    readFile(s, o) { const f = s.files[o.directory + ':' + o.path]; if (!f) throw missing('readFile', o.path); return { data: f.data }; },
    writeFile(s, o) {
      const pk = o.directory + ':' + parent(o.path);
      if (o.directory === 'DATA' && parent(o.path) && !s.dirs[pk]) throw err('OS-PLUG-FILE-0011', 'Missing parent directory.');
      s.files[o.directory + ':' + o.path] = { data: o.data, mtime: ++s.clock, base64: !o.encoding };
      return { uri: 'file:///' + o.directory.toLowerCase() + '/' + o.path };
    },
    deleteFile(s, o) { const k = o.directory + ':' + o.path; if (!s.files[k]) throw missing('deleteFile', o.path); delete s.files[k]; },
    mkdir(s, o) {
      const k = o.directory + ':' + o.path;
      if (s.dirs[k]) throw err('OS-PLUG-FILE-0010', 'Directory already exists, cannot be overwritten.');
      const parts = o.path.split('/');
      for (let i = 1; i <= parts.length; i++) s.dirs[o.directory + ':' + parts.slice(0, i).join('/')] = 1;
    },
    readdir(s, o) {
      const pre = o.directory + ':' + (o.path ? o.path + '/' : '');
      if (o.path && !s.dirs[o.directory + ':' + o.path]) throw missing('readdir', o.path);
      const names = new Map();
      for (const k of Object.keys(s.files)) if (k.startsWith(pre) && !k.slice(pre.length).includes('/')) names.set(k.slice(pre.length), 'file');
      for (const k of Object.keys(s.dirs)) if (k.startsWith(pre) && k.length > pre.length && !k.slice(pre.length).includes('/')) names.set(k.slice(pre.length), 'directory');
      return { files: [...names].map(([name, type]) => ({ name, type, size: 0, mtime: 0, uri: '' })) };
    },
    rename(s, o) {
      const from = o.directory + ':' + o.from, to = o.toDirectory + ':' + o.to;
      if (!s.files[from]) throw missing('rename', o.from);
      s.files[to] = s.files[from]; delete s.files[from];
    }
  };
  // App (Back button) and SystemBars: what the page asked for, for the checks to read.
  window.__native = { listeners: {}, calls: [] };
  window.Capacitor = {
    PluginHeaders: [{ name: 'Filesystem' }, { name: 'Share' }, { name: 'App' }, { name: 'SystemBars' }],
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    addListener(plugin, event, cb) { (window.__native.listeners[plugin + '.' + event] ||= []).push(cb); return { remove: async () => {} }; },
    async nativePromise(plugin, method, options) {
      if (plugin === 'App' || plugin === 'SystemBars') { window.__native.calls.push([plugin, method, options]); return {}; }
      const s = load();
      if (plugin === 'Share') { s.shared.push(options); save(s); return {}; }
      if (plugin !== 'Filesystem') throw err('UNIMPLEMENTED', plugin);
      const out = ops[method](s, options);
      save(s);
      return out;
    }
  };
})();
"""


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    if not os.path.isfile(os.path.join(WWW, 'index.html')):
        sys.exit('Run node mobile/scripts/build-web.mjs first.')
    handler = lambda *a, **k: Quiet(*a, directory=WWW, **k)
    with socketserver.TCPServer(('127.0.0.1', 0), handler) as httpd:
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        failures = []

        def check(name, ok):
            print(('ok   ' if ok else 'FAIL ') + name)
            if not ok:
                failures.append(name)

        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome') if os.path.exists('/usr/bin/google-chrome') and not os.environ.get('CI') else p.chromium.launch()
            ctx = browser.new_context(viewport={'width': 412, 'height': 915}, is_mobile=True, has_touch=True)
            ctx.add_init_script(BRIDGE)
            pg = ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            url = f'http://127.0.0.1:{port}/'
            pg.goto(url)
            pg.wait_for_load_state('load')
            pg.wait_for_function('window.__prioritizer && document.querySelector("#syncBtn")', timeout=15000)
            pg.wait_for_timeout(800)

            fs = lambda: pg.evaluate("JSON.parse(sessionStorage.getItem('fake-device-fs') || '{}')")
            tip = pg.evaluate("document.querySelector('#syncBtn').dataset.tip || ''")
            check('Docket says the board is saved on this phone', 'on this phone' in tip)
            check('no breadcrumbs lead out of the app', pg.locator('.ws-crumbs a').count() == 0)
            check('no service worker is registered', pg.evaluate("navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(r => r.length) : 0") == 0)

            pg.evaluate("() => { const P = window.__prioritizer; P.state.tasks.push({id: 'm1', title: 'Saved on the phone', listId: P.state.lists[0].id}); P.commit(); }")
            pg.wait_for_timeout(2500)
            files = fs().get('files', {})
            tasks = files.get('DATA:workshop/prioritizer/tasks.json')
            check('the board is saved as files under workshop/prioritizer/', bool(tasks) and 'Saved on the phone' in tasks['data'])
            check('no temporary file is left behind', not any(k.endswith('.workshop-tmp') for k in files))

            pg.reload()
            pg.wait_for_function('window.__prioritizer && window.__prioritizer.state.tasks', timeout=15000)
            pg.wait_for_timeout(800)
            titles = pg.evaluate("window.__prioritizer.state.tasks.map(t => t.title)")
            check('after a restart the task is still there', 'Saved on the phone' in titles)

            pg.evaluate("window.__prioritizer.downloadBackup()")
            pg.wait_for_timeout(1200)
            state = fs()
            shared = state.get('shared', [])
            backup = next((v for k, v in state.get('files', {}).items() if k.startswith('CACHE:workshop-') and k.endswith('.json')), None)
            check('a backup goes to the share sheet as a file in the cache', len(shared) == 1 and shared[0]['files'][0].startswith('file:///cache/workshop-'))
            check('the backup holds the board', bool(backup) and 'Saved on the phone' in backup['data'] and json.loads(backup['data']).get('collections'))

            # The Android Back button: closes what is open, then steps back to Today, then sends the app to the background.
            back = lambda: pg.evaluate("window.__native.listeners['App.backButton'].forEach(cb => cb({canGoBack: false}))")
            calls = lambda: pg.evaluate("window.__native.calls")
            check('Docket listens for the Back button', pg.evaluate("(window.__native.listeners['App.backButton'] || []).length") == 1)
            pg.evaluate("(() => { const P = window.__prioritizer; P.state.view = 'rank'; P.render(); })()")
            pg.locator('.row[data-id]').first.tap(); pg.wait_for_timeout(400)
            drawer_open = pg.evaluate("document.querySelector('.app').classList.contains('drawer-open')")
            back(); pg.wait_for_timeout(300)
            check('Back closes the task details first', drawer_open and not pg.evaluate("document.querySelector('.app').classList.contains('drawer-open')")
                  and pg.evaluate("window.__prioritizer.state.view") == 'rank')
            back(); pg.wait_for_timeout(300)
            check('then Back goes to Today', pg.evaluate("window.__prioritizer.state.view") == 'today' and not any(c[1] == 'minimizeApp' for c in calls()))
            back(); pg.wait_for_timeout(300)
            check('and on Today Back sends the app to the background', any(c[1] == 'minimizeApp' for c in calls()))

            # Status bar icons follow the theme.
            styles = lambda: [c[2]['style'] for c in calls() if c[0] == 'SystemBars' and c[1] == 'setStyle']
            pg.evaluate("document.documentElement.dataset.theme = 'dark'"); pg.wait_for_timeout(200)
            dark = styles()[-1:] == ['DARK']
            pg.evaluate("document.documentElement.dataset.theme = 'light'"); pg.wait_for_timeout(200)
            check('the status bar icons follow the theme', dark and styles()[-1:] == ['LIGHT'])

            # Press and hold a task, then drag it: the new order is saved.
            pg.evaluate("""() => { const P = window.__prioritizer, L = P.state.lists[0].id;
              for (const [id, title] of [['m2', 'Second'], ['m3', 'Third']]) { const t = {id, title, listId: L, rank: P.state.tasks.length + 1, who: []}; P.migrateTask(t); P.state.tasks.push(t); }
              P.state.view = 'rank'; P.commit(); }""")
            pg.wait_for_timeout(400)
            order = lambda: pg.evaluate("[...document.querySelectorAll('.ranklist > .row[data-id]')].map(r => r.dataset.id)")
            before = order()
            cdp = ctx.new_cdp_session(pg)
            first = pg.locator('.ranklist > .row[data-id]').first.bounding_box()
            last = pg.locator('.ranklist > .row[data-id]').last.bounding_box()
            x, y0, y1 = first['x'] + first['width'] / 2, first['y'] + first['height'] / 2, last['y'] + last['height'] - 4
            touch = lambda kind, y: cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})
            touch('touchStart', y0); pg.wait_for_timeout(600)
            lifted = pg.evaluate("!!document.querySelector('.row.lifted')")
            for i in range(1, 11):
                touch('touchMove', y0 + (y1 - y0) * i / 10); pg.wait_for_timeout(30)
            touch('touchEnd', y1); pg.wait_for_timeout(900)
            after = order()
            check('a long press lifts the task', lifted)
            check('dragging it to the bottom saves the new order', after[-1] == before[0] and after[:-1] == before[1:]
                  and not pg.evaluate("document.querySelector('.app').classList.contains('drawer-open')"))
            files = fs().get('files', {}).get('DATA:workshop/prioritizer/tasks.json', {}).get('data', '')
            ranks = {t['id']: t['rank'] for t in json.loads(files)['items']} if files else {}
            check('and the order is on the phone', bool(ranks) and ranks[before[0]] > ranks[before[-1]])

            # A quick swipe over a task scrolls instead of lifting it.
            r = pg.locator('.ranklist > .row[data-id]').nth(1).bounding_box()
            touch('touchStart', r['y'] + 10); touch('touchMove', r['y'] + 60); pg.wait_for_timeout(600); touch('touchEnd', r['y'] + 60); pg.wait_for_timeout(300)
            check('a swipe does not lift a task', order() == after and not pg.evaluate("!!document.querySelector('.row.lifted')"))

            check('no page errors', not errors)
            if errors:
                print('\n'.join(errors))
            browser.close()
        httpd.shutdown()
    if failures:
        sys.exit(f'{len(failures)} check(s) failed')
    print('mobile e2e ok')


if __name__ == '__main__':
    main()
