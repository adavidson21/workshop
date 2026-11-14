/* Shared theme handling for the Workshop shell and every app inside it.
   Load it synchronously in <head>, after the theme-color meta tag: it sets data-theme before first
   paint, so there is no flash. The colors come from the brand library through themes.css. Keep THEMES and SWATCH
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
  const SWATCH = {light: ['#FAF6F1', '#7A1B36'], dark: ['#1A1517', '#E59AAE']};
  // Each app's brand jewel accent, from data-app-color on <html> (themes.css has the matching --c-* colors).
  // Workshop's own color is amethyst: the shell, Docket, Settings, Needs you and any app not listed use it.
  // Runway is the one garnet app (the brand default, no data-accent). Sets the brand's data-accent, now and whenever data-app-color changes.
  const APP_ACCENT = {notes: 'sapphire', slate: 'sapphire', agents: 'tourmaline', receipts: 'tourmaline', runway: 'garnet'};
  (function syncAccent() {
    const el = document.documentElement;
    const set = () => {
      if (!el.dataset) return;
      const a = APP_ACCENT[el.dataset.appColor] || 'amethyst';
      if (a !== 'garnet') el.dataset.accent = a; else delete el.dataset.accent;
    };
    set();
    if (typeof MutationObserver === 'function') new MutationObserver(set).observe(el, {attributes: true, attributeFilter: ['data-app-color']});
  })();
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

/* Quiet "?" hints, shared by the shell and every app (styled by .qhint in ui.css).
   A page's explanation sits behind a faint ? next to its heading instead of a paragraph under it.
   Each hint retires after it has been opened RETIRE times, since regular users stop needing it;
   WorkshopTheme.hints.reset() (Settings, "Show tips again") brings them all back.

   Markup: WorkshopTheme.hints.html(id, text) gives
     <span class="qhint" data-hint="id"><button type="button" aria-label="About this">?</button><span class="qhint-tip" role="tooltip">text</span></span>
   Put it inside the heading it explains. Ids are short and stable, like "people" or "settings.local".
   Counts are kept in this browser (localStorage, workshop.hints) and shared by every page on the site. */
(function () {
  'use strict';
  const KEY = 'workshop.hints';
  const RETIRE = 3;
  let counts = {};
  function load() {
    try { counts = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { counts = {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(counts)); } catch (e) { /* private mode: hints just never retire */ }
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  function html(id, text, label) {
    return `<span class="qhint" data-hint="${esc(id)}"><button type="button" aria-label="${esc(label || 'About this')}">?</button><span class="qhint-tip" role="tooltip">${esc(text)}</span></span>`;
  }
  // Retired hints are hidden by one generated style rule, so hints rendered later are covered too.
  let styleEl = null;
  function paint() {
    if (typeof document.createElement !== 'function' || !document.head) return;
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.dataset.hints = ''; document.head.appendChild(styleEl); }
    const gone = Object.keys(counts).filter(k => counts[k] >= RETIRE);
    styleEl.textContent = gone.length ? gone.map(k => `.qhint[data-hint="${k.replace(/["\\]/g, '')}"]`).join(',') + '{display:none!important}' : '';
  }
  // One count per opening: hover, keyboard focus or a tap. It retires once the tooltip closes.
  let open = null, openedAt = 0;
  function opened(el) {
    if (open === el) return;
    if (open) closed();
    open = el;
    openedAt = Date.now();
    el.classList.add('open');
    const id = el.getAttribute('data-hint');
    if (id) { counts[id] = (counts[id] || 0) + 1; save(); }
  }
  function closed() {
    if (!open) return;
    open.classList.remove('open');
    open = null;
    paint();
  }
  function reset() { counts = {}; save(); paint(); }
  if (typeof document.addEventListener === 'function') {
    const hintOf = t => t && t.closest ? t.closest('.qhint') : null;
    document.addEventListener('mouseover', e => { const h = hintOf(e.target); if (h) opened(h); else if (open && !open.contains(e.target)) closed(); });
    document.addEventListener('focusin', e => { const h = hintOf(e.target); if (h) opened(h); });
    document.addEventListener('focusout', e => { if (open && !open.contains(e.relatedTarget)) closed(); });
    document.addEventListener('click', e => {
      const h = hintOf(e.target);
      if (h) { e.preventDefault(); e.stopPropagation(); if (open === h && Date.now() - openedAt > 400) closed(); else opened(h); return; }
      closed();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closed(); });
    window.addEventListener('storage', e => { if (e.key === KEY) { load(); paint(); } });
    load();
    if (document.head) paint(); else document.addEventListener('DOMContentLoaded', paint);
  }
  // Lives on WorkshopTheme (no new global): WorkshopTheme.hints.html(id, text) and .reset().
  if (window.WorkshopTheme) window.WorkshopTheme.hints = {KEY, RETIRE, html, reset};
})();
