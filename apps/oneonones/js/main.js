/* 1:1s: prep 1:1s with your direct reports.

   For one person and the time since your last 1:1, gathers what Docket, Receipts and Queue already know
   (read only, no AI), keeps the 1:1 note as a plain Markdown file in your Workshop folder, and after the
   meeting turns follow-ups into Docket quick-add lines and wins into Receipts offers. An optional step asks
   your opencode agents for draft talking points through the opencode connector.

   data.js loads, saves and calls the connector; model.js, view.js and markdown.js are pure; this file owns
   the page. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { createOneOnOnes } from './data.js';
import { APP, SOURCES, buildPacket, cadenceState, docketNames, isoDay, noteTemplate, packetMarkdown, parseFollowUps, parseWins, queuePeople, quickAddLines, readable, receiptsPeople, winOffers } from './model.js';
import { confirmHtml, homeHtml, logHtml, personHtml, settingsHtml, setupCard } from './view.js';

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('1:1s');

const d = createOneOnOnes(ws, { onChange: () => paint() });
const v = d.v;

const ui = {
  route: '',             // '' (people), 'settings', 'person'
  personId: null,
  selected: -1,          // row in the people list, for j and k
  edit: null,            // settings: the person being edited, {} for a new one
  note: null,            // {day, path, text, mtime, dirty, saving, error, conflict, mode}
  lastText: {},          // path -> text of earlier notes, for the packet
  ai: { state: 'idle', text: '', error: '', includeConcerns: false },
};
const today = () => isoDay(new Date());
const toastErr = e => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });

/* ---------- derived ---------- */

function homeRows() {
  const t = today();
  return v.people.filter(p => !p.archived).map(p => ({ person: p, ...cadenceState(d.notesOf(p.id), t, p.cadenceDays) }))
    .sort((a, b) => (b.due - a.due) || ((b.days ?? 1e9) - (a.days ?? 1e9)) || a.person.name.localeCompare(b.person.name));
}
const personNow = () => v.people.find(p => p.id === ui.personId) || null;

function packetFor(person) {
  const notes = d.notesOf(person.id);
  const t = today();
  const last = notes.find(n => n.day < t);
  return buildPacket({
    person, today: t, now: Date.now(), notes,
    lastText: last ? ui.lastText[last.path] ?? null : null,
    src: { docketTasks: v.src.docketTasks, receiptsEntries: v.src.receiptsEntries, queueSnapshot: v.src.queueSnapshot, queueSettings: v.src.queueSettings }
  });
}

function pickers() {
  return {
    docket: docketNames(v.src.docketPeople),
    receipts: receiptsPeople(v.src.receiptsPeople),
    queue: queuePeople(v.src.queueSettings),
    states: {
      docket: readable(v.src.docketPeople, SOURCES.docketPeople).state,
      receipts: readable(v.src.receiptsPeople, SOURCES.receiptsPeople).state,
      queue: readable(v.src.queueSettings, SOURCES.queueSettings).state
    }
  };
}

/* ---------- paint ---------- */

function paint() {
  // Keep the cursor in the note when something else repaints the page.
  const ed = app.querySelector('[data-editor]');
  const keep = ed && document.activeElement === ed ? { start: ed.selectionStart, end: ed.selectionEnd, top: ed.scrollTop } : null;
  const setup = setupCard(v, ws.embedded);
  let html;
  if (setup) html = setup;
  else if (!v.loaded) html = '<p class="loading">Loading your 1:1s.</p>';
  else if (ui.route === 'settings') html = settingsHtml(v, pickers(), ui.edit);
  else if (ui.route === 'person' && personNow()) {
    const person = personNow();
    html = personHtml({
      person, packet: packetFor(person), note: ui.note, notes: d.notesOf(person.id), today: today(),
      ai: ui.ai, aiOpts: { enabled: v.settings.aiDraft, ready: v.oc }
    });
  } else html = homeHtml(homeRows(), ui);
  app.innerHTML = `<div class="page">${html}</div>`;
  if (keep) {
    const e2 = app.querySelector('[data-editor]');
    if (e2) { e2.focus(); e2.setSelectionRange(keep.start, keep.end); e2.scrollTop = keep.top; }
  }
}

function showDialog(html) {
  dlg.innerHTML = html;
  dlg.returnValue = '';
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? dlg.querySelector('form') : null), { once: true });
    dlg.showModal();
  });
}

/* ---------- a person and their note ---------- */

async function openPerson(id, day = null) {
  if (ui.note && ui.note.dirty) await saveNote();
  ui.route = 'person';
  ui.personId = id;
  ui.note = null;
  ui.ai = { state: 'idle', text: '', error: '', includeConcerns: false };
  paint();
  const notes = d.notesOf(id);
  const t = today();
  const last = notes.find(n => n.day < t);
  if (last && !(last.path in ui.lastText)) {
    try { const f = await d.readNote(last.path); ui.lastText[last.path] = f ? f.content : null; } catch { ui.lastText[last.path] = null; }
  }
  const want = notes.find(n => n.day === (day || t));
  if (want) await loadNote(want.path, want.day);
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
  const ed = app.querySelector('[data-editor]');
  if (ed) { ed.focus(); const at = ed.value.indexOf('## Talking points'); if (at >= 0) ed.setSelectionRange(at + 21, at + 21); }
}

let saveTimer = null;
function status() {
  const n = ui.note, s = app.querySelector('.nstatus'), b = app.querySelector('[data-save]');
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

/* ---------- after the meeting ---------- */

async function logFollowUps() {
  const person = personNow(), n = ui.note;
  if (!person || !n) return;
  const followUps = parseFollowUps(n.text).open;
  const wins = parseWins(n.text);
  const canOffer = !!person.links.receipts;
  const form = await showDialog(logHtml({ followUps, wins, canOffer, docketLinked: !!person.links.docket }));
  if (!form) return;
  const f = new FormData(form);
  const pickedF = f.getAll('f').map(Number).map(i => followUps[i]).filter(Boolean);
  const pickedW = canOffer ? f.getAll('w').map(Number).map(i => wins[i]).filter(Boolean) : [];
  const done = [];
  if (pickedF.length) {
    const lines = quickAddLines(pickedF, person.links.docket).join('\n');
    try { await navigator.clipboard.writeText(lines); done.push(`${pickedF.length} Docket quick-add line${pickedF.length === 1 ? '' : 's'} copied`); }
    catch {
      await showDialog(`<form method="dialog" class="confirm"><h2>Copy these into Docket</h2><textarea rows="6" readonly>${lines.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</textarea>
        <div class="acts"><button class="btn primary" value="ok">Done</button></div></form>`);
    }
  }
  if (pickedW.length) {
    try {
      await d.offer(winOffers({ person, day: n.day, wins: pickedW, nowIso: new Date().toISOString() }));
      done.push(`${pickedW.length} win${pickedW.length === 1 ? '' : 's'} offered to Receipts`);
    } catch (e) { toastErr(e); }
  }
  if (done.length) ws.toast(done.join('. ') + '.', { kind: 'success' });
}

/* ---------- the optional draft step ---------- */

let pollTimer = null;
async function draftTalkingPoints() {
  const person = personNow();
  if (!person || !v.settings.aiDraft || !v.oc) return;
  const day = ui.note ? ui.note.day : today();
  const include = ui.ai.includeConcerns;
  const ok = await showDialog(confirmHtml({
    title: 'Draft talking points?',
    lines: [
      'Sends this prep to your opencode agents through Workshop on this computer. The name is left out.',
      include ? 'Receipts concerns are included for this run.' : 'Receipts concerns are left out.',
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
    if (Date.now() - started > 15 * 60000) { ui.ai.state = 'failed'; ui.ai.error = 'No draft after 15 minutes. Check the session in Dispatch.'; paint(); return; }
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

app.addEventListener('click', async e => {
  const el = s => e.target.closest(s);
  let x;
  if ((x = el('[data-person]'))) { openPerson(x.dataset.person); return; }
  if ((x = el('[data-route]'))) { if (ui.note && ui.note.dirty) await saveNote(); ui.route = x.dataset.route; ui.edit = null; paint(); return; }
  if (el('[data-add-person]')) { ui.edit = {}; paint(); app.querySelector('[data-person-form] input')?.focus(); return; }
  if ((x = el('[data-edit-person]'))) { ui.edit = v.people.find(p => p.id === x.dataset.editPerson) || null; paint(); return; }
  if (el('[data-cancel-person]')) { ui.edit = null; paint(); return; }
  if (el('[data-start-note]')) { startNote(); return; }
  if ((x = el('[data-mode]')) && ui.note) { ui.note.mode = x.dataset.mode; paint(); return; }
  if (el('[data-save]')) { saveNote(); return; }
  if ((x = el('[data-conflict]'))) { resolveConflict(x.dataset.conflict); return; }
  if (el('[data-log]')) { if (ui.note && ui.note.dirty) await saveNote(); logFollowUps(); return; }
  if (el('[data-draft]')) { draftTalkingPoints(); return; }
  if (el('[data-draft-insert]')) { insertDraft(); return; }
});

app.addEventListener('change', async e => {
  const t = e.target;
  if (t.matches('[data-include-concerns]')) { ui.ai.includeConcerns = t.checked; return; }
  if (t.matches('[data-pick-note]')) {
    if (ui.note && ui.note.dirty) await saveNote();
    const day = t.value;
    if (!day) { ui.note = null; paint(); return; }
    const n = d.notesOf(ui.personId).find(x => x.day === day);
    if (n) { await loadNote(n.path, n.day); paint(); }
  }
});

app.addEventListener('input', e => {
  if (!e.target.matches('[data-editor]') || !ui.note) return;
  ui.note.text = e.target.value;
  ui.note.dirty = true;
  status();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 1500);
});

app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const data = new FormData(f);
  if (f.matches('[data-person-form]')) {
    const id = f.dataset.id || '';
    const prev = v.people.find(p => p.id === id);
    try {
      await d.savePerson({
        ...(prev || {}), id,
        name: String(data.get('name') || '').trim(),
        cadenceDays: Number(data.get('cadenceDays')),
        links: { docket: String(data.get('docket') || ''), receipts: String(data.get('receipts') || ''), queue: String(data.get('queue') || '') },
        archived: data.get('archived') === 'on'
      });
      ui.edit = null; paint();
      ws.toast(prev ? 'Saved.' : 'Added.', { kind: 'success' });
    } catch (err) { toastErr(err); }
    return;
  }
  if (f.matches('[data-settings]')) {
    try { await d.saveSettings({ aiDraft: data.get('aiDraft') === 'on' }); ws.toast('Saved the 1:1s settings.', { kind: 'success' }); paint(); }
    catch (err) { toastErr(err); }
  }
});

// Keyboard: j and k move, Enter opens, Escape goes back. Ctrl+S saves the note, Ctrl+E switches Edit and Preview.
document.addEventListener('keydown', e => {
  if (dlg.open) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && ui.note && ui.route === 'person') {
    if (e.key === 's') { e.preventDefault(); saveNote(); return; }
    if (e.key === 'e') { e.preventDefault(); ui.note.mode = ui.note.mode === 'edit' ? 'preview' : 'edit'; paint(); return; }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'Escape') {
    if (typing) { document.activeElement.blur(); return; }
    if (ui.route) { (ui.note && ui.note.dirty ? saveNote() : Promise.resolve()).then(() => { ui.route = ''; ui.edit = null; paint(); }); }
    return;
  }
  if (typing || ui.route) return;
  const rows = homeRows();
  if ((e.key === 'j' || e.key === 'k') && rows.length) {
    ui.selected = Math.max(0, Math.min(rows.length - 1, ui.selected < 0 ? 0 : ui.selected + (e.key === 'j' ? 1 : -1)));
    paint();
    app.querySelectorAll('.prow')[ui.selected]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter' && rows[ui.selected]) openPerson(rows[ui.selected].person.id);
});

/* ---------- routes, commands, events ---------- */

function route(path) {
  const m = /^p\/([^/]+)$/.exec(path || '');
  if (path === 'settings') { ui.route = 'settings'; paint(); return; }
  if (m) { if (v.people.some(p => p.id === m[1])) openPerson(m[1]); else { ui.route = 'person'; ui.personId = m[1]; paint(); } return; }
  ui.route = ''; paint();
}
ws.on('route', p => route(p && p.path));
ws.commands.register({ id: 'prep', title: 'Prep a 1:1' });
ws.on('command', p => {
  if (p.id !== 'prep') return;
  ui.route = ''; ui.edit = null;
  const rows = homeRows();
  ui.selected = rows.length ? 0 : -1; // the most overdue person first
  paint();
});

for (const name of ['people', 'settings', 'handoffs']) ws.data.subscribe(name, () => { if (!v.waiting) d.reload(name); });
for (const [key, s] of Object.entries(SOURCES)) ws.data.subscribe(s.collection, () => { if (!v.waiting) d.reloadSource(key); }, { app: s.app });
ws.files.subscribe('notes', async ev => {
  await d.reloadFiles();
  const n = ui.note;
  if (n && ev && ev.path === n.path && !n.dirty && !n.saving && ev.mtime !== n.mtime) { await loadNote(n.path, n.day); paint(); }
});
if (ws.backend === 'agent') ws.connectors.onStatus('opencode', () => d.checkConnectors());

paint();
await d.loadAll();
// A deep link to a person that arrived before the people loaded.
if (ui.route === 'person' && ui.personId && !ui.note && v.people.some(p => p.id === ui.personId)) openPerson(ui.personId);
