/* Docket: focus. The task you are working on, re-entry breadcrumbs, the switch counter, and the shutdown ritual.
   The day's activity log (focus-model.js) is its own small board, saved through the same write loop as the board
   (store.js) as the focus/days/<yyyy> collections (focus-format.js). Breadcrumbs are saved on the task.

   Everything is local: nothing watches other apps or the computer. A switch is counted only when you start a
   task while another unfinished one is active, and an interruption only when you log one. */
import * as F from './focus-model.js';
import { focusEnvelopesFromBundle, focusFormat } from './focus-format.js';
import { createStore } from './store.js';
import { commit, findTask, isDoneToday, isFocus, isWaiting, state } from './state.js';
import { $, esc, fmtDay, plural, todayStr } from './util.js';
import { closeModal, showModal, toast } from './overlays.js';
import { dp } from './dayplan.js';
import { isWorkday, nextWorkday, toMin } from './dayplan-model.js';
import { embedded, ws } from './ws.js';

const PREFS_KEY = 'prioritizer.focus';   // this device only: the wrap-up reminder
const REMIND_BEFORE_MIN = 30;
let log = F.freshLog(), fstore = null;
let onChange = () => {};

let prefs = {remind: false, reminded: null};
try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} };

const switches = n => `${n} switch${n === 1 ? '' : 'es'}`;
const nowIso = () => new Date().toISOString();
const isOpen = id => { const t = findTask(id); return !!t && !t.done; };

/* Called once by storage.js after the board loaded. */
async function focusBoot(wsh, {render, status}){
  onChange = render;
  fstore = createStore({
    data: wsh.data,
    board: () => log,
    applied: () => { F.cleanLog(log); onChange(); },
    status,
    format: focusFormat()
  });
  await fstore.load();
  fstore.start();
  setInterval(remindTick, 60000);
  remindTick();
  return fstore;
}
function save(){ if (fstore) fstore.schedule(); onChange(); }

/* ---------- the active task ---------- */
const activeId = () => F.activeOf(log, todayStr());
const isActive = id => !!id && activeId() === id;
function activeTask(){ const t = findTask(activeId()); return t && !t.done ? t : null; }

function startTask(id){
  const t = findTask(id);
  if (isWaiting() || !t || t.done) return;
  const {left} = F.startTask(log, todayStr(), id, nowIso(), isOpen);
  save();
  if (left) askCrumb(left, 'You switched tasks. Where did you leave off?');
}
function pauseTask(){
  const id = F.stopActive(log, todayStr(), nowIso(), 'pause');
  if (!id) return;
  save();
  askCrumb(id);
}
/* The task Start next picks: Today's top open task, else the top of your rank that isn't waiting on someone. */
function nextTask(){
  const open = state.tasks.filter(t => !t.done && !t.waiting).sort((a, b) => a.rank - b.rank);
  return open.find(t => isFocus(t)) || open[0] || null;
}
function startNext(){
  const t = nextTask();
  if (t) startTask(t.id); else toast('Nothing open to start');
}
function toggleStart(id){ if (isActive(id)) pauseTask(); else startTask(id); }
function logInterrupt(){
  if (isWaiting()) return;
  const ev = F.addEvent(log, todayStr(), {at: nowIso(), type: 'interrupt'});
  save();
  toast('Interruption logged', 'Undo', () => { F.dropEvent(log, todayStr(), ev); save(); });
}
/* actions.js calls this when a task is completed, marked won't do, or deleted. */
function focusTaskClosed(id){
  if (F.taskClosed(log, todayStr(), id, nowIso()) && fstore) fstore.schedule();
}

/* ---------- breadcrumbs ---------- */
function askCrumb(id, title = 'Where did you leave off?'){
  const t = findTask(id);
  if (!t || t.done) return;
  showModal(`<form class="sheet small crumbsheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>
    <p class="sub">${esc(t.title)}</p>
    <input name="crumb" maxlength="${F.CRUMB_LEN}" autocomplete="off" placeholder="Next step" aria-label="Where you left off">
    <footer><span class="hint">Enter saves. Esc skips.</span><span class="grow"></span><button type="button" class="btn" data-close>Skip</button><button class="btn primary">Save</button></footer></form>`,
    f => {
      const i = f.querySelector('input'); i.focus();
      f.addEventListener('submit', e => {
        e.preventDefault();
        const added = F.addCrumb(t, i.value, nowIso());
        closeModal();
        if (added) commit();
      });
    });
}
function crumbAge(at){
  const d = new Date(at), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  return day === todayStr() ? time : `${fmtDay(day)}, ${time}`;
}
/* The drawer's "Left off" field: the newest three breadcrumbs and the Start / Pause button. */
function focusDrawerHtml(t){
  const crumbs = (t.crumbs || []).slice(-3).reverse();
  const on = isActive(t.id);
  return `<div class="dfld dfocus"><span class="lbl">Focus</span><div class="drow">
      ${t.done ? '' : `<button class="btn${on ? ' on' : ''}" data-d="focus-start" data-fk="fstart" aria-pressed="${on}" data-tip="${on ? 'Pause. Shortcut: S' : 'Work on this now. Shortcut: S'}">${on ? 'Pause' : 'Start'}</button>`}
      ${t.done ? '' : `<button class="lnk" data-d="focus-crumb" data-fk="fcrumb">Add a breadcrumb</button>`}</div>
    ${crumbs.length ? `<ul class="crumbs">${crumbs.map((c, i) => `<li${i === 0 ? ' class="last"' : ''}><span class="when">${esc(crumbAge(c.at))}</span>${esc(c.text)}</li>`).join('')}</ul>` : ''}</div>`;
}
function focusDrawerClick(t, a){
  if (a === 'focus-start'){ toggleStart(t.id); return true; }
  if (a === 'focus-crumb'){ askCrumb(t.id, 'Leave a breadcrumb'); return true; }
  return false;
}
/* A row's "Left off" line on Today, so the morning starts where yesterday stopped. */
function rowCrumb(t){
  const c = !t.done && F.lastCrumb(t);
  return c ? `<span class="crumb" data-tip="Left off ${esc(crumbAge(c.at))}">${esc(c.text)}</span>` : '';
}

/* ---------- the now bar (under the page header, on every view) ---------- */
function renderNow(){
  const el = $('#nowbar'); if (!el) return;
  const d = todayStr(), t = activeTask(), n = F.dayCounts(log, d);
  if (isWaiting() || (!t && !n.switches && !n.interrupts && !nextTask())){ el.hidden = true; el.innerHTML = ''; return; }
  const c = t && F.lastCrumb(t);
  // Counts show once there is something to count; zeros are noise.
  const parts = [n.switches ? switches(n.switches) : '', n.interrupts ? plural(n.interrupts, 'interruption') : ''].filter(Boolean);
  const counts = parts.length ? `<span class="ncount" data-tip="Today, counted only from what you start and log here">${parts.join(' · ')}</span>` : '';
  const interrupted = `<button class="btn" data-now="interrupt" data-tip="Something pulled you away. Shortcut: I">Interrupted</button>`;
  el.hidden = false;
  el.classList.toggle('idle', !t);
  el.innerHTML = t
    ? `<div class="nmain"><div class="nline"><span class="dotlive" aria-hidden="true"></span><span class="nlabel">Working on</span><button class="ntitle" data-now="open">${esc(t.title)}</button></div>
        ${c ? `<div class="ncrumb" data-tip="Your last breadcrumb, ${esc(crumbAge(c.at))}">Last time: ${esc(c.text)}</div>` : ''}</div>
      <div class="nact">${counts}${interrupted}<button class="btn" data-now="pause">Pause</button><button class="btn primary" data-now="done">Done</button></div>`
    : (() => { const nx = nextTask(); return `<div class="nmain"><div class="nline">${nx ? `<span class="nlabel">Next</span><button class="ntitle" data-now="opennext" data-id="${esc(nx.id)}">${esc(nx.title)}</button>` : '<span class="nlabel">Nothing started</span>'}</div></div>
      <div class="nact">${counts}${interrupted}${nx ? `<button class="btn primary" data-now="startnext" data-tip="Today's top task. Shortcut: S">Start</button>` : ''}</div>`; })();
}

/* ---------- shutdown ritual ---------- */
/* Tomorrow: the next working day by the Day view's sprint settings (weekends and holidays skipped). */
function tomorrow(){
  const today = todayStr();
  return nextWorkday(dp.sprint, today) || today;
}
/* Unfinished tasks you touched today: the active one, started ones, and Today's own. */
function unfinishedToday(){
  const d = todayStr(), ids = new Set(F.touchedOn(log, d));
  const a = activeId(); if (a) ids.add(a);
  state.tasks.forEach(t => { if (t.focusOn === d && !t.done) ids.add(t.id); });
  return [...ids].map(findTask).filter(t => t && !t.done).sort((x, y) => x.rank - y.rank);
}
function openShutdown(){
  if (isWaiting()) return;
  const d = todayStr(), n = F.dayCounts(log, d), next = tomorrow();
  const done = state.tasks.filter(isDoneToday);
  const unfinished = unfinishedToday();
  const touched = new Set(F.touchedOn(log, d)), act = activeId();
  const already = new Set(state.tasks.filter(t => !t.done && t.focusOn === next && next !== d).map(t => t.id));
  // Tomorrow's picks: start with anything already set for tomorrow, then today's unfinished, then the top of the list.
  const pool = [...already].map(findTask).filter(Boolean);
  for (const t of unfinished) if (!pool.includes(t)) pool.push(t);
  for (const t of state.tasks.filter(t => !t.done && !t.waiting).sort((a, b) => a.rank - b.rank)) if (pool.length < 12 && !pool.includes(t)) pool.push(t);
  const picked = new Set((already.size ? [...already] : unfinished.map(t => t.id)).slice(0, 3));
  const sec = (num, title, body) => `<section class="sd-sec"><h4><span class="num">${num}</span>${title}</h4>${body}</section>`;
  showModal(`<form class="sheet shutdown" role="dialog" aria-modal="true" aria-label="Wrap up the day"><h3>Wrap up the day</h3>
    <p class="sub">${plural(done.length, 'task')} done · ${switches(n.switches)} · ${plural(n.interrupts, 'interruption')}</p>
    ${sec(1, 'Done today', !done.length ? '<p class="soft">Nothing marked done today.</p>'
      : receiptsHere() ? `<p class="soft">Tick any worth keeping. They wait in Receipts to accept.</p>${done.map(t => receiptRow(t, d)).join('')}`
      : `<ul class="sd-done">${done.map(t => `<li>${esc(t.title)}</li>`).join('')}</ul>`)}
    ${sec(2, 'Where you left off', unfinished.filter(t => touched.has(t.id) || t.id === act).length
      ? `<p class="soft">One line each. Leave any blank.</p>${unfinished.filter(t => touched.has(t.id) || t.id === act).map(t => `<label class="sd-crumb"><span>${esc(t.title)}${t.id === act ? ' <span class="chip acc">active</span>' : ''}</span>
          <input data-crumb="${t.id}" maxlength="${F.CRUMB_LEN}" autocomplete="off" placeholder="${esc((F.lastCrumb(t) || {}).text || 'Next step')}"></label>`).join('')}`
      : '<p class="soft">No unfinished tasks were started today.</p>')}
    ${sec(3, `Tomorrow's top 3 <span class="sd-when">${esc(fmtDay(next))}</span>`, pool.length
      ? `<div class="sd-pick">${pool.map(t => `<label class="chk"><input type="checkbox" data-pick="${t.id}"${picked.has(t.id) ? ' checked' : ''}> <span>${esc(t.title)}</span></label>`).join('')}</div>
        <p class="soft sd-over" hidden>More than 3 picked.</p>`
      : '<p class="soft">Nothing open.</p>')}
    <label class="chk sd-remind"><input type="checkbox" data-remind${prefs.remind ? ' checked' : ''}> Remind me on this device ${REMIND_BEFORE_MIN} minutes before my day ends (${esc(dp.sprint.dayEnd)}, set in Day settings)</label>
    <footer><span class="grow"></span><button type="button" class="btn" data-close>Not yet</button><button class="btn primary">Wrap up</button></footer></form>`,
    f => {
      const over = f.querySelector('.sd-over');
      const count = () => { if (over) over.hidden = f.querySelectorAll('[data-pick]:checked').length <= 3; };
      f.addEventListener('change', e => { if (e.target.dataset.pick !== undefined) count(); });
      count();
      f.addEventListener('submit', e => {
        e.preventDefault();
        const at = nowIso();
        f.querySelectorAll('[data-crumb]').forEach(i => { const t = findTask(i.dataset.crumb); if (t) F.addCrumb(t, i.value, at); });
        const picks = new Set([...f.querySelectorAll('[data-pick]:checked')].map(i => i.dataset.pick));
        // Tomorrow's picks get tomorrow's Today. Today's unpicked leftovers go back to the lists, so tomorrow
        // starts with only what you chose instead of an "unfinished from an earlier day" banner.
        state.tasks.forEach(t => {
          if (t.done) return;
          if (picks.has(t.id)) t.focusOn = next;
          else if (t.focusOn && (t.focusOn === d || t.focusOn === next) && next !== d) t.focusOn = null;
        });
        prefs.remind = f.querySelector('[data-remind]').checked; savePrefs();
        let sent = 0;
        f.querySelectorAll('[data-rcpt]').forEach(c => {
          const id = c.dataset.rcpt, row = c.closest('.sd-rcpt');
          if (c.checked){ if (F.offerReceipt(log, id, d, row.querySelector('[data-rtext]').value, row.querySelector('[data-rkind]').value, at)) sent++; }
          else F.withdrawOffer(log, F.receiptId(id, d));
        });
        F.pruneHandoffs(log, d);
        F.shutdown(log, d, at);
        closeModal();
        save(); commit();
        const r = sent ? ` ${plural(sent, 'receipt')} waiting in Receipts.` : '';
        toast((picks.size ? `Day wrapped. ${plural(picks.size, 'task')} lined up for ${fmtDay(next).toLowerCase()}.` : 'Day wrapped.') + r);
      });
    });
}

/* Receipts lives next to Docket only inside Workshop (same data folder). On its own site there is nothing to send to. */
const receiptsHere = () => embedded;
const KIND_LABEL = {win: 'Win', growth: 'Learned', note: 'Note'};   // Receipts' own labels for receipts about you
function receiptRow(t, d){
  const h = F.receiptOffer(log, t.id, d), kind = h && h.payload ? h.payload.kind : 'win';
  return `<div class="sd-rcpt"><label class="chk"><input type="checkbox" data-rcpt="${t.id}"${h ? ' checked' : ''} aria-label="Keep as a receipt"></label>
    <input data-rtext maxlength="2000" value="${esc(h ? h.text : t.title)}" aria-label="Receipt text">
    <select data-rkind aria-label="Kind">${F.HANDOFF_KINDS.map(k => `<option value="${k}"${k === kind ? ' selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></div>`;
}

/* The wrap-up reminder: once a working day, REMIND_BEFORE_MIN before the Day view's dayEnd, if not wrapped yet. */
function remindTick(){
  if (!prefs.remind || isWaiting()) return;
  const d = todayStr();
  if (prefs.reminded === d || !isWorkday(dp.sprint, d) || F.dayCounts(log, d).wrapped) return;
  const end = toMin(dp.sprint.dayEnd), now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  if (end == null || nowMin < end - REMIND_BEFORE_MIN || nowMin > end + 120) return;
  prefs.reminded = d; savePrefs();
  toast('Time to wrap up the day', 'Wrap up', openShutdown, 60000);
  if (ws && document.hidden) ws.notify({title: 'Time to wrap up', body: 'Breadcrumbs and tomorrow\'s top 3 in Docket.'});
}

/* A backup's focus log, merged in (storage.js calls this after importing the board). */
async function importFocus(bundle){
  if (!fstore) return 0;
  const envs = focusEnvelopesFromBundle(bundle);
  const cols = Object.keys(envs);
  for (const c of cols) await fstore.addCollection(c);
  if (cols.length) await fstore.importEnvelopes(envs);
  return cols.length;
}

export { activeId, activeTask, focusBoot, focusDrawerClick, focusDrawerHtml, focusTaskClosed, fstore, importFocus, isActive, log as focusLog, logInterrupt, openShutdown, pauseTask, renderNow, rowCrumb, startNext, startTask, toggleStart };
