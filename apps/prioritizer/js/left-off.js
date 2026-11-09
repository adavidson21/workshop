/* Docket: "Where did you leave off?" (focus hours, Workshop docs/focus.md). When a focus block ends, lunch starts,
   focus starts now, or (with focus hours on) you switch away from an unfinished task, the Today column asks in one
   inline field above the Now card, with Skip. No modal; it fades after 60 seconds if ignored. The answer is saved
   on the task as `leftOff: {text, at}` (an extra field, so tasks stay at their version) and as a breadcrumb.
   When that task is the one you are on again, it shows above the Now card with Clear, and in the task drawer.
   Marking the task done clears it. At most 280 characters; always escaped. */
import { commit, findTask } from './state.js';
import { esc } from './util.js';
import { render } from './render.js';
import { LEFT_OFF_LEN, cleanLeftOff, setLeftOff } from './left-off-model.js';

export { LEFT_OFF_LEN, cleanLeftOff, setLeftOff };

const FADE_MS = 60000;
let ask = null;          // {taskId, why, timer}
let activeOf = () => null;

/** The task the Now card is on (focus.js activeTask), given by main.js so this file stays free of focus.js. */
export function leftOffBoot({active}){ activeOf = active; }

/** Asks about task `id` (why: a few words shown with the question). */
export function askLeftOff(id, why = ''){
  const t = findTask(id);
  if (!t || t.done) return false;
  if (ask) clearTimeout(ask.timer);
  ask = {taskId: id, why, timer: setTimeout(fade, FADE_MS - 400)};
  render();
  return true;
}
function fade(){
  const el = document.querySelector('.leftoff[data-asking]');
  if (el) el.classList.add('fading');
  setTimeout(() => { ask = null; render(); }, 400);
}
export const leftOffAsking = () => ask ? ask.taskId : null;

/** The panel above the Now card: the question, or the note for the task you are on. */
export function leftOffPanel(){
  if (ask){
    const t = findTask(ask.taskId);
    if (t && !t.done) return `<section class="leftoff" data-asking aria-label="Where did you leave off?">
      <div class="lo-h"><span>Where did you leave off?</span><span class="grow"></span>${ask.why ? `<span>${esc(ask.why)}</span>` : ''}</div>
      <p class="lo-t">${esc(t.title)}</p>
      <form data-leftoff-form><input name="leftoff" maxlength="${LEFT_OFF_LEN}" autocomplete="off" placeholder="Next step" aria-label="Where you left off" value="${esc(t.leftOff ? t.leftOff.text : '')}">
      <button type="button" class="btn" data-leftoff="skip">Skip</button><button class="btn primary">Save</button></form></section>`;
    ask = null;
  }
  const t = activeOf();
  if (!t || !t.leftOff) return '';
  return `<section class="leftoff" aria-label="Where you left off"><div class="lo-h"><span>Where you left off</span><span class="grow"></span><button class="lnk" data-leftoff="clear" data-id="${esc(t.id)}">Clear</button></div>
    <p class="lo-t">${esc(t.leftOff.text)}</p></section>`;
}

/** The drawer's line for a task. */
export function leftOffDrawerHtml(t){
  if (!t || !t.leftOff) return '';
  return `<div class="dleftoff"><span class="lbl">Where you left off</span> ${esc(t.leftOff.text)} <button class="lnk" data-leftoff="clear" data-id="${esc(t.id)}">Clear</button></div>`;
}

export function leftOffClick(el){
  const a = el.dataset.leftoff;
  if (a === 'skip'){ if (ask) clearTimeout(ask.timer); ask = null; render(); return; }
  if (a === 'clear'){ const t = findTask(el.dataset.id); if (t && t.leftOff){ delete t.leftOff; commit(); } }
}

/** onSave(t, text): also leave a breadcrumb (focus.js). */
let onSaved = () => {};
export function onLeftOffSaved(fn){ onSaved = fn; }
if (typeof document !== 'undefined') document.addEventListener('submit', e => {
  const f = e.target.closest && e.target.closest('[data-leftoff-form]');
  if (!f) return;
  e.preventDefault();
  const t = ask && findTask(ask.taskId);
  const text = f.querySelector('input').value;
  if (ask) clearTimeout(ask.timer);
  ask = null;
  if (t && setLeftOff(t, text)){ onSaved(t, text); commit(); } else render();
});

