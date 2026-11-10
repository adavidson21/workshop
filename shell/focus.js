/* Workshop shell: focus hours and lunch (docs/focus.md). The bar item (Focus, Focus until 12:00 · 7 held,
   Lunch until 1:00, Focus skipped today, Lunch missed), its menu, Peek, the release toast, the lunch cover,
   lunch detection bars, palette commands, and holding rail badges and held toasts.

   The shell writes Settings' `focus` day items itself: it connects to the SDK as app `settings` (docs/focus.md,
   Items). Rules and day item changes are in shared/focus.js; this file is the page around them.
   With focus hours off nothing here shows, nothing is held, and badges and toasts pass straight through. */
import { connect } from '../shared/workshop-sdk.js';
import { readCards } from '../shared/summary.js';
import * as F from '../shared/focus.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const RELEASED_KEY = 'workshop.focus.released';

/**
 * opts: {toast(text, label, fn, ms, kind), go(appId, path), apps(): [{id, manifest}], panes: Element,
 *        renderBadges(), now(): Date}. Returns {mount(topbarEl), attachFrame(win), filterToast(p), badgeFor(raw),
 *        commands(), get current}.
 */
export function createFocusShell(opts) {
  const now = opts.now || (() => new Date());
  let ws = null, watch = null, f = F.resolveFocus({}), held = [], heldTotal = 0;
  let item = null, menu = null, peekOpen = false, cover = null, coverTimer = null, bar = null;
  let prev = f;
  const shownCover = new Set();      // lunch block keys this tab covered once
  const shownBar = new Set();        // lunch block keys whose working-through bar showed
  const activity = F.createActivity({ now: () => now().getTime(), visible: () => document.visibilityState === 'visible' });
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(F.CHANNEL) : null;
  if (channel) channel.addEventListener('message', e => { if (e.data && e.data.kind === 'released') rememberReleased(e.data.key); });

  /* ---------- reading and writing ---------- */
  async function start() {
    try { ws = await connect({ app: F.APP }); } catch (e) { return; }
    watch = F.watchFocus(ws, (next) => onFocus(next), { now });
    try {
      for (const a of opts.apps()) ws.data.subscribe('summary', () => readHeld(), { app: a.id });
    } catch (e) { /* no events: Peek reads again when opened */ }
    setInterval(tick, 60000);
    activity.attach(window);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { watch.recompute(); tick(); } });
  }

  // Change today's day item with fn(item, f, now): read fresh, apply, put; on a conflict read again and re-apply.
  async function updateDay(fn) {
    if (!ws) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      let env = null;
      try { env = await ws.data.get(F.COLLECTION); } catch (e) { opts.toast("Couldn't reach your Workshop data to change focus.", null, null, 6000, 'error'); return false; }
      if (!env || env.schema !== F.SCHEMA) return false;
      const d = now(), date = F.dateStr(d);
      const next = fn(F.dayOf(env, date), f, d);
      if (!next) return false;
      let out = F.withDay(env, next, Date.now());
      out = F.cleanupEnvelope(out, date) || out;
      try { await ws.data.put(F.COLLECTION, out); await watch.refresh(); return true; }
      catch (e) { if (!(e && e.code === 'conflict')) { opts.toast((e && e.message) || "Couldn't save that.", null, null, 6000, 'error'); return false; } }
    }
    return false;
  }

  // Held cards for the span (every app's summary `held` card; docs/focus.md, The held card).
  async function heldCards(key) {
    if (!ws || !key) return [];
    const list = opts.apps();
    const sums = await Promise.all(list.map(a => ws.data.get('summary', { app: a.id }).then(env => readCards(env, a.id)).catch(() => null)));
    return F.heldFor(list.map((a, i) => ({ app: a.id, name: a.manifest.name, cards: sums[i] })), key);
  }
  let heldTimer = null;
  function readHeld() {
    clearTimeout(heldTimer);
    heldTimer = setTimeout(async () => {
      if (!F.isHeldNow(f)) { held = []; heldTotal = 0; render(); return; }
      held = await heldCards(f.span && f.span.key);
      heldTotal = held.reduce((n, p) => n + p.count, 0);
      render();
      if (peekOpen) renderMenu();
    }, 200);
  }

  /* ---------- transitions ---------- */
  function onFocus(next) {
    const before = prev;
    f = next; prev = next;
    // A focus block that ended on time is logged as kept (once, by one tab).
    if (before.state === 'focus' && next.state !== 'focus' && before.until && F.minuteOf(now()) >= F.toMin(before.until)) {
      const block = (before.blocks || []).find(b => b.end === before.until);
      if (block) claimOnce(`kept:${before.date}T${block.start}`, () => updateDay((it, _f, d) => F.logKept(it, block, F.dateStr(d))));
    }
    // A lunch block ended: how did it go?
    if (before.state === 'lunch' && (next.state !== 'lunch' || next.until !== before.until)) lunchEnded(before);
    // The span ended: release once.
    const was = before.span && before.span.key, is = next.span && next.span.key;
    if (was && was !== is) release(was, before.state);
    if (next.state === 'lunch') showCover(next);
    else hideCover();
    opts.renderBadges();
    readHeld();
    render();
    tick();
  }

  // Once per key per browser: a Web Lock (when there is one) around a check of localStorage.
  function claimOnce(key, fn) {
    const go = async () => {
      let done = [];
      try { done = JSON.parse(localStorage.getItem(RELEASED_KEY) || '[]'); } catch (e) { done = []; }
      if (!Array.isArray(done)) done = [];
      if (done.includes(key)) return;
      done = done.concat([key]).slice(-60);
      try { localStorage.setItem(RELEASED_KEY, JSON.stringify(done)); } catch (e) { /* private window: this tab only */ }
      await fn();
    };
    if (navigator.locks && navigator.locks.request) return navigator.locks.request('workshop-focus-claim', go).catch(() => {});
    return go();
  }
  function rememberReleased(key) {
    try { const done = JSON.parse(localStorage.getItem(RELEASED_KEY) || '[]'); if (Array.isArray(done) && !done.includes(key)) localStorage.setItem(RELEASED_KEY, JSON.stringify(done.concat([key]).slice(-60))); } catch (e) { /* ignore */ }
  }

  function release(key, kind) {
    claimOnce(`release:${key}`, async () => {
      if (channel) try { channel.postMessage({ kind: 'released', key: `release:${key}` }); } catch (e) { /* closed */ }
      const parts = await heldCards(key);
      const total = parts.reduce((n, p) => n + p.count, 0);
      showRelease(F.releaseText(parts, kind === 'lunch' ? 'lunch' : 'focus'), parts);
      if (total) await updateDay((it, _f, d) => F.addReleased(it, F.dateStr(d), total));
    });
  }
  // The release toast: one line, each part a link to where it lives.
  function showRelease(text, parts) {
    if (!parts.length) { opts.toast(text, null, null, 6000); return; }
    const el = document.getElementById('toast');
    opts.toast(text, null, null, 12000);
    if (!el) return;
    const span = el.querySelector('span');
    if (!span) return;
    const head = text.slice(0, text.indexOf(':') + 1);
    span.textContent = head + ' ';
    parts.forEach((p, i) => {
      const a = document.createElement('button');
      a.className = 'focus-link'; a.textContent = p.label;
      a.addEventListener('click', () => { el.classList.remove('show'); opts.go(p.app, p.route); });
      span.appendChild(a);
      span.appendChild(document.createTextNode(i < parts.length - 1 ? ', ' : '.'));
    });
  }

  /* ---------- lunch detection ---------- */
  const blockMs = (date, b) => { const [y, m, d] = date.split('-').map(Number); const s = F.toMin(b.start), e = F.toMin(b.end); return [new Date(y, m - 1, d, Math.floor(s / 60), s % 60).getTime(), new Date(y, m - 1, d, Math.floor(e / 60), e % 60).getTime()]; };
  const lunchKey = g => g && g.date && g.state === 'lunch' ? `${g.date}T${(g.lunchBlocks.find(b => b.end === g.until) || {}).start || g.until}` : null;
  function activeInLunch(g, uptoMs) {
    const b = g.lunchBlocks.find(x => x.end === g.until);
    if (!b) return 0;
    const [s, e] = blockMs(g.date, b);
    return activity.countIn(s, Math.min(e, uptoMs));
  }
  function lunchEnded(g) {
    const key = lunchKey(g);
    if (!key) return;
    const day = watch && watch.day, L = (day && day.lunch) || {};
    if (L.skipped) return;                                    // Skip lunch today says how it went
    const nowMin = F.minuteOf(now());
    if (g.source !== 'late' && (f.lunchBlocks || []).some(b => b.source !== 'late' && F.toMin(b.start) > nowMin)) return;   // pushed, not over
    const active = activeInLunch(g, now().getTime());
    const status = F.lunchOutcome(active, g.source);
    claimOnce(`lunch:${key}`, () => updateDay((it, _f, d) => F.setLunchStatus(it, F.dateStr(d), status)));
  }
  function tick() {
    if (!watch || !f.enabled) { hideBar(); return; }
    if (F.isHeldNow(f)) readHeld();
    const d = now();
    const day = watch.day;
    if (f.state === 'lunch') {
      const key = lunchKey(f);
      if (F.workingThrough(f, activeInLunch(f, d.getTime()), shownBar.has(key))) { shownBar.add(key); showBar('through'); }
      return;
    }
    if (bar && bar.dataset.kind === 'through') hideBar();
    if (F.pushedMissed(f, day, d)) claimOnce(`pushed:${f.date}`, () => updateDay((it, _f, dd) => F.setLunchStatus(it, F.dateStr(dd), 'missed')));
    render();
  }
  // The quiet bar at the top of the panes ("Still working through lunch?").
  function showBar(kind) {
    hideBar();
    bar = document.createElement('div');
    bar.className = 'focus-bar'; bar.dataset.kind = kind; bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>Still working through lunch? Take it now or push it.</span>
      <button class="btn primary" data-fx="take-60">Take lunch now</button><button class="btn" data-fx="push-30">Push 30 min</button><button class="btn ghost" data-fx="skip-lunch">Skip lunch today</button>`;
    opts.panes.prepend(bar);
    opts.panes.classList.add('has-bar');
  }
  function hideBar() {
    if (!bar) return;
    bar.remove(); bar = null;
    if (!document.getElementById('folderBar')) opts.panes.classList.remove('has-bar');
  }

  /* ---------- the lunch cover ---------- */
  function showCover(g) {
    const key = lunchKey(g);
    if (!key || shownCover.has(key) || cover) return;
    shownCover.add(key);
    drawCover(g);
  }
  function drawCover(g) {
    cover = document.createElement('div');
    cover.className = 'lunch-cover'; cover.setAttribute('role', 'dialog'); cover.setAttribute('aria-modal', 'true'); cover.setAttribute('aria-labelledby', 'lunchTitle');
    cover.innerHTML = `<div class="lunch-box"><p class="eyebrow">Lunch</p><h2 id="lunchTitle">Lunch. Back at ${esc(F.fmtTime(g.until))}.</h2>
      <p>Badges and pickups wait until you are back. Quick capture (Ctrl+.) still works.</p>
      <div class="acts"><button class="btn" data-fx="cover-minute">Just a minute</button><button class="btn primary" data-fx="end-lunch">Back early</button></div></div>`;
    document.body.appendChild(cover);
    cover.querySelector('[data-fx="cover-minute"]').focus();
  }
  function hideCover() {
    clearTimeout(coverTimer); coverTimer = null;
    if (cover) { cover.remove(); cover = null; }
  }
  function justAMinute() {
    const g = f;
    hideCover();
    coverTimer = setTimeout(() => { if (f.state === 'lunch' && lunchKey(f) === lunchKey(g) && !cover) drawCover(f); }, F.PAUSE_MINUTES * 60000);
  }

  /* ---------- the bar item and its menu ---------- */
  function render() {
    if (!item) return;
    const day = watch ? watch.day : null;
    const missed = watch && F.missedOffer(f, day, now());
    item.hidden = !f.enabled;
    item.dataset.state = f.state;
    if (!f.enabled) { item.innerHTML = ''; closeMenu(); return; }
    let label;
    if (f.state === 'focus') label = `Focus until ${F.fmtTime(f.until)}${heldTotal ? ` · ${heldTotal} held` : ''}`;
    else if (f.state === 'lunch') label = `Lunch until ${F.fmtTime(f.until)}`;
    else if (f.state === 'skipped') label = 'Focus skipped today';
    else label = 'Focus';
    const missedHtml = missed ? `<span class="wf-missed"><span>Lunch missed. Take a late lunch?</span><button class="wf-act" data-fx="take-30">Take 30 min</button><button class="wf-act" data-fx="take-60">Take 60 min</button><button class="wf-act ghost" data-fx="not-today">Not today</button></span>` : '';
    item.innerHTML = `${missedHtml}<button type="button" class="wf-btn" data-fx="menu" aria-haspopup="menu" aria-expanded="${menu ? 'true' : 'false'}"><span class="wf-dot" aria-hidden="true"></span><span class="wf-label">${esc(label)}</span></button>`;
    // Rewriting the item drops the open menu (and Peek with it), so put it back.
    if (menu) { item.appendChild(menu); renderMenu(); }
  }
  function remainingBlock(g, d) { const m = F.minuteOf(d); return (g.blocks || []).some(b => F.toMin(b.end) > m); }
  function menuItems() {
    const d = now(), out = [];
    if (f.state === 'focus' || f.state === 'lunch') out.push(['peek', 'Peek at held items']);
    if (f.state === 'off') {
      for (const m of [25, 50, 90]) { const e = F.startNowEnd(f, d, m); if (e) out.push([`start-${m}`, `Start focus now, ${m} min${e.lunch ? ` (until ${F.fmtTime(e.end)}, lunch)` : ''}`]); }
      const nx = F.startNowEnd(f, d, 'next');
      if (remainingBlock(f, d) && nx) out.push(['start-next', `Start focus now, until ${F.fmtTime(nx.end)}${nx.lunch ? ', lunch' : ''}`]);
      if (remainingBlock(f, d)) out.push(['skip', 'Skip today']);
    }
    if (f.state === 'focus') out.push(['end-early', 'End early'], ['skip', 'Skip today']);
    if (f.state === 'lunch') out.push(['end-lunch', 'End lunch'], ['push-15', 'Push lunch 15 min'], ['push-30', 'Push lunch 30 min'], ['push-60', 'Push lunch 60 min'], ['skip-lunch', 'Skip lunch today']);
    if (f.state === 'skipped') out.push(['undo-skip', 'Undo skip']);
    if (f.state !== 'lunch' && (f.lunchBlocks || []).some(b => F.toMin(b.start) > F.minuteOf(d) && b.source !== 'late')) out.push(['push-lunch-30', 'Push lunch 30 min'], ['skip-lunch', 'Skip lunch today']);
    out.push(['settings', 'Focus hours settings']);
    return out;
  }
  function renderMenu() {
    if (!menu) return;
    const had = menu.contains(document.activeElement) ? document.activeElement.dataset.fx : null;
    const peek = peekOpen ? `<div class="wf-peek" role="group" aria-label="Held items"><p class="eyebrow">Held${f.span ? ` until ${esc(F.fmtTime(f.span.end))}` : ''}</p>${held.length
      ? `<ul>${held.map(p => `<li><button class="wf-held" data-go="${esc(p.app)}" data-path="${esc(p.route)}"><span class="wf-app">${esc(p.name)}</span><span>${esc(p.label)}</span></button></li>`).join('')}</ul>`
      : '<p class="soft">Nothing held yet.</p>'}</div>` : '';
    menu.innerHTML = peek + `<ul role="menu">${menuItems().map(([id, label]) => `<li role="none"><button role="menuitem" data-fx="${id}">${esc(label)}</button></li>`).join('')}</ul>`;
    if (had) { const b = menu.querySelector(`[data-fx="${had}"]`); if (b) b.focus(); }
  }
  function openMenu(peek = false) {
    closeMenu();
    peekOpen = peek;
    menu = document.createElement('div');
    menu.className = 'wf-menu';
    item.appendChild(menu);
    renderMenu();
    const b = item.querySelector('.wf-btn'); if (b) b.setAttribute('aria-expanded', 'true');
    if (peek) readHeld();
    const first = menu.querySelector('button'); if (first) first.focus();
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; peekOpen = false; const b = item && item.querySelector('.wf-btn'); if (b) b.setAttribute('aria-expanded', 'false'); } }

  async function run(id) {
    const m = /^(start|push|take)-(\d+|next)$/.exec(id);
    if (id !== 'peek') closeMenu();
    if (m && m[1] === 'start') return updateDay((it, g, d) => F.startNow(it, g, d, m[2] === 'next' ? 'next' : +m[2]));
    if (m && m[1] === 'push') { hideBar(); return updateDay((it, g, d) => F.pushLunch(it, g, d, +m[2])); }
    if (m && m[1] === 'take') { hideBar(); return updateDay((it, g, d) => F.takeLunch(it, d, +m[2], g)); }
    switch (id) {
      case 'menu': return menu ? closeMenu() : openMenu();
      case 'peek': peekOpen = !peekOpen; renderMenu(); if (peekOpen) readHeld(); return;
      case 'end-early': return updateDay((it, g, d) => F.endEarly(it, g, d));
      case 'skip': return updateDay((it, g, d) => F.skipToday(it, g, d));
      case 'undo-skip': return updateDay((it, g, d) => F.undoSkip(it, d));
      case 'end-lunch': hideCover(); return updateDay((it, g, d) => F.endLunch(it, g, d));
      case 'push-lunch-30': return updateDay((it, g, d) => F.pushLunch(it, g, d, 30));
      case 'skip-lunch': hideBar(); hideCover(); return updateDay((it, g, d) => F.skipLunch(it, d));
      case 'not-today': return updateDay((it, g, d) => F.notToday(it, d));
      case 'cover-minute': return justAMinute();
      case 'settings': return opts.go('settings', 'focus');
    }
  }
  document.addEventListener('click', e => {
    const fx = e.target.closest('[data-fx]');
    if (fx && (item && item.contains(fx) || (bar && bar.contains(fx)) || (cover && cover.contains(fx)))) { e.preventDefault(); run(fx.dataset.fx); return; }
    const g = e.target.closest('.wf-held');
    if (g) { opts.go(g.dataset.go, g.dataset.path || ''); return; }   // Peek links do not end the span
    if (menu && item && !item.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu) { closeMenu(); const b = item.querySelector('.wf-btn'); if (b) b.focus(); } }, true);

  return {
    mount(topbar, before) {
      item = document.createElement('div');
      item.className = 'wfocus'; item.id = 'wfocus'; item.hidden = true;
      topbar.insertBefore(item, before || null);
      render();
      start();
    },
    attachFrame(win) { activity.attach(win); },
    get current() { return f; },
    /** Drop a held toast during a span (docs/focus.md, Holding a toast). True when it should not show. */
    holds(p) { return !!(p && p.hold) && F.isHeldNow(f) && !(p.breakThrough && f.state === 'focus'); },
    /** The number to show on a rail badge, given what the app asked for. */
    badgeFor(raw) {
      if (!raw) return 0;
      if (!F.isHeldNow(f)) return raw.count;
      return f.state === 'focus' && raw.breakThrough > 0 ? raw.breakThrough : 0;
    },
    /** Palette commands for the shell's list (only while focus hours are on). */
    commands() {
      if (!f.enabled) return [];
      const c = [];
      if (f.state === 'off') c.push({ title: 'Start focus', run: () => run(remainingBlock(f, now()) ? 'start-next' : 'start-50') });
      if (f.state === 'focus') c.push({ title: 'End focus early', run: () => run('end-early') });
      if (f.state === 'focus' || f.state === 'lunch') c.push({ title: 'Peek held items', run: () => openMenu(true) });
      if (f.state === 'off' || f.state === 'focus') c.push({ title: 'Skip focus today', run: () => run('skip') });
      if (f.state === 'skipped') c.push({ title: 'Undo skip focus today', run: () => run('undo-skip') });
      if (f.state !== 'lunch') c.push({ title: 'Take lunch now', run: () => run('take-60') });
      if (f.state === 'lunch') c.push({ title: 'End lunch', run: () => run('end-lunch') });
      if (f.state === 'lunch' || (f.lunchBlocks || []).some(b => F.toMin(b.start) > F.minuteOf(now()))) c.push({ title: 'Push lunch', run: () => run(f.state === 'lunch' ? 'push-30' : 'push-lunch-30') });
      return c;
    }
  };
}
