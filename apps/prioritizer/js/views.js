import { wontDo } from './actions.js';
import { EFFORTS, EQ, ICON, LENSES, POINTS, TOUCH, VALUE, VQ, WINDOW } from './constants.js';
import { ageDays, eKey, fmtScore, isStale, nudgeDue, score, vKey } from './model.js';
import { capacityCut, col, doneGroup, emptyHTML, inboxOpen, main, openQuad, render, row, setView, tri, weekOff } from './render.js';
import { commit, findTask, inScope, inboxQueue, initials, isDoneToday, isFocus, listById, orderedLists, rankedOpen, saveUi, scopeListIds, scopeOpen, state, ui } from './state.js';
import { $, addDays, dateStr, esc, fmtDay, fmtMD, isDate, parseD, plural, todayStr } from './util.js';
import { D, cardsFor, getDirectory, mentionOf, nameOf, namesOf, others } from './directory-model.js';
import { dp } from './dayplan.js';
import { currentSection, dayView, fmt12, isWorkday, sectionTasks } from './dayplan-model.js';
import { adoReview } from './ado.js';
/* Prioritizer: The views: Today (three columns: Inbox, Ranked, Today), Done with the weekly recap, People.

   Today is where the day happens. Work moves left to right: triage it in the Inbox, rank it, pick it for Today.
   The Ranked column has three lenses (List, Eisenhower, Value / Effort); the matrices need room, so with one on,
   the Inbox and Today fold into slim rails. Above the columns, Needs you has what is not already a column: new
   ADO items, PRs blocked on you, follow-ups due, and Today tasks not in a block. */

/* ---------- Needs you ---------- */
let need = null;   // which Needs you panel is open: 'prs', 'nudges' or null
function openNeed(k){
  if (k === 'ado') return adoReview();
  if (k === 'plan') return setView('day');
  need = need === k ? null : k;
  render();
}
function closeNeed(){ if (!need) return false; need = null; render(); return true; }
const blockingPr = t => !t.done && t.pr && t.pr.tier === 'blocking' && !t.pr.waiting;
function unplannedToday(){
  const sp = dp.sprint, d = todayStr();
  if (!sp || !sp.anchor || !isWorkday(sp, d)) return 0;
  const rec = dayView(dp, d).rec;
  if (!rec.sections.some(x => !x.lost)) return 0;
  const slotted = new Set(rec.slots.map(x => x.taskId));
  return state.tasks.filter(t => inScope(t) && !t.done && t.focusOn === d && !slotted.has(t.id)).length;
}
function needs(){
  const open = scopeOpen();
  return {
    ado: ui.ado && ui.ado.on ? state.ado.pending.length : 0,
    prs: open.filter(blockingPr),
    nudges: open.filter(nudgeDue),
    plan: unplannedToday()
  };
}
function needsStrip(n){
  const chip = (k, count, label, icon, cls = '') => count ? `<button class="need${cls ? ' ' + cls : ''}${need === k ? ' on' : ''}" data-need="${k}" aria-pressed="${need === k}">${icon}<b class="num">${count}</b><span>${label}</span></button>` : '';
  const html = chip('ado', n.ado, n.ado === 1 ? 'new ADO item' : 'new ADO items', ICON.item)
    + chip('prs', n.prs.length, n.prs.length === 1 ? 'PR blocked on you' : 'PRs blocked on you', ICON.block, 'warn')
    + chip('nudges', n.nudges.length, n.nudges.length === 1 ? 'follow-up due' : 'follow-ups due', ICON.bell, 'acc')
    + chip('plan', n.plan, 'not in a block', ICON.day);
  return html ? `<div class="needs" role="toolbar" aria-label="Needs you"><span class="needs-h">Needs you</span>${html}</div>` : '';
}
function needPanel(n){
  if (!need) return '';
  const list = need === 'prs' ? n.prs : need === 'nudges' ? n.nudges : [];
  if (!list.length){ need = null; return ''; }
  const title = {prs: 'Pull requests blocked on you', nudges: 'Time to follow up'}[need];
  return `<section class="needp" aria-label="${title}"><header><h3>${title}</h3><button class="ibtn" data-need="${need}" aria-label="Close" data-tip="Close">${ICON.x}</button></header>
    <div class="rows">${list.map(t => row(t, {compact: true, showList: true, follow: need === 'nudges'})).join('')}</div></section>`;
}

/* ---------- the Inbox column: triage in place, and work that came back ---------- */
function triageState(){
  const q = inboxQueue();
  const cur = (tri.pick && q.find(t => t.id === tri.pick)) || q.find(t => !tri.seen.has(t.id)) || null;
  return {q, cur};
}
function triageCard(cur, pos, total){
  if (tri.id !== cur.id){
    tri.id = cur.id;
    tri.draft = {title: cur.title, notes: cur.notes || '', listId: cur.listId, value: cur.value, effort: cur.effort, due: cur.due, urgentFlag: cur.urgentFlag, today: cur.focusOn === todayStr(), stale: isStale(cur)};
  }
  const d = tri.draft, age = isDate(cur.ageFrom) ? ageDays(cur) : 0, who = cur.who || [];
  const preview = Object.assign({}, cur, {value: d.value, effort: d.effort, due: d.due, urgentFlag: d.urgentFlag});
  const s = score(preview), ek = eKey(preview), vk = vKey(preview);
  const lists = orderedLists().map(l => `<option value="${esc(l.id)}"${l.id === d.listId ? ' selected' : ''}>${l.parentId ? '  ' : ''}${esc(l.name)}</option>`).join('');
  const opt = (on, attr, key, label, extra = '') => `<button class="opt${on ? ' on' : ''}" ${attr} aria-pressed="${on}"${key ? ` aria-keyshortcuts="${key}"` : ''}>${label}${extra}${key ? `<kbd>${key}</kbd>` : ''}</button>`;
  return `<div class="tri-card" tabindex="-1" aria-live="polite" aria-label="Triage: ${esc(cur.title)}">
    <div class="tri-top"><span class="num">${pos} of ${total}</span>${isDate(cur.cameBack) ? `<span class="chip cb">${ICON.back}Came back</span>` : ''}<span class="grow"></span>
      <select id="triList" class="tri-list" aria-label="List">${lists}</select><span aria-hidden="true">·</span><span>${age}d</span>
      <button class="ibtn" data-tri-open="${esc(cur.id)}" aria-label="Open details" data-tip="Open details">${ICON.dots}</button></div>
    <textarea id="triTitle" class="tri-title" rows="1" data-tf="title" aria-label="Task title" spellcheck="true">${esc(d.title)}</textarea>
    <textarea id="triNotes" class="tri-notes" rows="1" data-tf="notes" aria-label="Notes" placeholder="Add notes">${esc(d.notes)}</textarea>
    ${who.length || cur.waiting ? `<div class="info">${cur.waiting ? '<span class="chip">Waiting</span>' : ''}${who.map(id => `<span class="chip">${esc(mentionOf(id))}</span>`).join('')}</div>` : ''}
    ${d.stale ? `<div class="stale">Stale: ${age} days. Do it, give it a due date, or won't do.</div>` : ''}
    <div class="tri-fields">
      <div class="tfld"><label>Value<kbd>1-4</kbd></label><div class="seg-row">${[1,2,3,4].map(v => opt(d.value === v, `data-tv="${v}"`, '', VALUE[v])).join('')}</div></div>
      <div class="tfld"><label>Effort<kbd>Q-T</kbd></label><div class="seg-row">${EFFORTS.map(e => opt(d.effort === e, `data-te="${e}"`, '', e, `<span class="pts">${POINTS[e]}</span>`)).join('')}</div></div>
      <div class="tfld"><label for="triDue">Due<kbd>D</kbd></label><div class="opts"><input type="date" id="triDue" value="${d.due || ''}">
        ${d.due ? `<button class="lnk" data-tdue-clear>Clear</button>` : `<span class="hint">${d.value && isDate(cur.ageFrom) ? `Rises after ${fmtDay(addDays(cur.ageFrom, WINDOW[d.value]))}` : 'Optional'}</span>`}</div></div>
      <div class="tfld"><label>Flags</label><div class="opts">
        ${opt(d.urgentFlag, 'data-tt="urgentFlag"', 'U', 'Urgent')}${opt(d.today, 'data-tt="today"', 'Space', 'Today')}</div></div>
    </div>
    <div class="tri-score">${s != null ? `<span class="num">${fmtScore(s)}</span> · ` : ''}${ek ? EQ[ek].title : 'Unsorted'}${vk ? ` · ${VQ[vk].title}` : ''}</div>
    <div class="tri-foot">
      <button class="btn ghost text-danger" data-tact="wont">Won't do<kbd>0</kbd></button>
      <button class="btn ghost" data-tact="skip">Skip<kbd>S</kbd></button>
      <span class="grow"></span>
      <button class="btn primary" data-tact="save">Save<kbd>Enter</kbd></button>
    </div>
  </div>`;
}
function inboxCol(rail){
  const {q, cur} = triageState();
  if (!cur){ tri.id = null; tri.draft = null; }
  if (rail) return `<section class="col col-inbox rail" data-col="inbox" aria-label="Inbox"><button class="railbtn" data-lens="rank" data-goto="inbox" data-tip="Inbox: back to List to triage">${ICON.triage}<b class="num">${q.length}</b><span class="rl">Inbox</span></button></section>`;
  const rest = q.filter(t => !cur || t.id !== cur.id);
  const body = cur ? triageCard(cur, q.indexOf(cur) + 1, q.length)
    : q.length ? `<div class="colempty">You skipped ${plural(q.length, 'task')}.<p><button class="btn" data-tri-again>Go through again</button></p></div>`
    : `<div class="colempty"><b>Inbox clear.</b>New tasks and work that comes back land here.</div>`;
  return `<section class="col col-inbox dropzone" data-col="inbox" data-zone="inbox" aria-label="Inbox">
    <header class="colh"><button class="ibtn railx" data-inbox-toggle aria-label="Inbox" data-tip="Inbox">${ICON.triage}</button><h3>Inbox</h3>${q.length ? `<span class="n num">${q.length}</span>` : ''}</header>
    <div class="colbody">${body}${rest.length ? `<div class="rows inrows">${rest.map(t => row(t, {compact: true, back: true, noToday: true})).join('')}</div>` : ''}</div>
  </section>`;
}

/* ---------- the Ranked column ---------- */
function rankHtml(){
  const t0 = todayStr();
  const open = rankedOpen();
  if (!state.tasks.length) return emptyHTML;
  if (!open.length) return `<div class="colempty"><b>Nothing ranked yet.</b>Triage the Inbox, or ${TOUCH ? 'tap +' : 'press N'} to add a task.</div><div class="ranklist rows dropzone" data-zone="rank"></div>`;
  const {cut, sum} = capacityCut(open);
  const over = sum > state.capacity;
  let html = '';
  open.forEach((t, i) => {
    html += row(t, {rank: i + 1, top: i < 3, estimate: true, dim: t.focusOn === t0});
    if (i === cut){
      html += `<div class="capline${over ? ' over' : ''}" role="separator"><span><b class="num">${sum}</b> of <span class="num">${state.capacity}</span> pts this week${i === open.length - 1 ? (over ? '' : '. Room for more.') : ''}</span></div>`;
      if (i < open.length - 1) html += `<div class="belowcap">Not this week</div>`;
    }
  });
  return `<div class="ranklist rows dropzone" data-zone="rank">${html}</div>${TOUCH && open.length > 1 ? '<p class="soft">Press and hold a task to drag it into place.</p>' : ''}`;
}
function matrixHtml(kind){
  const Q = kind === 'eisen' ? EQ : VQ;
  const keyFn = kind === 'eisen' ? (t => eKey(t)) : vKey;
  const ax = kind === 'eisen' ? ['Urgent','Not urgent'] : ['Low effort','High effort'];
  const ay = kind === 'eisen' ? ['Important','Not important'] : ['High value','Low value'];
  const open = scopeOpen();
  const un = open.filter(t => !keyFn(t));
  return `<div class="unsorted dropzone" data-zone="none">${un.length
      ? `<span><b class="num">${un.length}</b> ${un.length === 1 ? 'task needs' : 'tasks need'} ${kind === 'eisen' ? 'a value' : 'a value and effort'}.</span><button class="lnk" data-lens="rank" data-goto="inbox">Triage now</button>`
      : `<span>${TOUCH ? 'Everything is placed. Change a task\'s value or effort in its details to move it.' : 'Everything is placed. Drop a task here to unsort it.'}</span>`}</div>
    <div class="matrix">
      <div class="axis-x"><span>${ax[0]}</span><span>${ax[1]}</span></div>
      <div class="axis-y"><span>${ay[0]}</span><span>${ay[1]}</span></div>
      <div class="grid">${Object.entries(Q).map(([k, q]) => {
        const items = open.filter(t => keyFn(t) === k);
        return `<section class="quad dropzone" data-zone="${k}">
          <header><h3>${q.title}</h3><small>${q.sub}</small>${items.length ? `<span class="qn">${items.length}</span>` : ''}
            <button class="ibtn" data-qadd="${k}" aria-label="Add to ${q.title}" data-tip="Add to ${q.title}">${ICON.plus}</button></header>
          <div class="rows">${openQuad === k ? `<form class="qform" data-qform="${k}"><input placeholder="New task in ${q.title}" aria-label="New task in ${q.title}"></form>` : ''}${items.map(t => row(t, {compact: true})).join('')}${!items.length && openQuad !== k ? `<div class="qhint">${TOUCH ? 'Nothing here' : 'Drop tasks here'}</div>` : ''}</div>
        </section>`;
      }).join('')}</div>
    </div>`;
}
function rankCol(lens){
  const open = rankedOpen().length;
  const tools = lens === 'rank' ? `<label class="cap" data-tip="Weekly capacity in effort points (XS 1, S 2, M 3, L 5, XL 8)">${ICON.gauge}<input type="number" id="capIn" class="mono" min="1" max="999" value="${state.capacity}" aria-label="Weekly capacity in points"></label>
      ${open > 1 ? `<button class="ibtn" data-suggest aria-label="Suggest an order" data-tip="Suggest an order by score (you preview it first)">${ICON.wand}</button>` : ''}` : '';
  return `<section class="col col-rank" data-col="rank" aria-label="Ranked">
    <header class="colh"><h3>Ranked</h3>${open ? `<span class="n num">${open}</span>` : ''}
      <div class="lens" role="tablist" aria-label="Rank by">${Object.entries(LENSES).map(([k, n]) => `<button data-lens="${k}" role="tab" aria-selected="${lens === k}"${lens === k ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
      <span class="grow"></span>${tools}</header>
    <div class="colbody">${lens === 'rank' ? rankHtml() : matrixHtml(lens)}</div>
  </section>`;
}

/* ---------- the Today column ---------- */
/* The Day view's block on now, its tasks and the next block. Plan the day when today has blocks but nothing planned. */
function nowCard(){
  const sp = dp.sprint, d = todayStr();
  if (!sp || !sp.anchor || !isWorkday(sp, d)) return '';
  const rec = dayView(dp, d).rec, open = rec.sections.filter(x => !x.lost);
  if (!open.length) return `<section class="panel nowcard"><header><h3>Now</h3></header><div class="pempty">No blocks today. <button class="lnk" data-view="day">Plan the day</button></div></section>`;
  const now = new Date(), {current, next} = currentSection(rec, now.getHours() * 60 + now.getMinutes());
  if (!current && !next) return '';
  const byId = new Map(state.tasks.map(t => [t.id, t]));
  const tasks = current ? sectionTasks(rec, current.id, byId).map(x => x.task) : [];
  const planned = rec.slots.length > 0;
  const head = current ? `<b>${esc(current.name)}</b>${current.around ? `<span class="mut">${esc(fmt12(current.around))}</span>` : ''}` : '<b>Nothing on now</b>';
  return `<section class="panel nowcard"><header><h3 data-tip="The Day view's block on now">Now</h3><button class="lnk" data-view="day">${planned ? 'Open Day' : 'Plan the day'}</button></header>
    <div class="nowb" role="button" tabindex="0" data-view="day">${head}</div>
    ${current ? (tasks.length ? `<div class="rows">${tasks.map(t => row(t, {compact: true, noScore: true})).join('')}</div>` : `<div class="pempty">Nothing planned in this block.</div>`) : ''}
    ${next ? `<div class="nownext"><span class="mut">Next</span> ${esc(next.name)}${next.around ? ` <span class="mut">${esc(fmt12(next.around))}</span>` : ''}</div>` : ''}
  </section>`;
}
/* What you wait on, grouped by the first person on each task, follow-ups due first. */
function waitingGroups(waiting){
  const groups = new Map();
  for (const t of waiting){ const k = (t.who && t.who[0]) || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const due = ts => ts.filter(nudgeDue).length, first = ts => ts.map(t => t.nudgeOn || '9').sort()[0];
  return [...groups].sort(([, a], [, b]) => due(b) - due(a) || first(a).localeCompare(first(b)))
    .map(([id, ts]) => `<div class="wgrp"><div class="sub">${id ? esc(nameOf(id)) : 'No one named'}${due(ts) ? ` <span class="sig acc txt" role="img" aria-label="${plural(due(ts), 'nudge')} due">${ICON.bell}<b>${due(ts)}</b></span>` : ''}</div>
      <div class="rows">${ts.map(t => row(t, {compact: true, follow: true, skipPerson: id, noToday: true})).join('')}</div></div>`).join('');
}
function todayCol(rail){
  const t0 = todayStr();
  const focus = state.tasks.filter(t => inScope(t) && isFocus(t)).sort((a,b) => a.rank - b.rank);
  const open = focus.filter(t => !t.done), done = focus.filter(t => t.done);
  if (rail) return `<section class="col col-today rail dropzone" data-col="today" data-zone="todayrail" aria-label="Today"><button class="railbtn" data-lens="rank" data-tip="Today: drop a task here to add it, or click to go back to List">${ICON.sun}<b class="num">${open.length}</b><span class="rl">Today</span></button></section>`;
  const left = state.tasks.filter(t => inScope(t) && !t.done && t.focusOn && t.focusOn < t0);
  const waiting = scopeOpen().filter(t => t.waiting).sort((a,b) => (nudgeDue(b) - nudgeDue(a)) || (a.nudgeOn || '9').localeCompare(b.nudgeOn || '9') || a.rank - b.rank);
  const nudges = waiting.filter(nudgeDue).length;
  return `<section class="col col-today" data-col="today" aria-label="Today">
    <header class="colh"><h3>Today</h3>${focus.length ? `<span class="n"><span class="num">${done.length}</span> of <span class="num">${focus.length}</span> done</span>` : ''}</header>
    <div class="colbody">
      ${left.length ? `<div class="banner carry"><span class="ctext">${ICON.stale}<b>${left.length}</b> left from before</span>
        <button class="ibtn" data-left="clear" aria-label="Send back to their lists" data-tip="Send back to their lists">${ICON.x}</button><button class="btn primary" data-left="carry" data-tip="${plural(left.length, 'unfinished task')} from an earlier day. Keep them on Today.">${ICON.sun}<span>Keep</span></button></div>` : ''}
      ${nowCard()}
      ${focus.length ? `<div class="progress"><i style="width:${Math.round(done.length / focus.length * 100)}%"></i></div>` : ''}
      <div class="ranklist rows dropzone" data-zone="today">${open.map((t,i) => row(t, {rank: i + 1, top: i < 3, start: true, crumb: true})).join('')
        || (done.length ? '' : `<div class="focus-empty"><b>What matters today?</b><span class="hint-ic">${TOUCH ? `${ICON.sun} 3 to 5 from Ranked` : `Drag 3 to 5 from Ranked, or ${ICON.sun} / T`}</span>${state.tasks.length ? '' : '<div class="acts"><button class="btn primary" data-add>Add a task</button><button class="btn" data-tour>Take the tour</button></div>'}</div>`)}</div>
      ${open.length > 5 ? `<p class="soft">${open.length} tasks on Today. Keep it to 3 to 5.</p>` : ''}
      ${doneGroup(done)}
      <section class="panel waitp">
        <header><h3>Waiting on others</h3>${waiting.length ? `<span class="n">${waiting.length}</span>` : ''}${nudges ? `<span class="sig acc txt" style="margin-left:auto" role="img" aria-label="${plural(nudges, 'nudge')} due" data-tip="${plural(nudges, 'nudge')} due">${ICON.bell}<b>${nudges}</b></span>` : ''}</header>
        ${waiting.length ? waitingGroups(waiting) : `<div class="pempty">Nothing handed over. ${TOUCH ? 'Tap a task\'s person button' : 'Press A on a task'} to delegate it.</div>`}
      </section>
    </div>
  </section>`;
}

function renderToday(){
  const wide = state.lens === 'rank', n = needs();
  main.innerHTML = `${needsStrip(n)}${needPanel(n)}<div class="t3wrap"><div class="today3${wide ? '' : ' lensed'}${inboxOpen ? ' inbox-open' : ''}">${inboxCol(!wide)}${rankCol(state.lens)}${todayCol(!wide)}</div></div>`;
  main.querySelectorAll('.col').forEach(c => c.classList.toggle('colon', c.dataset.col === col));
  fitTriage();
  if (openQuad){ const i = main.querySelector('.qform input'); if (i) i.focus(); }
}

// Title and notes grow with their text (field-sizing where the browser has it, scrollHeight otherwise).
function fitTriage(){
  for (const id of ['triTitle', 'triNotes']){
    const el = $('#' + id); if (!el || CSS.supports('field-sizing', 'content')) continue;
    el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';
  }
}
function triageSave(){
  const t = findTask(tri.id), d = tri.draft; if (!t || !d) return;
  const title = String(d.title || '').replace(/\s+/g, ' ').trim();
  if (title) t.title = title;
  t.notes = String(d.notes || '').trim();
  if (d.listId && listById(d.listId)) t.listId = d.listId;
  t.value = d.value; t.effort = d.effort; t.due = d.due || null; t.urgentFlag = !!d.urgentFlag;
  if (d.today) t.focusOn = todayStr(); else if (t.focusOn === todayStr()) t.focusOn = null;
  // kept after triage: restart the aging clock, so a task you just placed doesn't come straight back as stale
  if (d.stale || isStale(t)) t.ageFrom = todayStr();
  delete t.cameBack;   // came back and now placed: handled
  tri.seen.add(t.id); tri.id = null; tri.pick = null;
  commit();
}
function triageSkip(){ if (!tri.id) return; tri.seen.add(tri.id); tri.id = null; tri.pick = null; render(); }
function triageWont(){ if (!tri.id) return; const id = tri.id; tri.seen.add(id); tri.id = null; tri.pick = null; wontDo(id); }
function triageKey(e){
  if (!tri.draft) return false;
  const d = tri.draft, k = e.key;
  if (/^[1-4]$/.test(k)){ d.value = +k; }
  else if ('qwert'.includes(k.toLowerCase()) && k.length === 1){ d.effort = EFFORTS['qwert'.indexOf(k.toLowerCase())]; }
  else if (k === 'd' || k === 'D'){ e.preventDefault(); const i = $('#triDue'); if (i){ i.focus(); try { i.showPicker && i.showPicker(); } catch(_) {} } return true; }
  else if (k === 'u' || k === 'U'){ d.urgentFlag = !d.urgentFlag; }
  else if (k === ' '){ d.today = !d.today; }
  else if (k === '0'){ e.preventDefault(); triageWont(); return true; }
  else if (k === 'Enter'){ e.preventDefault(); triageSave(); return true; }
  else if (k === 's' || k === 'S'){ triageSkip(); return true; }
  else return false;
  e.preventDefault();
  render();
  return true;
}

// Everyone else in Workshop's people directory: one click adds a task for them.
function fromWorkshop(tasks){
  const more = others(tasks);
  return more.length ? `<div class="from-dir"><span class="sub">Add a task for</span>${more.map(it => `<button class="chip" data-dir-person="${esc(it.id)}" data-tip="${esc(it.name)}">${ICON.plus}@${esc(it.handle)}</button>`).join('')}</div>` : '';
}
/* People view: delegation review. A tray of unassigned tasks on the left (drag one onto a person, or select it and
   press A, to delegate it), and a card per person or group with something open (and your team). Cards with
   follow-ups due come first. A person's card also lists what is assigned to a group they are in, under that
   group, so "what is waiting on Sam" includes @leadership. */
let trayQ = '';
const TRAY_MAX = 60;
function trayTasks(){
  const q = trayQ.trim().toLowerCase();
  return scopeOpen().filter(t => !(t.who || []).length && (!q || t.title.toLowerCase().includes(q)));
}
function trayRows(){
  const ts = trayTasks();
  return ts.slice(0, TRAY_MAX).map(t => row(t, {compact: true, noScore: true, noToday: true, assignOn: true})).join('')
    + (ts.length > TRAY_MAX ? `<div class="pempty">${ts.length - TRAY_MAX} more. Filter to find one.</div>` : '')
    || `<div class="pempty">${trayQ ? 'Nothing matches.' : 'Everything open has someone on it.'}</div>`;
}
function setTrayQ(v){
  trayQ = v;
  const el = main.querySelector('.ptray .rows'); if (el) el.innerHTML = trayRows();
}
const peopleFilter = () => ui.peopleFilter === 'team' ? 'team' : 'all';
function setPeopleFilter(v){ ui.peopleFilter = v === 'team' ? 'team' : 'all'; saveUi(); render(); }
function renderPeople(){
  const dir = getDirectory();
  const live = state.tasks.filter(t => inScope(t) && (!t.done || isDoneToday(t)));
  const team = peopleFilter() === 'team';
  const onTeam = it => it.kind === 'person' ? D.onTeam(it) : D.membersOf(dir, it.id).some(m => D.onTeam(m));
  const byRank = (a, b) => a.rank - b.rank;
  const byFollow = (a, b) => (a.nudgeOn || '9').localeCompare(b.nudgeOn || '9') || a.rank - b.rank;
  const cards = cardsFor(live).filter(it => !team || onTeam(it)).map((it, i) => {
    const p = it.id;
    const direct = live.filter(t => t.who.includes(p)).sort(byRank);
    const viaGroups = it.kind === 'person' ? D.groupsOf(dir, p).map(g => [g, live.filter(t => !t.who.includes(p) && t.who.includes(g.id)).sort(byRank)]).filter(([, ts]) => ts.length) : [];
    const all = [...direct, ...viaGroups.flatMap(([, ts]) => ts)];
    const wait = direct.filter(t => t.waiting && !t.done).sort(byFollow), rest = direct.filter(t => !(t.waiting && !t.done));
    const nud = all.filter(t => !t.done && t.waiting && nudgeDue(t)).length;
    const first = wait.length ? wait[0].nudgeOn || '9' : '9';
    return {it, i, direct, viaGroups, all, wait, rest, nud, first, load: wait.reduce((n, t) => n + (POINTS[t.effort] || 0), 0)};
  }).sort((a, b) => b.nud - a.nud || a.first.localeCompare(b.first) || a.i - b.i);
  const tray = `<aside class="panel ptray dropzone" data-zone="untray">
      <header><h3 data-tip="Open tasks with no one on them">Unassigned</h3><span class="n">${trayTasks().length || ''}</span></header>
      <input type="search" id="ptrayQ" class="ptray-q" placeholder="Filter" aria-label="Filter unassigned tasks" value="${esc(trayQ)}" autocomplete="off">
      <div class="rows">${trayRows()}</div>
      <p class="soft">${TOUCH ? 'Tap a task\'s person button to delegate it.' : 'Drag a task onto a person, or select it and press A, to delegate it.'}</p>
    </aside>`;
  const cardHtml = ({it, direct, viaGroups, all, wait, rest, nud, load}) => {
    const p = it.id;
    const open = all.filter(t => !t.done).length;
    const rows = (list, o = {}) => `<div class="rows">${list.map(t => row(t, {compact: true, skipPerson: p, noScore: true, ...o})).join('')}</div>`;
    const members = it.kind === 'group' ? D.membersOf(dir, p).map(m => esc(m.name)).join(', ') : '';
    return `<section class="pcard dropzone" data-zone="person" data-person="${esc(p)}">
      <header><span class="avatar">${it.kind === 'group' ? ICON.people : esc(initials(it.name))}</span><span class="pname" data-tip="@${esc(it.handle)}. Double-click to rename">${esc(it.name)}</span>${open ? `<span class="n">${open} open</span>` : ''}${load ? `<span class="n" data-tip="Effort points you handed them that are still open">${load} pts</span>` : ''}${nud ? `<span class="sig acc txt" role="img" aria-label="${plural(nud, 'nudge')} due" data-tip="${plural(nud, 'nudge')} due">${ICON.bell}<b>${nud}</b></span>` : ''}
        <span class="ibtn" data-pmenu="${esc(p)}" role="button" tabindex="0" aria-label="Options for ${esc(it.name)}">${ICON.dots}</span></header>
      ${it.kind === 'group' ? `<div class="pmembers">${members || 'No members yet'}</div>` : ''}
      ${wait.length ? `<div class="sub">Waiting on them</div>${rows(wait, {follow: true})}` : ''}
      ${rest.length ? `<div class="sub" data-tip="Your 1:1 agenda with them">${wait.length ? 'To discuss or do' : 'Open'}</div>${rows(rest)}` : ''}
      ${viaGroups.map(([g, ts]) => `<div class="sub">Through @${esc(g.handle)}</div>${rows(ts, {follow: true})}`).join('')}
      ${all.length ? '' : `<div class="pempty">Nothing open here. ${TOUCH ? 'Tap a task\'s person button' : 'Drag a task from Unassigned'}, or add one below.</div>`}
      <form class="pform" data-person="${esc(p)}" autocomplete="off"><input placeholder="Add for ${esc(it.name)}" aria-label="Add a task for ${esc(it.name)}"></form>
    </section>`;
  };
  const body = cards.length ? `<div class="people">${cards.map(cardHtml).join('')}</div>`
    : `<div class="empty"><b>${team ? 'No one on your team has anything open.' : 'No people yet.'}</b>${team ? 'Switch to Everyone, or delegate a task from Unassigned.' : `Type @name in any task, like "Review design doc @teammate", or ${TOUCH ? 'tap' : 'click'} Person. Groups like @leadership are set up in Workshop's People app.`}</div>`;
  main.innerHTML = `<div class="pview">${tray}<div class="pmain">${body}${fromWorkshop(live)}</div></div>`;
}

/* archive + weekly recap */
function weekRange(off){
  const s = new Date(); s.setHours(0,0,0,0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7) + off * 7); // Monday
  const e = new Date(s); e.setDate(e.getDate() + 6);
  return [s, e];
}
function recapData(){
  const [s, e] = weekRange(weekOff), a = dateStr(s), b = dateStr(e), ids = scopeListIds();
  const done = state.tasks.filter(t => t.done && !t.wontDo && t.doneAt && t.doneAt >= a && t.doneAt <= b && ids.includes(t.listId));
  const byList = new Map();
  orderedLists().forEach(L => {
    const ts = done.filter(t => t.listId === L.id).sort((x,y) => (x.doneAt || '').localeCompare(y.doneAt || '') || x.rank - y.rank);
    if (ts.length) byList.set(L, ts);
  });
  // quadrant as of the day it was finished
  const quads = [...Object.keys(EQ), 'none'].map(k => [k, done.filter(t => (eKey(t, t.doneAt || undefined) || 'none') === k).length]);
  const waiting = state.tasks.filter(t => t.waiting && !t.done && ids.includes(t.listId)).sort((x,y) => x.rank - y.rank);
  return {s, e, done, byList, quads, waiting};
}
function recapInsight(r){
  const n = r.done.length; if (n < 3) return '';
  const q = Object.fromEntries(r.quads);
  if (q.do / n >= 0.5) return 'Mostly Do first this week: reactive work. Move more into Schedule.';
  if (q.schedule && q.schedule >= q.do) return 'More Schedule than Do first: mostly planned work.';
  return '';
}
function recapText(r){
  const withP = t => t.who.length ? ` (${namesOf(t.who).join(', ')})` : '';
  const out = [`Week of ${fmtMD(r.s)} to ${fmtMD(r.e)}: ${plural(r.done.length,'task')} done`];
  const split = r.quads.filter(x => x[1]).map(([k, c]) => `${k === 'none' ? 'Unsorted' : EQ[k].title} ${c}`).join(', ');
  if (split) out.push(`Split: ${split}`);
  r.byList.forEach((ts, L) => { out.push('', L.name); ts.forEach(t => out.push(`- ${t.title}${withP(t)}`)); });
  if (r.waiting.length){ out.push('', 'Waiting on'); r.waiting.forEach(t => out.push(`- ${t.title}${withP(t)}`)); }
  return out.join('\n');
}
function copyText(text){
  const ok = () => toast('Recap copied');
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(ok, () => fallback());
  fallback();
  function fallback(){
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch(e){ toast("Couldn't copy to the clipboard."); }
    ta.remove();
  }
}
function dayLabel(d){
  if (!d) return 'Earlier';
  if (d === todayStr()) return 'Today';
  if (d === addDays(todayStr(), -1)) return 'Yesterday';
  const o = {weekday: 'short', month: 'short', day: 'numeric'};
  if (parseD(d).getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return parseD(d).toLocaleDateString(undefined, o);
}
function renderArchive(){
  const ids = scopeListIds();
  const all = state.tasks.filter(t => t.done && ids.includes(t.listId)).sort((a,b) => (b.doneAt || '').localeCompare(a.doneAt || '') || a.rank - b.rank);
  const done = all.filter(t => !t.wontDo), wont = all.filter(t => t.wontDo);
  const r = recapData(), n = r.done.length;
  const when = weekOff === 0 ? 'This week' : weekOff === -1 ? 'Last week' : '';
  const split = n ? `<div class="split"><div class="splitbar" role="img" aria-label="Quadrant split">${r.quads.filter(x => x[1]).map(([k, c]) => `<i class="q-${k}" style="flex:${c}"></i>`).join('')}</div>
      <div class="legend">${r.quads.filter(x => x[1]).map(([k, c]) => `<span><i class="q-${k}"></i>${k === 'none' ? 'Unsorted' : EQ[k].title} <span class="num">${c}</span> (${Math.round(c / n * 100)}%)</span>`).join('')}</div>
      ${recapInsight(r) ? `<p class="insight">${recapInsight(r)}</p>` : ''}</div>` : '';
  const recap = `<section class="recap">
    <header><h3>Weekly recap</h3><span class="count">${when ? `${when} · ` : ''}${fmtMD(r.s)} to ${fmtMD(r.e)}</span>
      <div class="wknav"><button class="ibtn" data-week="-1" aria-label="Previous week" data-tip="Previous week">${ICON.chevL}</button><button class="ibtn" data-week="1" aria-label="Next week"${weekOff >= 0 ? ' disabled' : ' data-tip="Next week"'}>${ICON.chevR}</button></div></header>
    <div class="big">${n}<small>${n === 1 ? 'task' : 'tasks'} done</small></div>
    ${split}
    ${n ? `<div class="recap-lists">${[...r.byList].map(([L, ts]) => `<div><h4>${esc(L.name)}</h4><ul>${ts.map(t => `<li>${esc(t.title)}</li>`).join('')}</ul></div>`).join('')}</div>`
      : `<p class="soft">Nothing finished ${weekOff === 0 ? 'yet this week' : 'that week'}.</p>`}
    <footer><button class="btn primary" data-copy-recap${n || r.waiting.length ? '' : ' disabled'}>Copy recap</button>
      ${r.waiting.length ? `<span class="soft">Also lists ${plural(r.waiting.length,'task')} you're waiting on</span>` : ''}</footer>
  </section>`;
  if (!all.length){
    main.innerHTML = `<div class="archive">${recap}<div class="empty"><b>Nothing done yet.</b>Finished tasks stay in "Done today", then move here.</div></div>`;
    return;
  }
  const groups = new Map();
  done.forEach(t => { const k = t.doneAt || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  main.innerHTML = `<div class="archive">${recap}
    <div class="arch-head"><h3>Completed</h3><span class="count num">${done.length}</span><button class="btn" data-clear-archive>Clear</button></div>
    ${[...groups].map(([d, ts]) => `<div class="day"><h4>${dayLabel(d)}</h4><div class="rows">${ts.map(t => row(t, {compact: true, showList: true})).join('')}</div></div>`).join('')}
    ${wont.length ? `<div class="arch-head" style="margin-top:1.6rem"><h3>Won't do</h3><span class="count num">${wont.length}</span></div>
      <p class="soft" style="margin:0 0 .5rem">Decided against. Not counted as done.</p>
      <div class="rows">${wont.map(t => row(t, {compact: true, showList: true})).join('')}</div>` : ''}
  </div>`;
}

export { closeNeed, openNeed, peopleFilter, setPeopleFilter, setTrayQ, fitTriage, copyText, dayLabel, recapData, recapText, renderArchive, renderPeople, renderToday, triageKey, triageSave, triageSkip, triageWont };
