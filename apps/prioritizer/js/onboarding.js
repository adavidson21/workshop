/* Docket: the first-run tour. Shown once on a board with no tasks (the date it was shown is saved with the board
   settings, state.onboarded, so another window or Workshop doesn't show it again), and any time from the
   keyboard help (?). Every step can be skipped; it never deletes anything. */
import { addTask } from './actions.js';
import { ICON, TOUCH } from './constants.js';
import { cleanSprint, sprintDayDate, sprintInfo } from './dayplan-model.js';
import { dp, setRecurring, setSprint, setTemplates } from './dayplan.js';
import { exampleTemplates } from './day-view.js';
import { closeModal, modal, showModal, toast } from './overlays.js';
import { setView } from './render.js';
import { commit, isWaiting, state } from './state.js';
import { esc, plural, todayStr, uid } from './util.js';
import { embedded, ws } from './ws.js';

const STEPS = ['welcome', 'tasks', 'decide', 'days', 'sprint', 'done'];
const SAMPLES = [
  'Review the design doc for search !3 ~s ^fri',
  'Prep 1:1 agenda @Teammate !3 ~xs ^tomorrow',
  'Fix the flaky login test !4 ~m ^+2d',
  'Draft the Q4 roadmap !4 ~l',
  'Reply to the vendor email !1 ~xs',
  'Unblock the release checklist !! !3 ~s'
];
let step = 0, added = [];

/* Startup (main.js): open the tour on a brand new board. */
function maybeOnboard(){
  if (isWaiting() || state.onboarded || state.tasks.length) return false;
  openTour();
  return true;
}
function openTour(){
  step = 0; added = [];
  // Marked as shown right away: closing it any way counts as skipping, and it stays reachable from ?.
  if (!state.onboarded){ state.onboarded = todayStr(); commit(); }
  showModal(`<div class="sheet tour" role="dialog" aria-modal="true" aria-label="Welcome to Docket"></div>`, sh => {
    draw(sh);
    sh.addEventListener('click', e => onClick(e, sh));
    sh.addEventListener('submit', e => onSubmit(e, sh));
  });
}

const where = () => !ws ? 'nowhere yet' : ws.storage === 'device' ? 'on this phone, in the app\'s own storage'
  : ws.backend === 'agent' ? 'on this computer, as files in Workshop\'s data folder' : ws.storage === 'folder' ? 'in your Workshop folder' : 'in this browser';

function body(name){
  if (name === 'welcome') return `<h3>Welcome to Docket</h3>
    <p>A calm task list that helps you decide what to work on next, and plan your day around it. This takes about two minutes, and every step can be skipped.</p>
    <div class="tcard"><b>Your board is saved ${esc(where())}.</b> Nothing leaves your device. ${ws && ws.storage === 'device' ? '' : `The folder icon ${embedded ? '' : 'at the bottom of the sidebar '}has backups, Excel copies and imports.`}${ws && ws.storage === 'indexeddb' ? ' Browser storage can be cleared with your history, so download a backup now and then, or pair Docket with Workshop from that menu.' : ''}</div>`;
  if (name === 'tasks') return `<h3>Add a few tasks</h3>
    <p>Type a task and press Enter. Tags are optional; ${TOUCH ? 'tap' : 'click'} one to try it.</p>
    <form class="tadd" id="tourAdd"><input id="tourIn" placeholder="Review design doc @Teammate !3 ~s ^fri" autocomplete="off" aria-label="New task" enterkeyhint="done"><button class="btn primary">Add</button></form>
    <div class="ttags">${[['@name', 'person', '@Teammate'], ['!1 to !4', 'value', '!3'], ['!!', 'urgent', '!!'], ['~xs to ~xl', 'effort', '~s'], ['^fri', 'due', '^fri'], ['#list', 'list', `#${state.lists[0].name.toLowerCase()}`]].map(([t, d, ex]) => `<button type="button" class="chip" data-tag="${esc(ex)}" data-tip="Adds ${esc(ex)}">${esc(t)} <span>${d}</span></button>`).join('')}</div>
    <div class="tadded">${added.map(t => `<div>${ICON.check}<span>${esc(t)}</span></div>`).join('')}</div>
    ${state.lists.some(l => l.name === 'Samples') ? '' : `<p class="tsmall">Just looking? <button class="lnk" data-samples>Load ${SAMPLES.length} sample tasks</button> in a "Samples" list. Delete the list to remove them all.</p>`}`;
  if (name === 'decide') return `<h3>How Docket decides</h3>
    <ul class="tlist">
      <li><b>Value</b> (Trivial to High) and <b>effort</b> (XS to XL) are the two things you set, usually in <b>Triage</b>, a few seconds each.</li>
      <li>A <b>due date</b> is optional. Without one, a task gets an implied one from its age, so nothing sits forever.</li>
      <li>The <b>score</b> is value plus urgency over effort. Your own rank in <b>Prioritize</b> always has the final say.</li>
      <li><b>Today</b> is your short list: 3 to 5 tasks works best. <b>Day</b> turns it into time blocks.</li>
    </ul>
    ${state.tasks.some(t => !t.done && (t.value == null || t.effort == null)) ? `<div class="tcard">You have tasks without a value or effort. <button class="btn" data-triage>Triage them now</button> <span class="tsmall">(ends the tour)</span></div>` : ''}`;
  if (name === 'days') {
    const sp = dp.sprint;
    return `<h3>Plan your days <span class="topt">optional</span></h3>
    <p>If you work in sprints, Docket can count sprint days and give each day time blocks from a template, like Deep focus, Meetings and Admin. Skip this if you don't.</p>
    <form class="tsprint" id="tourSprint">
      <label>A sprint starts on <input type="date" name="anchor" value="${esc(sp.anchor || todayStr())}" required></label>
      <label>Length <select name="len">${[1, 2, 3, 4].map(n => `<option value="${n}"${n === sp.lengthWeeks ? ' selected' : ''}>${plural(n, 'week')}</option>`).join('')}</select></label>
      ${dp.templates.length ? '' : '<label class="chk"><input type="checkbox" name="example" checked> Example templates</label>'}
      <button class="btn primary">${sp.anchor ? 'Update sprint' : 'Save sprint'}</button>
    </form>
    ${sp.anchor ? `<p class="tsmall">Sprint set: one started ${esc(sp.anchor)}. Workdays, holidays and templates are in Day, under the gear.</p>` : ''}`;
  }
  if (name === 'sprint') {
    if (!dp.sprint.anchor) return `<h3>Every-sprint tasks <span class="topt">optional</span></h3><p>Set a sprint in the last step first, or add these later in Day, under the gear.</p>`;
    const sp = cleanSprint(dp.sprint), start = sprintInfo(sp, todayStr()).start, total = sp.workdays.length * sp.lengthWeeks;
    const day = n => { const d = sprintDayDate(sp, start, n); return d ? new Date(d + 'T12:00').toLocaleDateString(undefined, {weekday: 'short'}) : ''; };
    const have = new Set(dp.recurring.map(r => r.title.toLowerCase()));
    const presets = [['Sprint planning', 1, false, 'meetings'], ['Backlog refinement', Math.ceil(total / 2), false, 'meetings'], ['Release', 0, true, 'admin']]
      .filter(p => !have.has(p[0].toLowerCase()));
    const opts = (n, last) => `<option value="last"${last ? ' selected' : ''}>Last day</option>` + Array.from({length: total}, (_, i) => i + 1).map(i => `<option value="${i}"${!last && i === n ? ' selected' : ''}>Day ${i} (${day(i)})</option>`).join('');
    return `<h3>Every-sprint tasks <span class="topt">optional</span></h3>
    <p>For things you do once a sprint. Each sprint, a fresh task is added on day 1 at Low value, due on its day, and put in a block of its kind on that day.</p>
    ${presets.length ? `<div class="trec">${presets.map(([t, n, last, kind], i) => `<div class="trow" data-pi="${i}"><label class="chk"><input type="checkbox" data-p="on"> <input data-p="title" value="${esc(t)}" aria-label="Title"></label>
      <select data-p="due" aria-label="Due on">${opts(n, last)}</select><span class="tsmall">in a</span><select data-p="kind" aria-label="Plan into">${['meetings', 'focus', 'admin', 'review'].map(k => `<option${k === kind ? ' selected' : ''}>${k}</option>`).join('')}</select><span class="tsmall">block</span></div>`).join('')}</div>
    <p class="tsmall">Check the ones you want, then Next. Change them later in Day, under the gear.</p>` : '<p class="tsmall">You already have these. More are in Day, under the gear.</p>'}`;
  }
  return `<h3>You're set</h3>
    <p>${state.tasks.filter(t => !t.done).length ? `You have ${plural(state.tasks.filter(t => !t.done).length, 'open task')}.` : 'Add your first task any time.'} A few things worth knowing:</p>
    <table class="keys"><tbody>
      <tr><td>${TOUCH ? 'The + button' : '<kbd>N</kbd>'}</td><td>Add a task from anywhere</td></tr>
      ${TOUCH ? '' : '<tr><td><kbd>1</kbd> to <kbd>6</kbd></td><td>Today, Triage, Prioritize, People, Reports, Day</td></tr><tr><td><kbd>T</kbd> / <kbd>X</kbd></td><td>Add the selected task to Today / complete it</td></tr><tr><td><kbd>P</kbd></td><td>In Day, plan the selected task into a block</td></tr>'}
      <tr><td>${TOUCH ? '' : '<kbd>?</kbd>'}</td><td>${TOUCH ? '' : 'All shortcuts, and this tour again'}</td></tr>
    </tbody></table>`;
}

function draw(sh){
  const name = STEPS[step], last = step === STEPS.length - 1;
  sh.innerHTML = `<div class="tdots" aria-label="Step ${step + 1} of ${STEPS.length}">${STEPS.map((_, i) => `<i${i === step ? ' class="on"' : i < step ? ' class="past"' : ''}></i>`).join('')}</div>
    ${body(name)}
    <footer>${step ? '<button class="btn ghost" data-back>Back</button>' : ''}<span class="grow"></span>
      ${last ? '' : '<button class="btn" data-skip>Skip the tour</button>'}
      <button class="btn primary" data-next>${last ? 'Start using Docket' : 'Next'}</button></footer>`;
  const focus = sh.querySelector('#tourIn') || sh.querySelector('[data-next]');
  if (focus) focus.focus({preventScroll: true});
}

function onClick(e, sh){
  const b = e.target.closest('button'); if (!b) return;
  if (b.hasAttribute('data-skip')){ closeModal(); return; }
  if (b.hasAttribute('data-back')){ step = Math.max(0, step - 1); draw(sh); return; }
  if (b.hasAttribute('data-next')){
    if (STEPS[step] === 'tasks'){ const i = sh.querySelector('#tourIn'); if (i && i.value.trim()) add(i.value); }
    if (STEPS[step] === 'sprint') saveRecurring(sh);
    if (step === STEPS.length - 1){ closeModal(); setView(state.tasks.some(t => !t.done) ? 'today' : state.view); return; }
    step++; draw(sh); return;
  }
  if (b.dataset.tag){ const i = sh.querySelector('#tourIn'); i.value = (i.value.trim() + ' ' + b.dataset.tag).trim(); i.focus(); return; }
  if (b.hasAttribute('data-samples')){ loadSamples(); draw(sh); return; }
  if (b.hasAttribute('data-triage')){ closeModal(); setView('triage'); return; }
}
function onSubmit(e, sh){
  e.preventDefault();
  if (e.target.id === 'tourAdd'){ const i = sh.querySelector('#tourIn'); if (add(i.value)){ draw(sh); } return; }
  if (e.target.id === 'tourSprint'){
    const f = e.target;
    const sp = cleanSprint(Object.assign({}, dp.sprint, {anchor: f.anchor.value, lengthWeeks: +f.len.value}));
    if (!sp.anchor) return;
    setSprint(sp);
    if (f.example && f.example.checked && !dp.templates.length) setTemplates(exampleTemplates(sp));
    step++; draw(sh);
  }
}
function add(text){
  const t = addTask(text);
  if (t){ added.push(t.title); return t; }
  return null;
}
function loadSamples(){
  if (state.lists.some(l => l.name === 'Samples')) return;
  const list = {id: uid(), name: 'Samples', parentId: null};
  state.lists.push(list);
  SAMPLES.forEach(s => { const t = addTask(s, {listId: list.id}); if (t){ t.listId = list.id; added.push(t.title); } });
  commit();
  toast(`Added ${plural(SAMPLES.length, 'sample task')} in "Samples"`);
}
function saveRecurring(sh){
  const rows = [...sh.querySelectorAll('.trow')].filter(r => r.querySelector('[data-p=on]').checked);
  if (!rows.length) return;
  const items = rows.map(r => {
    const due = r.querySelector('[data-p=due]').value;
    return {id: uid(), title: r.querySelector('[data-p=title]').value.trim(), last: due === 'last', dueDay: due === 'last' ? 1 : +due,
      planKind: r.querySelector('[data-p=kind]').value, value: 2, effort: 'S', listId: state.lists[0].id};
  }).filter(r => r.title);
  setRecurring([...dp.recurring, ...items]);
  toast(`Added ${plural(items.length, 'every-sprint task')}`);
}

/* Replay from anywhere: any element with data-tour (the keyboard help, empty states). */
function tourInit(){
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-tour]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (modal.classList.contains('open')) closeModal();
    openTour();
  }, true);
}

export { maybeOnboard, openTour, tourInit };
