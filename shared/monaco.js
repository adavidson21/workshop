/* The Monaco editor, vendored in shared/vendor/monaco (scripts/vendor-monaco.mjs), for Builds' code review and
   Chat's Files (Chat 4.0.0; before that Builds kept its own copy).

   loadMonaco() loads it once and resolves window.monaco. Same origin only, so it fits the pages' CSP
   (script-src 'self'; worker-src 'self'). Monaco's own worker factory wraps the worker in a blob: URL, which
   worker-src 'self' refuses, so it is replaced with a plain same-origin worker after the editor loads.

   applyMonacoTheme(monaco) gives the editor Workshop's colors (the page's --surface, --ink, --muted and --line) as
   the theme "workshop", light or dark as the page is. Call it again when the page's theme changes.

   languageOf(path) is the Monaco language id for a file name (plain text when it does not know). */
let loading = null;

export function loadMonaco() {
  if (loading) return loading;
  const base = new URL('./vendor/monaco/vs', import.meta.url).href;
  loading = new Promise((resolve, reject) => {
    if (window.monaco) return resolve(window.monaco);
    const s = document.createElement('script');
    s.src = base + '/loader.js';
    s.onerror = () => reject(new Error('Could not load the code editor.'));
    s.onload = () => {
      window.require.config({ paths: { vs: base } });
      window.require(['vs/editor/editor.main'], () => {
        self.MonacoEnvironment = { getWorker: (_id, label) => new Worker(base + '/editor-worker.js', { name: label || 'editor' }) };
        resolve(window.monaco);
      }, err => reject(new Error('Could not load the code editor: ' + ((err && err.message) || err))));
    };
    document.head.appendChild(s);
  });
  loading.catch(() => { loading = null; });
  return loading;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
export function applyMonacoTheme(monaco) {
  const dark = (document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const hex = v => (/^#[0-9a-f]{6}$/i.test(v) ? v : null);
  const colors = {};
  const set = (k, v) => { if (hex(v)) colors[k] = v; };
  set('editor.background', cssVar('--surface'));
  set('editorGutter.background', cssVar('--surface'));
  set('editor.foreground', cssVar('--ink'));
  set('editorLineNumber.foreground', cssVar('--muted'));
  set('editorLineNumber.activeForeground', cssVar('--ink'));
  set('editorWidget.background', cssVar('--surface'));
  set('editorWidget.border', cssVar('--line'));
  monaco.editor.defineTheme('workshop', { base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [], colors });
  monaco.editor.setTheme('workshop');
}

const LANGS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
  xml: 'xml', csproj: 'xml', props: 'xml', targets: 'xml', config: 'xml', resx: 'xml', svg: 'xml', xaml: 'xml',
  cs: 'csharp', csx: 'csharp', vb: 'vb', fs: 'fsharp', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  swift: 'swift', php: 'php', sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'bat', cmd: 'bat', yml: 'yaml', yaml: 'yaml', ini: 'ini', toml: 'ini', dockerfile: 'dockerfile', c: 'c', h: 'c', cpp: 'cpp',
  hpp: 'cpp', cc: 'cpp', r: 'r', lua: 'lua', dart: 'dart', graphql: 'graphql', gql: 'graphql', bicep: 'bicep', tf: 'hcl', razor: 'razor', cshtml: 'razor'
};
export function languageOf(path) {
  const name = String(path || '').split(/[\\/]/).pop().toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'makefile') return 'shell';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return LANGS[ext] || 'plaintext';
}
