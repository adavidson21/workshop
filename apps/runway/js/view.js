/* Runway's HTML, as strings. Pure: no DOM, no state of its own. main.js paints these and wires events.
   Every piece of user text goes through esc(); only http(s) links are ever made clickable. */
import { SCALES, fmt } from './dates.js';
import { COLORS, IDEA_COLOR, LEVELS, LEVEL_COLORS, STATUSES, levels, linksIn, parentChoices, schedule } from './model.js';
import { PALETTE, esc } from './timeline.js';
import { summary } from './export.js';
import { adoOwner, choices, mentionOf, namesOf } from './people.js';

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

/** Pending assignment: ideas captured on Home that wait for a roadmap (js/pending.js). */
export function pendingHtml(p, hasMaps) {
  if (!p || !p.items.length) return '';
  const dot = `<span class="idot" style="--c:${PALETTE.light[IDEA_COLOR]};--cd:${PALETTE.dark[IDEA_COLOR]}" aria-hidden="true"></span>`;
  return `<section class="pending" id="pending" aria-label="Pending assignment">
    <h2 class="section-label">Pending assignment <span class="count">${p.items.length}</span></h2>
    <ul class="plist">${p.items.map(x => `<li class="prow-i">
      ${dot}<span class="ptext"><span class="ptitle">${esc(x.title)}</span>${x.notes ? `<span class="hint pnotes">${esc(x.notes)}</span>` : ''}</span>
      <span class="rmeta mono">${esc([x.from, x.date].filter(Boolean).join(' · '))}</span>
      <span class="racts">${hasMaps ? `<button class="btn" data-passign="${esc(x.id)}">Assign</button>` : ''}<button class="btn text-danger" data-premove="${esc(x.id)}">Remove</button></span>
    </li>`).join('')}</ul>
    ${hasMaps ? '' : '<p class="hint">Make a roadmap to assign these to.</p>'}
  </section>`;
}

/** Assign an idea: roadmap, lane, and what it sits under. The lane and Under lists are filled by main.js. */
export function assignDialog(idea, list, mapId) {
  return `<form method="dialog" class="sheet">
    <h3>Assign to a roadmap</h3>
    <p class="hint">${esc(idea.title)}</p>
    <label class="pf"><span>Roadmap</span><select name="map" data-amap>${[...list].sort((a, b) => b.changed - a.changed).map(r => `<option value="${esc(r.id)}"${r.id === mapId ? ' selected' : ''}>${esc(r.title)}</option>`).join('')}</select></label>
    <label class="pf"><span>Lane</span><select name="lane" data-alane><option value="">No lane</option></select></label>
    <label class="pf"><span>Under</span><select name="parent" data-aparent><option value="">Nothing (top level)</option></select><small class="hint">Pick an epic to make this a feature under it. It lands unscheduled; drag it onto the timeline from the tray.</small></label>
    <footer><span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Assign</button></footer>
  </form>`;
}

/** The options for a lane select and an Under select, from a roadmap. */
export function laneOptions(doc) {
  return `<option value="">No lane</option>${[...doc.lanes].sort((a, b) => a.order - b.order).map(l => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join('')}`;
}
export function underOptions(doc, lane) {
  const lv = levels(doc);
  return `<option value="">Nothing (top level)</option>${parentChoices(doc, null, lane).map(o => `<option value="${esc(o.id)}">${esc(LEVELS[lv.get(o.id) || 0])}: ${esc(o.title)}</option>`).join('')}`;
}

export function listHtml(v, { canPair = false, paired = false, ado = false, reports = false, pending = null } = {}) {
  const adoBtn = ado ? '<button class="btn" data-fromado>From Azure DevOps</button>' : '';
  const repLink = reports ? '<a class="btn ghost" href="#/reports" data-reports>Team reports</a>' : '';
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
    <div class="acts"><button class="btn primary" data-new>${ICON.plus}New roadmap</button><button class="btn" data-example>Start from an example</button><button class="btn ghost" data-import>Import Markdown</button>${adoBtn}${repLink}</div></div>`;
  return `<header class="lhead">
      <p class="eyebrow">Runway</p>
      <h1 class="page-title dot">Roadmaps</h1>
      ${v.list.length ? `<div class="lacts"><button class="btn primary" data-new>${ICON.plus}New roadmap</button><button class="btn" data-import>Import Markdown</button>${adoBtn}<button class="btn ghost" data-example>Example</button>${repLink}</div>` : ''}
    </header>
    ${pendingHtml(pending, v.list.length > 0)}
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

/* The owner filter: anyone, or a person or group from the people directory. Items not theirs (directly or
   through a group) are drawn faint. */
function ownerFilter(owner) {
  const list = choices();
  if (!list.length && !owner) return '';
  return `<label class="fld"><span class="sr">Owner</span><select data-owner aria-label="Owner">
    <option value=""${owner ? '' : ' selected'}>Anyone</option>
    ${list.map(it => `<option value="${esc(it.id)}"${owner === it.id ? ' selected' : ''}>${esc(it.name)}${it.kind === 'group' ? ' (group)' : ''}</option>`).join('')}</select></label>`;
}

export function rangeHtml(v, range, locked = false, owner = '') {
  const auto = !v.doc.meta.range;
  return `<div class="rbar">
    <span class="eyebrow">Showing</span>
    <label class="fld"><span class="sr">From</span><input type="date" data-from value="${esc(range.from)}" aria-label="From"></label>
    <span class="muted">to</span>
    <label class="fld"><span class="sr">To</span><input type="date" data-to value="${esc(range.to)}" aria-label="To"></label>
    <button class="btn ghost" data-fit${auto ? ' disabled' : ''}>Fit to items</button>
    ${ownerFilter(owner)}
    <span class="grow"></span>
    ${locked ? '' : `<button class="btn ghost" data-addlane>${ICON.plus}Lane</button>
    <button class="btn ghost" data-additem>${ICON.plus}Item <kbd>N</kbd></button>`}
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
goal: S1 | What this sprint delivers   (a month or Q2 on other scales)

## Lane
- Item | Jan-Mar 2027
- Item | Q2 | after: Other item | status: at risk | color: teal
- Item | Q3 | who: @sam, @leadership   owners, from People
- Item | S3-S4         sprints, W1-W2 for weeks
- Item | 2027-03-01..2027-03-20
- Item | 3 sprints     a length: starts after its "after" items
- * Milestone | 2027-04-15
  Indented lines are its description.
  - Child item | S3     an indented "- " line sits under the item
    (epic, feature, story, task: each level its own color)</code></pre></details>`;

/* ---------- under the timeline: goals and what each item delivers ---------- */

const ownersOf = (doc, id) => ((doc.items.find(x => x.id === id) || {}).who || []);

export function detailsHtml(doc, range, open = true) {
  const { goals, items } = summary(doc, range);
  const goalWord = doc.meta.scale === 'sprint' ? 'Sprint goals' : 'Goals';
  const body = `
    <div class="dcol"><h4 class="section-label">${goalWord}</h4>
      ${goals.length ? `<ul class="dlist">${goals.map(g => `<li><button class="dname" data-goal="${esc(g.start)}">${esc(g.name)}</button><p>${esc(g.text)}</p></li>`).join('')}</ul>`
        : `<p class="hint">No goals in these dates. Click a cell in the goals row above the lanes, or write <code>goal: ${doc.meta.scale === 'sprint' ? 'S1' : doc.meta.scale === 'quarter' ? 'Q1' : 'Jan'} | ...</code> in the outline.</p>`}
    </div>
    <div class="dcol"><h4 class="section-label">What's getting done</h4>
      ${items.length ? `<ul class="dlist">${items.map(it => `<li><button class="dname" data-pick="${esc(it.id)}">${esc(it.title)}</button><span class="hint">${esc([it.lane, it.milestone ? fmt(it.start) : `${fmt(it.start)} to ${fmt(it.end)}`, it.status !== 'planned' ? it.status : '', namesOf(ownersOf(doc, it.id)).join(', ')].filter(Boolean).join(' · '))}</span><p>${esc(it.notes)}</p></li>`).join('')}</ul>`
        : '<p class="hint">Add a description to an item (its panel, or indented lines under it in the outline) to say what it delivers.</p>'}
    </div>`;
  return `<details class="details" data-details${open ? ' open' : ''}><summary>Goals and descriptions <span class="hint">${goals.length} goal${goals.length === 1 ? '' : 's'}, ${items.length} described</span></summary><div class="dgrid">${body}</div></details>`;
}

export function goalDialog(name, text) {
  return `<form method="dialog" class="sheet small">
    <h3>Goal</h3>
    <p class="hint">${esc(name)}</p>
    <label class="pf"><span>What this period delivers</span><textarea name="v" rows="3" maxlength="300" autofocus>${esc(text)}</textarea></label>
    <footer>${text ? '<button class="btn text-danger" value="clear" formnovalidate>Clear</button>' : ''}<span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save</button></footer>
  </form>`;
}

/* ---------- the item panel ---------- */

export function panelHtml(doc, id, sched = schedule(doc), readOnly = false, { addPerson = !readOnly, workItems = null } = {}) {
  const it = doc.items.find(x => x.id === id && x.kind === 'item');
  if (!it) return '';
  const s = sched.get(id);
  const ro = readOnly ? ' disabled' : '';
  const lanes = [{ id: '', title: 'No lane' }, ...[...doc.lanes].sort((a, b) => a.order - b.order)];
  const others = doc.items.filter(x => x.kind === 'item' && x.id !== id);
  const links = linksIn(it.notes);
  const sized = !it.start && it.size;
  const level = levels(doc).get(id) || 0;
  const under = parentChoices(doc, id);
  const lvAll = levels(doc);
  return `<form class="panel" data-panel="${esc(id)}" aria-label="Item">
    <header><span class="eyebrow">${it.milestone ? 'Milestone' : LEVELS[level]}</span><button type="button" class="ibtn" data-close aria-label="Close">${ICON.close}</button></header>
    <label class="pf"><span>Title</span><input data-f="title" value="${esc(it.title)}" maxlength="200"${ro}></label>
    <label class="pf"><span>Lane</span><select data-f="lane"${ro}>${lanes.map(l => `<option value="${esc(l.id)}"${(it.lane || '') === l.id ? ' selected' : ''}>${esc(l.title)}</option>`).join('')}</select></label>
    <label class="pf"><span>Under</span><select data-f="parent"${ro}><option value="">Nothing (top level)</option>${under.map(o => `<option value="${esc(o.id)}"${it.parent === o.id ? ' selected' : ''}>${esc(LEVELS[lvAll.get(o.id) || 0])}: ${esc(o.title)}</option>`).join('')}</select><small class="hint">Epic, then feature, story and task. Each level has its own color.</small></label>
    <label class="pc"><input type="checkbox" data-f="milestone"${it.milestone ? ' checked' : ''}${ro}> Milestone (one date)</label>
    ${sized ? `<p class="hint">${esc(`${it.size.n} ${it.size.unit}${it.size.n === 1 ? '' : 's'}`)}${s ? `, ${esc(fmt(s.start))} to ${esc(fmt(s.end))}` : ''}. Set dates to pin it.</p>` : ''}
    <div class="prow">
      <label class="pf"><span>${it.milestone ? 'Date' : 'Start'}</span><input type="date" data-f="start" value="${esc(it.start || (s ? s.start : ''))}"${ro}></label>
      ${it.milestone ? '' : `<label class="pf"><span>End</span><input type="date" data-f="end" value="${esc(it.end || (s ? s.end : ''))}"${ro}></label>`}
    </div>
    ${it.start || sized ? `<button type="button" class="lnk" data-unschedule${ro}>Unschedule</button>` : ''}
    <label class="pf"><span>Status</span><select data-f="status"${ro}>${STATUSES.map(x => `<option value="${x}"${it.status === x ? ' selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></label>
    <label class="pf"><span>Owners</span><input data-f="who" list="ownerList" value="${esc((it.who || []).map(id => mentionOf(id)).join(', '))}" placeholder="@name or @group, separated by commas" autocomplete="off"${ro}>
      <datalist id="ownerList">${choices().map(o => `<option value="@${esc(o.handle)}" label="${esc(o.name)}${o.kind === 'group' ? ' (group)' : ''}">`).join('')}</datalist>
      <small class="hint">People and groups from People in Workshop. A new name is added there as a contact.</small></label>
    <fieldset class="pf"><legend>Color</legend><div class="swatches">
      <label class="swl" title="${LEVELS[level]} color"><input type="radio" name="color" data-f="color" value=""${!it.color ? ' checked' : ''}${ro}><span class="swc auto" style="--c:${PALETTE.light[LEVEL_COLORS[level]]};--cd:${PALETTE.dark[LEVEL_COLORS[level]]}">A</span></label>
      ${COLORS.map(c => `<label class="swl" title="${c}"><input type="radio" name="color" data-f="color" value="${c}"${it.color === c ? ' checked' : ''}${ro}><span class="swc" style="--c:${PALETTE.light[c]};--cd:${PALETTE.dark[c]}"></span></label>`).join('')}
    </div></fieldset>
    <fieldset class="pf"><legend>Starts after</legend>${others.length ? `<div class="deps">${others.map(o => `<label class="pc"><input type="checkbox" data-dep="${esc(o.id)}"${it.dependsOn.includes(o.id) ? ' checked' : ''}${ro}> ${esc(o.title)}</label>`).join('')}</div>` : '<p class="hint">No other items yet.</p>'}
      ${it.afterMissing.length ? `<p class="hint">Not in this roadmap: ${esc(it.afterMissing.join(', '))}</p>` : ''}</fieldset>
    ${it.ado ? adoPanel(it, readOnly, { addPerson }) : ''}
    ${workItems ? `<div class="pf"><span>Work item</span><div class="prow"><button type="button" class="btn" data-workitem>${esc(workItems)}</button></div><small class="hint">Triage it, define its stories and publish them to ADO, then delegate it or build it yourself.</small></div>` : ''}
    <label class="pf"><span>Description</span><textarea data-f="notes" rows="4" maxlength="4000" placeholder="What this delivers, and why"${ro}>${esc(it.notes)}</textarea><small class="hint">Shows under the timeline and in exports.</small></label>
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
      <label class="pc"><input type="checkbox" name="details" checked> Goals and descriptions</label>
      <label class="pc"><input type="checkbox" name="today" checked> Today line</label>
      ${doc.items.some(i => i.ado) ? '<label class="pc"><input type="checkbox" name="ids"> ADO ids</label>' : ''}
      <label class="pf inline"><span>Theme</span><select name="theme"><option value="light"${dark ? '' : ' selected'}>Light (for printing)</option><option value="dark"${dark ? ' selected' : ''}>Dark</option></select></label>
    </div>
    <div class="acts"><button type="button" class="btn primary" data-x="png">${ICON.down}PNG image</button><button type="button" class="btn" data-x="svg">${ICON.down}SVG image</button></div>
    <h4 class="section-label">Markdown</h4>
    <label class="pc"><input type="checkbox" name="table"> Add a table (lane, item, dates, status, after, description)</label>
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

/* ---------- Azure DevOps (optional: shown only for roadmaps or items that use it) ---------- */

const ADO_FIELDS = { title: 'Title', start: 'Start', end: 'End', status: 'Status', who: 'Owners' };
const httpOnly = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

/** The ADO part of the item panel: its work item, and what to do when it differs or is gone. `addPerson` offers
    to add an Assigned To that People does not have (also on a live roadmap, whose items can't be edited). */
export function adoPanel(it, readOnly = false, { addPerson = !readOnly } = {}) {
  const a = it.ado;
  const url = httpOnly(a.url);
  const name = `${esc(a.type || 'Work item')} #${esc(a.id)}`;
  // Fields ADO's values differ in. A `remote` saved before owners came from ADO has no `who`.
  const norm = (f, x) => (f === 'who' ? [...(x || [])].sort().join(',') : x ?? null);
  const diff = a.remote ? Object.keys(ADO_FIELDS).filter(f => f in a.remote && norm(f, a.remote[f]) !== norm(f, it[f])) : [];
  const val = (f, x) => esc(f === 'start' || f === 'end' ? (x ? fmt(x) : 'none') : f === 'who' ? (namesOf(x).join(', ') || 'none') : (x || 'none'));
  // Assigned To in ADO that People does not have: say so, and offer to add them with that identity.
  const asg = a.assignee && (a.assignee.name || a.assignee.email) ? a.assignee : null;
  const unmatched = asg && !adoOwner(asg);
  return `<div class="adobox" data-adobox>
    <p class="eyebrow">Azure DevOps</p>
    <p>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name}${a.state ? ` <span class="muted">· ${esc(a.state)}</span>` : ''}</p>
    ${unmatched ? `<p class="hint">Assigned to ${esc(asg.name || asg.email)} in ADO, who is not in People.${!addPerson ? '' : ' <button type="button" class="lnk" data-ado-person>Add to People</button>'}</p>` : ''}
    ${a.missing ? '<p class="hint warn">The last refresh did not find this work item (closed, moved or removed).</p>' : ''}
    ${diff.length ? `<p class="hint warn">Differs from ADO:</p><ul class="adodiff">${diff.map(f => `<li><span class="muted">${ADO_FIELDS[f]}:</span> yours ${val(f, it[f])}, ADO ${val(f, a.remote[f])}</li>`).join('')}</ul>` : ''}
    ${readOnly ? '' : `<div class="acts">${diff.length ? '<button type="button" class="btn" data-ado-use>Use ADO&#39;s</button><button type="button" class="btn ghost" data-ado-keep>Keep mine</button>' : ''}<button type="button" class="lnk" data-ado-unlink>Unlink</button></div>`}
  </div>`;
}

/** The strip above the timeline for a roadmap that follows ADO, or the offer to add items from it. */
export function adoBarHtml(doc, { ready = false, message = '', refreshing = false, readOnly = false, publish = 0, publishing = false } = {}) {
  const src = doc.meta.ado;
  if (!src) return ready && !readOnly ? `<div class="adobar"><span class="grow"></span><button class="btn ghost" data-addado>Add items from Azure DevOps</button></div>` : '';
  const live = src.mode === 'live';
  const differs = doc.items.filter(i => i.ado && i.ado.remote).length;
  const missing = doc.items.filter(i => i.ado && i.ado.missing).length;
  const when = src.fetchedAt ? relTime(Date.parse(src.fetchedAt)) : 'not yet';
  return `<div class="adobar">
    <span class="eyebrow">Azure DevOps</span>
    <span>${live ? 'Live view, read only' : 'Linked'} · ${esc(src.areas.length)} area path${src.areas.length === 1 ? '' : 's'} · updated ${esc(when)}${src.truncated ? ' · showing the newest 2000' : ''}</span>
    ${differs ? `<button class="lnk" data-adodiff>${differs} differ${differs === 1 ? 's' : ''} from ADO</button>` : ''}
    ${missing ? `<span class="muted">${missing} not found</span>` : ''}
    ${!ready ? `<span class="muted">${esc(message || 'Connect Workshop on this computer to refresh.')} Showing the last copy.</span>` : ''}
    <span class="grow"></span>
    ${ready && !readOnly && !live && publish > 0 ? `<button class="btn primary" data-adopublish${refreshing || publishing ? ' disabled' : ''} title="Send your changes to ADO, after a preview">${publishing ? 'Publishing' : `Publish (${esc(publish)})`}</button>` : ''}
    ${ready && !readOnly ? `<button class="btn ghost" data-adorefresh${refreshing ? ' disabled' : ''}>${refreshing ? 'Refreshing' : 'Refresh'}</button><button class="btn ghost" data-adoedit>Change</button>` : ''}
    ${readOnly ? '' : `<button class="btn ghost" data-adostop>${live ? 'Make editable' : 'Stop following'}</button>`}
  </div>`;
}

/** Choose what to read from ADO. `mode` false hides the live or linked choice (adding to an existing roadmap). */
export function adoDialog({ title = '', areas = [], connection = '', types = ['Epic', 'Feature'], lanes = 'area', mode = 'linked', includeClosed = false, chooseMode = true, heading = 'From Azure DevOps' } = {}) {
  const t = (x, label) => `<label class="pc"><input type="checkbox" name="type" value="${x}"${types.includes(x) ? ' checked' : ''}> ${label}</label>`;
  return `<form method="dialog" class="sheet wide">
    <h3>${esc(heading)}</h3>
    ${chooseMode ? `<label class="pf"><span>Name</span><input name="title" value="${esc(title)}" maxlength="120" required autofocus></label>
    <fieldset class="pf"><legend>Kind</legend>
      <label class="pc"><input type="radio" name="mode" value="linked"${mode !== 'live' ? ' checked' : ''}> Import, then edit freely. Refresh adds new work items and shows what differs; it never overwrites your edits. Add your own items too.</label>
      <label class="pc"><input type="radio" name="mode" value="live"${mode === 'live' ? ' checked' : ''}> Live view of ADO. Rebuilt on every refresh; items can't be edited here.</label>
    </fieldset>` : ''}
    <label class="pf"><span>Area paths</span><textarea name="areas" rows="4" class="mono" required placeholder="Project\\Team">${esc(areas.join('\n'))}</textarea><small class="hint">One per line. Work items under each are included.</small></label>
    <div class="prow"><fieldset class="pf"><legend>Work items</legend>${t('Epic', 'Epics')}${t('Feature', 'Features')}${t('User Story', 'User Stories, named Feature &gt; Story')}</fieldset>
      <label class="pf inline"><span>Lanes by</span><select name="lanes"><option value="area"${lanes !== 'epic' ? ' selected' : ''}>Area path</option><option value="epic"${lanes === 'epic' ? ' selected' : ''}>Epic</option></select></label></div>
    <label class="pc"><input type="checkbox" name="closed"${includeClosed ? ' checked' : ''}> Include closed work items</label>
    <label class="pf"><span>ADO connection</span><input name="connection" value="${esc(connection)}" maxlength="40" placeholder="The connector's default"><small class="hint">Reading changes nothing in ADO. Only Publish writes, after a preview.</small></label>
    <footer><span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${chooseMode ? 'Create' : 'Add'}</button></footer>
  </form>`;
}

/* ---------- Publish to ADO (js/ado/publish.js makes the plan; every ADO text is escaped here) ---------- */

const PUB_STATUS = { send: 'Will update', conflict: 'Conflict, skipped', skip: 'Not sent' };
const RESULT = { updated: 'Updated', conflict: 'Conflict, skipped', failed: 'Failed', skipped: 'Skipped' };
const workItem = (type, id, url) => {
  const name = `${esc(type || 'Work item')} #${esc(id)}`;
  const u = httpOnly(url);
  return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name;
};

/** The preview: every linked item with changes, each field from what ADO has to what Publish sends, and why a
    field or an item is not sent. Confirming returns the form. */
export function publishDialog(plan) {
  const rows = plan.rows.map(r => `<li class="pubrow" data-pub-row="${esc(r.status)}" data-ado-id="${esc(r.adoId)}">
      <p class="pubhead"><span class="pubtitle">${workItem(r.type, r.adoId, r.url)} <span class="ptitle">${esc(r.title)}</span></span><span class="pubtag" data-tag="${esc(r.status)}">${esc(PUB_STATUS[r.status])}</span></p>
      ${r.why ? `<p class="hint${r.status === 'conflict' ? ' warn' : ''}">${esc(r.why)}</p>` : ''}
      <table class="pubtable"><thead><tr><th>Field</th><th>In ADO now</th><th>After publish</th></tr></thead><tbody>
      ${r.fields.map(f => `<tr${f.sent ? ' data-sent' : ''}><td>${esc(f.label)}</td><td>${esc(f.from)}</td><td>${f.sent ? `<strong>${esc(f.to)}</strong>` : `${esc(f.to)}<br><small class="hint">Not sent.${f.why ? ` ${esc(f.why)}` : ''}</small>`}</td></tr>`).join('')}
      </tbody></table></li>`).join('');
  const n = plan.send;
  return `<form method="dialog" class="sheet wide pubsheet">
    <h3>Publish to Azure DevOps</h3>
    <p class="hint">Runway sends only what is in bold, through Workshop's ADO connector: titles, Assigned To, start and target dates, and sprints. It never creates work items, adds comments, or changes states or area paths. An item someone changed in ADO since Runway read it is skipped, not overwritten.</p>
    ${plan.rows.length ? `<ul class="publist">${rows}</ul>` : '<p>No changes to publish.</p>'}
    <footer><span class="hint">${esc(n)} work item${n === 1 ? '' : 's'} to update${plan.conflicts ? `, ${esc(plan.conflicts)} conflict${plan.conflicts === 1 ? '' : 's'}` : ''}</span><span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok" data-pub-confirm${n ? '' : ' disabled'}>Publish ${esc(n)}</button></footer>
  </form>`;
}

/** What happened to each work item. */
export function publishResultsDialog(results) {
  const count = k => results.filter(r => r.outcome === k).length;
  const SUM = { updated: 'updated', conflict: 'skipped for a conflict', failed: 'failed', skipped: 'not sent' };
  const sum = ['updated', 'conflict', 'failed', 'skipped'].map(k => count(k) && `${count(k)} ${SUM[k]}`).filter(Boolean).join(', ');
  return `<form method="dialog" class="sheet wide pubsheet">
    <h3>Published to Azure DevOps</h3>
    <p class="hint">${esc(sum || 'Nothing was sent.')}. Runway refreshes from ADO now.</p>
    <ul class="publist">${results.map(r => `<li class="pubrow" data-pub-result="${esc(r.outcome)}" data-ado-id="${esc(r.adoId)}">
      <p class="pubhead"><span class="pubtitle">#${esc(r.adoId)} <span class="ptitle">${esc(r.title)}</span></span><span class="pubtag" data-tag="${esc(r.outcome)}">${esc(RESULT[r.outcome] || r.outcome)}</span></p>
      ${r.message ? `<p class="hint">${esc(r.message)}</p>` : ''}</li>`).join('')}</ul>
    <footer><span class="grow"></span><button class="btn primary" value="ok">Done</button></footer>
  </form>`;
}
