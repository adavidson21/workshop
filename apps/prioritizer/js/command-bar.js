import { addTask } from './actions.js';
import { TOUCH, VALUE } from './constants.js';
import { hideTip } from './events.js';
import { closeMenu } from './overlays.js';
import { parseQuick } from './quick-add.js';
import { takePasted } from './paste.js';
import { defaultListId, isWaiting, listById, orderedLists, saveUi, state, ui } from './state.js';
import { col } from './render.js';
import { $, esc, fmtLong, todayStr } from './util.js';
import { nameOf, refOf } from './directory-model.js';
/* Prioritizer: The command bar (N or Ctrl+K) for adding tasks. */
/* ---------- command bar ---------- */
const cmd = $('#cmd'), cmdInput = $('#cmdInput'), cmdParsed = $('#cmdParsed');
let cmdReturn = null, cmdAdded = '';
const cmdOpen = () => cmd.classList.contains('open');
// On Today a new task lands in the Inbox to triage; it goes straight onto Today only from the Today column.
const toToday = () => state.view === 'today' && col === 'today';
function openCmd(){
  if (isWaiting()) return;
  if (cmdOpen()) return cmdInput.focus();
  closeMenu(); hideTip();
  cmdReturn = document.activeElement;
  cmd.classList.add('open'); cmdAdded = '';
  cmdInput.value = ''; cmdPreview();
  setCheat(!!ui.cheat, false);
  cmdInput.focus();
}
function closeCmd(){
  cmd.classList.remove('open');
  if (cmdReturn && cmdReturn.isConnected && cmdReturn !== document.body) cmdReturn.focus({preventScroll: true});
}
function cmdPreview(){
  const p = parseQuick(cmdInput.value);
  const L = listById(p.listId || defaultListId());
  const bits = [];
  if (p.value) bits.push(`<span class="chip acc">Value ${VALUE[p.value]}</span>`);
  if (p.effort) bits.push(`<span class="chip acc">Effort ${p.effort}</span>`);
  if (p.due) bits.push(`<span class="chip acc">Due ${fmtLong(p.due)}</span>`);
  if (p.urgentFlag) bits.push(`<span class="chip acc">Urgent</span>`);
  if (p.delegate) bits.push(`<span class="chip acc">Waiting on them</span>`);
  p.people.forEach(n => { const id = refOf(n); bits.push(`<span class="chip acc">${id ? esc(nameOf(id)) : `@${esc(n)} (new contact)`}</span>`); });
  const where = `Adds to <b>${esc(L ? L.name : '')}</b>${toToday() ? ' and Today' : state.view === 'today' && !p.delegate ? ', in the Inbox' : ''}`;
  cmdParsed.innerHTML = cmdInput.value.trim()
    ? bits.join('') + `<span style="margin-left:auto">${where}</span>`
    : (cmdAdded ? `<span class="added">Added "${esc(cmdAdded)}". Keep going, or ${TOUCH ? 'tap Done' : 'press Esc'}.</span>` : `<span>${where}</span>`);
}
cmdInput.addEventListener('input', cmdPreview);

/* The Quick add cheat sheet: hidden until you open it (the button, or Ctrl+/ / Cmd+/ while typing). Remembered
   per window in ui.cheat. Clicking a tag puts it in the add box. Your own lists are shown as #tags. */
const cheat = $('#cmdCheat'), cheatBtn = $('#cmdCheatBtn');
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || '');
if (MAC) $('#cmdCheatKey').innerHTML = '<kbd>&#8984; /</kbd> toggle';
const listTag = name => '#' + String(name).trim().toLowerCase().replace(/\s+/g, '-');
const tag = (t, ins = t) => `<button type="button" class="ctag" data-ins="${esc(ins)}">${esc(t)}</button>`;
function cheatHtml(){
  const lists = orderedLists().slice(0, 8);
  const row = (tags, what) => `<div class="crow"><div class="ctags">${tags}</div><div class="cwhat">${what}</div></div>`;
  return `
    <div class="cgrp"><h4>Who</h4>
      ${row(tag('@name', '@'), 'Involve a person or group (handle or name; a new name adds a contact)')}
      ${row(tag('>@name', '>@'), 'Delegate: waiting on them, with a follow-up date')}
    </div>
    <div class="cgrp"><h4>Priority</h4>
      ${row([1, 2, 3, 4].map(n => tag('!' + n)).join(''), `Value: ${[1, 2, 3, 4].map(n => `${n} ${VALUE[n]}`).join(', ')}`)}
      ${row(tag('!!'), 'Urgent')}
      ${row(['xs', 's', 'm', 'l', 'xl'].map(x => tag('~' + x)).join(''), 'Effort')}
    </div>
    <div class="cgrp"><h4>Due</h4>
      ${row(tag('^today') + tag('^tom'), 'Today, tomorrow')}
      ${row(tag('^fri') + tag('^mon'), 'Next weekday (first 3 letters or more)')}
      ${row(tag('^+3d') + tag('^+2w'), 'Days or weeks from today')}
      ${row(tag('^YYYY-MM-DD', '^' + todayStr()), 'A date')}
    </div>
    <div class="cgrp"><h4>List</h4>
      ${row(lists.length ? lists.map(l => tag(listTag(l.name))).join('') : tag('#list', '#'), 'Start of the list name is enough; a dash for a space')}
    </div>
    <p class="cnote">Tags can go anywhere in the line. Anything not recognized stays in the title. Paste an ADO work item or its link to keep the link on the task.<br>
      Example: <span class="mono">Review design doc &gt;@sam !3 ~s ^fri</span></p>`;
}
function setCheat(open, save = true){
  if (open) cheat.innerHTML = cheatHtml();
  cheat.hidden = !open;
  cheatBtn.setAttribute('aria-expanded', String(open));
  cmd.classList.toggle('cheat-open', open);
  if (save){ ui.cheat = open; saveUi(); }
}
cheatBtn.addEventListener('click', () => { setCheat(cheat.hidden); cmdInput.focus(); });
cheat.addEventListener('click', e => {
  const b = e.target.closest('[data-ins]'); if (!b) return;
  const v = cmdInput.value, s = cmdInput.selectionStart ?? v.length, end = cmdInput.selectionEnd ?? s;
  const before = v.slice(0, s), after = v.slice(end);
  const ins = (before && !/\s$/.test(before) ? ' ' : '') + b.dataset.ins + (after && !/^\s/.test(after) ? ' ' : '');
  cmdInput.focus();
  cmdInput.setRangeText(ins, s, end, 'end');
  cmdPreview();
});

cmdInput.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '/'){ e.preventDefault(); setCheat(cheat.hidden); return; }
  if (e.key === 'Enter'){
    e.preventDefault();
    const t = addTask(cmdInput.value, {...(toToday() ? {focusOn: todayStr()} : {}), ado: takePasted(cmdInput)});
    if (t){ cmdAdded = t.title; cmdInput.value = ''; cmdPreview(); }
  }
});
cmd.addEventListener('click', e => { if (e.target.closest('[data-cmd-close]')) closeCmd(); });

export { closeCmd, cmd, cmdOpen, openCmd };
