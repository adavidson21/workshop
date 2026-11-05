/* Rapport service worker: lets Rapport install as its own window and open offline.
   It caches this site's own files only. It never touches requests to another origin (such as Workshop on
   127.0.0.1 if you pair it), and your receipts and 1:1 notes are never in this cache: they live in browser storage or
   your folder. Bump VERSION when shipping a change so open windows get the "New version" toast. */
const VERSION = '3.0.0';
const CACHE = 'receipts-' + VERSION;
const CORE = [
  './', './manifest.webmanifest',
  './apps/receipts/', './apps/receipts/index.html', './apps/receipts/app.css', './apps/receipts/icon.svg',
  './apps/receipts/js/main.js', './apps/receipts/js/state.js',
  './apps/receipts/js/markdown.js', './apps/receipts/js/oneonones/data.js', './apps/receipts/js/oneonones/model.js',
  './apps/receipts/js/oneonones/page.js', './apps/receipts/js/oneonones/view.js',
  './apps/receipts/js/goals/model.js', './apps/receipts/js/goals/page.js', './apps/receipts/js/goals/view.js',
  './shared/themes.css', './shared/ui.css', './shared/theme.js', './shared/sw-register.js',
  './shared/workshop-sdk.js', './shared/standalone-bar.js', './shared/device-fs.js', './shared/site.js', './shared/summary.js', './shared/people.js',
  './shared/fonts/fonts.css', './shared/fonts/inter-latin-wght-normal.woff2', './shared/fonts/inter-latin-ext-wght-normal.woff2',
  './shared/fonts/jetbrains-mono-latin-wght-normal.woff2', './shared/fonts/jetbrains-mono-latin-ext-wght-normal.woff2',
  './shared/fonts/source-serif-4-latin-opsz-normal.woff2', './shared/fonts/source-serif-4-latin-ext-opsz-normal.woff2',
  './icons/favicon.svg', './icons/favicon-32.png', './icons/app-192.png', './icons/app-512.png',
  './icons/app-maskable-512.png', './icons/app-touch-180.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('receipts-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Pages and code: network first, so a reload gets the latest. Fonts and icons: cache first.
  if (req.mode === 'navigate' || /(\/|\.html|\.js|\.css|\.json|\.webmanifest)$/.test(url.pathname)) return e.respondWith(networkFirst(req));
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && await cache.match('./apps/receipts/')) || Response.error();
  }
}
