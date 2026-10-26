import { addTask } from './actions.js';
import { VALUE } from './constants.js';
import { hideTip } from './events.js';
import { closeMenu } from './overlays.js';
import { parseQuick } from './quick-add.js';
import { defaultListId, isWaiting, listById, state } from './state.js';
import { $, esc, fmtLong, todayStr } from './util.js';
/* Prioritizer: The command bar (N or Ctrl+K) for adding tasks. */
/* ---------- command bar ---------- */
const cmd = $('#cmd'), cmdInput = $('#cmdInput'), cmdParsed = $('#cmdParsed');
let cmdReturn = null, cmdAdded = '';
const cmdOpen = () => cmd.classList.contains('open');
function openCmd(){
  if (isWaiting()) return;
  if (cmdOpen()) return cmdInput.focus();
  closeMenu(); hideTip();
  cmdReturn = document.activeElement;
  cmd.classList.add('open'); cmdAdded = '';
  cmdInput.value = ''; cmdPreview();
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
  p.people.forEach(n => bits.push(`<span class="chip acc">@${esc(n)}</span>`));
  const where = `Adds to <b>${esc(L ? L.name : '')}</b>${state.view === 'today' ? ' and Today' : ''}`;
  cmdParsed.innerHTML = cmdInput.value.trim()
    ? bits.join('') + `<span style="margin-left:auto">${where}</span>`
    : (cmdAdded ? `<span class="added">Added "${esc(cmdAdded)}". Keep going, or press Esc.</span>` : `<span>${where}. Type a task; tags are optional.</span>`);
}
cmdInput.addEventListener('input', cmdPreview);
cmdInput.addEventListener('keydown', e => {
  if (e.key === 'Enter'){
    e.preventDefault();
    const t = addTask(cmdInput.value, state.view === 'today' ? {focusOn: todayStr()} : {});
    if (t){ cmdAdded = t.title; cmdInput.value = ''; cmdPreview(); }
  }
});
cmd.addEventListener('click', e => { if (e.target.closest('[data-cmd-close]')) closeCmd(); });

export { closeCmd, cmd, cmdOpen, openCmd };
