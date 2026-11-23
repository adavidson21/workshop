/* Rapport's 1:1s: the 1:1 tab on a person's page (Rapport 5.0.0).

   For one person and the time since your last 1:1, gathers what Docket, Loom and Rapport already know (read only,
   no AI), keeps the 1:1 note as a plain Markdown file in your Workshop folder, and after the meeting Wrap up sends
   follow-ups to Docket as tasks (accepted handoffs, Workshop docs/handoffs.md; or copies them as quick-add lines)
   and turns wins into receipts. Copy for Lattice puts talking points for Lattice's shared agenda on the clipboard.
   With Tandem on (Rapport's Tandem setting and the opencode connector), Tandem can draft talking points, and
   Wrap up can ask it to read the note for follow-ups and wins you didn't mark.

   main.js owns the page, the hash and the paint loop. It calls show() when a person's 1:1 tab opens or closes and
   asks for HTML with panel(). Clicks on this module's controls are handled here by their data- attributes.
   data.js loads and saves; model.js, view.js and markdown.js are pure. */
import { createOneOnOnes } from './data.js';
import { DEFAULT_CADENCE, NOTES, addDays, PEOPLE, SETTINGS, SOURCES, buildPacket, cadenceState, isoDay, personFromDirectory, noteTemplate, packetMarkdown, parseFollowUps, parseWins, quickAddLines, winEntries, withDirectory, esc, applyTidy, followUpHandoffs, followUpId, followUpOwner, parseTidy, tidyInput } from './model.js';
import { confirmHtml, personHtml, setupCard, startHtml, wrapHtml } from './view.js';
import { talkingPoints } from '../lattice.js';

/**
 * ws: the SDK. root: the element main.js paints into. host: what this module needs from main.js:
 *   repaint()            paint the page again
 *   isReport(id)         id is one of your reports (in the people directory)
 *   reportName(id)       a directory person's name
 *   addWins(entries)     add receipts that are not there yet; resolves how many were added
 *   tandem()             Rapport's Tandem setting is on (Settings, Apps, Rapport)
 */
export function createOneOnOnesPage(ws, root, host) {
  const dlg = document.createElement('dialog');
  dlg.className = 'oo-dlg';
  dlg.setAttribute('aria-label', 'Confirm');
  document.body.appendChild(dlg);

  const d = createOneOnOnes(ws, { onChange: () => host.repaint() });
  const v = d.v;

  const ui = {
    mode: 'off',           // 'panel' (a person's 1:1 tab) or 'off'
    personId: null,        // the 1:1s person shown
    dirId: null,           // the directory person whose page is open ('' for a 1:1s person not in People)
    note: null,            // {day, path, text, mtime, dirty, saving, error, conflict, mode}
    lastText: {},          // path -> text of earlier notes, for the packet
    ai: { state: 'idle', text: '', error: '', includeConcerns: false },
    wrap: { state: 'idle', error: '' }, // Tandem reading the note for Wrap up
  };
  const tandemOn = () => !!(host.tandem ? host.tandem() : v.settings.aiDraft) && !!v.oc;
  // Docket shares this data folder: inside Workshop, or with the agent (docs/handoffs.md, rule 5).
  const canSend = () => !!ws.embedded || ws.backend === 'agent';
  // You, from the people directory, so a follow-up naming you is yours.
  const meInDir = () => (v.dir && Array.isArray(v.dir.items) ? v.dir.items.find(it => it && it.kind === 'person' && it.relation === 'self' && !it.archived) : null) || null;
  const today = () => isoDay(new Date());
  const toastErr = e => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });
  const paint = () => host.repaint();

  /* ---------- derived ---------- */

  // 1:1s people with the directory's name, relation and handle.
  const shown = () => v.people.map(p => withDirectory(p, v.dir));

  function rows() {
    const t = today();
    return shown().filter(p => !p.archived).map(p => ({ person: p, ...cadenceState(d.notesOf(p.id), t, p.cadenceDays) }))
      .sort((a, b) => (b.due - a.due) || ((b.days ?? 1e9) - (a.days ?? 1e9)) || a.person.name.localeCompare(b.person.name));
  }
  const personNow = () => shown().find(p => p.id === ui.personId) || null;
  // A directory person's 1:1s person: the active one linked to them, else an archived one (so no second one is made).
  const personFor = did => shown().find(p => p.personId === did && !p.archived) || shown().find(p => p.personId === did) || null;
  const reportOf = p => (p && p.personId && host.isReport(p.personId) ? p.personId : '');
  // Where a 1:1s person's page is: their People page, or their own when they are not in People.
  const routeOf = p => (p.personId && p.linked ? `p/${p.personId}` : `o/${p.id}`);

  function packetFor(person) {
    const notes = d.notesOf(person.id);
    const t = today();
    const last = notes.find(n => n.day < t);
    const packet = buildPacket({
      person, today: t, now: Date.now(), notes,
      lastText: last ? ui.lastText[last.path] ?? null : null,
      src: { docketSummary: v.src.docketSummary, slateSummary: v.src.slateSummary, receiptsEntries: v.src.receiptsEntries }
    });
    // Tasks on a group they are in name the group.
    if (packet.docket.state === 'ok') for (const t of [...packet.docket.open, ...packet.docket.waiting, ...packet.docket.nudges]) {
      const g = t.via && v.dir && v.dir.byId.get(t.via);
      if (g) t.viaName = g.handle;
    }
    return packet;
  }

  function personBody(person) {
    return personHtml({
      person: { ...person, canLog: !!reportOf(person) }, packet: packetFor(person), note: ui.note, notes: d.notesOf(person.id), today: today(),
      ai: ui.ai, aiOpts: { enabled: tandemOn(), ready: true }, wrap: ui.wrap
    });
  }

  /* ---------- HTML for main.js ---------- */

  /** The 1:1 tab: for a directory person (dirId), or for a 1:1s person not in People (oid). */
  function panel({ dirId = '', oid = '', name = '' } = {}) {
    const setup = setupCard(v, ws.embedded);
    if (setup) return setup;
    if (!v.loaded) return '<p class="loading">Loading your 1:1s.</p>';
    const person = oid ? shown().find(p => p.id === oid) || null : personFor(dirId);
    if (!person) return oid ? '<div class="engcard"><h2>Not found</h2><p>This person is not in your 1:1s.</p></div>' : startHtml(name || host.reportName(dirId) || 'them');
    if (person.archived && !oid) return startHtml(person.name);
    if (person.id !== ui.personId) {
      // Linked since the route was shown (another window, or the first load): open them.
      if (ui.mode === 'panel') queueMicrotask(() => { if (ui.mode === 'panel' && (oid ? oid === person.id : ui.dirId === dirId)) openPerson(person.id); });
      return '<p class="loading">Loading your 1:1s.</p>';
    }
    return personBody(person);
  }

  /* ---------- routes ---------- */

  async function leaveNote() { if (ui.note && ui.note.dirty) await saveNote(); }

  /** A person's 1:1 tab opened ({dirId} or {oid}), or closed (null). */
  async function show(ref) {
    if (!ref) {
      await leaveNote();
      ui.mode = 'off'; ui.personId = null; ui.dirId = null; ui.note = null;
      return;
    }
    ui.mode = 'panel';
    ui.dirId = ref.dirId || '';
    const p = ref.oid ? shown().find(x => x.id === ref.oid) : personFor(ref.dirId);
    if (p && !(p.archived && !ref.oid)) return openPerson(p.id);
    await leaveNote();
    ui.personId = null; ui.note = null;
    return paint();
  }

  /* ---------- a person and their note ---------- */

  async function openPerson(id, day = null, force = false) {
    if (ui.personId === id && !day && !force) return paint(); // already open: keep the note being edited
    await leaveNote();
    ui.personId = id;
    ui.note = null;
    ui.ai = { state: 'idle', text: '', error: '', includeConcerns: false };
    ui.wrap = { state: 'idle', error: '' };
    paint();
    if (!v.people.some(p => p.id === id)) return;
    const notes = d.notesOf(id);
    const t = today();
    const last = notes.find(n => n.day < t);
    if (last && !(last.path in ui.lastText)) {
      try { const f = await d.readNote(last.path); ui.lastText[last.path] = f ? f.content : null; } catch { ui.lastText[last.path] = null; }
    }
    const want = notes.find(n => n.day === (day || t));
    if (want && ui.personId === id) await loadNote(want.path, want.day);
    paint();
  }

  async function loadNote(path, day) {
    try {
      const f = await d.readNote(path);
      if (ui.personId === null) return;
      ui.note = f ? { day, path, text: f.content, mtime: f.mtime, dirty: false, saving: false, error: '', conflict: null, mode: ui.note ? ui.note.mode : 'edit' } : null;
    } catch (e) { toastErr(e); }
  }

  async function startNote() {
    const person = personNow();
    if (!person) return;
    const day = today();
    const path = d.notePath(person.id, day);
    const text = noteTemplate({ name: person.name, day, packet: packetFor(person) });
    try {
      const r = await d.writeNote(path, text, null);
      ui.note = { day, path, text, mtime: r.mtime, dirty: false, saving: false, error: '', conflict: null, mode: 'edit' };
    } catch (e) {
      if (e.code === 'conflict' && e.current) await loadNote(path, day); // another window started it first
      else toastErr(e);
    }
    paint();
    const ed = root.querySelector('[data-editor]');
    if (ed) { ed.focus(); const at = ed.value.indexOf('## Talking points'); if (at >= 0) ed.setSelectionRange(at + 21, at + 21); }
  }

  /** The first 1:1s person for the directory person whose page is open (or the archived one, back). */
  async function startForDir() {
    const did = ui.dirId;
    if (!did) return;
    const old = personFor(did);
    try {
      if (old) { await d.savePerson({ ...v.people.find(p => p.id === old.id), archived: false }); return openPerson(old.id, null, true); }
      const dp = v.dir && v.dir.byId.get(did);
      const base = dp ? personFromDirectory(dp) : { name: host.reportName(did) || 'Unnamed', personId: did, cadenceDays: DEFAULT_CADENCE, archived: false };
      const p = await d.savePerson(base);
      await openPerson(p.id);
    } catch (e) { toastErr(e); }
  }

  /** How often you meet: a number of days, or 0 for no regular 1:1s (archived; notes are kept). */
  async function setCadence(days, id = ui.personId) {
    const p = v.people.find(x => x.id === id);
    if (!p) return;
    try {
      await d.savePerson(days ? { ...p, cadenceDays: days, archived: false } : { ...p, archived: true });
      ws.toast(days ? `1:1s every ${days} days.` : 'No regular 1:1s. Notes are kept.', { kind: 'success' });
      if (!days && id === ui.personId) { await leaveNote(); ui.personId = null; ui.note = null; }
      paint();
    } catch (e) { toastErr(e); }
  }

  let saveTimer = null;
  function status() {
    const n = ui.note, s = root.querySelector('.nstatus'), b = root.querySelector('[data-save]');
    if (s && n) s.textContent = n.error ? `Not saved yet: ${n.error}` : n.saving ? 'Saving…' : n.dirty ? 'Unsaved' : 'Saved';
    if (b && n) b.disabled = !n.dirty;
  }
  async function saveNote() {
    clearTimeout(saveTimer);
    const n = ui.note;
    if (!n || !n.dirty || n.saving || n.conflict) return;
    n.saving = true; status();
    const text = n.text;
    try {
      const r = await d.writeNote(n.path, text, n.mtime);
      n.mtime = r.mtime; n.error = '';
      if (n.text === text) n.dirty = false;
    } catch (e) {
      if (e.code === 'conflict') { n.conflict = { current: e.current || null }; paint(); }
      else { n.error = e.message || 'Workshop did not answer.'; saveTimer = setTimeout(saveNote, 5000); }
    } finally {
      n.saving = false; status();
    }
  }

  async function resolveConflict(how) {
    const n = ui.note;
    if (!n || !n.conflict) return;
    const cur = n.conflict.current;
    n.conflict = null;
    if (how === 'load') {
      if (cur) { n.text = cur.content; n.mtime = cur.mtime; n.dirty = false; }
      else { n.mtime = null; n.dirty = true; }
      paint();
      return;
    }
    n.mtime = cur ? cur.mtime : null;
    n.dirty = true;
    paint();
    await saveNote();
  }

  function showDialog(html) {
    return showDialogValue(html).then(r => (r.value === 'ok' ? r.form : null));
  }
  /** The dialog's form and the value of the button that closed it ('' for Escape). */
  function showDialogValue(html) {
    dlg.innerHTML = html;
    dlg.returnValue = '';
    return new Promise(resolve => {
      dlg.addEventListener('close', () => resolve({ form: dlg.querySelector('form'), value: dlg.returnValue }), { once: true });
      dlg.showModal();
    });
  }

  /* ---------- after the meeting: Wrap up ---------- */

  /** Talking points for Lattice's shared agenda on the clipboard: the note's own, else built from the prep. */
  async function copyPoints() {
    const person = personNow();
    if (!person) return;
    const text = talkingPoints(ui.note ? ui.note.text : '', packetFor(person));
    if (!text) { ws.toast('Nothing to bring up yet. Add lines under Talking points in the note.', { kind: 'warn' }); return; }
    try { await navigator.clipboard.writeText(text); ws.toast('Talking points copied. Paste them into the 1:1 agenda in Lattice.', { kind: 'success' }); }
    catch {
      await showDialog(`<form method="dialog" class="confirm"><h2>Copy these into Lattice</h2><textarea rows="8" readonly>${esc(text)}</textarea>
        <div class="acts"><button class="btn primary" value="ok">Done</button></div></form>`);
    }
  }

  /** Wrap up: with Tandem on, it can read the note first; then the dialog with every line to send. */
  async function wrapUp() {
    const person = personNow(), n = ui.note;
    if (!person || !n) return;
    if (ui.wrap.state === 'starting' || ui.wrap.state === 'running') return;
    // Tandem finished reading this note while you were on another person: use what it found.
    const key = `${person.id} ${n.day}`;
    if (tidyDone.has(key)) {
      const p = parseTidy(tidyDone.get(key));
      tidyDone.delete(key);
      return wrapDialog([...p.followUps.map(x => ({ ...x, kind: 'f' })), ...p.wins.map(text => ({ text, kind: 'w' }))]);
    }
    if (tidyRun && tidyRun.key === key) { ui.wrap = { state: 'running', error: '' }; paint(); return; }
    if (tandemOn() && tidyInput(n.text, person).trim()) {
      const { value } = await showDialogValue(`<form method="dialog" class="confirm">
        <h2>Ask Tandem to read the note too?</h2>
        <ul class="lines"><li>${esc(`Tandem looks for follow-ups and wins you didn't mark. ${person.name}'s name is left out.`)}</li>
          <li>Sent to your opencode agents through Workshop on this computer, saved in Workshop's own folder.</li></ul>
        <div class="acts"><button class="btn primary" value="mine" autofocus>Just my lines</button><button class="btn" value="tandem">Ask Tandem</button></div></form>`);
      if (value === 'tandem') return askTandem(person, n);
      if (value !== 'mine') return;
    }
    return wrapDialog([]);
  }

  // Tandem reading a note keeps going when you open another person (Rapport 5.1.0): tidyRun is the one running, and
  // tidyDone holds a finished read until you click Wrap up on that note again.
  let tidyTimer = null, tidyRun = null;
  const tidyDone = new Map();
  async function askTandem(person, n) {
    const day = n.day;
    ui.wrap = { state: 'starting', error: '' };
    paint();
    try {
      await d.tidy(person.id, day, tidyInput(n.text, person));
      ui.wrap.state = 'running';
      paint();
      tidyRun = { key: `${person.id} ${day}`, name: person.name };
      pollTidy(person.id, day, Date.now());
    } catch (e) {
      ui.wrap = { state: 'failed', error: e.message || 'Tandem did not start.' };
      paint();
    }
  }
  function pollTidy(personId, day, started) {
    clearTimeout(tidyTimer);
    const here = () => ui.personId === personId && ui.note && ui.note.day === day;
    const stop = () => { tidyRun = null; };
    tidyTimer = setTimeout(async () => {
      if (!tidyRun || tidyRun.key !== `${personId} ${day}`) return;
      try {
        const r = await d.tidyResult(personId, day);
        if (r.state === 'done') {
          const name = tidyRun.name;
          stop();
          if (!here()) { tidyDone.set(`${personId} ${day}`, r.text); ws.toast(`Tandem read your 1:1 note with ${name}. Open it and click Wrap up.`, { kind: 'success' }); return; }
          ui.wrap = { state: 'idle', error: '' };
          paint();
          const p = parseTidy(r.text);
          return wrapDialog([...p.followUps.map(x => ({ ...x, kind: 'f' })), ...p.wins.map(text => ({ text, kind: 'w' }))]);
        }
        if (r.state === 'failed') { stop(); if (here()) { ui.wrap = { state: 'failed', error: r.error || '' }; paint(); } return; }
      } catch { /* keep waiting; Workshop may be busy */ }
      // A local model can take a while: 30 minutes before giving up (Rapport 5.1.0; 15 before).
      if (Date.now() - started > 30 * 60000) { stop(); if (here()) { ui.wrap = { state: 'failed', error: 'Nothing after 30 minutes. Check the session in Loom.' }; paint(); } return; }
      pollTidy(personId, day, started);
    }, 3000);
  }

  /** The Wrap up dialog. extra: lines Tandem found, [{kind: 'f', text, owner} | {kind: 'w', text}]. */
  async function wrapDialog(extra) {
    const person = personNow(), n = ui.note;
    if (!person || !n) return;
    await leaveNote();
    const send = canSend();
    const sent = send ? await d.sentHandoffs() : new Set();
    const me = meInDir();
    const known = new Set([...parseFollowUps(n.text).open, ...parseWins(n.text)].map(t => t.toLowerCase()));
    const fresh = extra.filter(x => x.text && !known.has(x.text.toLowerCase()));
    const followUps = [...parseFollowUps(n.text).open.map(text => ({ text, owner: followUpOwner(text, person, me) })),
      ...fresh.filter(x => x.kind === 'f').map(x => ({ text: x.text, owner: x.owner === 'them' ? 'them' : 'me', tandem: true }))]
      .map(f => ({ ...f, sent: sent.has(followUpId(person.id, n.day, f.text)) }));
    const wins = [...parseWins(n.text).map(text => ({ text })), ...fresh.filter(x => x.kind === 'w').map(x => ({ text: x.text, tandem: true }))];
    const canOffer = !!reportOf(person);
    const { form, value } = await showDialogValue(wrapHtml({ followUps, wins, canOffer, canSend: send, linked: !!person.linked, name: person.name, day: n.day }));
    if (!form || value !== 'ok') return;
    const f = new FormData(form);
    const pickedF = f.getAll('f').map(Number).filter(i => followUps[i]).map(i => ({ ...followUps[i], owner: f.get(`o${i}`) === 'them' ? 'them' : f.get(`o${i}`) === 'me' ? 'me' : followUps[i].owner }));
    const pickedW = canOffer ? f.getAll('w').map(Number).map(i => wins[i]).filter(Boolean) : [];
    // Lines Tandem found that you kept go into the note too, so the note stays the record.
    const fromTandem = { followUps: pickedF.filter(x => x.tandem).map(({ text, owner }) => ({ text, owner })), wins: pickedW.filter(x => x.tandem).map(x => x.text) };
    if (fromTandem.followUps.length || fromTandem.wins.length) {
      const next = applyTidy(n.text, fromTandem, person);
      if (next !== n.text) { n.text = next; n.dirty = true; await saveNote(); paint(); }
    }
    const done = [];
    if (pickedF.length && !send) {
      const lines = quickAddLines(pickedF.map(x => x.text), person.handle).join('\n');
      try { await navigator.clipboard.writeText(lines); done.push(`${pickedF.length} Docket quick-add line${pickedF.length === 1 ? '' : 's'} copied`); }
      catch {
        await showDialog(`<form method="dialog" class="confirm"><h2>Copy these into Docket</h2><textarea rows="6" readonly>${esc(lines)}</textarea>
          <div class="acts"><button class="btn primary" value="ok">Done</button></div></form>`);
      }
    } else if (pickedF.length) {
      try {
        const added = await d.sendHandoffs(followUpHandoffs({ person, day: n.day, lines: pickedF, nowIso: new Date().toISOString() }));
        const theirs = pickedF.filter(x => x.owner === 'them').length;
        done.push(added === pickedF.length ? `${added} task${added === 1 ? '' : 's'} sent to Docket${theirs ? ` (${theirs} waiting on ${person.name})` : ''}`
          : added ? `${added} of ${pickedF.length} follow-ups sent to Docket (the rest were sent already)` : `${pickedF.length === 1 ? 'That follow-up was' : 'Those follow-ups were'} sent to Docket already`);
      } catch (e) { toastErr(e); }
    }
    if (pickedW.length) {
      try {
        const added = await host.addWins(winEntries({ person, day: n.day, wins: pickedW.map(w => w.text), nowIso: new Date().toISOString() }));
        done.push(added === pickedW.length ? `${added} win${added === 1 ? '' : 's'} logged`
          : added ? `${added} of ${pickedW.length} wins logged (the rest were in the Log already)` : `${pickedW.length === 1 ? 'That win is' : 'Those wins are'} in the Log already`);
      } catch (e) { toastErr(e); }
    }
    if (done.length) ws.toast(done.join('. ') + '.', { kind: 'success' });
  }

  /* ---------- the optional draft step ---------- */

  let pollTimer = null;
  async function draftTalkingPoints() {
    const person = personNow();
    if (!person || !tandemOn()) return;
    const day = ui.note ? ui.note.day : today();
    const include = ui.ai.includeConcerns;
    const ok = await showDialog(confirmHtml({
      title: 'Draft talking points?',
      lines: [
        'Sends this prep to your opencode agents through Workshop on this computer. The name is left out.',
        include ? 'Concerns from your receipts are included for this run.' : 'Concerns from your receipts are left out.',
        'The draft is saved in Workshop\'s own folder, not in your code workspace.'
      ],
      action: 'Draft'
    }));
    if (!ok) return;
    ui.ai = { ...ui.ai, state: 'starting', text: '', error: '' };
    paint();
    try {
      await d.draft(person.id, day, packetMarkdown(packetFor(person), { includeConcerns: include }));
      ui.ai.state = 'running';
      paint();
      poll(person.id, day, Date.now());
    } catch (e) {
      ui.ai.state = 'failed'; ui.ai.error = e.message || 'The draft step did not start.';
      paint();
    }
  }
  function poll(personId, day, started) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (ui.personId !== personId || ui.ai.state !== 'running') return;
      try {
        const r = await d.draftResult(personId, day);
        if (r.state === 'done') { ui.ai.state = 'done'; ui.ai.text = r.text || ''; paint(); return; }
        if (r.state === 'failed') { ui.ai.state = 'failed'; ui.ai.error = r.error || ''; paint(); return; }
      } catch { /* keep waiting; Workshop may be busy */ }
      if (Date.now() - started > 15 * 60000) { ui.ai.state = 'failed'; ui.ai.error = 'No draft after 15 minutes. Check the session in Loom.'; paint(); return; }
      poll(personId, day, started);
    }, 3000);
  }
  function insertDraft() {
    const n = ui.note;
    if (!n || !ui.ai.text) return;
    n.text = n.text.replace(/\s*$/, '\n\n') + '## Draft talking points\n\n' + ui.ai.text.trim() + '\n';
    n.dirty = true;
    n.mode = 'edit';
    paint();
    saveNote();
  }

  /* ---------- input ---------- */

  root.addEventListener('click', async e => {
    if (ui.mode !== 'panel') return;
    const el = s => e.target.closest(s);
    let x;
    if ((x = el('[data-slate]'))) { ws.open({ app: 'slate', path: `item/${x.dataset.slate}` }).catch(() => {}); return; }
    if (el('[data-start-dir]')) { startForDir(); return; }
    if (el('[data-start-note]')) { startNote(); return; }
    if ((x = el('[data-mode]')) && ui.note) { ui.note.mode = x.dataset.mode; paint(); return; }
    if (el('[data-save]')) { saveNote(); return; }
    if ((x = el('[data-conflict]'))) { resolveConflict(x.dataset.conflict); return; }
    if (el('[data-wrap]')) { await leaveNote(); wrapUp(); return; }
    if (el('[data-lattice-points]')) { copyPoints(); return; }
    if (el('[data-draft]')) { draftTalkingPoints(); return; }
    if (el('[data-draft-insert]')) { insertDraft(); return; }
  });

  root.addEventListener('change', async e => {
    if (ui.mode !== 'panel') return;
    const t = e.target;
    if (t.matches('[data-include-concerns]')) { ui.ai.includeConcerns = t.checked; return; }
    if (t.matches('[data-pick-note]')) {
      await leaveNote();
      const day = t.value;
      ui.wrap = { state: 'idle', error: '' };
      if (!day) { ui.note = null; paint(); return; }
      const n = d.notesOf(ui.personId).find(x => x.day === day);
      if (n) { await loadNote(n.path, n.day); paint(); }
    }
  });

  root.addEventListener('input', e => {
    if (!e.target.matches('[data-editor]') || !ui.note) return;
    ui.note.text = e.target.value;
    ui.note.dirty = true;
    status();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNote, 1500);
  });

  // With a note open: Ctrl+S saves it, Ctrl+E switches Edit and Preview.
  document.addEventListener('keydown', e => {
    if (dlg.open || ui.mode !== 'panel' || !ui.note) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === 's') { e.preventDefault(); saveNote(); return; }
      if (e.key === 'e') { e.preventDefault(); ui.note.mode = ui.note.mode === 'edit' ? 'preview' : 'edit'; paint(); }
    }
  });

  /** The Prep a 1:1 command: the most overdue person's page. */
  function prep() {
    const r = rows()[0];
    return r ? routeOf(r.person) : '';
  }

  /* ---------- live updates ---------- */

  for (const name of [PEOPLE, SETTINGS]) ws.data.subscribe(name, () => { if (!v.waiting) d.reload(name); });
  for (const key of d.READ) { const s = SOURCES[key]; ws.data.subscribe(s.collection, () => { if (!v.waiting) d.reloadSource(key); }, { app: s.app }); }
  ws.files.subscribe(NOTES, async ev => {
    await d.reloadFiles();
    const n = ui.note;
    if (n && ev && ev.path === n.path && !n.dirty && !n.saving && ev.mtime !== n.mtime) { await loadNote(n.path, n.day); paint(); }
  });
  if (ws.backend === 'agent') ws.connectors.onStatus('opencode', () => d.checkConnectors());

  /** First load: copy the old 1:1s data in if needed, load, then open whatever the route asked for. */
  async function start(ref) {
    const copied = await d.loadAll();
    if (copied && copied.first && (copied.people || copied.notes)) {
      ws.toast(`Your 1:1s moved into Rapport: ${copied.people} ${copied.people === 1 ? 'person' : 'people'}, ${copied.notes} ${copied.notes === 1 ? 'note' : 'notes'}. The old copy is kept.`, { kind: 'success' });
    }
    ui.personId = null; // open again now that people and notes are known
    await show(ref);
  }

  /** For the People list: a directory person's 1:1s (or a 1:1s person's by id), at a glance. null when none. */
  function glance({ dirId = '', oid = '' } = {}) {
    if (!v.loaded) return null;
    const p = oid ? shown().find(x => x.id === oid) : personFor(dirId);
    if (!p || p.archived) return null;
    const t = today();
    const st = cadenceState(d.notesOf(p.id), t, p.cadenceDays);
    const next = st.lastDay ? addDays(st.lastDay, p.cadenceDays) : t;
    const pk = packetFor(p);
    return { id: p.id, cadenceDays: p.cadenceDays, lastDay: st.lastDay, due: st.due, days: st.days, next,
      waiting: pk.docket.state === 'ok' ? pk.docket.waiting.length : 0, open: pk.last.state === 'ok' ? pk.last.open.length : 0 };
  }
  /** 1:1s people not in People (or whose directory person is gone), for the People list. */
  const unlinked = () => shown().filter(p => !p.archived && !p.linked);
  /** The 1:1s person shown on the 1:1 tab, for the cadence control. */
  const current = () => personNow();

  /** 1:1s that are due, for Rapport's summary (Home's Needs you): [{id, name, days, route}]. Names only. */
  function dueList() {
    if (!v.loaded) return [];
    return rows().filter(r => r.due).map(r => ({ id: r.person.id, name: r.person.name, days: r.days, route: routeOf(r.person) }));
  }
  // When each 1:1 is next due by cadence (Home's Coming up): the day after the last one plus the cadence, or today.
  function upcomingList() {
    if (!v.loaded) return [];
    const t = today();
    return rows().map(r => {
      const next = r.lastDay ? addDays(r.lastDay, r.person.cadenceDays) : t;
      return { id: r.person.id, name: r.person.name, due: next < t ? t : next, route: routeOf(r.person) };
    });
  }
  return { d, v, ui, panel, show, start, prep, glance, unlinked, current, setCadence, setOwn: d.setOwn, saveNote, dueList, upcomingList, routeOf };
}
