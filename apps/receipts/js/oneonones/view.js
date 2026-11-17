/* Rapport's 1:1s: the HTML. Pure functions with no DOM or SDK, so Node tests can import them. Every string
   from another app or the person is escaped with esc(); notes go through the escaping renderer in markdown.js.
   Class names start with oo- where Rapport's own styles use the same word. */
import { KINDS, KIND_LABELS, esc } from './model.js';
import { render as renderMd } from '../markdown.js';

const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;

/** Shown instead of the page when it cannot work yet. Returns '' when it can. */
export function setupCard(v, embedded) {
  if (v.waiting) {
    return `<section class="engcard" role="status"><h2>Allow Workshop to use your folder to see your 1:1s</h2>
      <p>${embedded ? 'Click <b>Allow</b> in the bar at the top of Workshop.' : 'Open Workshop and click <b>Allow</b> in the bar at the top.'} Chrome asks again after it restarts.</p></section>`;
  }
  if (v.newer) return '<section class="engcard"><h2>Saved by a newer Rapport</h2><p>Update Rapport to use 1:1s here. Nothing was changed.</p></section>';
  return '';
}

/* ---------- the packet ---------- */

const UNAVAILABLE = {
  unlinked: 'Not in People, so nothing to gather. Add them in Settings, People.',
  missing: 'Nothing saved there yet.',
  unreadable: 'Saved by a version this app does not know. Update Workshop to read it.'
};
// missing: a message for that source when it has a better one (Docket writes its summary only when it runs).
const unavailable = (s, link, missing) => `<p class="soft">${esc((s.state === 'missing' && missing) || UNAVAILABLE[s.state] || 'Not available.')}</p>`;

// One date format everywhere on the page: "Nov 14" (Rapport UX v1).
const day = d => { const t = new Date(String(d || '') + 'T12:00:00'); return isNaN(t) ? String(d || '') : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
function rows(title, list, fmt, empty = 'None') {
  return `<div class="grp"><h4>${esc(title)} <span class="num soft">${list.length}</span></h4>${list.length
    ? `<ul>${list.map(x => `<li>${fmt(x)}</li>`).join('')}</ul>` : `<p class="soft">${esc(empty)}</p>`}</div>`;
}

// A task that reaches them through a group: "via @leadership" (viaName is filled in by page.js).
const viaHtml = t => (t.via ? ` <span class="soft">via ${esc(t.viaName ? '@' + t.viaName : 'a group')}</span>` : '');

export function packetHtml(p) {
  // Docket's groups show only when they have something; all empty is one line.
  const dk = p.docket.state === 'ok' ? [
    p.docket.open.length ? rows('Open, tagged with them', p.docket.open, t => `${esc(t.title)}${viaHtml(t)}${t.due ? ` <span class="soft">due ${esc(day(t.due))}</span>` : ''}`) : '',
    p.docket.waiting.length ? rows('Waiting on them', p.docket.waiting, t => `${esc(t.title)}${viaHtml(t)}${t.nudgeOn ? ` <span class="soft">nudge ${esc(day(t.nudgeOn))}</span>` : ''}`) : '',
    p.docket.nudges.length ? rows('Nudges due', p.docket.nudges, t => esc(t.title)) : ''].join('') : '';
  const docket = p.docket.state === 'ok'
    ? dk || '<p class="soft">Nothing open with them in Docket.</p>'
    : unavailable(p.docket, true, 'Nothing from Docket yet. Open Docket once and their tasks show here.');
  const receipts = p.receipts.state === 'ok'
    ? (p.receipts.total ? KINDS.filter(k => p.receipts.groups[k].length).map(k => rows(KIND_LABELS[k], p.receipts.groups[k], e => `<span class="soft num">${esc(day(e.date))}</span> ${esc(e.text)}`)).join('') : '<p class="soft">No receipts about them in this period.</p>')
    : unavailable(p.receipts, true);
  // Slate: shown only when Slate is here and has delegated something to them.
  const slate = p.slate && p.slate.state === 'ok' && p.slate.items.length
    ? `<section><h3 class="section-label">With them in Loom</h3>${rows('With them now', p.slate.items, t => `<button class="lnk" data-slate="${esc(t.id)}">${esc(t.title)}</button>`)}</section>` : '';
  const last = p.last.state === 'ok'
    ? rows(`Open follow-ups from ${day(p.last.day)}`, p.last.open, t => esc(t))
    : `<p class="soft">${p.last.state === 'unreadable' ? "Couldn't read the last note." : 'No earlier 1:1 note.'}</p>`;
  return `<section class="packet" aria-label="Bring up">
    <section><h3 class="section-label">Open from last time</h3>${last}</section>
    <section><h3 class="section-label">Waiting on them (Docket)</h3>${docket}</section>
    ${slate}
    <section><h3 class="section-label">New receipts</h3>${receipts}</section>
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
  return `<section class="ai" aria-label="Draft talking points with Tandem">
    <div class="abar"><h3 class="section-label">Draft talking points with Tandem</h3><span class="grow"></span>
      <label class="chk"><input type="checkbox" data-include-concerns${ai.includeConcerns ? ' checked' : ''}${busy ? ' disabled' : ''}> Include concerns</label>
      <button class="btn" data-draft${busy ? ' disabled' : ''}>${busy ? 'Drafting…' : ai.state === 'done' ? 'Draft again' : 'Draft'}</button></div>
    <p class="soft small">Sends this prep (without the name, and without Receipts concerns unless you tick the box) to your opencode agents through Workshop on this computer. It drafts only.</p>
    ${ai.state === 'failed' ? `<p class="bad">${esc(ai.error || 'The draft step did not finish.')}</p>` : ''}
    ${ai.state === 'done' ? `<div class="md oo-draft">${renderMd(ai.text)}</div><p><button class="btn" data-draft-insert>Add to the note</button></p>` : ''}
  </section>`;
}

/* ---------- a person ---------- */

/**
 * A person's 1:1 tab (Rapport 5.0.0): Bring up on the left, today's note on the right. One action per job:
 * Copy for Lattice (talking points for Lattice's shared agenda), Wrap up (follow-ups to Docket, wins to their Log),
 * and, with Tandem on, Draft talking points with Tandem. wrap: Tandem reading the note for Wrap up
 * ({state: 'idle' | 'starting' | 'running' | 'failed', error}).
 */
export function personHtml({ person, packet, note, notes, today, ai, aiOpts, wrap = null }) {
  const since = `<span class="soft small">since ${esc(day(packet.since))}${packet.sinceFrom === 'note' ? ', the last 1:1' : ''}</span>`;
  const busy = wrap && (wrap.state === 'starting' || wrap.state === 'running');
  return `<div class="cols oo-cols">
    <section class="left oo-card" aria-label="Bring up">
      <div class="oo-cardhead"><h3>Bring up</h3>${since}</div>
      ${packetHtml(packet)}
      <div class="oo-foot"><button class="btn" data-lattice-points title="Talking points for Lattice's shared agenda. Concerns are left out.">Copy for Lattice</button>
        <span class="soft small">talking points for the shared agenda, no concerns</span></div>
      ${aiHtml(ai, aiOpts)}
    </section>
    <section class="right oo-card" aria-label="Today's note">
      ${noteHtml(note, notes, today)}
      ${note ? `<div class="oo-foot"><button class="btn primary" data-wrap${busy ? ' disabled' : ''}>${busy ? 'Tandem is reading the note…' : 'Wrap up'}</button>
        <span class="soft small">follow-ups to Docket${person.canLog ? ', wins to the Log' : ''}</span></div>
        ${wrap && wrap.state === 'failed' ? `<p class="bad small">${esc(wrap.error || 'Tandem did not finish.')} Wrap up again to go on with your own lines.</p>` : ''}` : ''}
    </section>
  </div>`;
}

/** A person you have no 1:1s with yet: one click starts them, linked to People. */
export function startHtml(name) {
  return `<section class="oo-card oo-start" aria-label="1:1">
    <p>No 1:1s with ${esc(name)} yet. Prep gathers what Docket and Rapport know since your last 1:1, next to a plain Markdown note.</p>
    <p><button class="btn primary" data-start-dir>Start 1:1s with ${esc(name)}</button></p></section>`;
}

/* ---------- after the meeting ---------- */

/**
 * The Wrap up dialog. followUps: open follow-up lines, [{text, owner: 'me' | 'them', sent, tandem}]; each ticked
 * one goes to Docket as a task (yours, or handed to them and waiting on them). wins: [{text, tandem}] (each can
 * become a receipt in their Log). tandem: a line Tandem found, added to the note when sent. canOffer: their Log
 * takes wins (a report). canSend: Docket shares this data folder; otherwise the follow-ups are copied as Docket
 * quick-add lines. linked: they are in People. name: their name. day: the note's day.
 */
export function wrapHtml({ followUps, wins, canOffer, canSend = true, linked = true, name = 'them', day: d = '' }) {
  const mark = x => (x.tandem ? ' <span class="oo-tandem soft small">Tandem</span>' : '');
  const owner = (f, i) => `<select name="o${i}" aria-label="Who does it">
      <option value="me"${f.owner === 'me' ? ' selected' : ''}>Me</option>
      <option value="them"${f.owner === 'them' ? ' selected' : ''}>${esc(name)}, waits on them</option></select>`;
  const fRows = followUps.map((f, i) => `<li class="frow"><label class="chk"><input type="checkbox" name="f" value="${i}"${f.sent || f.use === false ? '' : ' checked'}> ${esc(f.text)}${mark(f)}</label>
      ${canSend ? owner(f, i) : ''}${f.sent ? '<span class="sent soft small">Sent</span>' : ''}</li>`).join('');
  const wRows = wins.map((w, i) => `<li><label class="chk"><input type="checkbox" name="w" value="${i}"${w.use === false ? '' : ' checked'}> ${esc(w.text)}${mark(w)}</label></li>`).join('');
  return `<form method="dialog" class="confirm log wrap">
    <h2>Wrap up: ${esc(name)}${d ? `, ${esc(day(d))}` : ''}</h2>
    <p class="soft small">Picked from the note. Untick anything you don't want sent. A line already sent is not sent again.</p>
    <h3 class="section-label">Follow-ups to Docket</h3>
    ${followUps.length ? `<ul class="picks">${fRows}</ul>${canSend ? (linked ? '' : `<p class="soft small">${esc(name)} is not in People, so their tasks go to Docket without a person.</p>`)
      : '<p class="soft small">Docket is not in this folder, so these are copied as Docket quick-add lines to paste.</p>'}` : '<p class="soft">No open follow-ups in this note.</p>'}
    ${canOffer ? `<h3 class="section-label">Wins to ${esc(name)}'s Log</h3>
    ${wins.length ? `<ul class="picks">${wRows}</ul>` : '<p class="soft">No lines under Wins in this note.</p>'}` : ''}
    <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button>
      <button class="btn primary" value="ok">${canSend ? 'Send' : 'Copy and log'}</button></div>
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
