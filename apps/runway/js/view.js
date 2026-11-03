/* Runway's HTML, as strings. Pure: no DOM, no state of its own. main.js paints these and wires events.
   Every piece of user text goes through esc(); only http(s) links are ever made clickable. */
import { SCALES, fmt } from './dates.js';
import { COLORS, STATUSES, linksIn, schedule } from './model.js';
import { PALETTE, esc } from './timeline.js';

const relTime = (ms, now = Date.now()) => {
  if (!ms) return '';
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : new Date(ms).toLocaleDateString();
};

const ICON = {
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  gear: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 2.5v3M13 2.5v3"/></svg>',
  down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
};
export { ICON };

/* ---------- the list of roadmaps ---------- */

export function listHtml(v, { canPair = false, paired = false } = {}) {
  const rows = [...v.list].sort((a, b) => b.changed - a.changed).map(r => `
    <li class="rrow">
      <a class="rtitle" href="#/${esc(r.id)}" data-open="${esc(r.id)}">${esc(r.title)}</a>
      <span class="rmeta mono">${esc(relTime(r.changed))}</span>
      <span class="racts">
        <button class="btn ghost" data-dup="${esc(r.id)}">Duplicate</button>
        <button class="btn text-danger" data-del="${esc(r.id)}">Remove</button>
      </span>
    </li>`).join('');
  const empty = `<div class="engcard"><h2>Start a roadmap</h2>
    <p>Type an outline, one item per line, and Runway draws the timeline. Drag bars to change dates, then export an image or Markdown.</p>
    <div class="acts"><button class="btn primary" data-new>${ICON.plus}New roadmap</button><button class="btn" data-example>Start from an example</button><button class="btn ghost" data-import>Import Markdown</button></div></div>`;
  return `<header class="lhead">
      <p class="eyebrow">Runway</p>
      <h1 class="page-title dot">Roadmaps</h1>
      ${v.list.length ? `<div class="lacts"><button class="btn primary" data-new>${ICON.plus}New roadmap</button><button class="btn" data-import>Import Markdown</button><button class="btn ghost" data-example>Example</button></div>` : ''}
    </header>
    ${v.list.length ? `<ul class="rlist">${rows}</ul>` : empty}
    ${canPair ? `<p class="hint pairline">Your roadmaps are saved in this browser. <button class="lnk" data-pair>Use Workshop on this computer</button> to keep them in your Workshop folder.</p>` : ''}
    ${paired ? `<p class="hint pairline">Saved in your Workshop folder. <button class="lnk" data-unpair>Stop using Workshop on this computer</button></p>` : ''}`;
}

/* ---------- the roadmap page ---------- */

const SAVE = { saved: 'Saved', saving: 'Saving', unsaved: 'Not saved yet' };

export function toolbarHtml(v, ui) {
  const m = v.doc.meta;
  const tabs = ['timeline', 'outline', 'split'].map(k => `<button role="tab" aria-selected="${ui.mode === k}" data-mode="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('');
  return `<div class="tbar">
    <a class="btn ghost back" href="#/" data-home aria-label="All roadmaps">${ICON.back}<span>Roadmaps</span></a>
    <input class="mtitle" data-title value="${esc(m.title)}" aria-label="Roadmap title" maxlength="120"${v.readOnly ? ' readonly' : ''}>
    <span class="grow"></span>
    <span class="save mono" data-save="${v.save}" title="${esc(v.error)}">${SAVE[v.save]}</span>
    <div class="seg" role="tablist" aria-label="View">${tabs}</div>
    <label class="fld"><span class="sr">Scale</span><select data-scale aria-label="Scale"${v.readOnly ? ' disabled' : ''}>${SCALES.map(s => `<option value="${s}"${m.scale === s ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
    <button class="ibtn" data-settings aria-label="Roadmap settings" data-tip="Dates and sprints">${ICON.gear}</button>
    <button class="btn" data-export>${ICON.down}Export</button>
  </div>`;
}

export function rangeHtml(v, range) {
  const auto = !v.doc.meta.range;
  return `<div class="rbar">
    <span class="eyebrow">Showing</span>
    <label class="fld"><span class="sr">From</span><input type="date" data-from value="${esc(range.from)}" aria-label="From"></label>
    <span class="muted">to</span>
    <label class="fld"><span class="sr">To</span><input type="date" data-to value="${esc(range.to)}" aria-label="To"></label>
    <button class="btn ghost" data-fit${auto ? ' disabled' : ''}>Fit to items</button>
    <span class="grow"></span>
    <button class="btn ghost" data-addlane>${ICON.plus}Lane</button>
    <button class="btn ghost" data-additem>${ICON.plus}Item <kbd>N</kbd></button>
  </div>`;
}

export function trayHtml(doc, sched = schedule(doc)) {
  const loose = doc.items.filter(i => i.kind === 'item' && !sched.get(i.id));
  if (!loose.length) return '';
  const lane = (id) => (doc.lanes.find(l => l.id === id) || {}).title;
  return `<div class="tray" aria-label="Unscheduled">
    <span class="eyebrow">Unscheduled</span>
    ${loose.map(i => `<button class="chip" draggable="true" data-tray="${esc(i.id)}" title="Drag onto the timeline, or click to set dates">${esc(i.title)}${lane(i.lane) ? `<span class="muted"> · ${esc(lane(i.lane))}</span>` : ''}</button>`).join('')}
  </div>`;
}

export function warningsHtml(warnings) {
  if (!warnings.length) return '';
  return `<ul class="warns" aria-label="Outline warnings">${warnings.slice(0, 30).map(w => `<li>${w.line ? `<span class="mono">Line ${w.line}</span> ` : ''}${esc(w.message)}</li>`).join('')}${warnings.length > 30 ? `<li>${warnings.length - 30} more</li>` : ''}</ul>`;
}

export const OUTLINE_HELP = `<details class="ohelp"><summary>Outline format</summary>
  <pre><code># Title
scale: month          week, sprint, month or quarter
start: 2027-01-01     where S1, W1 and year-less months count from
sprint: 2027-01-06, 2 weeks

## Lane
- Item | Jan-Mar 2027
- Item | Q2 | after: Other item | status: at risk | color: teal
- Item | S3-S4         sprints, W1-W2 for weeks
- Item | 2027-03-01..2027-03-20
- Item | 3 sprints     a length: starts after its "after" items
- * Milestone | 2027-04-15
  Indented lines are notes.</code></pre></details>`;

/* ---------- the item panel ---------- */

export function panelHtml(doc, id, sched = schedule(doc), readOnly = false) {
  const it = doc.items.find(x => x.id === id && x.kind === 'item');
  if (!it) return '';
  const s = sched.get(id);
  const ro = readOnly ? ' disabled' : '';
  const lanes = [{ id: '', title: 'No lane' }, ...[...doc.lanes].sort((a, b) => a.order - b.order)];
  const others = doc.items.filter(x => x.kind === 'item' && x.id !== id);
  const links = linksIn(it.notes);
  const sized = !it.start && it.size;
  return `<form class="panel" data-panel="${esc(id)}" aria-label="Item">
    <header><span class="eyebrow">${it.milestone ? 'Milestone' : 'Item'}</span><button type="button" class="ibtn" data-close aria-label="Close">${ICON.close}</button></header>
    <label class="pf"><span>Title</span><input data-f="title" value="${esc(it.title)}" maxlength="200"${ro}></label>
    <label class="pf"><span>Lane</span><select data-f="lane"${ro}>${lanes.map(l => `<option value="${esc(l.id)}"${(it.lane || '') === l.id ? ' selected' : ''}>${esc(l.title)}</option>`).join('')}</select></label>
    <label class="pc"><input type="checkbox" data-f="milestone"${it.milestone ? ' checked' : ''}${ro}> Milestone (one date)</label>
    ${sized ? `<p class="hint">${esc(`${it.size.n} ${it.size.unit}${it.size.n === 1 ? '' : 's'}`)}${s ? `, ${esc(fmt(s.start))} to ${esc(fmt(s.end))}` : ''}. Set dates to pin it.</p>` : ''}
    <div class="prow">
      <label class="pf"><span>${it.milestone ? 'Date' : 'Start'}</span><input type="date" data-f="start" value="${esc(it.start || (s ? s.start : ''))}"${ro}></label>
      ${it.milestone ? '' : `<label class="pf"><span>End</span><input type="date" data-f="end" value="${esc(it.end || (s ? s.end : ''))}"${ro}></label>`}
    </div>
    ${it.start || sized ? `<button type="button" class="lnk" data-unschedule${ro}>Unschedule</button>` : ''}
    <label class="pf"><span>Status</span><select data-f="status"${ro}>${STATUSES.map(x => `<option value="${x}"${it.status === x ? ' selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></label>
    <fieldset class="pf"><legend>Color</legend><div class="swatches">
      <label class="swl" title="Lane color"><input type="radio" name="color" data-f="color" value=""${!it.color ? ' checked' : ''}${ro}><span class="swc auto">A</span></label>
      ${COLORS.map(c => `<label class="swl" title="${c}"><input type="radio" name="color" data-f="color" value="${c}"${it.color === c ? ' checked' : ''}${ro}><span class="swc" style="--c:${PALETTE.light[c]};--cd:${PALETTE.dark[c]}"></span></label>`).join('')}
    </div></fieldset>
    <fieldset class="pf"><legend>Starts after</legend>${others.length ? `<div class="deps">${others.map(o => `<label class="pc"><input type="checkbox" data-dep="${esc(o.id)}"${it.dependsOn.includes(o.id) ? ' checked' : ''}${ro}> ${esc(o.title)}</label>`).join('')}</div>` : '<p class="hint">No other items yet.</p>'}
      ${it.afterMissing.length ? `<p class="hint">Not in this roadmap: ${esc(it.afterMissing.join(', '))}</p>` : ''}</fieldset>
    <label class="pf"><span>Notes</span><textarea data-f="notes" rows="4" maxlength="4000"${ro}>${esc(it.notes)}</textarea></label>
    ${links.length ? `<ul class="plinks">${links.map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ul>` : ''}
    <footer>${readOnly ? '' : `<button type="button" class="btn text-danger" data-delete>Delete</button>`}</footer>
  </form>`;
}

/* ---------- dialogs ---------- */

export function settingsDialog(doc) {
  const m = doc.meta;
  return `<form method="dialog" class="sheet">
    <h3>Dates and sprints</h3>
    <label class="pf"><span>Start</span><input type="date" name="origin" value="${esc(m.origin)}" required>
      <small class="hint">Where S1, W1 and months written without a year count from.</small></label>
    <label class="pf"><span>A sprint starts on</span><input type="date" name="anchor" value="${esc(m.sprint ? m.sprint.anchor : '')}">
      <small class="hint">Any sprint's first day. Leave empty to count sprints from the start date.</small></label>
    <label class="pf"><span>Sprint length</span><select name="weeks">${[1, 2, 3, 4].map(n => `<option value="${n}"${(m.sprint ? m.sprint.weeks : 2) === n ? ' selected' : ''}>${n} week${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
    <footer><span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></footer>
  </form>`;
}

export function exportDialog(doc, { dark = false } = {}) {
  return `<form method="dialog" class="sheet wide">
    <h3>Export</h3>
    <p class="hint">The image shows the dates and lanes on screen now. Folded lanes are left out.</p>
    <div class="prow">
      <label class="pc"><input type="checkbox" name="title" checked> Title</label>
      <label class="pc"><input type="checkbox" name="today" checked> Today line</label>
      <label class="pf inline"><span>Theme</span><select name="theme"><option value="light"${dark ? '' : ' selected'}>Light (for printing)</option><option value="dark"${dark ? ' selected' : ''}>Dark</option></select></label>
    </div>
    <div class="acts"><button type="button" class="btn primary" data-x="png">${ICON.down}PNG image</button><button type="button" class="btn" data-x="svg">${ICON.down}SVG image</button></div>
    <h4 class="section-label">Markdown</h4>
    <label class="pc"><input type="checkbox" name="table"> Add a table (lane, item, dates, status, after)</label>
    <div class="acts"><button type="button" class="btn" data-x="md">${ICON.down}Download .md</button><button type="button" class="btn" data-x="copy">Copy</button><button type="button" class="btn ghost" data-x="folder">Save to Workshop folder</button></div>
    <footer><span class="grow"></span><button class="btn" value="cancel">Done</button></footer>
  </form>`;
}

export function promptDialog(title, label, value = '', ok = 'Save') {
  return `<form method="dialog" class="sheet small">
    <h3>${esc(title)}</h3>
    <label class="pf"><span>${esc(label)}</span><input name="v" value="${esc(value)}" maxlength="120" required autofocus></label>
    <footer><span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${esc(ok)}</button></footer>
  </form>`;
}

export function importDialog() {
  return `<form method="dialog" class="sheet wide">
    <h3>Import Markdown</h3>
    <p class="hint">Paste an outline or a Runway Markdown export, or pick a .md file. Lines Runway can't read are kept as text with a warning.</p>
    <textarea name="v" rows="12" class="mono" aria-label="Markdown" placeholder="# Platform Q1 2027&#10;## Lane&#10;- Item | Jan-Mar 2027"></textarea>
    <footer><label class="btn ghost filepick">Choose a file<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" data-file hidden></label><span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Import</button></footer>
  </form>`;
}

export function confirmDialog(title, body, ok = 'Remove') {
  return `<form method="dialog" class="sheet small">
    <h3>${esc(title)}</h3><p>${esc(body)}</p>
    <footer><span class="grow"></span><button class="btn" value="cancel">Cancel</button><button class="btn danger" value="ok">${esc(ok)}</button></footer>
  </form>`;
}
