/* Workshop: the service worker every app with a site of its own uses (Docket, Runway, Rapport), so the caching
   rules live in one place. The app's own sw.js is two lines:

     importScripts('./shared/app-sw.js');
     appServiceWorker({ name: 'runway', version: '1.8.0' });

   It lets the app install as its own window and open offline. What it caches: the page, the manifest, app.json,
   the icon and every file app.json lists, so adding a file to app.json is all it takes. What it never touches:
   requests to another origin (such as the app calling Workshop on 127.0.0.1) and anything not a GET. Your data
   is never in this cache: it lives in the data folder or browser storage. shared/sw-register.js registers it
   when the app runs on its own page (never inside Workshop). Bump the version when
   shipping so open windows get the "New version" toast. A classic script (importScripts), not a module. */
self.appServiceWorker = function appServiceWorker({ name, version, core = [] }) {
  const CACHE = `${name}-${version}`;
  const CORE = ['./', './index.html', './manifest.webmanifest', './app.json', './icon.svg', ...core];

  async function appFiles() {
    try {
      const r = await fetch('./app.json', { cache: 'no-store' });
      if (r.ok) return ((await r.json()).files || []).map(f => './' + f);
    } catch (e) { /* offline during install: CORE only */ }
    return [];
  }

  async function networkFirst(req) {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && await cache.match('./')) || Response.error();
    }
  }

  self.addEventListener('install', e => {
    e.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      // One by one, so one missing file does not stop the install.
      const files = [...new Set([...CORE, ...await appFiles()])];
      await Promise.all(files.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    })());
  });

  self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith(name + '-')).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
  });

  // The page asks for this when you click Reload on the "New version" toast.
  self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

  self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    // Pages and code: network first, so a reload always gets the latest. Fonts and icons: cache first.
    if (req.mode === 'navigate' || /(\/|\.html|\.js|\.mjs|\.css|\.json|\.webmanifest)$/.test(url.pathname)) return e.respondWith(networkFirst(req));
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
  });
};
