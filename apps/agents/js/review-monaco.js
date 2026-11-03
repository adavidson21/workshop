/* Loads the vendored Monaco (vendor/monaco, AMD build) once and resolves window.monaco.
   Same origin only, so it fits the page's CSP (script-src 'self'; worker-src 'self'). Monaco's own
   worker factory wraps the worker in a blob: URL, which worker-src 'self' refuses, so it is replaced
   with a plain same-origin worker after the editor loads. */
let loading = null;

export function loadMonaco() {
  if (loading) return loading;
  const base = new URL('../vendor/monaco/vs', import.meta.url).href;
  loading = new Promise((resolve, reject) => {
    if (window.monaco) return resolve(window.monaco);
    const s = document.createElement('script');
    s.src = base + '/loader.js';
    s.onerror = () => reject(new Error('Could not load the code viewer.'));
    s.onload = () => {
      window.require.config({ paths: { vs: base } });
      window.require(['vs/editor/editor.main'], () => {
        self.MonacoEnvironment = { getWorker: (_id, label) => new Worker(base + '/editor-worker.js', { name: label || 'editor' }) };
        resolve(window.monaco);
      }, err => reject(new Error('Could not load the code viewer: ' + ((err && err.message) || err))));
    };
    document.head.appendChild(s);
  });
  loading.catch(() => { loading = null; });
  return loading;
}
