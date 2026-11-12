import { quickSort, wontDo } from './actions.js';
import { EFFORTS, EQ, ICON, LENSES, POINTS, TOUCH, VALUE, VQ, WINDOW } from './constants.js';
import { ageDays, eKey, fmtScore, isStale, nudgeDue, score, vKey } from './model.js';
import { capacityCut, col, doneGroup, emptyHTML, inboxOpen, main, openQuad, planWeek, render, row, setView, weekOff } from './render.js';
import { commit, findTask, inScope, inboxQueue, initials, isDoneToday, isFocus, listById, orderedLists, rankedOpen, saveUi, scopeListIds, scopeOpen, state, ui } from './state.js';
import { $, addDays, dateStr, esc, fmtDay, fmtMD, isDate, parseD, plural, todayStr } from './util.js';
import { D, cardsFor, getDirectory, mentionOf, nameOf, namesOf, others } from './directory-model.js';
import { dp, dpChange } from './dayplan.js';
import { carryCandidates, carryOver, carryPending, currentSection, dayReady, dayView, dismissCarry, fmt12, isWorkday, sectionTasks, toMin } from './dayplan-model.js';
import { adoReview } from './ado.js';
import { fmtUntil, focusNow, heldUntil } from './focus-hours.js';
import { leftOffPanel } from './left-off.js';
/* Prioritizer: The views: Today (Inbox, Up next and Today), Done with the weekly recap, People.

   Today is where the day happens (Docket 7.0.0, Workshop claude/today-home-simplify-v1-plan.md). Work moves left to
   right: sort it in the Inbox, pick from Up next, do it on Today. Today is the widest column: its tasks are grouped
   under the day's blocks when there is a Day plan, PRs blocked on you are pinned on top, and what you wait on is at
   the bottom. Up next is the top of the ranking; Plan week opens the full Ranked list with its lenses and capacity,
   and the Inbox and Today step aside as rails. There is no Needs you strip: every item has a column. */

/* ---------- old Needs you links ---------- */
// data-need links from older pages and the ADO row: new ADO items open their review, the rest is Today itself.
function openNeed(k){
  if (k === 'ado') return adoReview();
  if (k === 'plan') return setView('day');
  render();
}
const closeNeed = () => false;
const blockingPr = t => !t.done && t.pr && t.pr.tier === 'blocking' && !t.pr.waiting;
const UP_NEXT = 5;

/* ---------- the Inbox column: one key per task; a click or Enter opens the task in the drawer ---------- */
/* During focus and lunch the Inbox folds to a rail with its count and when it comes back (focus hours, Workshop
   docs/focus.md). Captures still land in it, and a task dropped on the rail goes to the Inbox. "Open it anyway"
   lasts until the block ends. */
let inboxAnyway = '';
function heldInbox(){ const f = focusNow(); return (f.state === 'focus' || f.state === 'lunch') && inboxAnyway !== (f.span && f.span.key); }
function openInboxAnyway(){ const f = focusNow(); inboxAnyway = f.span ? f.span.key : ''; render(); }
const adoNew = () => ui.ado && ui.ado.on ? state.ado.pending.length : 0;
// New work items from ADO, waiting to be added or skipped: one row at the top of the Inbox (held during focus).
const adoRow = n => n ? `<button class="adorow" data-need="ado">${ICON.item}<span><b class="num">${n}</b> new from Azure DevOps</span><span class="lnk">Review</span></button>` : '';
// The short line for a narrow window, where the Inbox is a bar above the columns.
function inboxBar(q){
  const back = q.filter(t => isDate(t.cameBack)).length, n = adoNew();
  if (!q.length && !n) return '';
  if (heldInbox()) return `<div class="inbar held" role="status">${ICON.triage}<span>To sort <b class="num">${q.length}</b>, held until ${esc(fmtUntil(heldUntil()))}</span><button class="lnk" data-inbox-anyway>Open anyway</button></div>`;
  return `<button class="inbar" data-inbox-toggle aria-expanded="${inboxOpen}">${ICON.triage}<span>To sort <b class="num">${q.length}</b>${back ? ` · ${back} came back` : ''}${n ? ` · ${n} new from ADO` : ''}</span><span class="lnk">Sort</span></button>`;
}
function inboxCol(rail){
  const q = inboxQueue();
  const held = heldInbox();
  if (!rail && held) return `<section class="col col-inbox rail held dropzone" data-col="inbox" data-zone="inbox" aria-label="To sort, held until ${esc(fmtUntil(heldUntil()))}"><button class="railbtn" data-inbox-anyway data-tip="To sort: held until ${esc(fmtUntil(heldUntil()))}. Click to open it anyway.">${ICON.triage}<b class="num">${q.length}</b><span class="rl">until ${esc(fmtUntil(heldUntil()))}</span></button></section>`;
  if (rail) return `<section class="col col-inbox rail dropzone" data-col="inbox" data-zone="inbox" aria-label="To sort"><button class="railbtn" data-planweek="off" data-goto="inbox" data-tip="To sort: leave Week to sort it">${ICON.triage}<b class="num">${q.length}</b><span class="rl">To sort</span></button></section>`;
  const rows = q.map(t => row(t, {compact: true, back: true, sort: true})).join('');
  const hint = q.length && !TOUCH ? `<p class="soft inhint"><kbd>1</kbd>-<kbd>4</kbd> sort by value, <kbd>T</kbd> Today, <kbd>A</kbd> hand off, <kbd>0</kbd> won't do, <kbd>Enter</kbd> details</p>` : '';
  return `<section class="col col-inbox dropzone" data-col="inbox" data-zone="inbox" aria-label="To sort">
    <header class="colh"><h3>To sort</h3>${q.length ? `<span class="n num">${q.length}</span>` : ''}${q.length > 1 ? `<button class="lnk colh-act" data-sortrun data-tip="One task at a time, one key each. Shortcut: O">Sort one by one</button>` : ''}</header>
    <div class="colbody">${adoRow(held ? 0 : adoNew())}${q.length ? `<div class="rows inrows">${rows}</div>${hint}` : `<div class="colempty"><b>All sorted.</b>New tasks and work that comes back land here.</div>`}</div>
  </section>`;
}

/* ---------- Up next, and Plan week's Ranked column ---------- */
let staleOnly = false;
const toggleStaleOnly = () => { staleOnly = !staleOnly; render(); };
function rankHtml(){
  const t0 = todayStr();
  let open = rankedOpen();
  if (!state.tasks.length) return emptyHTML;
  if (!open.length) return `<div class="colempty"><b>Nothing ranked yet.</b>Sort what's new, or ${TOUCH ? 'tap +' : 'press N'} to add a task.</div><div class="ranklist rows dropzone" data-zone="rank"></div>`;
  if (staleOnly){
    open = open.filter(isStale);
    return `<div class="ranklist rows">${open.map(t => row(t, {estimate: true, dim: t.focusOn === t0})).join('') || '<div class="colempty">Nothing stale.</div>'}</div>`;
  }
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
      ? `<span><b class="num">${un.length}</b> ${un.length === 1 ? 'task needs' : 'tasks need'} ${kind === 'eisen' ? 'a value' : 'a value and effort'}.</span><button class="lnk" data-planweek="off" data-goto="inbox">Sort now</button>`
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
// PR reviews that don't block you: one line at the end of Up next, open to see them. Pending ones are also placed
// into Day plan blocks by their group (ado.js), so they show on Today when their block comes.
let reviewsOpen = false;
const setReviewsOpen = v => { reviewsOpen = !!v; };
function reviewsLine(){
  const t0 = todayStr();
  const prs = scopeOpen().filter(t => t.pr && !blockingPr(t) && t.focusOn !== t0);
  if (!prs.length) return '';
  return `<details class="revline" id="revLine"${reviewsOpen ? ' open' : ''}><summary>${ICON.tri}Reviews <span class="num">${prs.length}</span></summary>
    <div class="rows">${prs.map(t => row(t, {compact: true, lean: true})).join('')}</div></details>`;
}
function upNextHtml(){
  const t0 = todayStr();
  const all = rankedOpen(), open = all.filter(t => t.focusOn !== t0);
  if (!state.tasks.length) return emptyHTML;
  const top = open.slice(0, UP_NEXT);
  const list = top.length ? top.map((t, i) => row(t, {rank: i + 1, lean: true})).join('')
    : `<div class="colempty"><b>Nothing up next.</b>${all.length ? 'Everything ranked is on Today.' : 'Sort what\'s new, or add a task.'}</div>`;
  return `<div class="ranklist rows dropzone" data-zone="rank">${list}</div>
    ${all.length > top.length ? `<button class="lnk showall" data-planweek="on">Show all ${all.length}</button>` : ''}${reviewsLine()}`;
}
function rankCol(plan, lens){
  if (!plan){
    return `<section class="col col-rank upnext" data-col="rank" aria-label="Up next">
      <header class="colh"><h3>Up next</h3><span class="grow"></span>
        <button class="btn ghost small" data-planweek="on" data-tip="The full ranking with its lenses and weekly capacity. Shortcut: 4">${ICON.prio}<span>Plan the week</span></button></header>
      <div class="colbody">${upNextHtml()}</div>
    </section>`;
  }
  const open = rankedOpen(), stale = open.filter(isStale).length;
  const tools = lens === 'rank' ? `${stale ? `<button class="chipbtn${staleOnly ? ' on' : ''}" data-staleonly aria-pressed="${staleOnly}" data-tip="Tasks untouched for twice their value's window">${ICON.stale}Stale <b class="num">${stale}</b></button>` : ''}
      <label class="cap" data-tip="Weekly capacity in effort points (XS 1, S 2, M 3, L 5, XL 8)">${ICON.gauge}<input type="number" id="capIn" class="mono" min="1" max="999" value="${state.capacity}" aria-label="Weekly capacity in points"></label>
      ${open.length > 1 ? `<button class="ibtn" data-suggest aria-label="Suggest an order" data-tip="Suggest an order by score (you preview it first)">${ICON.wand}</button>` : ''}` : '';
  return `<section class="col col-rank" data-col="rank" aria-label="Week: Ranked">
    <header class="colh"><h3>Everything open</h3>${open.length ? `<span class="n num">${open.length}</span>` : ''}
      <div class="lens" role="tablist" aria-label="Rank by">${Object.entries(LENSES).map(([k, n]) => `<button data-lens="${k}" role="tab" aria-selected="${lens === k}"${lens === k ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
      <span class="grow"></span>${tools}<button class="btn primary small" data-planweek="off" data-tip="Back to Today. Shortcut: 4">Done planning</button></header>
    <div class="colbody">${lens === 'rank' ? rankHtml() : matrixHtml(lens)}</div>
  </section>`;
}

/* ---------- the Today column: Reviews, the day's blocks, not scheduled, waiting ---------- */
/* Today's Day plan, when there is one: its open blocks in order, which is on now, and which are past. */
function todayPlan(){
  const sp = dp.sprint, d = todayStr();
  if (!dayReady(sp) || !isWorkday(sp, d)) return null;
  const rec = dayView(dp, d).rec, secs = rec.sections.filter(x => !x.lost);
  if (!secs.length) return null;
  const now = new Date(), {current, next} = currentSection(rec, now.getHours() * 60 + now.getMinutes());
  const at = current ? secs.indexOf(current) : next ? secs.indexOf(next) : secs.some(x => x.around) ? secs.length : 0;
  return {rec, secs, current, past: new Set(secs.slice(0, Math.max(0, at)).map(x => x.id))};
}
/* What you wait on, grouped by the first person on each task, follow-ups due first. */
function waitingGroups(waiting){
  const groups = new Map();
  for (const t of waiting){ const k = (t.who && t.who[0]) || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const due = ts => ts.filter(nudgeDue).length, first = ts => ts.map(t => t.nudgeOn || '9').sort()[0];
  return [...groups].sort(([, a], [, b]) => due(b) - due(a) || first(a).localeCompare(first(b)))
    .map(([id, ts]) => `<div class="wgrp"><div class="sub">${id ? esc(nameOf(id)) : 'No one named'}${due(ts) ? ` <span class="sig acc txt" role="img" aria-label="${plural(due(ts), 'follow-up')} due">${ICON.bell}<b>${due(ts)}</b></span>` : ''}</div>
      <div class="rows">${ts.map(t => row(t, {compact: true, follow: true, skipPerson: id, noToday: true})).join('')}</div></div>`).join('');
}
/* Unfinished tasks from an earlier day: on the Today list before today, and (with a Day plan) in the last working
   day's blocks. Keep puts them on Today and, when they were in a block, into today's block of the same kind. */
function leftOver(){
  const t0 = todayStr();
  const ids = new Set(state.tasks.filter(t => inScope(t) && !t.done && t.focusOn && t.focusOn < t0).map(t => t.id));
  const byId = new Map(state.tasks.map(t => [t.id, t]));
  const plan = dayReady(dp.sprint) && isWorkday(dp.sprint, t0) && carryPending(dp, t0, byId);
  if (plan) for (const x of carryCandidates(dp, t0, byId).items){ const t = byId.get(x.taskId); if (t && inScope(t) && t.focusOn !== t0) ids.add(x.taskId); }
  return {ids: [...ids], plan};
}
function carryLeft(keep){
  const t0 = todayStr(), {ids, plan} = leftOver();
  if (plan) dpChange([t0], () => keep ? carryOver(dp, t0, 'sections', new Map(state.tasks.map(t => [t.id, t]))) : dismissCarry(dp, t0));
  for (const id of ids){ const t = findTask(id); if (!t) continue; if (keep) t.focusOn = t0; else if (t.focusOn && t.focusOn < t0) t.focusOn = null; }
  commit();
}
function blockGroup(s, tasks, {now, past}){
  const open = tasks.filter(t => !t.done), done = tasks.length - open.length;
  const fold = past && !open.length;
  const time = s.around ? `<span class="tbt num">${esc(fmt12(s.around))}</span>` : '';
  return `<section class="tblk${now ? ' now' : ''}${fold ? ' fold' : ''}" data-color="${esc(s.color || '')}" aria-label="${esc(s.name)}${now ? ', now' : ''}">
    <header class="tblk-h">${time}<b>${esc(s.name)}</b>${now ? '<span class="chip acc">Now</span>' : ''}${tasks.length ? `<span class="tbn num">${done}/${tasks.length}</span>` : ''}</header>
    ${fold ? '' : `<div class="rows dropzone tblk-rows" data-zone="tsec" data-sec="${esc(s.id)}">${open.map(t => row(t, {start: true, crumb: true})).join('') || `<div class="tblk-empty">${TOUCH ? 'Nothing here' : 'Drop a task here to plan it now'}</div>`}</div>`}
  </section>`;
}
function todayCol(rail){
  const t0 = todayStr();
  const focus = state.tasks.filter(t => inScope(t) && isFocus(t)).sort((a,b) => a.rank - b.rank);
  const reviews = scopeOpen().filter(blockingPr);
  const work = focus.filter(t => !blockingPr(t));
  const open = work.filter(t => !t.done), done = focus.filter(t => t.done);
  if (rail) return `<section class="col col-today rail dropzone" data-col="today" data-zone="todayrail" aria-label="Today"><button class="railbtn" data-planweek="off" data-tip="Today: drop a task here to add it, or click to go back to Today">${ICON.sun}<b class="num">${open.length}</b><span class="rl">Today</span></button></section>`;
  const left = leftOver().ids;
  const waiting = scopeOpen().filter(t => t.waiting).sort((a,b) => (nudgeDue(b) - nudgeDue(a)) || (a.nudgeOn || '9').localeCompare(b.nudgeOn || '9') || a.rank - b.rank);
  const nudges = waiting.filter(nudgeDue).length;
  // Reviews: PRs blocked on you, pinned on top every day. During lunch they fold to one line (nothing breaks through lunch).
  const lunch = focusNow().state === 'lunch';
  const revs = !reviews.length ? '' : lunch
    ? `<section class="treviews held"><header class="tblk-h"><b>Reviews</b><span class="soft">${plural(reviews.length, 'PR')} blocked on you, held until ${esc(fmtUntil(heldUntil()))}</span></header></section>`
    : `<section class="treviews" aria-label="Pull requests blocked on you"><header class="tblk-h">${ICON.block}<b>Reviews</b><span class="tbn">${plural(reviews.length, 'PR')} blocked on you</span></header>
      <div class="rows">${reviews.map(t => row(t, {compact: true, noToday: true})).join('')}</div></section>`;
  // The day's blocks, when there is a Day plan; tasks on Today with no block are Not scheduled, by rank.
  const plan = todayPlan();
  let body = '';
  if (plan){
    const byId = new Map(state.tasks.map(t => [t.id, t])), inBlock = new Set();
    for (const s of plan.secs){
      const tasks = sectionTasks(plan.rec, s.id, byId).map(x => x.task).filter(t => inScope(t) && !blockingPr(t) && (!t.done || isDoneToday(t)));
      tasks.forEach(t => inBlock.add(t.id));
      body += blockGroup(s, tasks, {now: plan.current && plan.current.id === s.id, past: plan.past.has(s.id)});
    }
    const loose = open.filter(t => !inBlock.has(t.id));
    body += `<section class="tblk loose"><header class="tblk-h"><b>Not scheduled</b>${loose.length ? `<span class="tbn num">${loose.length}</span>` : ''}<span class="grow"></span><button class="lnk" data-view="day">Plan the day</button></header>
      <div class="ranklist rows dropzone" data-zone="today">${loose.map(t => row(t, {start: true, crumb: true})).join('') || `<div class="tblk-empty">${TOUCH ? 'Nothing here' : 'Drag from Up next to add to Today'}</div>`}</div></section>`;
  } else {
    body = `<div class="ranklist rows dropzone" data-zone="today">${open.map((t,i) => row(t, {rank: i + 1, top: i < 3, start: true, crumb: true})).join('')
      || (done.length ? '' : `<div class="focus-empty"><b>What matters today?</b><span class="hint-ic">${TOUCH ? `${ICON.sun} 3 to 5 from Up next` : `Drag 3 to 5 from Up next, or ${ICON.sun} / T`}</span>${state.tasks.length ? '' : '<div class="acts"><button class="btn primary" data-add>Add a task</button><button class="btn" data-tour>Take the tour</button></div>'}</div>`)}</div>`;
  }
  const count = work.filter(t => !t.pr), cdone = count.filter(t => t.done).length;
  // Its left edge resizes it (Docket 9.1.0; events.js todayGrip), saved per browser in ui.todayW.
  return `<section class="col col-today" data-col="today" aria-label="Today"><div class="t3grip" role="separator" aria-orientation="vertical" aria-label="Today's width" tabindex="0" data-tip="Drag to make Today wider or narrower. Double-click to reset."></div>
    <header class="colh"><h3>Today</h3>${count.length ? `<span class="n"><span class="num">${cdone}</span> of <span class="num">${count.length}</span> done</span>` : ''}</header>
    <div class="colbody">
      ${left.length ? `<div class="banner carry"><span class="ctext">${ICON.stale}<b>${left.length}</b> left from before</span>
        <button class="ibtn" data-left="clear" aria-label="Send back to their lists" data-tip="Send back to their lists">${ICON.x}</button><button class="btn primary" data-left="carry" data-tip="${plural(left.length, 'unfinished task')} from an earlier day. Keep them on Today, in the same kind of block.">${ICON.sun}<span>Keep</span></button></div>` : ''}
      ${leftOffPanel()}${revs}
      ${count.length ? `<div class="progress"><i style="width:${Math.round(cdone / count.length * 100)}%"></i></div>` : ''}
      ${body}
      ${count.filter(t => !t.done).length > 5 ? `<p class="soft">${count.filter(t => !t.done).length} tasks on Today. Keep it to 3 to 5.</p>` : ''}
      ${doneGroup(done)}
      <section class="panel waitp">
        <header><h3>Waiting on others</h3>${waiting.length ? `<span class="n">${waiting.length}</span>` : ''}${nudges ? `<span class="sig acc txt" style="margin-left:auto" role="img" aria-label="${plural(nudges, 'follow-up')} due" data-tip="${plural(nudges, 'follow-up')} due">${ICON.bell}<b>${nudges}</b></span>` : ''}</header>
        ${waiting.length ? waitingGroups(waiting) : `<div class="pempty">Nothing handed over. ${TOUCH ? 'Tap a task\'s person button' : 'Press A on a task'} to hand it off.</div>`}
      </section>
    </div>
  </section>`;
}

function renderToday(){
  const plan = planWeek(), q = inboxQueue();
  const lens = plan ? state.lens : 'rank';
  const tw = !plan && ui.todayW ? ` style="--tw:${Math.round(ui.todayW)}px"` : '';
  main.innerHTML = `<div class="t3wrap">${plan ? '' : inboxBar(q)}<div${tw} class="today3${plan ? ' planweek lensed' : ''}${!plan && heldInbox() ? ' inbox-held' : ''}${inboxOpen ? ' inbox-open' : ''}">${inboxCol(plan)}${rankCol(plan, lens)}${todayCol(plan)}</div></div>`;
  main.querySelectorAll('.col').forEach(c => c.classList.toggle('colon', c.dataset.col === col));
  if (openQuad){ const i = main.querySelector('.qform input'); if (i) i.focus(); }
}

/* One-key sorting on an Inbox row (events.js): 1 to 4 sorts it by value, then the next Inbox row is selected. */
function sortKey(id, k){
  const q = inboxQueue().map(t => t.id), i = q.indexOf(id);
  if (i < 0) return false;
  const next = q[i + 1] || q[i - 1] || null;
  if (/^[1-4]$/.test(k)){ quickSort(id, +k); return next || true; }
  if (k === '0'){ wontDo(id); return next || true; }
  return false;
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
      <p class="soft">${TOUCH ? 'Tap a task\'s person button to hand it off.' : 'Drag a task onto a person, or select it and press A, to hand it off.'}</p>
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
    : `<div class="empty"><b>${team ? 'No one on your team has anything open.' : 'No people yet.'}</b>${team ? 'Switch to Everyone, or hand off a task from Unassigned.' : `Type @name in any task, like "Review design doc @teammate", or ${TOUCH ? 'tap' : 'click'} Person. Groups like @leadership are set up in Workshop's People app.`}</div>`;
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

export { carryLeft, setReviewsOpen, toggleStaleOnly, sortKey, closeNeed, openNeed, openInboxAnyway, peopleFilter, setPeopleFilter, setTrayQ, copyText, dayLabel, recapData, recapText, renderArchive, renderPeople, renderToday };
