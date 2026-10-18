/* Workshop shell: the app rail, routing between apps, the theme picker, the toast, and messages from
   the apps inside it.

   To add a page, add an entry to APPS:
     id      route (#/<id>) and pane id
     label   rail label and document title
     icon    20x20 stroke SVG path data
     mount   (pane) => void, once, the first time the page is shown
     show    (arg) => void, every time it is shown (arg: the rest of the route, e.g. a work item id)
     hide    () => void, optional, when another page is shown
   An app can be a same-origin page in a frame (see Prioritizer) or code that renders into the pane
   (see the Dashboard in dashboard.js). */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const svg = d => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

  // A same-origin app in a frame. It keeps running while hidden, so its state survives switching.
  function framed(src, title) {
    let frame = null;
    return {
      mount(pane) {
        frame = document.createElement('iframe');
        frame.src = src; frame.title = title;
        pane.appendChild(frame);
      },
      show() { if (frame) setTimeout(() => { try { frame.contentWindow.focus(); } catch (e) { /* not loaded yet */ } }); },
      get window() { return frame && frame.contentWindow; }
    };
  }

  const prioritizer = framed('prioritizer/', 'Prioritizer');
  const APPS = [
    {id: 'prioritizer', label: 'Prioritizer', icon: '<path d="M4 5h12M4 10h8.5M4 15h5"/>', ...pick(prioritizer)},
    {id: 'dashboard', label: 'Dashboard', icon: '<rect x="2.75" y="3.25" width="6" height="7.5" rx="1.3"/><rect x="11.25" y="3.25" width="6" height="4.5" rx="1.3"/><rect x="11.25" y="10.25" width="6" height="6.5" rx="1.3"/><rect x="2.75" y="13.25" width="6" height="3.5" rx="1.3"/>',
      mount: pane => EmDashboard.mount(pane), show: arg => EmDashboard.show(arg), hide: () => EmDashboard.hide()}
  ];
  function pick(o) { return {mount: p => o.mount(p), show: a => o.show(a), hide: o.hide ? () => o.hide() : undefined}; }

  const byId = Object.fromEntries(APPS.map(a => [a.id, a]));
  const mounted = new Set();
  let current = null;

  /* ---------- rail ---------- */
  const THEME_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>';
  const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6.5" fill="currentColor"/><g fill="var(--on-accent)"><rect x="5" y="5" width="6.2" height="6.2" rx="1.8"/><rect x="12.8" y="5" width="6.2" height="6.2" rx="1.8" opacity=".38"/><rect x="5" y="12.8" width="6.2" height="6.2" rx="1.8" opacity=".38"/><rect x="12.8" y="12.8" width="6.2" height="6.2" rx="1.8" opacity=".38"/></g></svg>';
  const INSTALL_ICON = svg('<rect x="3" y="3.5" width="14" height="10" rx="1.8"/><path d="M7 17h6M10 6.5v4.5M8 9l2 2 2-2"/>');
  function renderRail() {
    $('#rail').innerHTML = `<a class="mark" href="#/" aria-label="Workshop">${MARK}</a>`
      + APPS.map((a, i) => `<a class="app-btn" href="#/${a.id}" data-app="${a.id}" title="${a.label} (Alt+${i + 1})"><span aria-hidden="true">${svg(a.icon)}</span><span class="lbl">${a.label}</span></a>`).join('')
      + `<span class="grow"></span><button class="app-btn" id="installBtn" hidden aria-label="Install Workshop as a desktop app" title="Install as a desktop app">${INSTALL_ICON}<span class="lbl">Install</span></button>`
      + `<button class="app-btn" id="themeBtn" aria-label="Theme" title="Theme">${THEME_ICON}</button>`;
  }
  function markRail() {
    document.querySelectorAll('.app-btn[data-app]').forEach(b => {
      const on = b.dataset.app === current;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  /* ---------- routing: #/<app>[/<arg>]. The first app (home) has the bare address, no #. ---------- */
  const HOME = APPS[0].id;
  function parseHash() {
    const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
    return {id: byId[id] ? id : null, arg: rest.length ? decodeURIComponent(rest.join('/')) : ''};
  }
  function route() {
    const parsed = parseHash(), arg = parsed.arg, id = parsed.id || HOME;
    const app = byId[id];
    if (current && current !== id && byId[current].hide) byId[current].hide();
    current = id;
    let pane = document.getElementById('pane-' + id);
    if (!pane) {
      pane = document.createElement('section');
      pane.className = 'pane'; pane.id = 'pane-' + id; pane.setAttribute('aria-label', app.label);
      $('#panes').appendChild(pane);
    }
    document.querySelectorAll('.pane').forEach(p => { p.hidden = p !== pane; });
    if (!mounted.has(id)) { app.mount(pane); mounted.add(id); }
    app.show(arg);
    document.title = `${app.label} · Workshop`;
    markRail();
    // Tidy the address: home is the bare page, and a one-time argument is dropped so a reload doesn't repeat it.
    const clean = id === HOME ? location.pathname + location.search : '#/' + id;
    if (location.hash !== (id === HOME ? '' : '#/' + id)) history.replaceState(null, '', clean);
  }
  function go(id, arg) {
    const h = '#/' + id + (arg ? '/' + encodeURIComponent(arg) : '');
    if (location.hash === h) route(); else location.hash = h;
  }

  /* ---------- messages from apps in frames (same origin only) ---------- */
  // {type: 'em-open', app, focus}: switch to an app, optionally at an item.
  // {type: 'em-key', code}: Alt+<digit> pressed inside the app.
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.source !== prioritizer.window) return;
    if (e.data.type === 'em-open' && byId[e.data.app]) go(e.data.app, e.data.focus || '');
    if (e.data.type === 'em-key') switchByDigit(e.data.code);
  });
  function switchByDigit(code) {
    const a = /^Digit[1-9]$/.test(code) && APPS[+code.slice(5) - 1];
    if (a) go(a.id);
    return !!a;
  }

  /* ---------- theme menu ---------- */
  let menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function openThemeMenu(anchor) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'menu'; menu.setAttribute('role', 'menu');
    menu.innerHTML = WorkshopTheme.menuHtml();
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
    const phone = matchMedia('(max-width:720px)').matches;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - m.width - 8, phone ? r.right - m.width : r.right + 8)) + 'px';
    menu.style.top = Math.max(8, phone ? r.top - m.height - 8 : r.bottom - m.height) + 'px';
    menu.addEventListener('click', e => { const b = e.target.closest('[data-th]'); if (b) { WorkshopTheme.set(b.dataset.th); closeMenu(); anchor.focus(); } });
    const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (first) first.focus();
  }
  document.addEventListener('click', e => {
    const tb = e.target.closest('#themeBtn');
    if (tb) { menu ? closeMenu() : openThemeMenu(tb); return; }
    if (menu && !menu.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu) { closeMenu(); $('#themeBtn').focus(); return; }
    // Alt+1, Alt+2, ...: switch apps (works while focus is in the shell; apps in frames forward it).
    if (e.altKey && !e.ctrlKey && !e.metaKey && switchByDigit(e.code)) e.preventDefault();
  });

  /* ---------- toast ---------- */
  let toastTimer = null;
  function toast(msg, label, fn, ms = 4000) {
    const el = $('#toast');
    el.innerHTML = '';
    const span = document.createElement('span'); span.textContent = msg; el.appendChild(span);
    if (label && fn) {
      const b = document.createElement('button'); b.textContent = label;
      b.addEventListener('click', () => { el.classList.remove('show'); fn(); });
      el.appendChild(b);
    }
    el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ---------- install as a desktop app ----------
     Chrome and Edge offer an install prompt when the site qualifies (manifest + service worker).
     We keep it and show an Install button on the rail; once installed, Workshop opens in its own
     window with a dock or taskbar icon, and the button goes away. */
  let installPrompt = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function setInstall() { const b = $('#installBtn'); if (b) b.hidden = !installPrompt || standalone(); }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; setInstall(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; setInstall(); toast('Workshop is installed. Open it from your dock, taskbar or Start menu.'); });
  document.addEventListener('click', async e => {
    if (!e.target.closest('#installBtn') || !installPrompt) return;
    const p = installPrompt; installPrompt = null; setInstall();
    try { await p.prompt(); await p.userChoice; } catch (err) { /* each prompt works once; the browser offers a fresh one later */ }
  });

  window.WorkshopHub = {apps: APPS, go, toast};

  renderRail();
  window.addEventListener('hashchange', route);
  route();
  WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000));
})();
