/* Rapport's 1:1s: the 1:1s tab and the 1:1 section on a report's page.

   For one person and the time since your last 1:1, gathers what Docket and Rapport already know (read only,
   no AI), keeps the 1:1 note as a plain Markdown file in your Workshop folder, and after the meeting turns
   follow-ups into Docket quick-add lines and wins into receipts. An optional step asks your opencode agents for
   draft talking points through the opencode connector.

   main.js owns the page, the hash and the paint loop. It calls route() on every route change and asks for HTML
   with view() (the 1:1s tab) and panel() (a report's page). Clicks on this module's controls are handled here
   by their data- attributes. data.js loads and saves; model.js, view.js and markdown.js are pure. */
import { createOneOnOnes } from './data.js';
import { DEFAULT_CADENCE, NOTES, addDays, PEOPLE, SETTINGS, SOURCES, buildPacket, cadenceState, directoryChoices, directorySuggestions, isoDay, personFromDirectory, noteTemplate, packetMarkdown, parseFollowUps, parseWins, quickAddLines, winEntries, withDirectory, esc } from './model.js';
import { confirmHtml, homeHtml, logHtml, personHtml, settingsHtml, setupCard, startPanelHtml } from './view.js';

/**
 * ws: the SDK. root: the element main.js paints into. host: what this module needs from main.js:
 *   repaint()            paint the page again
 *   go(path)             open a Rapport path ('1on1s', 'team/<id>', ...)
 *   isReport(id)         id is one of your reports (in the people directory)
 *   reportName(id)       a report's name
 *   addWins(entries)     add receipts that are not there yet; resolves how many were added
 */
export function createOneOnOnesPage(ws, root, host) {
  const dlg = document.createElement('dialog');
  dlg.className = 'oo-dlg';
  dlg.setAttribute('aria-label', 'Confirm');
  document.body.appendChild(dlg);

  const d = createOneOnOnes(ws, { onChange: () => host.repaint() });
  const v = d.v;

  const ui = {
    view: '',              // Rapport's view: '1on1s', 'team' or another
    mode: 'off',           // 'list', 'settings', 'person' (1:1s tab), 'panel' (a report's page), 'off'
    personId: null,        // the 1:1s person shown
    reportId: null,        // on a report's page
    selected: -1,          // row in the list, for j and k
    edit: null,            // settings: the person being edited, {} for a new one
    note: null,            // {day, path, text, mtime, dirty, saving, error, conflict, mode}
    lastText: {},          // path -> text of earlier notes, for the packet
    ai: { state: 'idle', text: '', error: '', includeConcerns: false },
  };
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
  // A report's 1:1s person: the active one linked to them, else an archived one (so no second one is made).
  const personForReport = rid => shown().find(p => p.personId === rid && !p.archived) || shown().find(p => p.personId === rid) || null;
  const reportOf = p => (p && p.personId && host.isReport(p.personId) ? p.personId : '');

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

  // Who a 1:1s person can be: anyone in the people directory (reports first), and the ones to add in one click.
  function pickers() {
    return {
      choices: directoryChoices(v.dir, ui.edit && ui.edit.personId),
      fromDirectory: directorySuggestions(v.people, v.dir),
      embedded: !!ws.embedded
    };
  }

  function personBody(person, panel) {
    return personHtml({
      person, packet: packetFor(person), note: ui.note, notes: d.notesOf(person.id), today: today(),
      ai: ui.ai, aiOpts: { enabled: v.settings.aiDraft, ready: v.oc },
      panel, due: panel ? cadenceState(d.notesOf(person.id), today(), person.cadenceDays) : null
    });
  }

  /* ---------- HTML for main.js ---------- */

  /** The 1:1s tab. */
  function view() {
    const setup = setupCard(v, ws.embedded);
    if (setup) return setup;
    if (!v.loaded) return '<p class="loading">Loading your 1:1s.</p>';
    if (ui.mode === 'settings') return settingsHtml({ ...v, people: shown() }, pickers(), ui.edit);
    if (ui.mode === 'person') {
      const person = personNow();
      if (person) return personBody(person, false);
      return `<div class="engcard"><h2>Not found</h2><p>This person is not in your 1:1s.</p><div class="acts"><button class="btn" data-route="">All 1:1s</button></div></div>`;
    }
    return homeHtml(rows(), ui, directorySuggestions(v.people, v.dir));
  }

  /** The 1:1 section on a report's page. */
  function panel(rid, name) {
    const setup = setupCard(v, ws.embedded);
    if (setup) return setup;
    if (!v.loaded) return '<p class="loading">Loading your 1:1s.</p>';
    const person = personForReport(rid);
    if (!person) return startPanelHtml(name || host.reportName(rid) || 'this report');
    if (person.id !== ui.personId) {
      // Linked since the route was shown (another window, or the first load): open them.
      if (ui.mode === 'panel' && ui.reportId === rid) queueMicrotask(() => { if (ui.reportId === rid) openPerson(person.id); });
      return '<p class="loading">Loading your 1:1s.</p>';
    }
    return personBody(person, true);
  }

  /* ---------- routes ---------- */

  async function leaveNote() { if (ui.note && ui.note.dirty) await saveNote(); }

  /** Rapport's route changed (or the data loaded): show the matching 1:1s person, if any. */
  async function route(view, id) {
    ui.view = view;
    if (view === '1on1s') {
      ui.reportId = null;
      if (id === 'settings') { await leaveNote(); ui.mode = 'settings'; return paint(); }
      ui.edit = null;
      if (id) { ui.mode = 'person'; return openPerson(id); }
      await leaveNote();
      ui.mode = 'list'; ui.personId = null; ui.note = null;
      return paint();
    }
    ui.edit = null;
    if (view === 'team' && id) {
      ui.mode = 'panel'; ui.reportId = id;
      const p = personForReport(id);
      if (p) return openPerson(p.id);
      await leaveNote();
      ui.personId = null; ui.note = null;
      return paint();
    }
    await leaveNote();
    ui.mode = 'off'; ui.personId = null; ui.reportId = null; ui.note = null;
  }

  /* ---------- a person and their note ---------- */

  async function openPerson(id, day = null) {
    if (ui.personId === id && !day) return paint(); // already open: keep the note being edited
    await leaveNote();
    ui.personId = id;
    ui.note = null;
    ui.ai = { state: 'idle', text: '', error: '', includeConcerns: false };
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

  /** A report's first 1:1s person, linked to them in the people directory. */
  async function startForReport() {
    const rid = ui.reportId;
    if (!rid || personForReport(rid)) return;
    const dp = v.dir && v.dir.byId.get(rid);
    const base = dp ? personFromDirectory(dp) : { name: host.reportName(rid) || 'Unnamed', personId: rid, cadenceDays: DEFAULT_CADENCE, archived: false };
    try {
      const p = await d.savePerson(base);
      await openPerson(p.id);
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
    dlg.innerHTML = html;
    dlg.returnValue = '';
    return new Promise(resolve => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? dlg.querySelector('form') : null), { once: true });
      dlg.showModal();
    });
  }

  /* ---------- after the meeting ---------- */

  async function logFollowUps() {
    const person = personNow(), n = ui.note;
    if (!person || !n) return;
    const followUps = parseFollowUps(n.text).open;
    const wins = parseWins(n.text);
    const canOffer = !!reportOf(person);
    const form = await showDialog(logHtml({ followUps, wins, canOffer, docketLinked: !!person.handle }));
    if (!form) return;
    const f = new FormData(form);
    const pickedF = f.getAll('f').map(Number).map(i => followUps[i]).filter(Boolean);
    const pickedW = canOffer ? f.getAll('w').map(Number).map(i => wins[i]).filter(Boolean) : [];
    const done = [];
    if (pickedF.length) {
      const lines = quickAddLines(pickedF, person.handle).join('\n');
      try { await navigator.clipboard.writeText(lines); done.push(`${pickedF.length} Docket quick-add line${pickedF.length === 1 ? '' : 's'} copied`); }
      catch {
        await showDialog(`<form method="dialog" class="confirm"><h2>Copy these into Docket</h2><textarea rows="6" readonly>${esc(lines)}</textarea>
          <div class="acts"><button class="btn primary" value="ok">Done</button></div></form>`);
      }
    }
    if (pickedW.length) {
      try {
        const added = await host.addWins(winEntries({ person, day: n.day, wins: pickedW, nowIso: new Date().toISOString() }));
        done.push(added === pickedW.length ? `${added} receipt${added === 1 ? '' : 's'} added`
          : added ? `${added} of ${pickedW.length} wins added (the rest were receipts already)` : `${pickedW.length === 1 ? 'That win is' : 'Those wins are'} receipts already`);
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

  function openRow(p) {
    const rid = reportOf(p);
    host.go(rid ? `team/${rid}` : `1on1s/${p.id}`);
  }

  root.addEventListener('click', async e => {
    const el = s => e.target.closest(s);
    let x;
    if ((x = el('[data-person]'))) { const p = shown().find(q => q.id === x.dataset.person); if (p) openRow(p); return; }
    if ((x = el('[data-route]'))) { host.go(x.dataset.route === 'settings' ? '1on1s/settings' : '1on1s'); return; }
    if ((x = el('[data-slate]'))) { ws.open({ app: 'slate', path: `item/${x.dataset.slate}` }).catch(() => {}); return; }
    if ((x = el('[data-add-dir]'))) {
      const dp = v.dir && v.dir.byId.get(x.dataset.addDir);
      if (dp) {
        try { await d.savePerson(personFromDirectory(dp)); ws.toast(`Added ${dp.name}.`, { kind: 'success' }); paint(); }
        catch (err) { toastErr(err); }
      }
      return;
    }
    if (el('[data-start-report]')) { startForReport(); return; }
    if (el('[data-add-person]')) { ui.edit = {}; paint(); root.querySelector('[data-person-form] input')?.focus(); return; }
    if ((x = el('[data-edit-person]'))) { ui.edit = v.people.find(p => p.id === x.dataset.editPerson) || null; paint(); return; }
    if (el('[data-cancel-person]')) { ui.edit = null; paint(); return; }
    if (el('[data-start-note]')) { startNote(); return; }
    if ((x = el('[data-mode]')) && ui.note) { ui.note.mode = x.dataset.mode; paint(); return; }
    if (el('[data-save]')) { saveNote(); return; }
    if ((x = el('[data-conflict]'))) { resolveConflict(x.dataset.conflict); return; }
    if (el('[data-log]')) { await leaveNote(); logFollowUps(); return; }
    if (el('[data-draft]')) { draftTalkingPoints(); return; }
    if (el('[data-draft-insert]')) { insertDraft(); return; }
  });

  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-include-concerns]')) { ui.ai.includeConcerns = t.checked; return; }
    if (t.matches('[data-pick-note]')) {
      await leaveNote();
      const day = t.value;
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

  root.addEventListener('submit', async e => {
    const f = e.target;
    if (!f.matches('[data-person-form], [data-settings]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const data = new FormData(f);
    if (f.matches('[data-person-form]')) {
      const id = f.dataset.id || '';
      const prev = v.people.find(p => p.id === id);
      try {
        await d.savePerson({
          ...(prev || {}), id,
          name: (v.dir && v.dir.byId.get(String(data.get('personId') || '')) || {}).name || (prev && prev.name) || 'Unnamed',
          personId: String(data.get('personId') || ''),
          cadenceDays: Number(data.get('cadenceDays')),
          archived: data.get('archived') === 'on'
        });
        ui.edit = null; paint();
        ws.toast(prev ? 'Saved.' : 'Added.', { kind: 'success' });
      } catch (err) { toastErr(err); }
      return;
    }
    try { await d.saveSettings({ aiDraft: data.get('aiDraft') === 'on' }); ws.toast('Saved the 1:1s settings.', { kind: 'success' }); paint(); }
    catch (err) { toastErr(err); }
  }, true);

  // Keyboard on the 1:1s tab: j and k move, Enter opens, Escape goes back. With a note open (here or on a
  // report's page): Ctrl+S saves it, Ctrl+E switches Edit and Preview.
  document.addEventListener('keydown', e => {
    if (dlg.open || ui.mode === 'off') return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ui.note && (ui.mode === 'person' || ui.mode === 'panel')) {
      if (e.key === 's') { e.preventDefault(); saveNote(); return; }
      if (e.key === 'e') { e.preventDefault(); ui.note.mode = ui.note.mode === 'edit' ? 'preview' : 'edit'; paint(); return; }
    }
    if (e.ctrlKey || e.metaKey || e.altKey || ui.view !== '1on1s') return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (typing) { document.activeElement.blur(); return; }
      if (ui.mode !== 'list') host.go('1on1s');
      return;
    }
    if (typing || ui.mode !== 'list') return;
    const list = rows();
    if ((e.key === 'j' || e.key === 'k') && list.length) {
      ui.selected = Math.max(0, Math.min(list.length - 1, ui.selected < 0 ? 0 : ui.selected + (e.key === 'j' ? 1 : -1)));
      paint();
      root.querySelectorAll('.oo-row')[ui.selected]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && list[ui.selected]) openRow(list[ui.selected].person);
  });

  /** The Prep a 1:1 command: the 1:1s tab with the most overdue person picked. */
  function prep() {
    ui.selected = rows().length ? 0 : -1;
    host.go('1on1s');
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
  async function start(view, id) {
    const copied = await d.loadAll();
    if (copied && copied.first && (copied.people || copied.notes)) {
      ws.toast(`Your 1:1s moved into Rapport: ${copied.people} ${copied.people === 1 ? 'person' : 'people'}, ${copied.notes} ${copied.notes === 1 ? 'note' : 'notes'}. The old copy is kept.`, { kind: 'success' });
    }
    ui.personId = null; // open again now that people and notes are known
    await route(view, id);
  }

  /** The active 1:1s person for a directory person, for Upward's link to your manager's 1:1s. */
  const findByPerson = personId => shown().find(p => !p.archived && p.personId === personId) || null;

  /** 1:1s that are due, for Rapport's summary (Home's Needs you): [{id, name, days, route}]. Names only. */
  function dueList() {
    if (!v.loaded) return [];
    return rows().filter(r => r.due).map(r => { const rid = reportOf(r.person); return { id: r.person.id, name: r.person.name, days: r.days, route: rid ? `team/${rid}` : `1on1s/${r.person.id}` }; });
  }
  // When each 1:1 is next due by cadence (Home's Coming up): the day after the last one plus the cadence, or today.
  function upcomingList() {
    if (!v.loaded) return [];
    const t = today();
    return rows().map(r => {
      const rid = reportOf(r.person);
      const next = r.lastDay ? addDays(r.lastDay, r.person.cadenceDays) : t;
      return { id: r.person.id, name: r.person.name, due: next < t ? t : next, route: rid ? `team/${rid}` : `1on1s/${r.person.id}` };
    });
  }
  return { d, v, ui, view, panel, route, start, prep, findByPerson, setOwn: d.setOwn, saveNote, dueList, upcomingList, isWide: () => ui.mode === 'person' || ui.mode === 'panel' };
}
