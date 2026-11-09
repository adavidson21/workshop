/* Docket: focus. The task you are working on, re-entry breadcrumbs, the switch counter, and the shutdown ritual.
   The day's activity log (focus-model.js) is its own small board, saved through the same write loop as the board
   (store.js) as the focus/days/<yyyy> collections (focus-format.js). Breadcrumbs are saved on the task.

   Everything is local: nothing watches other apps or the computer. A switch is counted only when you start a
   task while another unfinished one is active, and an interruption only when you log one. */
import { focusNow } from './focus-hours.js';
import { askLeftOff } from './left-off.js';
import * as F from './focus-model.js';
import { focusEnvelopesFromBundle, focusFormat } from './focus-format.js';
import { createStore } from './store.js';
import { commit, findTask, isDoneToday, isFocus, isWaiting, state } from './state.js';
import { $, esc, fmtDay, plural, todayStr } from './util.js';
import { closeModal, showModal, toast } from './overlays.js';
import { dp } from './dayplan.js';
import { isWorkday, nextWorkday, toMin } from './dayplan-model.js';
import { embedded, ready, ws } from './ws.js';
import { ICON } from './constants.js';

const PREFS_KEY = 'prioritizer.focus';   // this device only: the wrap-up reminder
const REMIND_BEFORE_MIN = 30;
let log = F.freshLog(), fstore = null;
let onChange = () => {};

let prefs = {remind: false, reminded: null, wrapNote: true};
try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) {}
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} };

const switches = n => `${n} switch${n === 1 ? '' : 'es'}`;
let notesOn = false;
const notesHere = () => embedded && notesOn;
const nowIso = () => new Date().toISOString();
const isOpen = id => { const t = findTask(id); return !!t && !t.done; };

/* Called once by storage.js after the board loaded. */
async function focusBoot(wsh, {render, status}){
  onChange = render;
  // Notes on this site: Wrap up can write into today's note (only inside Workshop, where both share a folder).
  if (embedded && wsh.apps) wsh.apps.list().then(a => { notesOn = a.some(x => x.id === 'notes'); }).catch(() => {});
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
  setInterval(nowTick, 30000);
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
  // With focus hours on, the Today column asks inline (left-off.js); otherwise the breadcrumb sheet, as before.
  if (left && !(focusNow().enabled && askLeftOff(left, 'You switched tasks'))) askCrumb(left, 'You switched tasks. Where did you leave off?');
}
/* From Docket, Pause asks for a breadcrumb here. From the shell's top bar the shell already asked: `text` is
   what was typed (or undefined if skipped), and nothing opens inside Docket, which may be hidden. */
function pauseTask(fromShell = false, text){
  const id = F.stopActive(log, todayStr(), nowIso(), 'pause');
  if (!id) return;
  if (fromShell){ const t = findTask(id); if (t && text && F.addCrumb(t, text, nowIso())) commit(); save(); return; }
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
  if (shellOn && ws && !shownHere()) { ws.toast('Interruption logged'); return; }
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

/* ---------- the focus band (top of the page, on every view, only while a task is running) ---------- */
/* Idle, it is hidden: Start next is the play button in Today's header, and S anywhere. Running, it sits above the
   page header so the one task you are on, how long it has been running, and Pause are always in reach. */
const LONG_RUN_MIN = 90;     // the timer turns amber past this: a hint to pause if you stepped away
const AWAY_MIN = 20;         // back after this long with the page hidden: ask whether you are still on it
const BASE_TITLE = document.title;
let hiddenAt = null;

function runMinutes(){
  const since = F.activeSince(log, todayStr());
  return since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000)) : 0;
}
const fmtRun = m => m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

function renderNow(){
  const el = $('#nowbar'); if (!el) return;
  const d = todayStr(), t = activeTask(), n = F.dayCounts(log, d);
  document.body.classList.toggle('focusing', !!t && !isWaiting());
  shellStatus(isWaiting() ? null : t);
  if (isWaiting() || !t){ el.hidden = true; el.innerHTML = ''; setTitle(null); return; }
  const c = F.lastCrumb(t), m = runMinutes();
  // Counts show once there is something to count; zeros are noise. Icon and number; the words are in the label.
  const words = [n.switches ? switches(n.switches) : '', n.interrupts ? plural(n.interrupts, 'interruption') : ''].filter(Boolean).join(' · ');
  const counts = words ? `<span class="ncount" role="img" aria-label="${words}" data-tip="Today: ${words}. Counted only from what you start and log here.">`
    + (n.switches ? `<span>${ICON.swap}${n.switches}</span>` : '') + (n.interrupts ? `<span>${ICON.bolt}${n.interrupts}</span>` : '') + '</span>' : '';
  const ib = (act, icon, tip, cls = '') => `<button class="hbtn sm${cls ? ' ' + cls : ''}" data-now="${act}" aria-label="${tip.split('.')[0]}" data-tip="${tip}">${icon}</button>`;
  el.hidden = false;
  el.innerHTML = `<div class="nmain"><div class="nline"><span class="dotlive" aria-hidden="true"></span><span class="nlabel">Focus</span>
        <button class="ntitle" data-now="open" data-tip="Open the task">${esc(t.title)}</button>
        <span class="ntime${m >= LONG_RUN_MIN ? ' long' : ''}" data-tip="${m >= LONG_RUN_MIN ? 'Running a while. Pause if you stepped away.' : 'Time on this task since you started it'}">${fmtRun(m)}</span></div>
      ${c ? `<div class="ncrumb" data-tip="Your last breadcrumb, ${esc(crumbAge(c.at))}">${esc(c.text)}</div>` : ''}</div>
    <div class="nact">${counts}${ib('crumb', ICON.crumb, 'Leave a breadcrumb')}${ib('interrupt', ICON.bolt, 'Interrupted. Something pulled you away. Shortcut: I')}
      <button class="btn npause" data-now="pause" data-tip="Pause and leave a breadcrumb. Shortcut: S">${ICON.pause}<span>Pause</span></button>${ib('done', ICON.check20, 'Done', 'primary')}</div>`;
  setTitle(t, m);
}
/* The browser tab says what you are on, so a running task is visible even from another tab. */
function setTitle(t, m){
  if (embedded) return;   // inside Workshop the shell owns the title
  document.title = t ? `● ${fmtRun(m)} ${t.title} · ${BASE_TITLE}` : BASE_TITLE;
}
/* Inside Workshop the running task lives in the shell's top bar instead (ws.status), on every app, and Docket's
   own band hides. An older shell without it rejects the call, and the band stays. */
let shellOn = false, shellSent = '';
function shellStatus(t){
  if (!embedded) return;
  const c = t && F.lastCrumb(t);
  const st = t ? {text: t.title, detail: c ? c.text : '', since: F.activeSince(log, todayStr()) || undefined, route: `task/${t.id}`,
    actions: [
      {label: 'Leave a breadcrumb', command: 'focus-crumb', icon: 'note', prompt: {title: 'Leave a breadcrumb', placeholder: 'Next step', maxLength: F.CRUMB_LEN, skip: false}},
      {label: 'Interrupted', command: 'focus-interrupt', icon: 'bolt'},
      {label: 'Pause', command: 'focus-pause', icon: 'pause', prompt: {title: 'Where did you leave off?', placeholder: c ? c.text : 'Next step', maxLength: F.CRUMB_LEN}},
      {label: 'Done', command: 'focus-done', icon: 'done', primary: true}
    ]} : null;
  const key = JSON.stringify(st);
  if (key === shellSent) return;
  shellSent = key;
  ready.then(w => {
    if (!w || key !== shellSent) return;
    (st ? w.status.set(st) : w.status.clear()).then(() => { if (!shellOn){ shellOn = true; document.body.classList.add('shellfocus'); } }, () => {});
  });
}
/* The top bar's buttons arrive as commands (main.js routes focus-done, which needs actions.js). */
function focusCommand(id, text){
  const t = activeTask();
  if (id === 'focus-pause') pauseTask(true, text);
  if (id === 'focus-interrupt') logInterrupt();
  if (id === 'focus-crumb' && t && text && F.addCrumb(t, text, nowIso())){ commit(); toastHere('Breadcrumb saved'); }
}
/* Inside Workshop, is Docket the app on screen? A hidden pane gives its frame no size. */
const shownHere = () => !embedded || document.documentElement.clientWidth > 0;
/* A toast where the user can see it: the shell's when Docket is hidden inside Workshop, else Docket's own. */
function toastHere(msg){
  if (shellOn && ws && !shownHere()) ws.toast(msg); else toast(msg);
}
/* Every 30 seconds: refresh the timer without a full render. */
function nowTick(){
  const t = activeTask(), el = $('#nowbar .ntime');
  if (!t || !el) return;
  const m = runMinutes();
  el.textContent = fmtRun(m);
  if (m >= LONG_RUN_MIN && !el.classList.contains('long')){ el.classList.add('long'); el.dataset.tip = 'Running a while. Pause if you stepped away.'; }
  setTitle(t, m);
}
/* Back after a while away: still on it? One tap pauses (and asks for the breadcrumb). */
function awayCheck(){
  if (document.hidden){ hiddenAt = Date.now(); return; }
  const was = hiddenAt; hiddenAt = null;
  const t = activeTask();
  if (!was || !t || isWaiting() || Date.now() - was < AWAY_MIN * 60000) return;
  if (shellOn && ws && !shownHere()) ws.toast(`Still on "${t.title}"?`, {action: {label: 'Pause', command: 'focus-pause'}});
  else toast(`Still on "${t.title}"?`, 'Pause', () => pauseTask(), 15000);
}
document.addEventListener('visibilitychange', awayCheck);

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
    ${notesHere() ? `<label class="chk sd-remind"><input type="checkbox" data-wrapnote${prefs.wrapNote !== false ? ' checked' : ''}> Add a wrap-up to today's note in Notes</label>` : ''}
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
        prefs.remind = f.querySelector('[data-remind]').checked;
        const wn = f.querySelector('[data-wrapnote]');
        let noted = false;
        if (wn){
          prefs.wrapNote = wn.checked;
          if (wn.checked){
            const crumbs = new Map([...f.querySelectorAll('[data-crumb]')].map(i => [i.dataset.crumb, i.value]));
            const leftOff = unfinished.filter(t => crumbs.has(t.id)).map(t => ({title: t.title, crumb: crumbs.get(t.id)}));
            const tomorrowTitles = pool.filter(t => picks.has(t.id)).map(t => t.title);
            noted = !!F.offerWrapNote(log, d, F.wrapLines({done: done.map(t => t.title), leftOff, tomorrow: tomorrowTitles, counts: n}), at);
          } else F.withdrawWrapNote(log, d);
        }
        savePrefs();
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
        const msg = (picks.size ? `Day wrapped. ${plural(picks.size, 'task')} lined up for ${fmtDay(next).toLowerCase()}.` : 'Day wrapped.') + r;
        if (noted && ws) toast(msg, "Open today's note", () => ws.open({app: 'notes', path: 'today'}).catch(() => {}), 8000);
        else toast(msg);
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

export { activeId, activeTask, askCrumb, focusCommand, nextTask, focusBoot, focusDrawerClick, focusDrawerHtml, focusTaskClosed, fstore, importFocus, isActive, log as focusLog, logInterrupt, openShutdown, pauseTask, renderNow, rowCrumb, startNext, startTask, toggleStart };
