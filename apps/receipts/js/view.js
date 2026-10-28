/* Receipts: the page, as HTML strings. No DOM and no connection: main.js paints what these return and
   handles the clicks, so Node tests can check the markup (escaping above all).

   Every piece of entry and person text goes through h(). Links are clickable only when they are http(s);
   anything else (javascript:, data:, a typo) is shown as text. Text that names people or describes their
   work carries the class `sensitive`, which the blur toggle blurs for screen sharing. */
import {
  ARTIFACTS, EFFORTS, KINDS, METRIC_SOURCES, RELATIONS, VISIBILITY, CSV_COLUMNS,
  categoriesFor, coverage, daysBetween, entriesIn, isHttp, lastEntryDate, reviewReasons, sortedCycles
} from './model.js';
import { entryText, metricTotals } from './summarize/template.js';

/* ---------- helpers ---------- */

export function h(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/** A link only for http(s) URLs, opening in a new tab; anything else is plain text. */
export function link(url, text) {
  const u = String(url || '').trim();
  if (!isHttp(u)) return `<span class="badlink">${h(text || u)}</span>`;
  return `<a href="${h(u)}" target="_blank" rel="noopener noreferrer">${h(text || u)}</a>`;
}
export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const sel = (a, b) => (a === b ? ' selected' : '');
const pressed = on => ` aria-pressed="${on ? 'true' : 'false'}"`;
const kindName = id => (KINDS.find(k => k.id === id) || { name: id }).name;
const relName = id => (RELATIONS.find(r => r.id === id) || { name: id }).name;
const rubricName = (s, id) => (s.rubric.find(r => r.id === id) || { name: id }).name;
const roleName = (s, id) => (s.roles.find(r => r.id === id) || { name: '' }).name;
export function niceDate(d) {
  if (!d) return '';
  const t = new Date(d + 'T12:00:00Z');
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/* ---------- the frame: header and tabs ---------- */

export const TABS = [
  { id: 'log', name: 'Log' },
  { id: 'person', name: 'Person' },
  { id: 'review', name: 'Needs review' },
  { id: 'team', name: 'Team' },
  { id: 'packet', name: 'Review packet' }
];

const ICON = {
  eye: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.3"/></svg>',
  eyeOff: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l14 14M8.3 5A7.7 7.7 0 0 1 10 4.5c5 0 8 5.5 8 5.5a14 14 0 0 1-2.4 3M5.4 6.4C3.3 7.9 2 10 2 10s3 5.5 8 5.5a7.4 7.4 0 0 0 3.2-.7M8.4 8.4a2.3 2.3 0 0 0 3.2 3.2"/></svg>',
  gear: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"/></svg>'
};

const STATUS = { saved: 'Saved', saving: 'Saving', error: 'Not saved yet', readonly: 'Read only', waiting: 'Waiting for the folder', loading: 'Loading' };

/** The header: title, the tabs, the save status, blur and settings buttons. */
export function header(V) {
  const n = V.reviewCount || 0;
  const tabs = TABS.map(t => `<button type="button" class="tab" role="tab" data-tab="${t.id}" aria-selected="${V.view === t.id}"${V.waiting ? ' disabled' : ''}>${h(t.name)}${t.id === 'review' && n ? ` <span class="count">${n}</span>` : ''}</button>`).join('');
  const st = V.status || 'saved';
  return `<header class="rhead">
  <div class="rtitle"><p class="eyebrow">${h(V.cycleName ? 'Current cycle: ' + V.cycleName : 'Performance evidence')}</p><h1 class="page-title dot">Receipts</h1></div>
  <div class="rtools">
    <span class="save" data-save="${h(st)}" role="status"${V.statusTip ? ` title="${h(V.statusTip)}"` : ''}>${h(STATUS[st] || st)}</span>
    <button type="button" class="ibtn" data-blur aria-pressed="${V.blurred ? 'true' : 'false'}" aria-label="${V.blurred ? 'Show names and notes' : 'Blur names and notes for screen sharing'}" title="${V.blurred ? 'Unblur' : 'Blur for screen sharing'}">${V.blurred ? ICON.eyeOff : ICON.eye}</button>
    <button type="button" class="ibtn" data-tab="settings" aria-pressed="${V.view === 'settings' ? 'true' : 'false'}" aria-label="Receipts settings" title="Receipts settings"${V.waiting ? ' disabled' : ''}>${ICON.gear}</button>
  </div>
</header>
<nav class="tabs" role="tablist" aria-label="Views">${tabs}</nav>`;
}

/** The folder-permission wait: no data, nothing to add or edit, and where to click. */
export function waitingHtml(embedded) {
  return `<div class="engcard waiting-empty" role="status"><h2>Allow Workshop to use your folder to see your receipts</h2>
<p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop. Chrome asks again after it restarts.'
    : 'Open Workshop and click <b>Allow</b> in the bar at the top. Chrome asks again after it restarts.'}</p>
<p>Your entries are safe in the folder. They appear here, ready to edit, once Workshop may use the folder.</p>
${embedded ? '' : '<div class="acts"><button type="button" class="btn primary" data-open-workshop>Open Workshop</button></div>'}</div>`;
}

export function errorHtml(message) {
  return `<div class="engcard" role="alert"><h2>Could not load your receipts</h2><p>${h(message)}</p><p>Nothing will be saved until this is fixed, so nothing is written over your files.</p></div>`;
}

/* ---------- pickers ---------- */

export function personPicker(V, current, name = 'person') {
  return `<select class="inp" name="${name}" data-pick="${name}" aria-label="Person">${V.people.map(p =>
    `<option value="${h(p.id)}"${sel(p.id, current)} class="sensitive">${h(p.name)}${p.relation === 'self' && p.name !== 'You' ? ' (you)' : ''}${p.active === false ? ' (inactive)' : ''}</option>`).join('')}</select>`;
}
export function cyclePicker(V, current, name = 'cycle') {
  return `<select class="inp" name="${name}" data-pick="${name}" aria-label="Cycle">${sortedCycles(V.settings).reverse().map(c =>
    `<option value="${h(c.id)}"${sel(c.id, current)}>${h(c.name)}</option>`).join('')}</select>`;
}

/* ---------- the entry form (Log, and editing in place) ---------- */

function chips(name, options, selected, { multi = false, primary = false } = {}) {
  return `<div class="chips" role="group" data-chips="${name}"${multi ? ` data-multi data-sel="${h(selected.join(','))}"` : ''}>${options.map((o, i) => {
    const on = selected.includes(o.id);
    const first = primary && on && selected[0] === o.id;
    return `<button type="button" class="chip${first ? ' primary' : ''}" data-chip="${h(o.id)}"${pressed(on)}${o.title ? ` title="${h(o.title)}"` : ''}>${h(o.name)}${first ? '<span class="tag">primary</span>' : ''}</button>`;
  }).join('')}</div>`;
}

/**
 * The form for one entry. `entry` is null for a new one. `person` decides the categories.
 * Fields carry name attributes; main.js reads them with readForm().
 */
export function entryForm(V, entry, person, { mode = 'log' } = {}) {
  const e = entry || { kind: 'win', date: V.today, rubric: [], note: '', category: '' };
  const s = V.settings;
  const cats = categoriesFor(s, person && person.role);
  const catOpts = [...new Set([...cats, ...(e.category && !cats.includes(e.category) ? [e.category] : [])])];
  const more = !!(e.bullet || e.impact || e.effort || e.strategic || e.riskReduced || e.visibility || (e.collaborators || []).length
    || e.artifact || (e.links || []).length || e.metric || e.metricSource || (e.tags || []).length || e.review);
  const opt = (list, v, blank = '') => `<option value="">${blank}</option>` + list.map(x => `<option value="${h(x)}"${sel(x, v)}>${h(x)}</option>`).join('');
  return `<form class="entry-form" data-form="${mode}"${entry ? ` data-entry="${h(entry.id)}" data-year="${h(entry.date.slice(0, 4))}"` : ''} autocomplete="off">
  <div class="row">
    ${mode === 'log' ? `<label class="fld"><span class="lbl">Person</span>${personPicker({ people: V.people.filter(p => p.active !== false) }, person && person.id, 'person')}</label>` : ''}
    <label class="fld"><span class="lbl">Date</span><input class="inp" type="date" name="date" value="${h(e.date)}" required></label>
  </div>
  <div class="fld"><span class="lbl">Kind</span>${chips('kind', KINDS, [e.kind])}</div>
  <label class="fld"><span class="lbl">What happened</span><textarea class="inp sensitive" name="note" rows="${mode === 'log' ? 3 : 4}" required placeholder="What they did, the result, and how you know.">${h(e.note)}</textarea></label>
  <div class="fld"><span class="lbl">Rubric <small>up to 3; the first is primary</small></span>${chips('rubric', s.rubric.map(r => ({ id: r.id, name: r.name, title: r.description })), e.rubric || [], { multi: true, primary: true })}</div>
  ${catOpts.length ? `<div class="fld"><span class="lbl">Category</span>${chips('category', catOpts.map(c => ({ id: c, name: c })), e.category ? [e.category] : [])}</div>` : ''}
  <details class="more"${more ? ' open' : ''}><summary>More details</summary>
    <label class="fld"><span class="lbl">Review bullet</span><textarea class="inp sensitive" name="bullet" rows="2" placeholder="One sentence you could paste into a review.">${h(e.bullet || '')}</textarea></label>
    <div class="row">
      <label class="fld"><span class="lbl">Impact</span><select class="inp" name="impact">${opt(['1', '2', '3', '4', '5'], e.impact ? String(e.impact) : '')}</select></label>
      <label class="fld"><span class="lbl">Effort</span><select class="inp" name="effort">${opt(EFFORTS, e.effort || '')}</select></label>
      <label class="fld"><span class="lbl">Risk reduced</span><select class="inp" name="riskReduced">${opt(['0', '1', '2', '3', '4', '5'], e.riskReduced != null ? String(e.riskReduced) : '')}</select></label>
      <label class="fld"><span class="lbl">Visibility</span><select class="inp" name="visibility">${opt(VISIBILITY, e.visibility || '')}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="strategic"${e.strategic ? ' checked' : ''}> Strategic: tied to a team or company goal</label>
    <div class="row">
      <label class="fld"><span class="lbl">Metric</span><input class="inp sensitive" name="metric" value="${h(e.metric || '')}" placeholder="Only a number you know"></label>
      <label class="fld"><span class="lbl">Metric source</span><select class="inp" name="metricSource">${opt(METRIC_SOURCES, e.metricSource || '')}</select></label>
    </div>
    <div class="row">
      <label class="fld"><span class="lbl">Artifact</span><select class="inp" name="artifact">${opt(ARTIFACTS, e.artifact || '')}</select></label>
      <label class="fld"><span class="lbl">Collaborators <small>comma separated</small></span><input class="inp sensitive" name="collaborators" value="${h((e.collaborators || []).join(', '))}"></label>
    </div>
    <label class="fld"><span class="lbl">Links <small>one per line, http(s) only</small></span><textarea class="inp" name="links" rows="2">${h((e.links || []).join('\n'))}</textarea></label>
    <label class="fld"><span class="lbl">Tags <small>comma separated</small></span><input class="inp" name="tags" value="${h((e.tags || []).join(', '))}"></label>
    <label class="check"><input type="checkbox" name="review"${e.review ? ' checked' : ''}> Mark for review</label>
  </details>
  <div class="acts">
    ${mode === 'log' ? '<span class="hint"><kbd>Ctrl</kbd> <kbd>Enter</kbd> saves</span>' : ''}
    ${mode === 'edit' ? '<button type="button" class="btn text-danger" data-delete>Delete</button><span class="grow"></span><button type="button" class="btn ghost" data-cancel>Cancel</button>' : ''}
    <button type="submit" class="btn primary"${V.readOnly ? ' disabled' : ''}>${mode === 'log' ? 'Save receipt' : 'Save'}</button>
  </div>
</form>`;
}

/* ---------- an entry, read-only ---------- */

export function entryCard(V, e, { person = null, editing = false } = {}) {
  if (editing) return `<article class="entry editing" data-entry-id="${h(e.id)}">${entryForm(V, e, person, { mode: 'edit' })}</article>`;
  const s = V.settings;
  const rub = (e.rubric || []).map((r, i) => `<span class="pill${i === 0 ? ' primary' : ''}">${h(rubricName(s, r))}</span>`).join('');
  const reasons = reviewReasons(e);
  const links = (e.links || []).map(u => link(u)).join(' ');
  const text = e.bullet && e.bullet.trim() ? e.bullet : null;
  return `<article class="entry" data-entry-id="${h(e.id)}" data-kind="${h(e.kind)}">
  <div class="emeta"><span class="kind k-${h(e.kind)}">${h(kindName(e.kind))}</span><time class="mono">${h(niceDate(e.date))}</time>${person ? `<span class="who sensitive">${h(person.name)}</span>` : ''}${rub}${e.category ? `<span class="pill cat">${h(e.category)}</span>` : ''}</div>
  ${text ? `<p class="bullet sensitive">${h(text)}</p>` : ''}
  <p class="note sensitive${text ? ' sub' : ''}">${h(e.note)}</p>
  ${e.metric ? `<p class="metric sensitive"><span class="lbl">Metric</span> ${h(e.metric)}${e.metricSource ? ` <span class="sub">(${h(e.metricSource)})</span>` : ''}</p>` : ''}
  ${links ? `<p class="links">${links}</p>` : ''}
  <div class="eacts">${reasons.length ? `<span class="needs">Needs ${h(reasons.map(r => r === 'marked' ? 'a look' : r === 'rubric' ? 'a rubric section' : 'a bullet').join(', '))}</span>` : ''}<span class="grow"></span>${V.readOnly ? '' : `<button type="button" class="lnk" data-edit="${h(e.id)}">Edit</button>`}</div>
</article>`;
}

/* ---------- 1. Log ---------- */

export function logView(V) {
  const person = V.people.find(p => p.id === V.logPerson) || V.people.find(p => p.active !== false);
  if (!person) return '<div class="engcard"><h2>No people yet</h2><p>Add someone in settings first.</p></div>';
  const recent = [...(V.entries[person.id] || [])].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  return `<section class="view log" aria-label="Log a receipt">
  <div class="logform">${entryForm(V, null, person, { mode: 'log' })}</div>
  <aside class="recent"><h2 class="section-label">Recent for <span class="sensitive">${h(person.name)}</span></h2>
    ${recent.length ? recent.map(e => entryCard(V, e, { editing: V.editing === e.id, person })).join('') : '<p class="sub">Nothing logged yet. The first receipt is the hardest.</p>'}
  </aside>
</section>`;
}

/* ---------- 2. Person ---------- */

export function coverageStrip(V, cov) {
  const s = V.settings;
  const cells = s.rubric.map(r => `<div class="cov${cov.bySection[r.id] ? '' : ' gap'}" title="${h(r.description || '')}"><span class="n">${cov.bySection[r.id]}</span><span class="lbl">${h(r.name)}</span></div>`).join('');
  const gaps = cov.gaps.map(id => rubricName(s, id));
  return `<div class="coverage">${cells}</div>
<p class="gaps">${gaps.length ? `<b>No entries yet for:</b> ${h(gaps.join(', '))}.` : 'Every rubric section has at least one entry.'}</p>`;
}

export function personView(V) {
  const person = V.people.find(p => p.id === V.personId) || V.people[0];
  if (!person) return '<div class="engcard"><h2>No people yet</h2><p>Add someone in settings first.</p></div>';
  const cycle = V.settings.cycles.find(c => c.id === V.cycleId) || V.cycle;
  const all = cycle ? entriesIn(V.entries[person.id] || [], cycle) : [];
  const cov = coverage(all, V.settings.rubric);
  const f = V.filter || {};
  const shown = all.filter(e => (!f.kind || e.kind === f.kind) && (!f.rubric || (e.rubric || []).includes(f.rubric))).reverse();
  const kindOpts = `<option value="">Every kind</option>` + KINDS.map(k => `<option value="${k.id}"${sel(k.id, f.kind)}>${h(k.name)}</option>`).join('');
  const rubOpts = `<option value="">Every section</option>` + V.settings.rubric.map(r => `<option value="${h(r.id)}"${sel(r.id, f.rubric)}>${h(r.name)}</option>`).join('');
  return `<section class="view person" aria-label="Person">
  <div class="bar">${personPicker(V, person.id, 'personId')}${cyclePicker(V, cycle && cycle.id, 'cycleId')}
    <select class="inp" data-filter="kind" aria-label="Kind">${kindOpts}</select>
    <select class="inp" data-filter="rubric" aria-label="Rubric section">${rubOpts}</select>
    <span class="grow"></span><button type="button" class="btn" data-log-for="${h(person.id)}">Log for <span class="sensitive">${h(person.name)}</span></button></div>
  <div class="phead"><h2 class="sensitive">${h(person.name)}</h2><p class="sub">${h(relName(person.relation))}${roleName(V.settings, person.role) ? ' · ' + h(roleName(V.settings, person.role)) : ''} · ${plural(all.length, 'entry', 'entries')} in ${h(cycle ? cycle.name : 'no cycle')}</p></div>
  ${coverageStrip(V, cov)}
  <div class="timeline">${shown.length ? shown.map(e => entryCard(V, e, { person, editing: V.editing === e.id })).join('') : `<p class="sub empty">${all.length ? 'No entries match these filters.' : 'No entries in this cycle yet.'}</p>`}</div>
</section>`;
}

/* ---------- 3. Needs review ---------- */

export function reviewItems(V) {
  const out = [];
  for (const p of V.people) for (const e of V.entries[p.id] || []) if (reviewReasons(e).length) out.push({ person: p, entry: e });
  return out.sort((a, b) => b.entry.date.localeCompare(a.entry.date) || a.entry.id.localeCompare(b.entry.id));
}

export function reviewView(V) {
  const items = reviewItems(V);
  return `<section class="view review" aria-label="Needs review">
  <p class="lede">Entries missing a rubric section or a review bullet, or marked for review. Edit them here.</p>
  ${items.length ? items.map(({ person, entry }) => entryCard(V, entry, { person, editing: V.editing === entry.id })).join('')
    : '<div class="engcard"><h2>Nothing to review</h2><p>Every entry has a rubric section and a bullet.</p></div>'}
</section>`;
}

/* ---------- 4. Team ---------- */

/** One row per active person for a cycle. */
export function teamRows(V, cycle) {
  return V.people.filter(p => p.active !== false).map(p => {
    const all = V.entries[p.id] || [];
    const inC = cycle ? entriesIn(all, cycle) : [];
    const cov = coverage(inC, V.settings.rubric);
    const last = lastEntryDate(all);
    const idle = last ? daysBetween(last, V.today) : null;
    const metrics = metricTotals((V.metrics[p.id] || {})[cycle && cycle.id] || []);
    return { person: p, count: inC.length, last, idle, wins: cov.byKind.win, concerns: cov.byKind.concern, gaps: cov.gaps, nudge: idle == null || idle > V.settings.nudgeDays, metrics };
  });
}

export function teamView(V) {
  const cycle = V.settings.cycles.find(c => c.id === V.cycleId) || V.cycle;
  const rows = teamRows(V, cycle);
  const metricIds = [...new Set(rows.flatMap(r => Object.keys(r.metrics)))].sort();
  const s = V.settings;
  return `<section class="view team" aria-label="Team">
  <div class="bar">${cyclePicker(V, cycle && cycle.id, 'cycleId')}<span class="sub">Flagged when nothing was logged for ${plural(s.nudgeDays, 'day')}.</span></div>
  <div class="tablewrap"><table class="grid">
    <thead><tr><th scope="col">Person</th><th scope="col" class="num">Entries</th><th scope="col">Last entry</th><th scope="col" class="num">Wins</th><th scope="col" class="num">Concerns</th><th scope="col">Rubric gaps</th>${metricIds.map(id => `<th scope="col" class="num">${h(id)}</th>`).join('')}<th scope="col"><span class="vh">Actions</span></th></tr></thead>
    <tbody>${rows.map(r => `<tr data-person="${h(r.person.id)}"${r.nudge ? ' class="nudge"' : ''}>
      <th scope="row"><button type="button" class="lnk sensitive" data-open-person="${h(r.person.id)}">${h(r.person.name)}</button>${r.person.relation === 'self' ? '' : `<span class="sub"> ${h(relName(r.person.relation))}</span>`}</th>
      <td class="num">${r.count}</td>
      <td>${r.last ? h(niceDate(r.last)) : '<span class="sub">never</span>'}${r.nudge ? ` <span class="flag" title="Nothing logged for more than ${s.nudgeDays} days">${r.idle == null ? 'start logging' : r.idle + ' days'}</span>` : ''}</td>
      <td class="num">${r.wins}</td><td class="num">${r.concerns}</td>
      <td>${r.gaps.length ? `<span class="sub">${h(r.gaps.map(id => rubricName(s, id)).join(', '))}</span>` : '<span class="sub">none</span>'}</td>
      ${metricIds.map(id => `<td class="num">${r.metrics[id] ? h(String(r.metrics[id].value)) : ''}</td>`).join('')}
      <td class="rowacts"><button type="button" class="lnk" data-log-for="${h(r.person.id)}">Log</button><button type="button" class="lnk" data-packet-for="${h(r.person.id)}">Packet</button></td>
    </tr>`).join('')}</tbody>
  </table></div>
</section>`;
}

/* ---------- 5. Review packet ---------- */

/** A small, safe Markdown preview: headings, bullets and paragraphs, all escaped. */
export function mdPreview(md) {
  const out = [];
  let list = false;
  for (const raw of String(md || '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!li && list) { out.push('</ul>'); list = false; }
    const hd = /^(#{1,3})\s+(.*)$/.exec(line);
    if (hd) out.push(`<h${hd[1].length + 2}>${h(hd[2])}</h${hd[1].length + 2}>`);
    else if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${h(li[1])}</li>`); }
    else if (line.trim()) out.push(`<p>${h(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

export function packetView(V) {
  const person = V.people.find(p => p.id === V.personId) || V.people[0];
  if (!person) return '<div class="engcard"><h2>No people yet</h2><p>Add someone in settings first.</p></div>';
  const cycle = V.settings.cycles.find(c => c.id === V.cycleId) || V.cycle;
  const P = V.packet || {};
  const count = cycle ? entriesIn(V.entries[person.id] || [], cycle).length : 0;
  const versions = P.versions || [];
  const cur = P.current;
  const verOpts = versions.map(v => `<option value="${v.version}"${sel(v.version, cur && cur.version)}>Version ${v.version}</option>`).join('');
  let state = '';
  if (cur) {
    const bits = [];
    bits.push(cur.edited ? 'Edited by you' : 'As generated');
    if (cur.sidecar && cur.sidecar.generatedAt) bits.push('generated ' + niceDate(cur.sidecar.generatedAt.slice(0, 10)));
    if (P.stale) bits.push('entries changed since then');
    state = `<p class="sub vstate">${h(bits.join(' · '))}</p>`;
  }
  const relNote = person.relation === 'manager' ? '<p class="lede">For your manager, this works as upward-feedback prep.</p>' : '';
  return `<section class="view packet" aria-label="Review packet">
  <div class="bar">${personPicker(V, person.id, 'personId')}${cyclePicker(V, cycle && cycle.id, 'cycleId')}<span class="sub">${plural(count, 'entry', 'entries')}</span>
    <span class="grow"></span>
    <button type="button" class="btn" data-export="csv"${count ? '' : ' disabled'}>Export CSV</button>
    <button type="button" class="btn" data-export="xlsx"${count ? '' : ' disabled'}>Export Excel</button></div>
  ${relNote}
  <div class="gen">
    <button type="button" class="btn primary" data-generate${V.readOnly ? ' disabled' : ''}>${versions.length ? 'Regenerate summary' : 'Generate summary'}</button>
    ${versions.length > 1 ? `<select class="inp" data-pick="version" aria-label="Version">${verOpts}</select>` : ''}
    ${cur ? `<span class="path mono">${h(cur.path)}</span>` : ''}
  </div>
  ${P.message ? `<p class="msg" role="status">${h(P.message)}</p>` : ''}
  ${cur ? `${state}
  <div class="tabs small" role="tablist"><button type="button" class="tab" role="tab" data-pmode="edit" aria-selected="${P.mode !== 'preview'}">Edit</button><button type="button" class="tab" role="tab" data-pmode="preview" aria-selected="${P.mode === 'preview'}">Preview</button></div>
  ${P.mode === 'preview' ? `<div class="mdprev sensitive">${mdPreview(P.draft != null ? P.draft : cur.content)}</div>`
    : `<textarea class="inp mdedit sensitive" data-summary rows="22" spellcheck="true" aria-label="Summary in Markdown">${h(P.draft != null ? P.draft : cur.content)}</textarea>`}
  <div class="acts left">
    <button type="button" class="btn primary" data-save-summary${P.draft != null && P.draft !== cur.content && !V.readOnly ? '' : ' disabled'}>Save edits</button>
    <button type="button" class="btn" data-copy="text">Copy as text</button>
    <button type="button" class="btn" data-copy="md">Copy Markdown</button>
    <span class="msg">Saved in your Workshop folder as Markdown. Regenerating never overwrites your edits; it writes a new version beside them.</span>
  </div>` : `<p class="sub">No summary yet for this cycle. Generate one from the entries; you can edit it after.</p>`}
</section>`;
}

/** Plain text from the Markdown: headings and bullets kept, the marks removed. */
export function mdToText(md) {
  return String(md || '').split(/\r?\n/).map(l => l.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*]\s+/, '• ')).join('\n');
}

/* ---------- settings panel ---------- */

export function settingsView(V) {
  const s = V.settings;
  const people = V.people.map(p => `<tr data-person-row="${h(p.id)}">
    <td><input class="inp sensitive" name="name" value="${h(p.name)}" aria-label="Name" required maxlength="80"></td>
    <td><select class="inp" name="relation" aria-label="Relation"${p.relation === 'self' ? ' disabled' : ''}>${RELATIONS.filter(r => p.relation === 'self' || r.id !== 'self').map(r => `<option value="${r.id}"${sel(r.id, p.relation)}>${h(r.name)}</option>`).join('')}</select></td>
    <td><select class="inp" name="role" aria-label="Role"><option value=""></option>${s.roles.map(r => `<option value="${h(r.id)}"${sel(r.id, p.role)}>${h(r.name)}</option>`).join('')}</select></td>
    <td><input class="inp" name="level" value="${h(p.level || '')}" aria-label="Level" maxlength="40"></td>
    <td class="c"><input type="checkbox" name="active"${p.active !== false ? ' checked' : ''} aria-label="Active"${p.relation === 'self' ? ' disabled' : ''}></td>
    <td class="mono sub">${h(p.id)}</td></tr>`).join('');
  const cycles = sortedCycles(s).map(c => `<tr data-cycle-row="${h(c.id)}">
    <td class="mono sub">${h(c.id)}</td>
    <td><input class="inp" name="name" value="${h(c.name)}" aria-label="Name" required maxlength="60"></td>
    <td><input class="inp" type="date" name="start" value="${h(c.start)}" aria-label="Start" required></td>
    <td><input class="inp" type="date" name="end" value="${h(c.end)}" aria-label="End" required></td>
    <td><input class="inp" type="date" name="due" value="${h(c.due || '')}" aria-label="Due"></td></tr>`).join('');
  const rubric = s.rubric.map(r => `<tr data-rubric-row="${h(r.id)}"><td class="mono sub">${h(r.id)}</td>
    <td><input class="inp" name="name" value="${h(r.name)}" aria-label="Name" required maxlength="60"></td>
    <td><input class="inp" name="description" value="${h(r.description || '')}" aria-label="Description" maxlength="300"></td></tr>`).join('');
  const cols = CSV_COLUMNS.map(c => `<label class="check"><input type="checkbox" name="col" value="${c}"${s.csvColumns.includes(c) ? ' checked' : ''}> ${c}</label>`).join('');
  const dis = V.readOnly ? ' disabled' : '';
  return `<section class="view settings" aria-label="Receipts settings">
  <form class="card" data-settings="people"><h2>People</h2><p class="sub">You, your direct reports and your manager. The id names their folder and never changes, so renaming someone moves nothing.</p>
    <div class="tablewrap"><table class="grid form"><thead><tr><th>Name</th><th>Relation</th><th>Role</th><th>Level</th><th>Active</th><th>Id</th></tr></thead><tbody>${people}
    <tr data-person-row=""><td><input class="inp" name="name" placeholder="Add a person" aria-label="New person's name" maxlength="80"></td>
      <td><select class="inp" name="relation" aria-label="Relation"><option value="report">Direct report</option><option value="manager">Manager</option></select></td>
      <td><select class="inp" name="role" aria-label="Role"><option value=""></option>${s.roles.map(r => `<option value="${h(r.id)}">${h(r.name)}</option>`).join('')}</select></td>
      <td><input class="inp" name="level" aria-label="Level" maxlength="40"></td><td class="c"><input type="checkbox" name="active" checked aria-label="Active"></td><td></td></tr>
    </tbody></table></div>
    <div class="acts"><span class="msg" data-msg></span><button type="submit" class="btn primary"${dis}>Save people</button></div></form>
  <form class="card" data-settings="cycles"><h2>Review cycles</h2><p class="sub">Each cycle's summary is saved under its id.</p>
    <div class="tablewrap"><table class="grid form"><thead><tr><th>Id</th><th>Name</th><th>Start</th><th>End</th><th>Due</th></tr></thead><tbody>${cycles}
    <tr data-cycle-row=""><td><input class="inp mono" name="id" placeholder="2027-h1" aria-label="New cycle id" maxlength="40"></td><td><input class="inp" name="name" placeholder="H1 2027" aria-label="New cycle name" maxlength="60"></td>
      <td><input class="inp" type="date" name="start" aria-label="Start"></td><td><input class="inp" type="date" name="end" aria-label="End"></td><td><input class="inp" type="date" name="due" aria-label="Due"></td></tr>
    </tbody></table></div>
    <div class="row"><label class="fld"><span class="lbl">Flag people with nothing logged for</span><span class="inline"><input class="inp num" type="number" min="1" max="365" name="nudgeDays" value="${s.nudgeDays}" aria-label="Days"> days</span></label></div>
    <div class="acts"><span class="msg" data-msg></span><button type="submit" class="btn primary"${dis}>Save cycles</button></div></form>
  <form class="card" data-settings="rubric"><h2>Rubric</h2><p class="sub">Workshop's own generic rubric. Rename sections or change their descriptions; the ids stay, so entries keep their sections.</p>
    <div class="tablewrap"><table class="grid form"><thead><tr><th>Id</th><th>Name</th><th>Description</th></tr></thead><tbody>${rubric}</tbody></table></div>
    <div class="acts"><span class="msg" data-msg></span><button type="submit" class="btn primary"${dis}>Save rubric</button></div></form>
  <form class="card" data-settings="columns"><h2>Export columns</h2><p class="sub">Columns in CSV and Excel exports. The two scores are TaskLedger's leverage and review scores.</p>
    <div class="colgrid">${cols}</div>
    <div class="acts"><span class="msg" data-msg></span><button type="submit" class="btn primary"${dis}>Save columns</button></div></form>
</section>`;
}
