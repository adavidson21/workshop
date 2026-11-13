import { closeModal, showModal, toast } from './overlays.js';
import { row } from './render.js';
import { ROW_FIELDS, ROW_GROUPS, ROW_KEEPS, cleanRowFields, withHidden } from './row-fields-model.js';
import { commit, isWaiting, state } from './state.js';
import { addDays, esc, todayStr } from './util.js';
/* Docket: Row fields, the sidebar's Display button. Which optional fields task rows show, for every view, saved with
   the board's settings (row-fields-model.js). A preview row at the top uses the real row() with every field filled.
   Changes apply on Save. */

let draft = null;   // Set of hidden known keys while the sheet is open

/* A made-up task with every optional field filled. Not on the board, never saved. */
function sample(){
  const d = todayStr();
  return {
    id: 'rf-preview', listId: 'rf-preview', title: 'Review the onboarding doc', done: false, value: 3, effort: 'M',
    urgentFlag: false, ageFrom: d, due: addDays(d, 2), waiting: true, who: [], rank: 0,
    ado: {id: 1234, type: 'Task'}, pr: {id: 412, repo: 'sample-repo', tier: 'pool', via: [], ai: {state: 'done', rec: 'approve', counts: {}}},
    recur: {id: 'rf-preview'}, crumbs: [{at: Date.now(), text: 'left off at the second section'}]
  };
}
const AGENT = '<span class="chip eng" data-tip="Agent status from Loom">Plan ready</span>';

function previewHtml(){
  return row(sample(), {start: true, crumb: true, hidden: [...draft],
    preview: {names: ['Sam Lee', 'Ana Ruiz'], list: {id: 'rf-preview', name: 'Main'}, agent: AGENT, product: 'Sample product'}});
}

function draw(sh){
  const groups = ROW_GROUPS.map(g => {
    const fs = ROW_FIELDS.filter(f => f.group === g);
    return `<fieldset class="rfgrp"><legend>${esc(g)}</legend>
      ${fs.map(f => `<label class="chk"><input type="checkbox" data-rf="${f.key}"${draft.has(f.key) ? '' : ' checked'}> ${esc(f.label)}</label>`).join('')}
      ${ROW_KEEPS[g] ? `<p class="rfkeep">${esc(ROW_KEEPS[g])}</p>` : ''}</fieldset>`;
  }).join('');
  sh.innerHTML = `<h3>Row fields</h3>
    <p class="dhelp">Choose what task rows show, in every view. Alerts that need you always show. Everything is still in a task's details.</p>
    <div class="rfprev" inert aria-label="Preview"><div class="rows">${previewHtml()}</div></div>
    <div class="rfgrid">${groups}</div>
    <footer><button class="btn" data-rfreset>Reset to defaults</button><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-rfsave>Save</button></footer>`;
}
function redrawPreview(sh){ const p = sh.querySelector('.rfprev .rows'); if (p) p.innerHTML = previewHtml(); }

function openDisplay(){
  const known = new Set(ROW_FIELDS.map(f => f.key));
  draft = new Set(cleanRowFields(state.rowFields).hidden.filter(k => known.has(k)));
  showModal(`<div class="sheet wide rowfields" role="dialog" aria-modal="true" aria-label="Row fields"></div>`, sh => {
    draw(sh);
    sh.addEventListener('change', e => {
      const k = e.target.dataset && e.target.dataset.rf; if (!k) return;
      if (e.target.checked) draft.delete(k); else draft.add(k);
      redrawPreview(sh);
    });
    sh.addEventListener('click', e => {
      if (e.target.closest('[data-rfreset]')){ draft = new Set(); draw(sh); const b = sh.querySelector('[data-rfreset]'); if (b) b.focus(); return; }
      if (e.target.closest('[data-rfsave]')){
        if (isWaiting()){ toast('Still loading. Try again in a moment.'); return; }
        state.rowFields = withHidden(state.rowFields, draft);
        closeModal(); commit();
      }
    });
  });
}

export { openDisplay };
