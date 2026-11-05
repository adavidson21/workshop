/* Rapport's 1:1s: the HTML. Pure functions with no DOM or SDK, so Node tests can import them. Every string
   from another app or the person is escaped with esc(); notes go through the escaping renderer in markdown.js.
   Class names start with oo- where Rapport's own styles use the same word. */
import { KINDS, KIND_LABELS, esc } from './model.js';
import { render as renderMd } from '../markdown.js';

const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;

const GEAR = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6h12M4 14h12"/><circle cx="8" cy="6" r="2" fill="var(--bg)"/><circle cx="12.5" cy="14" r="2" fill="var(--bg)"/></svg>';

/** A bar under Rapport's tabs: an optional title on the left, buttons on the right. */
export function header(title, eyebrow, acts = '') {
  return `<div class="oo-head">${title ? `<div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h2 class="oo-title">${esc(title)}</h2></div>` : ''}<span class="grow"></span><div class="oo-acts">${acts}</div></div>`;
}

/** Shown instead of the page when it cannot work yet. Returns '' when it can. */
export function setupCard(v, embedded) {
  if (v.waiting) {
    return `<section class="engcard" role="status"><h2>Allow Workshop to use your folder to see your 1:1s</h2>
      <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop.' : 'Open Workshop and click <b>Allow</b> in the bar at the top.'} Chrome asks again after it restarts.</p></section>`;
  }
  if (v.newer) return '<section class="engcard"><h2>Saved by a newer Rapport</h2><p>Update Rapport to use 1:1s here. Nothing was changed.</p></section>';
  return '';
}

/* ---------- the people list ---------- */

/** rows: [{person, lastDay, days, due}] */
export function homeHtml(rows, ui, fromDir = []) {
  const acts = `<button class="btn" data-route="settings" title="People you meet with, links and cadence">${GEAR} People and links</button>`;
  if (!rows.length) {
    return header('', '', acts) + `<section class="engcard"><h2>Who do you meet with?</h2>
      <p>Add the people you have 1:1s with: your reports, your manager, peers, skip-levels. Link each one to what Docket and Rapport already know about them, and prep gathers it in one place.</p>
      <p><button class="btn primary" data-route="settings">Add people</button></p>${fromDir.length ? fromDirectoryHtml(fromDir) : ''}</section>`;
  }
  return header('', '', acts) + `<p class="oo-hint soft">Due means the last 1:1 note is as old as that person's cadence. Reports open on their page in Reports.</p>
    <ul class="oo-people" role="list">${rows.map((r, i) => `<li><button class="oo-row${ui.selected === i ? ' on' : ''}" data-person="${esc(r.person.id)}">
      <span class="oo-name">${esc(r.person.name)}</span>
      <span class="oo-last soft">${r.lastDay ? `Last 1:1 ${esc(r.lastDay)} (${r.days === 0 ? 'today' : plural(r.days, 'day') + ' ago'})` : 'No 1:1 notes yet'}</span>
      ${r.due ? '<span class="due">Due</span>' : '<span class="oo-ok soft">Every ' + esc(plural(r.person.cadenceDays, 'day')) + '</span>'}
    </button></li>`).join('')}</ul>`;
}

/* ---------- the packet ---------- */

const UNAVAILABLE = {
  unlinked: 'Not in People. Pick who this is in People and links.',
  missing: 'Nothing saved there yet.',
  unreadable: 'Saved by a version this app does not know. Update Workshop to read it.'
};
const unavailable = (s, link) => `<p class="soft">${esc(UNAVAILABLE[s.state] || 'Not available.')}${s.state === 'unlinked' && link ? ` <button class="lnk" data-route="settings">People and links</button>` : ''}</p>`;

function rows(title, list, fmt, empty = 'None') {
  return `<div class="grp"><h4>${esc(title)} <span class="num soft">${list.length}</span></h4>${list.length
    ? `<ul>${list.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>` : `<p class="soft">${esc(empty)}</p>`}</div>`;
}

// A task that reaches them through a group: "via @leadership" (viaName is filled in by page.js).
const viaHtml = t => (t.via ? ` <span class="soft">via ${esc(t.viaName ? '@' + t.viaName : 'a group')}</span>` : '');

export function packetHtml(p) {
  const docket = p.docket.state === 'ok'
    ? rows('Open, tagged with them', p.docket.open, t => `${esc(t.title)}${viaHtml(t)}${t.due ? ` <span class="soft">due ${esc(t.due)}</span>` : ''}`)
      + rows('Waiting on them', p.docket.waiting, t => `${esc(t.title)}${viaHtml(t)}${t.nudgeOn ? ` <span class="soft">nudge ${esc(t.nudgeOn)}</span>` : ''}`)
      + rows('Nudges due', p.docket.nudges, t => esc(t.title))
    : unavailable(p.docket, true);
  const receipts = p.receipts.state === 'ok'
    ? (p.receipts.total ? KINDS.filter(k => p.receipts.groups[k].length).map(k => rows(KIND_LABELS[k], p.receipts.groups[k], e => `<span class="soft num">${esc(e.date)}</span> ${esc(e.text)}`)).join('') : '<p class="soft">No receipts about them in this period.</p>')
    : unavailable(p.receipts, true);
  const last = p.last.state === 'ok'
    ? rows(`Open follow-ups from ${p.last.day}`, p.last.open, t => esc(t))
    : `<p class="soft">${p.last.state === 'unreadable' ? "Couldn't read the last note." : 'No earlier 1:1 note.'}</p>`;
  return `<section class="packet" aria-label="Prep">
    <p class="since soft">Since ${esc(p.since)}${p.sinceFrom === 'note' ? ' (the last 1:1 note)' : ' (cadence, no earlier note)'}</p>
    <section><h3 class="section-label">Docket</h3>${docket}</section>
    <section><h3 class="section-label">Receipts</h3>${receipts}</section>
    <section><h3 class="section-label">Last 1:1</h3>${last}</section>
  </section>`;
}

/* ---------- the note ---------- */

/** n: {day, path, text, mtime, dirty, saving, error, conflict, mode} or null. notes: [{day}] for the picker. */
export function noteHtml(n, notes, today) {
  const pick = notes.length ? `<label class="fl"><span class="sr">Note</span><select data-pick-note>${notes.some(x => x.day === today) ? '' : opt('', `Today (${today}), not started`, !n)}${notes.map(x => opt(x.day, x.day === today ? `Today (${x.day})` : x.day, n && n.day === x.day)).join('')}</select></label>` : '';
  if (!n) {
    return `<section class="oo-note" aria-label="Note"><div class="nbar">${pick}<span class="grow"></span></div>
      <div class="engcard small"><p>No note for today yet. Start one from the template: date, what changed since last time, talking points, wins, follow-ups and notes.</p>
      <p><button class="btn primary" data-start-note>Start today's note</button></p></div></section>`;
  }
  const status = n.conflict ? '' : n.error ? `<span class="bad">Not saved yet: ${esc(n.error)}</span>` : n.saving ? 'Saving…' : n.dirty ? 'Unsaved' : n.mtime ? 'Saved' : '';
  return `<section class="oo-note" aria-label="Note">
    <div class="nbar">${pick}
      <div class="seg" role="group" aria-label="View"><button class="${n.mode === 'edit' ? 'on' : ''}" data-mode="edit" aria-pressed="${n.mode === 'edit'}">Edit</button><button class="${n.mode === 'preview' ? 'on' : ''}" data-mode="preview" aria-pressed="${n.mode === 'preview'}">Preview</button></div>
      <span class="grow"></span><span class="nstatus soft" role="status">${status}</span>
      <button class="btn" data-save${n.dirty ? '' : ' disabled'}>Save</button>
    </div>
    ${n.conflict ? `<p class="unsaved" role="alert">This note changed somewhere else since you opened it. Nothing was overwritten.
      <button class="btn" data-conflict="load">Load the new version</button><button class="btn" data-conflict="overwrite">Overwrite with mine</button></p>` : ''}
    ${n.mode === 'preview' ? `<div class="md">${renderMd(n.text)}</div>` : `<textarea class="editor" id="oo-editor" data-editor aria-label="1:1 note" spellcheck="true">${esc(n.text)}</textarea>`}
    <p class="soft small">Saved as <span class="num">${esc(n.path)}</span> in your Workshop folder: a plain Markdown file.</p>
  </section>`;
}

/* ---------- the optional draft step ---------- */

/** ai: {state: 'idle' | 'starting' | 'running' | 'done' | 'failed', text, error, includeConcerns}. */
export function aiHtml(ai, { enabled, ready }) {
  if (!enabled || !ready) return '';
  const busy = ai.state === 'starting' || ai.state === 'running';
  return `<section class="ai" aria-label="Draft talking points">
    <div class="abar"><h3 class="section-label">Draft talking points</h3><span class="grow"></span>
      <label class="chk"><input type="checkbox" data-include-concerns${ai.includeConcerns ? ' checked' : ''}${busy ? ' disabled' : ''}> Include concerns</label>
      <button class="btn" data-draft${busy ? ' disabled' : ''}>${busy ? 'Drafting…' : ai.state === 'done' ? 'Draft again' : 'Draft talking points'}</button></div>
    <p class="soft small">Sends this prep (without the name, and without Receipts concerns unless you tick the box) to your opencode agents through Workshop on this computer. It drafts only.</p>
    ${ai.state === 'failed' ? `<p class="bad">${esc(ai.error || 'The draft step did not finish.')}</p>` : ''}
    ${ai.state === 'done' ? `<div class="md oo-draft">${renderMd(ai.text)}</div><p><button class="btn" data-draft-insert>Add to the note</button></p>` : ''}
  </section>`;
}

/* ---------- a person ---------- */

/**
 * A person's prep and note. On the 1:1s tab it has the person's name and a way back; on a report's page in
 * Reports (`panel`) it is a section above their receipts, with how often you meet.
 */
export function personHtml({ person, packet, note, notes, today, ai, aiOpts, panel = false, due = null }) {
  const log = `<button class="btn" data-log${note ? '' : ' disabled'}>Log follow-ups</button>`;
  const cols = `<div class="cols">
    <div class="left">${packetHtml(packet)}</div>
    <div class="right">${noteHtml(note, notes, today)}${aiHtml(ai, aiOpts)}</div>
  </div>`;
  if (panel) {
    const when = due ? (due.lastDay ? `Last 1:1 ${esc(due.lastDay)}` : 'No 1:1 notes yet') + ` · every ${esc(plural(person.cadenceDays, 'day'))}` : '';
    return `<section class="oo-panel" aria-label="1:1">
      <div class="oo-head"><h3 class="section-label">1:1${due && due.due ? ' <span class="due">Due</span>' : ''}</h3><span class="soft small">${when}</span><span class="grow"></span>
        <div class="oo-acts">${log}<button class="btn ghost" data-route="settings">People and links</button></div></div>
      ${cols}</section>`;
  }
  return header(person.name, '1:1 prep', `${log}<button class="btn" data-route="">All 1:1s</button>`) + cols;
}

/** On a report's page when they have no 1:1s yet: one click starts them, linked. */
export function startPanelHtml(name) {
  return `<section class="oo-panel oo-start" aria-label="1:1">
    <div class="oo-head"><h3 class="section-label">1:1</h3><span class="grow"></span></div>
    <p class="soft">No 1:1s with ${esc(name)} yet. Prep gathers what Docket and Rapport know about them since your last 1:1, next to a plain Markdown note.</p>
    <p><button class="btn" data-start-report>Start 1:1s with ${esc(name)}</button></p></section>`;
}

/* ---------- after the meeting ---------- */

/**
 * The Log follow-ups dialog. followUps: open follow-up lines of the note (each can become a Docket task,
 * copied as quick-add lines). wins: lines under Wins (each can become a receipt). canOffer: the person is
 * linked to one of your reports.
 */
export function logHtml({ followUps, wins, canOffer, docketLinked }) {
  const list = (name, items) => items.map((t, i) => `<li><label class="chk"><input type="checkbox" name="${name}" value="${i}" checked> ${esc(t)}</label></li>`).join('');
  return `<form method="dialog" class="confirm log">
    <h2>Log follow-ups</h2>
    <h3 class="section-label">Docket tasks</h3>
    ${followUps.length ? `<ul class="picks">${list('f', followUps)}</ul>
      <p class="soft small">Ticked follow-ups are copied as Docket quick-add lines. Paste them into Docket's command bar to add them.${docketLinked ? '' : ' This person is not linked to a Docket name, so the lines carry no @name.'}</p>`
      : '<p class="soft">No open follow-ups in this note.</p>'}
    <h3 class="section-label">Receipts</h3>
    ${!wins.length ? '<p class="soft">No lines under Wins in this note.</p>'
      : canOffer ? `<ul class="picks">${list('w', wins)}</ul><p class="soft small">Ticked wins become receipts about this report, dated the day of the note.</p>`
      : '<p class="soft">Wins become receipts only for a report. Link this person to a report in People and links.</p>'}
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Log</button></div>
  </form>`;
}

/* ---------- settings ---------- */

/**
 * v.people: 1:1s people with the directory's name and relation (withDirectory).
 * pick: {choices: [{id, name, relation, archived}], fromDirectory: [{id, name}], embedded}
 * edit: the person being edited ({} for a new one) or null.
 */
export function settingsHtml(v, pick, edit) {
  const back = '<button type="button" class="btn" data-route="">All 1:1s</button>';
  const active = v.people.filter(p => !p.archived), archived = v.people.filter(p => p.archived);
  const row = p => `<li class="srow"><span class="oo-name">${esc(p.name)}</span>
    <span class="links soft">${p.linked ? esc(RELATION[p.relation] || 'In People') + (p.handle ? ` · @${esc(p.handle)}` : '') : 'Not in People'} · every ${esc(plural(p.cadenceDays, 'day'))}</span>
    <button class="lnk" data-edit-person="${esc(p.id)}">Edit</button></li>`;
  return header('People and links', '1:1s', back) + `
    ${edit ? personForm(edit, pick) : `<p><button class="btn primary" data-add-person>Add a person</button></p>`}
    ${!edit && pick.fromDirectory.length ? fromDirectoryHtml(pick.fromDirectory) : ''}
    ${active.length ? `<ul class="slist">${active.map(row).join('')}</ul>` : ''}
    ${archived.length ? `<details class="archived"><summary>Archived (${archived.length})</summary><ul class="slist">${archived.map(row).join('')}</ul></details>` : ''}
    <form class="oo-settings" data-settings>
      <h3 class="section-label">Draft step</h3>
      <label class="chk"><input type="checkbox" name="aiDraft"${v.settings.aiDraft ? ' checked' : ''}> Offer "Draft talking points" when the opencode connector is on</label>
      <p class="soft small">Off: the button never shows and nothing is sent to opencode. Prep and notes never need it.</p>
      <div class="acts"><button class="btn">Save</button></div>
    </form>`;
}

/** Reports and your manager in People with no 1:1s person yet: one click adds them. */
export function fromDirectoryHtml(list) {
  return `<div class="from-dir"><p class="soft small">From People: add in one click. Their Docket tasks and receipts come along.</p>
    ${list.map(p => `<button class="oo-chip" data-add-dir="${esc(p.id)}">+ ${esc(p.name)}</button>`).join('')}</div>`;
}

const RELATION = { report: 'Direct report', manager: 'Manager', peer: 'Peer', contact: 'Contact' };

export function personForm(p, pick) {
  const cur = p.personId || '';
  const known = pick.choices.some(c => c.id === cur);
  const options = pick.choices.map(c => opt(c.id, `${c.name} (${RELATION[c.relation] || c.relation}${c.archived ? ', archived' : ''})`, c.id === cur)).join('');
  return `<form class="oo-pform" data-person-form data-id="${esc(p.id || '')}" autocomplete="off">
    <h3 class="section-label">${p.id ? 'Edit person' : 'New person'}</h3>
    <div class="two">
      <label>Person<select name="personId" required>${opt('', 'Pick someone from People', !cur)}${options}${cur && !known ? opt(cur, `${p.name || cur} (not in People)`, true) : ''}</select>
        ${pick.choices.length ? '' : `<span class="soft">No one in People yet. Add them in ${pick.embedded ? 'Settings, People' : 'Workshop\'s Settings, People'}.</span>`}</label>
      <label>Cadence (days between 1:1s)<input name="cadenceDays" type="number" min="1" max="90" value="${esc(p.cadenceDays || 7)}"></label>
    </div>
    <p class="soft small">Their Docket tasks (and tasks on groups they are in) and, for a report or your manager, their receipts show in prep.</p>
    ${p.id ? `<label class="chk"><input type="checkbox" name="archived"${p.archived ? ' checked' : ''}> Archived (hidden from the list; notes are kept)</label>` : ''}
    <div class="acts"><button type="button" class="btn" data-cancel-person>Cancel</button><button class="btn primary">${p.id ? 'Save' : 'Add'}</button></div>
  </form>`;
}

/** A plain confirm. */
export function confirmHtml({ title, lines, action }) {
  return `<form method="dialog" class="confirm">
    <h2>${esc(title)}</h2>
    <ul class="lines">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <div class="acts"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok" autofocus>${esc(action)}</button></div>
  </form>`;
}
