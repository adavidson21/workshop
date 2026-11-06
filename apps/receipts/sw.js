/* Rapport's service worker: shared/app-sw.js from Workshop's bundle. It caches the page, the manifest and every
   file app.json lists, and never touches another origin. Bump the version when shipping a change. */
importScripts('./shared/app-sw.js');
appServiceWorker({ name: 'receipts', version: '3.3.0' });
