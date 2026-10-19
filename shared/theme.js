/* Shared theme handling for the Workshop shell and every app inside it.
   Load it synchronously in <head>, after the theme-color meta tag: it sets data-theme before first
   paint, so there is no flash. The colors themselves live in themes.css. Keep THEMES and SWATCH
   in step with it (`node tests/check-themes.mjs` checks).

   Every page on this site shares one choice: picking a theme in one page updates the others
   through the storage event. */
(function () {
  'use strict';
  const KEY = 'workshop.theme';
  const OLD_KEYS = ['em.theme', 'prioritizer.theme']; // earlier names, newest first
  const THEMES = {system: 'System', slate: 'Slate', graphite: 'Graphite', ivory: 'Ivory', rose: 'Rosé', solarized: 'Solarized Light', nord: 'Nord', dracula: 'Dracula'};
  // [background, accent] per theme, for the theme menu swatches and the browser's theme-color.
  const SWATCH = {slate: ['#F7F7F8', '#4F46E5'], graphite: ['#141518', '#8C88FF'], ivory: ['#FBF8F1', '#9C5A6A'], rose: ['#FBF4F2', '#A04F6C'], solarized: ['#FDF6E3', '#1F6FA8'], nord: ['#2E3440', '#88C0D0'], dracula: ['#282A36', '#BD93F9']};
  const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : {matches: false};
  const listeners = [];

  // One-time move from the earlier names (em.theme in the EM Hub days, prioritizer.theme before the
  // hub). Runs on load, before anything reads the choice. The old keys go only once the copy succeeds.
  try {
    if (localStorage.getItem(KEY) === null) {
      const old = OLD_KEYS.map(k => localStorage.getItem(k)).find(v => v !== null);
      if (old !== undefined) localStorage.setItem(KEY, old);
    }
    OLD_KEYS.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* private mode: nothing to move */ }

  function pref() {
    try {
      const v = localStorage.getItem(KEY);
      return v in THEMES ? v : 'system';
    } catch (e) { return 'system'; }
  }
  // 'system' becomes Slate or Graphite.
  function resolve(p) { return p === 'system' || !(p in SWATCH) ? (dark.matches ? 'graphite' : 'slate') : p; }
  function current() { return document.documentElement.dataset.theme || resolve(pref()); }

  function apply() {
    const t = resolve(pref());
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.content = SWATCH[t][0];
    listeners.forEach(fn => { try { fn(t); } catch (e) { console.error(e); } });
    return t;
  }
  function set(p) {
    try { localStorage.setItem(KEY, p in THEMES ? p : 'system'); } catch (e) { /* private mode: this page only */ }
    return apply();
  }
  // 'light' or 'dark' for a theme key, from its background color (the SDK theme payload is {key, scheme}).
  function scheme(key) {
    const hex = ((SWATCH[resolve(key)] || SWATCH.slate)[0] || '#ffffff').replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? 'dark' : 'light';
  }
  // fn(theme) runs whenever the applied theme changes, from this page or another one.
  function onChange(fn) { listeners.push(fn); }

  // Menu items for a theme picker: <button data-th="key"> rows with swatches.
  function menuHtml() {
    const cur = pref();
    return Object.entries(THEMES).map(([k, n]) => {
      const [bg, ac] = SWATCH[k] || [SWATCH.slate[0], SWATCH.graphite[0]];
      return `<button data-th="${k}" role="menuitemradio" aria-checked="${cur === k}"${cur === k ? ' class="on"' : ''}><span class="sw" style="background:${bg}"><i style="background:${ac}"></i></span>${n}${k === 'system' ? '<span class="hint" style="margin-left:auto">Slate or Graphite</span>' : ''}</button>`;
    }).join('');
  }

  if (dark.addEventListener) dark.addEventListener('change', apply);
  window.addEventListener('storage', e => { if (e.key === KEY) apply(); });

  window.WorkshopTheme = {KEY, THEMES, SWATCH, pref, resolve, current, scheme, apply, set, onChange, menuHtml};
  apply();
})();
