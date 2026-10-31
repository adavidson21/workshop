/* Workshop service worker: lets Workshop install as its own window and open offline.

   What it caches: CORE (the shell and shared/), plus every app's entry page, icon and the files its
   app.json lists. The app list comes from GET /api/apps when the agent serves the site, else from
   apps/registry.json (static sites). Adding an app needs no edit here.

   What it never touches (docs/run-modes.md, Service worker rules): /api/* and /pair on this origin
   (including the event stream at /api/events), and any request to another origin, such as a hosted
   page calling the agent on 127.0.0.1.

   Bump VERSION when shipping a change so open windows get the "New version" toast. */
const VERSION = '5.3.0';
const CACHE = 'workshop-' + VERSION;
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './shell/shell.css', './shell/shell.js',
  './shared/themes.css', './shared/ui.css', './shared/theme.js', './shared/sw-register.js',
  './shared/workshop-sdk.js', './shared/standalone-bar.js',
  './shared/fonts/fonts.css', './shared/fonts/inter-latin-wght-normal.woff2', './shared/fonts/inter-latin-ext-wght-normal.woff2',
  './shared/fonts/jetbrains-mono-latin-wght-normal.woff2', './shared/fonts/jetbrains-mono-latin-ext-wght-normal.woff2',
  './shared/fonts/source-serif-4-latin-opsz-normal.woff2', './shared/fonts/source-serif-4-latin-ext-opsz-normal.woff2',
  './shared/vendor/xlsx.full.min.js',
  './icons/favicon.svg', './icons/favicon-32.png', './icons/app-192.png', './icons/app-512.png',
  './icons/app-maskable-512.png', './icons/app-touch-180.png'
];
// Caches from earlier names of this site, removed on activate.
const OLD_PREFIXES = ['emhub-', 'prioritizer-'];
const ROOT = new URL('./', self.location).pathname; // '/' on the agent, '/workshop/' on a project site

// Requests the worker must leave to the browser.
function untouchable(url) {
  if (url.origin !== self.location.origin) return true;
  const p = url.pathname;
  return p.startsWith('/api/') || p === '/pair' || p.startsWith(ROOT + 'api/') || p === ROOT + 'pair';
}

// Every app's files, relative to the site root: entry page, icon and app.json files.
async function appFiles() {
  let list = null;
  try {
    const r = await fetch(new URL('api/apps', self.location), { cache: 'no-store', credentials: 'same-origin' });
    if (r.ok && /json/.test(r.headers.get('content-type') || '')) list = (await r.json()).apps;
  } catch (e) { /* not the agent */ }
  if (!list) {
    try {
      const r = await fetch(new URL('apps/registry.json', self.location), { cache: 'no-store' });
      if (r.ok) list = (await r.json()).apps;
    } catch (e) { /* no registry */ }
  }
  const out = [];
  for (const a of list || []) {
    const base = './' + String(a.base).replace(/^\//, '');
    const m = a.manifest || {};
    out.push(base, base + (m.entry || 'index.html'), base + (m.icon || 'icon.svg'), ...(m.files || []).map(f => base + f));
  }
  return out;
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    // App files are cached one by one, so one missing file does not stop the install.
    const files = [...new Set(await appFiles())];
    await Promise.all(files.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && (k.startsWith('workshop-') || OLD_PREFIXES.some(p => k.startsWith(p)))).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The page asks for this when you click Reload on the "New version" toast.
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (untouchable(url)) return;
  // Pages and code: network first, so a reload always gets the latest. Everything else: cache first.
  if (req.mode === 'navigate' || /(\/|\.html|\.js|\.mjs|\.css|\.json)$/.test(url.pathname)) return e.respondWith(networkFirst(req));
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Pages are cached without their query (?embed=1), so match ignoring it.
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}
