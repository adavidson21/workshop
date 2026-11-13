import { quickSort, toggleFocus, wontDo } from './actions.js';
import { delegateTo, handoffChoices } from './delegate.js';
import { openDrawer } from './drawer.js';
import { EFFORTS, PRI, PRI_ORDER, VALUE } from './constants.js';
import { closeModal, showModal } from './overlays.js';
import { commit, findTask, initials, inboxQueue, listById } from './state.js';
import { esc, fmtDay, todayStr } from './util.js';
/* Docket: Card sort (was Sort one by one, Docket 9.1.0). To sort with 10 or more tasks was slow row by row, so this sheet shows one
   task at a time, big, with every answer a single key: 1 (High) to 4 (Trivial) sets how much it matters (effort M unless you pick
   another first, with [ and ] or a click), T puts it on Today, A hands it off, 0 is won't do, Space or S skips. Each answer
   moves to the next task; Backspace goes back to the one before (its answer can be changed). The sheet walks the
   tasks that were in To sort when it opened, so nothing new jumps in mid-run. */

let run = null;   // {ids, i, did: {id: text}, effort: {id: 'M'}, hand: false, q: ''}

function openSortRun(){
  const ids = inboxQueue().map(t => t.id);
  if (!ids.length) return false;
  run = {ids, i: 0, did: {}, effort: {}, hand: false, q: ''};
  draw();
  return true;
}
const cur = () => run && findTask(run.ids[run.i]);

function source(t){
  if (t.cameBack) return 'Came back to you';
  if (t.pr) return `Pull request ${t.pr.id}`;
  if (t.ado) return `From ADO, ${t.ado.type || 'work item'} ${t.ado.id}`;
  return t.createdAt ? `Added ${fmtDay(t.createdAt)}` : '';
}

const peopleHtml = t => handoffChoices(t, run.q).map((it, i) => `<button class="chip" data-srto="${esc(it.id)}"><i class="av" aria-hidden="true">${esc(initials(it.name))}</i>${esc(it.name)}${i < 9 && !run.q ? ` <kbd>${i + 1}</kbd>` : ''}</button>`).join('')
  || '<span class="soft">No one matches. Type a name, or add people on the People page.</span>';

function body(t){
  const n = run.ids.length, done = Object.keys(run.did).length;
  const eff = run.effort[t.id] || t.effort || 'M';
  const L = listById(t.listId);
  const meta = [source(t), L && L.name, t.due ? `Due ${fmtDay(t.due)}` : ''].filter(Boolean);
  const was = run.did[t.id];
  const hand = run.hand ? `<div class="sr-hand"><input type="text" id="srQ" placeholder="Hand off to: name, @handle or @group" aria-label="Hand off to" autocomplete="off" value="${esc(run.q)}">
      <div class="sr-people" role="group" aria-label="People and groups">${peopleHtml(t)}</div></div>` : '';
  return `<div class="sr-top"><span class="sr-count"><b class="num">${run.i + 1}</b> of ${n}</span><div class="sr-bar" aria-hidden="true"><i style="width:${Math.round(done / n * 100)}%"></i></div>
      <button class="ibtn" data-close aria-label="Close">×</button></div>
    <div class="sr-task">
      ${meta.length ? `<p class="sr-meta">${meta.map(esc).join(', ')}</p>` : ''}
      <h3 id="srTitle">${esc(t.title)}</h3>
      ${t.notes ? `<p class="sr-notes">${esc(t.notes.slice(0, 220))}${t.notes.length > 220 ? '…' : ''}</p>` : ''}
      ${was ? `<p class="sr-was">${esc(was)}. Answer again to change it.</p>` : ''}
    </div>
    <div class="sr-group"><span class="lbl">How much it matters</span><div class="sr-keys">${PRI_ORDER.map(v => `<button class="sr-k${t.value === v && was ? ' on' : ''}" data-srv="${v}"><kbd>${PRI(v)}</kbd>${VALUE[v]}</button>`).join('')}</div></div>
    <div class="sr-group"><span class="lbl">How big</span><div class="seg sr-eff">${EFFORTS.map(e => `<button class="${e === eff ? 'on' : ''}" data-sre="${e}" aria-pressed="${e === eff}">${e}</button>`).join('')}</div><span class="soft sr-ekeys"><kbd>[</kbd> <kbd>]</kbd> smaller, bigger</span></div>
    <div class="sr-group"><span class="lbl">Or</span><div class="sr-keys">
      <button class="sr-k" data-sra="today"><kbd>T</kbd>On Today</button>
      <button class="sr-k${run.hand ? ' on' : ''}" data-sra="hand"><kbd>A</kbd>Hand off</button>
      <button class="sr-k" data-sra="wont"><kbd>0</kbd>Won't do</button>
      <button class="sr-k" data-sra="skip"><kbd>S</kbd>Skip</button></div></div>
    ${hand}
    <div class="sr-foot"><button class="btn small" data-sra="back"${run.i ? '' : ' disabled'}><kbd>⌫</kbd> Back</button><button class="btn small" data-sra="open">Open details</button>
      <span class="soft">Esc to stop. Everything you sorted stays sorted.</span></div>`;
}

function finish(){
  const n = Object.keys(run.did).length;
  run = null;
  const left = inboxQueue().length;
  document.querySelector('#modal .sheet').innerHTML = `<div class="sr-done"><h3>${n ? 'All sorted.' : 'Nothing sorted.'}</h3><p>${n} ${n === 1 ? 'task' : 'tasks'} sorted${left ? `, ${left} still to sort` : ''}.</p><button class="btn primary" data-close>Done</button></div>`;
  document.querySelector('#modal [data-close].btn').focus();
}

function draw(){
  const t = cur();
  if (!t){ return next(); }
  const html = `<div class="sheet sortrun" role="dialog" aria-modal="true" aria-labelledby="srTitle">${body(t)}</div>`;
  const sh = document.querySelector('#modal .sheet.sortrun');
  if (sh){ sh.innerHTML = body(t); focusIn(sh); return; }
  showModal(html, el => { el.addEventListener('click', onClick); el.addEventListener('keydown', onKey); el.addEventListener('input', onInput); focusIn(el); });
}
function focusIn(sh){
  const q = sh.querySelector('#srQ');
  (q || sh).focus();
  if (!q) sh.setAttribute('tabindex', '-1');
}
function next(){
  if (!run) return;
  run.hand = false; run.q = '';
  let i = run.i + 1;
  while (i < run.ids.length && !findTask(run.ids[i])) i++;
  if (i >= run.ids.length) return finish();
  run.i = i; draw();
}
function back(){
  if (!run || !run.i) return;
  run.hand = false; run.q = ''; run.i--; draw();
}

/* The answers. Each records what it did, so going back shows it. */
function setValue(t, v){
  const e = run.effort[t.id];
  quickSort(t.id, v);
  if (e && t.effort !== e){ t.effort = e; commit(); }
  run.did[t.id] = `Sorted: ${VALUE[v]}, ${t.effort}`;
  next();
}
function act(t, a){
  if (a === 'today'){ if (t.focusOn !== todayStr()) toggleFocus(t.id); run.did[t.id] = 'On Today'; return next(); }
  if (a === 'wont'){ wontDo(t.id); run.did[t.id] = "Won't do"; return next(); }
  if (a === 'skip') return next();
  if (a === 'back') return back();
  if (a === 'hand'){ run.hand = !run.hand; run.q = ''; return draw(); }
  if (a === 'open'){ const id = t.id; run = null; closeModal(); openDrawer(id); }
}
function handTo(t, id){
  delegateTo(t, [id], true);
  run.did[t.id] = 'Handed off';
  next();
}

function onClick(e){
  if (!run) return;
  if (e.target.closest('[data-close]')){ run = null; return; }   // the page closes the sheet
  const t = cur(); if (!t) return;
  const v = e.target.closest('[data-srv]'); if (v) return setValue(t, +v.dataset.srv);
  const ef = e.target.closest('[data-sre]'); if (ef){ run.effort[t.id] = ef.dataset.sre; return draw(); }
  const a = e.target.closest('[data-sra]'); if (a) return act(t, a.dataset.sra);
  const p = e.target.closest('[data-srto]'); if (p) return handTo(t, p.dataset.srto);
}
function onInput(e){
  if (!run || e.target.id !== 'srQ') return;
  run.q = e.target.value;
  const list = document.querySelector('#modal .sr-people');
  if (list) list.innerHTML = peopleHtml(cur());
}
function onKey(e){
  if (!run) return;
  const sh = e.currentTarget, t = cur(); if (!t) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const inQ = e.target.id === 'srQ';
  if (inQ){
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); run.hand = false; run.q = ''; return draw(); }
    if (e.key === 'Enter'){ e.preventDefault(); const first = handoffChoices(t, run.q)[0]; if (first) handTo(t, first.id); }
    return;
  }
  if (e.key === 'Escape'){ run = null; return; }   // the page closes the sheet
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (run.hand && /^[1-9]$/.test(k)){ const it = handoffChoices(t, '')[+k - 1]; if (it){ e.preventDefault(); handTo(t, it.id); } return; }
  if (/^[1-4]$/.test(k)){ e.preventDefault(); return setValue(t, PRI(+k)); }
  if (k === '[' || k === ']'){
    e.preventDefault();
    const i = EFFORTS.indexOf(run.effort[t.id] || t.effort || 'M');
    run.effort[t.id] = EFFORTS[Math.max(0, Math.min(EFFORTS.length - 1, i + (k === ']' ? 1 : -1)))];
    return draw();
  }
  const map = {t: 'today', a: 'hand', 0: 'wont', s: 'skip', ' ': 'skip', Backspace: 'back', ArrowLeft: 'back', ArrowRight: 'skip'};
  if (map[k]){ e.preventDefault(); return act(t, map[k]); }
  if (k === 'Enter' && e.target === sh){ e.preventDefault(); act(t, 'open'); }
}

const sortRunOpen = () => !!run;
export { openSortRun, sortRunOpen };
