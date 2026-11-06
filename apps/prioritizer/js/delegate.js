/* Docket: delegating, on screen. The Assign picker (A on a task, the person button on a row, Assign in its
   details), waiting on and off (W), Nudged and Got it back on waiting tasks, Copy hand-off, and the one-time
   follow-up date for waiting tasks that have none. The rules are in delegate-model.js. Nothing here writes to
   ADO or sends anything: delegating is local, and the hand-off text goes to your clipboard. */
import * as M from './delegate-model.js';
import { ICON, initials } from './constants.js';
import { D, getDirectory, mentionOf, nameOf, namesOf } from './directory-model.js';
import { assign } from './directory.js';
import { dp } from './dayplan.js';
import { closeMenu, popMenu, toast } from './overlays.js';
import { commit, findTask, isWaiting, state } from './state.js';
import { esc, fmtDay, todayStr } from './util.js';

/** The follow-up date for something delegated today: the setting's working days out. */
const followDays = () => (state.follow && state.follow.days) || M.FOLLOW_DEFAULT;
function followDate(from = todayStr()){
  return M.addWorkdays(from, followDays(), dp && dp.sprint);
}
const mentions = t => (t.who || []).map(id => mentionOf(id)).join(', ');
const who = t => namesOf(t.who || []).join(', ');

function undoToast(msg, t, before, more = []){
  toast(msg, [...more, ['Undo', () => { const cur = findTask(t.id); if (cur){ M.restore(cur, before); commit(); } }]]);
}

/** Put people on a task. waiting: hand it over (wait on them, follow up). Returns nothing; commits. */
function delegateTo(t, tokens, waiting = true){
  if (!t || t.done) return;
  const before = M.snapshot(t);
  assign(t, tokens, {add: true});
  if (waiting) M.delegate(t, followDate());
  commit();
  const names = namesOf(tokens.filter(x => D.isRef(x))).join(', ') || tokens.map(x => String(x).replace(/^@/, '')).join(', ');
  if (waiting) undoToast(`Delegated to ${names}. Follow up ${fmtDay(t.nudgeOn)}`, t, before, [['Just involve them', () => { const c = findTask(t.id); if (c){ c.waiting = false; c.nudgeOn = null; commit(); } }]]);
  else undoToast(`Added ${names}`, t, before);
}

/** Dropped on a person's card from the People view's Unassigned tray: delegated to them. */
function dropDelegate(t, id){ delegateTo(t, [id], true); }

/** W: waiting on and off. Turning it on fills the follow-up date. */
function toggleWaiting(id){
  const t = findTask(id); if (!t || t.done) return;
  const before = M.snapshot(t);
  if (t.waiting){ t.waiting = false; t.nudgeOn = null; commit(); undoToast('Not waiting any more', t, before); return; }
  M.delegate(t, followDate());
  commit();
  undoToast(`Waiting${t.who.length ? ' on ' + who(t) : ''}. Follow up ${fmtDay(t.nudgeOn)}`, t, before);
}

function nudgedTask(id){
  const t = findTask(id); if (!t || t.done || !t.waiting) return;
  const before = M.snapshot(t), crumbs = t.crumbs ? t.crumbs.slice() : null;
  M.nudged(t, followDate(), new Date().toISOString(), mentions(t));
  commit();
  toast(`Nudged. Next follow-up ${fmtDay(t.nudgeOn)}`, 'Undo', () => {
    const c = findTask(id); if (!c) return;
    M.restore(c, before); if (crumbs) c.crumbs = crumbs; else delete c.crumbs; commit();
  });
}

function gotBackTask(id){
  const t = findTask(id); if (!t || t.done || !t.waiting) return;
  const before = M.snapshot(t);
  M.gotBack(t, todayStr());
  commit();
  undoToast('Back on your list', t, before, [['Add to Today', () => { const c = findTask(id); if (c && !c.done){ c.focusOn = todayStr(); delete c.cameBack; commit(); } }]]);
}

function dismissBack(id){
  const t = findTask(id); if (!t || !t.cameBack) return;
  const was = t.cameBack;
  delete t.cameBack; commit();
  toast('Dismissed', 'Undo', () => { const c = findTask(id); if (c && !c.done){ c.cameBack = was; commit(); } });
}

/** Copy hand-off: the task as text for chat, on the clipboard. */
function copyHandoff(t){
  if (!t) return;
  const text = M.handoffText(t, namesOf(t.who || []), d => fmtDay(d));
  const ok = () => toast('Hand-off copied. Paste it into chat.');
  const fallback = () => {
    const ta = Object.assign(document.createElement('textarea'), {value: text});
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { toast("Couldn't copy to the clipboard."); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
  else fallback();
}

/** Once per board: waiting tasks without a follow-up date get one, so nothing delegated sits forever. */
function fillFollowUps(){
  if (isWaiting() || state.follow.filled) return 0;
  const n = M.fillFollowUps(state.tasks, followDate());
  state.follow.filled = todayStr();
  commit();
  if (n) toast(`${n === 1 ? '1 waiting task' : n + ' waiting tasks'} now ${n === 1 ? 'has a follow-up date' : 'have follow-up dates'}, ${fmtDay(followDate())}.`);
  return n;
}

/* ---------- the Assign picker ---------- */
let pick = null;   // {id, query, waiting}
function counts(){
  const m = new Map();
  for (const t of state.tasks) for (const id of t.who || []) m.set(id, (m.get(id) || 0) + 1);
  return m;
}
function matches(t, q){
  const dir = getDirectory();
  return M.pickerOrder(D.active(dir, {self: false}), t.who, it => it.kind === 'person' && D.onTeam(it), counts(), q);
}
function listHtml(t){
  const q = pick.query.trim().replace(/^[>@]+/, '');
  const items = matches(t, q).slice(0, 12), on = new Set(t.who || []);
  const exact = q && items.some(it => it.name.toLowerCase() === q.toLowerCase() || it.handle.toLowerCase() === q.toLowerCase());
  return items.map((it, i) => `<button class="apk${on.has(it.id) ? ' on' : ''}" data-pick="${esc(it.id)}" role="menuitemcheckbox" aria-checked="${on.has(it.id)}">`
      + `<i class="av" aria-hidden="true">${it.kind === 'group' ? ICON.people : esc(initials(it.name))}</i><span class="nm">${esc(it.name)}<span class="mut"> @${esc(it.handle)}</span></span>`
      + (i < 9 && !q ? `<kbd>${i + 1}</kbd>` : on.has(it.id) ? `<span class="mut">on</span>` : '') + `</button>`).join('')
    + (q && !exact ? `<button data-pick-new="${esc(q)}">${ICON.plus} Add “${esc(q)}” as a contact</button>` : '')
    + (!items.length && !q ? '<div class="mnote">No one in People yet. Type a name to add a contact.</div>' : '');
}
function pickerHtml(t){
  const days = followDays();
  return `<div class="apick-body"><div class="mnote apick-h"><b>${esc(t.title)}</b></div>
    <div class="apick-in"><input type="text" id="apickQ" placeholder="Name, @handle or @group" aria-label="Find a person or group" autocomplete="off" value="${esc(pick.query)}"></div>
    <label class="apick-w"><input type="checkbox" id="apickW"${pick.waiting ? ' checked' : ''}> Waiting on them, follow up <select id="apickD" aria-label="Follow up after">${M.FOLLOW_CHOICES.map(n => `<option value="${n}"${n === days ? ' selected' : ''}>in ${n} working day${n === 1 ? '' : 's'}</option>`).join('')}</select></label>
    <div class="apick-list" role="group" aria-label="People and groups">${listHtml(t)}</div>
    <div class="sep"></div>
    <button data-pick-copy>Copy hand-off</button>${t.who.length ? '<button data-pick-clear class="danger">Take everyone off</button>' : ''}</div>`;
}
/** Opens the picker for a task, under `anchor` (its row's person button, or the row). */
function openAssign(id, anchor){
  const t = findTask(id); if (!t || t.done || isWaiting()) return;
  pick = {id, query: '', waiting: true};
  const at = anchor || document.querySelector(`main .row[data-id="${CSS.escape(id)}"]`) || document.querySelector('#main');
  const m = popMenu(pickerHtml(t), at, 'right');
  m.classList.add('apick');
  const q = m.querySelector('#apickQ'); q.focus();
  const refresh = () => { const cur = findTask(id); if (cur) m.querySelector('.apick-list').innerHTML = listHtml(cur); };
  const choose = btn => {
    const cur = findTask(id); if (!cur) return closeMenu(true);
    const waiting = m.querySelector('#apickW').checked;
    if (btn.dataset.pickNew){ closeMenu(true); return delegateTo(cur, [btn.dataset.pickNew], waiting); }
    const pid = btn.dataset.pick;
    if ((cur.who || []).includes(pid)){
      const before = M.snapshot(cur);
      cur.who = cur.who.filter(x => x !== pid);
      if (!cur.who.length && cur.waiting){ cur.waiting = false; cur.nudgeOn = null; }
      commit(); refresh();
      undoToast(`Took ${nameOf(pid)} off`, cur, before);
      return;
    }
    closeMenu(true);
    delegateTo(cur, [pid], waiting);
  };
  q.addEventListener('input', () => { pick.query = q.value; refresh(); });
  m.addEventListener('change', e => {
    if (e.target.id === 'apickW') pick.waiting = e.target.checked;
    if (e.target.id === 'apickD'){ state.follow.days = +e.target.value; commit(); }
  });
  m.addEventListener('keydown', e => {
    if (e.target === q && e.key === 'Enter'){
      e.preventDefault(); e.stopPropagation();
      const first = m.querySelector('.apick-list [data-pick],.apick-list [data-pick-new]'); if (first) choose(first);
      return;
    }
    if (e.target !== q && /^[1-9]$/.test(e.key) && !e.target.matches('select')){
      const b = m.querySelectorAll('.apick-list [data-pick]')[+e.key - 1];
      if (b){ e.preventDefault(); e.stopPropagation(); choose(b); }
    }
  });
  // Digits while the box is empty pick from the list too (the box has focus when the picker opens).
  q.addEventListener('keydown', e => {
    if (!q.value && /^[1-9]$/.test(e.key)){
      const b = m.querySelectorAll('.apick-list [data-pick]')[+e.key - 1];
      if (b){ e.preventDefault(); e.stopPropagation(); choose(b); }
    }
  });
  m.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pick || b.dataset.pickNew) return choose(b);
    const cur = findTask(id); if (!cur) return;
    if ('pickCopy' in b.dataset){ closeMenu(true); return copyHandoff(cur); }
    if ('pickClear' in b.dataset){
      const before = M.snapshot(cur);
      cur.who = []; cur.waiting = false; cur.nudgeOn = null; closeMenu(true); commit();
      undoToast('Took everyone off', cur, before);
    }
  });
}

export { copyHandoff, delegateTo, dismissBack, dropDelegate, fillFollowUps, followDate, gotBackTask, nudgedTask, openAssign, toggleWaiting };
