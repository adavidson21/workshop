/* Workshop service worker: lets the hub install as its own window and open offline.
   Bump CACHE when shipping a change so open windows get the "New version" toast.
   Add new files to SHELL so they work offline. Everything is same-origin: no third-party requests. */
const CACHE = 'workshop-3.3.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './shell/shell.css', './shell/shell.js', './shell/dashboard.js',
  './shared/themes.css', './shared/ui.css', './shared/theme.js', './shared/eng-client.js', './shared/sw-register.js',
  './shared/fonts/fonts.css', './shared/fonts/inter-latin-wght-normal.woff2', './shared/fonts/inter-latin-ext-wght-normal.woff2',
  './shared/fonts/jetbrains-mono-latin-wght-normal.woff2', './shared/fonts/jetbrains-mono-latin-ext-wght-normal.woff2',
  './shared/vendor/xlsx.full.min.js',
  './prioritizer/', './prioritizer/index.html', './prioritizer/app.css',
  ...['constants', 'util', 'model', 'state', 'quick-add', 'actions', 'render', 'views', 'drawer', 'overlays',
    'command-bar', 'excel', 'drag-drop', 'people', 'events', 'folder-sync', 'ado', 'reports', 'eng', 'main'].map(f => `./prioritizer/js/${f}.js`),
  './icons/favicon.svg', './icons/favicon-32.png', './icons/app-192.png', './icons/app-512.png',
  './icons/app-maskable-512.png', './icons/app-touch-180.png'
];
// Caches from earlier names of this site, removed on activate.
const OLD_PREFIXES = ['emhub-', 'prioritizer-'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))));
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
  const sameOrigin = url.origin === location.origin;
  // Pages (the shell, Prioritizer) and their code: network first, so a reload always gets the latest.
  if (req.mode === 'navigate' || (sameOrigin && /(\/|\.html|\.js|\.css)$/.test(url.pathname))) return e.respondWith(networkFirst(req));
  if (sameOrigin) return e.respondWith(caches.match(req, {ignoreSearch: true}).then(hit => hit || fetch(req)));
});

async function networkFirst(req){
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Pages are cached without their query (?embed=1), so match ignoring it.
    return (await cache.match(req, {ignoreSearch: true})) || Response.error();
  }
}
