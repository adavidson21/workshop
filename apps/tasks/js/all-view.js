/* The All tasks place (Tasks 12.5.0, all-model.js): every open task in the picked lists, grouped by list, with
   filters. New work items waiting for you show here too, never held by focus hours. */
import { adoIsOn } from '../../../shared/ado.js';
import { ICON } from './constants.js';
import { main, row } from './render.js';
import { orderedLists, scopeListIds, shown, state, ui, saveUi } from './state.js';
import { esc, plural, todayStr } from './util.js';
import { personalOn, personalShown } from './agent-queue.js';
import { ALL_FILTERS, allCounts, allGroups, cleanFilter, hiddenOf } from './all-model.js';

export const allFilter = () => cleanFilter(ui.allFilter);
export function setAllFilter(f){ ui.allFilter = cleanFilter(f); saveUi(); }

export function renderAll(){
  const ids = scopeListIds(), today = todayStr(), filter = allFilter();
  const counts = allCounts(state.tasks, ids, {today, shown});
  const groups = allGroups(state.tasks, orderedLists(), ids, {filter, today, shown});
  const hid = hiddenOf(state.tasks, ids, {shown, personalShown});
  const pend = ui.tracker && ui.tracker.on ? state.tracker.pending.length : 0;
  const chips = `<div class="lens allf" role="tablist" aria-label="Show">${ALL_FILTERS.map(([k, n]) => `<button data-allf="${k}" role="tab" aria-selected="${filter === k}"${filter === k ? ' class="on"' : ''}>${n}${counts[k] ? ` <span class="num">${counts[k]}</span>` : ''}</button>`).join('')}</div>`;
  const notes = [];
  if (pend) notes.push(`<button class="adorow" data-need="ado">${ICON.item}<span><b class="num">${pend}</b> new work item${pend === 1 ? '' : 's'} from ${adoIsOn() ? 'ADO' : 'your tracker'} to add</span><span class="lnk">Review</span></button>`);
  if (hid.other) notes.push(`<p class="hint allhid">${plural(hid.other, 'task')} hidden by the product or pull request filter. <button class="lnk" data-allshow>Show everything</button></p>`);
  if (hid.personal && !personalOn()) notes.push(`<p class="hint allhid">${plural(hid.personal, 'personal task')} hidden. Turn on Personal tasks under Tasks in Workshop Settings, Apps, to see ${hid.personal === 1 ? 'it' : 'them'}.</p>`);
  const body = groups.length
    ? groups.map(g => `<section class="allgrp" aria-label="${esc(g.list.name)}"><header class="allgrp-h"><b>${esc(g.list.name)}</b><span class="num">${g.tasks.length}</span></header>
        <div class="rows">${g.tasks.map(t => row(t, {compact: true, estimate: true})).join('')}</div></section>`).join('')
    : `<div class="empty"><b>${filter === 'all' ? 'Nothing open here.' : 'Nothing matches.'}</b>${filter === 'all' ? 'Add a task, or pick another list.' : 'Pick Everything to see every open task.'}</div>`;
  main.innerHTML = `<div class="allview">${chips}${notes.join('')}${body}</div>`;
}
