/* Registers the site's service worker (/sw.js) so the hub installs as an app and opens offline.
   The top page calls WorkshopSw.register(ask) once: the shell, or Prioritizer when it runs on its own.
   ask(message, label, onClick) shows the "New version" prompt in that page's own toast. */
(function () {
  'use strict';
  // This file lives in /shared/, so the worker and its scope are one level up: the site root.
  const root = new URL('../', document.currentScript.src);
  // Not in the Android app (mobile/): it ships its files inside the app, and a cached copy would outlive an update.
  const native = () => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } };
  const ok = () => 'serviceWorker' in navigator && !native() && (location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));

  function register(ask) {
    if (!ok()) return;
    let reloading = false;
    // Module pages (the shell) may call this after the load event has fired.
    const whenLoaded = fn => (document.readyState === 'complete' ? fn() : window.addEventListener('load', fn));
    whenLoaded(() => {
      navigator.serviceWorker.register(new URL('sw.js', root).href, {scope: root.pathname}).then(reg => {
        const prompt = w => ask('New version available', 'Reload', () => { reloading = true; w.postMessage('skipWaiting'); });
        if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing; if (!w) return;
          w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
        });
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
    });
  }

  window.WorkshopSw = {register};
})();
