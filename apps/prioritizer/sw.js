/* Docket's service worker: lets Docket install as its own app and open offline on docket.alexisdavidson.org.
   shared/sw-register.js registers it when Docket runs on its own page (never inside Workshop, never in the
   Android app).

   What it caches: the page, the web app manifest, and every file app.json lists (Docket's modules, shared/
   and icons/), so adding a file to app.json is all it takes.

   What it never touches: requests to another origin, such as Docket calling Workshop on 127.0.0.1.

   Bump VERSION when shipping a change so open windows get the "New version" toast. */
const VERSION = '1.6.0';
const CACHE = 'docket-' + VERSION;
const CORE = ['./', './index.html', './manifest.webmanifest', './app.json', './icon.svg'];

async function appFiles() {
  try {
    const r = await fetch('./app.json', { cache: 'no-store' });
    if (r.ok) return ((await r.json()).files || []).map(f => './' + f);
  } catch (e) { /* offline during install: CORE only */ }
  return [];
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    // One by one, so one missing file does not stop the install.
    const files = [...new Set(await appFiles())];
    await Promise.all(files.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith('docket-')).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page asks for this when you click Reload on the "New version" toast.
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Pages and code: network first, so a reload always gets the latest. Everything else: cache first.
  if (req.mode === 'navigate' || /(\/|\.html|\.js|\.mjs|\.css|\.json|\.webmanifest)$/.test(url.pathname)) return e.respondWith(networkFirst(req));
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}
