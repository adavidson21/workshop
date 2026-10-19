/* Workshop: the Dashboard page. Shows the eng-agents live dashboard (127.0.0.1) in a frame, kept
   loaded once opened, in the hub's theme. Before it can connect, it shows the setup steps.

   Messages with the dashboard frame (the eng-agents side is in dashboard.template.html):
     frame -> hub   {type: 'eng-ready'}            the page loaded and listens
     hub -> frame   {type: 'eng-theme', theme}      use this theme
     hub -> frame   {type: 'eng-focus', id}         scroll to this work item */
(function () {
  'use strict';
  const CHECK_EVERY = 30 * 1000;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

  let pane, head, body, frame = null, ready = false, focusId = null, timer = null, visible = false;
  let st = {status: 'idle', error: '', data: null}; // idle | checking | ok | down | setup

  function mount(el) {
    pane = el;
    pane.innerHTML = '<header class="dhead"></header><div class="dbody"></div>';
    head = pane.querySelector('.dhead');
    body = pane.querySelector('.dbody');
    pane.addEventListener('click', onClick);
    pane.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'engPort') act('connect'); });
    window.addEventListener('message', onMessage);
    WorkshopTheme.onChange(sendTheme);
    EngClient.onChange(() => { if (frame && frame.dataset.port !== String(EngClient.settings().port)) dropFrame(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && visible && st.status !== 'ok') check(); });
  }

  // Called by the shell each time the page is shown. focus: a work item id to scroll to.
  function show(focus) {
    visible = true;
    if (focus) focusId = String(focus);
    if (st.status === 'ok' && ready && focusId) { post({type: 'eng-focus', id: focusId}); focusId = null; }
    if (st.status === 'idle' || st.status === 'down') check(); else render();
    schedule();
  }
  function hide() { visible = false; schedule(); }

  function schedule() {
    clearInterval(timer); timer = null;
    // Recheck while visible and not connected; once the frame is up, the dashboard reconnects itself.
    if (visible && EngClient.settings().on) timer = setInterval(() => { if (!document.hidden && st.status !== 'ok') check(); }, CHECK_EVERY);
  }

  async function check() {
    if (st.status === 'checking') return;
    if (!EngClient.settings().on && st.status !== 'idle') { st.status = 'setup'; render(); return; }
    st.status = 'checking'; render();
    try {
      st = {status: 'ok', error: '', data: await EngClient.status()};
      if (!EngClient.settings().on) EngClient.save({on: true}); // first successful connect turns stages on in Prioritizer too
    } catch (e) {
      st = {status: EngClient.settings().on ? 'down' : 'setup', error: EngClient.unreachable(e) ? '' : e.message, data: null};
    }
    render(); schedule();
  }

  function render() {
    const s = EngClient.settings(), d = st.data;
    head.innerHTML = `<div><h1>Dashboard</h1><div class="sub">${st.status === 'ok' && d ? `eng-agents ${esc(d.version || '')} · ${esc(d.workspace || '')}` : 'eng-agents live dashboard'}</div></div>
      <div class="tools">${st.status === 'ok' ? `<button class="btn" data-eng="reload">Reload</button><a class="btn" href="${esc(EngClient.base())}/" target="_blank" rel="noopener">Open in its own tab</a>` : ''}
        ${s.on ? `<button class="btn ghost" data-eng="settings">Connection</button>` : ''}</div>`;
    if (st.status === 'ok') { ensureFrame(); return; }
    dropFrame();
    if (st.status === 'checking' || st.status === 'idle') {
      body.innerHTML = `<div class="engcard"><h2>Connecting to the live dashboard</h2><p>Looking for it at 127.0.0.1:${s.port}.</p></div>`;
      return;
    }
    const setup = st.status === 'setup' || !s.on;
    body.innerHTML = `<div class="engcard">
      <h2>${setup ? 'Connect your work dashboard' : "Can't reach the live dashboard"}</h2>
      ${st.error ? `<p>${esc(st.error)}</p>` : '<p>The eng-agents live dashboard runs on this computer. The hub shows it here and puts each ADO task\'s stage next to it in Prioritizer. Nothing leaves your computer.</p>'}
      <ol>
        <li>Start it: run <code>/dashboard</code> in opencode in your workspace. It opens in its own minimized window.</li>
        ${setup ? `<li>Let it answer this site. In <code>~/.config/eng-agents/config.json</code> add <code>"dashboard": { "shellOrigins": ["${esc(location.origin)}"] }</code>. If it was already running, close its window and run <code>/dashboard</code> again.</li>` : ''}
        <li>${setup ? 'Click Connect' : 'This page checks again every 30 seconds, or click Try again'}. If the browser asks to allow access to apps on this device, choose Allow.</li>
      </ol>
      <div class="acts"><span class="fld"><label for="engPort">Port</label><input type="number" id="engPort" class="mono" min="1024" max="65535" value="${s.port}"></span>
        <span class="grow"></span>${s.on ? '<button class="btn text-danger" data-eng="off">Disconnect</button>' : ''}<button class="btn primary" data-eng="connect">${setup ? 'Connect' : 'Try again'}</button></div>
    </div>`;
  }

  function ensureFrame() {
    const port = String(EngClient.settings().port);
    if (frame && frame.dataset.port === port && frame.isConnected) return;
    dropFrame();
    ready = false;
    body.innerHTML = '';
    frame = document.createElement('iframe');
    frame.title = 'Work dashboard';
    frame.dataset.port = port;
    frame.allow = 'loopback-network; local-network-access';
    frame.src = EngClient.base() + '/?embed=1';
    body.appendChild(frame);
  }
  function dropFrame() { if (frame) { frame.remove(); frame = null; ready = false; } }

  function post(msg) { if (frame && ready && frame.contentWindow) frame.contentWindow.postMessage(msg, EngClient.base()); }
  function sendTheme() { post({type: 'eng-theme', theme: WorkshopTheme.current()}); }
  function onMessage(e) {
    if (!frame || e.source !== frame.contentWindow || e.origin !== EngClient.base()) return;
    if (e.data && e.data.type === 'eng-ready') {
      ready = true; sendTheme();
      if (focusId) { post({type: 'eng-focus', id: focusId}); focusId = null; }
    }
  }

  function onClick(e) {
    const b = e.target.closest('[data-eng]');
    if (b) act(b.dataset.eng);
  }
  function act(a) {
    if (a === 'reload') { dropFrame(); st.status = 'idle'; check(); return; }
    if (a === 'settings') { st.status = 'setup'; render(); return; }
    if (a === 'off') {
      EngClient.save({on: false});
      st = {status: 'setup', error: '', data: null};
      render(); schedule(); WorkshopHub.toast('Dashboard disconnected'); return;
    }
    if (a === 'connect') {
      const inp = pane.querySelector('#engPort'), port = Math.round(+(inp && inp.value));
      if (!EngClient.validPort(port)) { WorkshopHub.toast('Use a port between 1024 and 65535.'); return; }
      EngClient.save({port});
      st.status = 'idle'; check();
    }
  }

  window.WorkshopDashboard = {mount, show, hide};
})();
