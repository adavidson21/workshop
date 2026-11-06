/* Notes' service worker: shared/app-sw.js from Workshop's bundle. It caches the page, the manifest and every
   file app.json lists, and never touches another origin. Bump the version with app.json's when shipping. */
importScripts('./shared/app-sw.js');
appServiceWorker({ name: 'notes', version: '2.7.0' });
