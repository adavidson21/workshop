/* The top bar for an app opened on its own page (not inside the Workshop shell), so it looks like every
   other tool on tools.alexisdavidson.org: breadcrumbs on the left and the round light/dark toggle in the top
   right corner. On alexisdavidson.org the crumbs lead back up to LifeKit and its Office section; in the Android
   app there is only the app's name; anywhere else (the agent on 127.0.0.1, another company's domain) they
   start at Workshop.

   import { mountBar } from '../../shared/standalone-bar.js';
   mountBar('Prioritizer');   // adds <header class="ws-bar"> as the first child of <body> and body.standalone

   Needs shared/theme.js (for the toggle) and shared/themes.css (colors). Styles are injected here because not
   every app loads shared/ui.css. A page lays itself out around the bar with body.standalone. */

import { deviceAvailable } from './device-fs.js';

const LIFEKIT = /(^|\.)alexisdavidson\.org$/.test(location.hostname);

const CSS = `
.ws-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex:none;min-height:60px;padding:0 20px 0 28px;box-sizing:border-box;background:var(--bg);border-bottom:1px solid var(--line)}
.ws-crumbs{display:flex;align-items:center;flex-wrap:wrap;min-width:0;font:500 11.5px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--eyebrow)}
.ws-crumbs a{color:inherit;text-decoration:none;padding:4px 0;border-radius:2px}
.ws-crumbs a:hover{color:var(--ink)}
.ws-crumbs span[aria-hidden]{margin:0 8px;opacity:.5}
.ws-crumbs .here{color:var(--ink)}
.ws-bar .theme-toggle{position:static;width:38px;height:38px;display:grid;place-items:center;padding:0;margin:0;flex:none;cursor:pointer;
  border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--muted);transition:color .2s,border-color .2s,transform .2s;-webkit-tap-highlight-color:transparent}
.ws-bar .theme-toggle:hover{color:var(--ink);border-color:color-mix(in srgb,var(--ink) 30%,var(--line))}
.ws-bar .theme-toggle:active{transform:scale(.94)}
.ws-bar .theme-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.ws-bar .theme-toggle svg{width:18px;height:18px;display:block;transition:transform .5s cubic-bezier(.34,1.56,.64,1)}
.ws-bar .theme-toggle:hover svg{transform:rotate(-20deg)}
@media (max-width:720px){.ws-bar{min-height:56px;padding:env(safe-area-inset-top) 12px 0 16px}}
@media (prefers-reduced-motion:reduce){.ws-bar .theme-toggle,.ws-bar .theme-toggle svg{transition:none}}`;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function mountBar(name) {
  if (document.querySelector('.ws-bar')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  // In the Android app (mobile/) the app is the whole world: no crumbs leading to a site it does not have.
  const up = deviceAvailable() ? []
    : LIFEKIT
    ? [['LifeKit', 'https://tools.alexisdavidson.org/'], ['Office', 'https://tools.alexisdavidson.org/office/']]
    : [['Workshop', '../../']];
  const bar = document.createElement('header');
  bar.className = 'ws-bar';
  bar.innerHTML = `<nav class="ws-crumbs" aria-label="Breadcrumb">`
    + up.map(([t, href]) => `<a href="${href}">${esc(t)}</a><span aria-hidden="true">/</span>`).join('')
    + `<span class="here" aria-current="page">${esc(name)}</span></nav>`
    + (window.WorkshopTheme ? WorkshopTheme.toggleHtml() : '');
  document.body.prepend(bar);
  document.body.classList.add('standalone');
}
