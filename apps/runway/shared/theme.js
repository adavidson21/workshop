/* Shared theme handling for the Workshop shell and every app inside it.
   Load it synchronously in <head>, after the theme-color meta tag: it sets data-theme before first
   paint, so there is no flash. The colors themselves live in themes.css. Keep THEMES and SWATCH
   in step with it (`node tests/check-themes.mjs` checks).

   Two themes, Light and Dark, like tools.alexisdavidson.org. Until you pick one with the toggle,
   Workshop follows the device ('system'). The toggle is the round button in the top right corner:
   toggleHtml() gives its markup and .theme-toggle in ui.css styles it.

   Every page on this site shares one choice: picking a theme in one page updates the others
   through the storage event. */
(function () {
  'use strict';
  const KEY = 'workshop.theme';
  const OLD_KEYS = ['em.theme', 'prioritizer.theme']; // earlier names, newest first
  const THEMES = {system: 'System', light: 'Light', dark: 'Dark'};
  // [background, accent] per theme, for the browser's theme-color.
  const SWATCH = {light: ['#F4F1EA', '#4F6B78'], dark: ['#161514', '#A9BCC6']};
  // Themes from before the editorial redesign, mapped to the closer of the two.
  const RETIRED = {slate: 'light', ivory: 'light', rose: 'light', solarized: 'light', graphite: 'dark', nord: 'dark', dracula: 'dark'};
  const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : {matches: false};
  const listeners = [];

  // One-time moves: from the earlier key names (em.theme in the EM Hub days, prioritizer.theme
  // before the hub), then from retired theme names. Runs on load, before anything reads the choice.
  try {
    if (localStorage.getItem(KEY) === null) {
      const old = OLD_KEYS.map(k => localStorage.getItem(k)).find(v => v !== null);
      if (old !== undefined) localStorage.setItem(KEY, old);
    }
    OLD_KEYS.forEach(k => localStorage.removeItem(k));
    const saved = localStorage.getItem(KEY);
    if (saved in RETIRED) localStorage.setItem(KEY, RETIRED[saved]);
  } catch (e) { /* private mode: nothing to move */ }

  function pref() {
    try {
      const v = localStorage.getItem(KEY);
      if (v in RETIRED) return RETIRED[v];
      return v in THEMES ? v : 'system';
    } catch (e) { return 'system'; }
  }
  // 'system' becomes Light or Dark from the device.
  function resolve(p) {
    if (p in RETIRED) p = RETIRED[p];
    return p === 'system' || !(p in SWATCH) ? (dark.matches ? 'dark' : 'light') : p;
  }
  function current() { return document.documentElement.dataset.theme || resolve(pref()); }
  function isDark() { return current() === 'dark'; }

  function apply() {
    const t = resolve(pref());
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.content = SWATCH[t][0];
    paintToggles();
    listeners.forEach(fn => { try { fn(t); } catch (e) { console.error(e); } });
    return t;
  }
  function set(p) {
    if (p in RETIRED) p = RETIRED[p];
    try { localStorage.setItem(KEY, p in THEMES ? p : 'system'); } catch (e) { /* private mode: this page only */ }
    return apply();
  }
  // Flip between Light and Dark (what the toggle does).
  function toggle() { return set(isDark() ? 'light' : 'dark'); }
  // 'light' or 'dark' for a theme key (the SDK theme payload is {key, scheme}).
  function scheme(key) { return resolve(key); }
  // fn(theme) runs whenever the applied theme changes, from this page or another one.
  function onChange(fn) { listeners.push(fn); }

  // The toggle button: same icons and behavior as the one on tools.alexisdavidson.org.
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  function toggleLabel() { return isDark() ? 'Switch to light mode' : 'Switch to dark mode'; }
  function toggleHtml(extraClass) {
    return `<button type="button" class="theme-toggle${extraClass ? ' ' + extraClass : ''}" data-theme-toggle aria-label="${toggleLabel()}" title="${isDark() ? 'Light mode' : 'Dark mode'}">${isDark() ? MOON : SUN}</button>`;
  }
  function paintToggles() {
    if (typeof document.querySelectorAll !== 'function') return;
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.innerHTML = isDark() ? MOON : SUN;
      b.setAttribute('aria-label', toggleLabel());
      b.title = isDark() ? 'Light mode' : 'Dark mode';
    });
  }
  // Any [data-theme-toggle] button on the page flips the theme, wherever it was rendered from.
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('[data-theme-toggle]');
      if (b) { e.preventDefault(); toggle(); }
    });
  }

  // Menu items for a theme picker: <button data-th="key"> rows. Kept for pages that still offer one.
  function menuHtml() {
    const cur = pref();
    return Object.entries(THEMES).map(([k, n]) => {
      const [bg, ac] = SWATCH[k] || [SWATCH.light[0], SWATCH.dark[0]];
      return `<button data-th="${k}" role="menuitemradio" aria-checked="${cur === k}"${cur === k ? ' class="on"' : ''}><span class="sw" style="background:${bg}"><i style="background:${ac}"></i></span>${n}${k === 'system' ? '<span class="hint" style="margin-left:auto">Match device</span>' : ''}</button>`;
    }).join('');
  }

  if (dark.addEventListener) dark.addEventListener('change', apply);
  window.addEventListener('storage', e => { if (e.key === KEY) apply(); });

  window.WorkshopTheme = {KEY, THEMES, SWATCH, pref, resolve, current, isDark, scheme, apply, set, toggle, toggleHtml, onChange, menuHtml};
  apply();
})();
