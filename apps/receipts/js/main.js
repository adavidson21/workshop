/* Receipts: startup, loading and saving, and the page's clicks. Connects through the SDK, reads and writes
   only through ws.data (store.js) and ws.files (summary.js), and paints the HTML strings from view.js.

   Data lives in the receipts folder of the Workshop folder (README.md, Storage):
     config                          people, rubric, roles, categories, cycles, settings
     entries/<person>/<yyyy>         one collection per person per year
     metrics/<person>/<yyyy-mm>      read only here; collectors write it in V1.1
     summaries/<person>/<cycle>.md   a file, with a sidecar collection of the same name */
import { connect } from '../../../shared/workshop-sdk.js';
import {
  CONFIG, KINDS, SELF_ID, SEGMENT, cleanEntry, currentCycle, defaultConfig, emptyEnvelope, entriesIn, entriesName,
  isDate, kindOf, metricsName, monthsOf, newEntry, peopleOf, previousCycle, reviewReasons, settingsOf, slugify,
  todayLocal, validCycle, yearOf, yearsToLoad
} from './model.js';
import { createStore } from './store.js';
import { summarize } from './summarize/template.js';
import { canonical, generate, readVersion, saveEdit, sha256, versionsFrom } from './summary.js';
import { columnsOf, entryRows, exportName, toCsv, toWorkbook } from './export.js';
import * as view from './view.js';
import { COLLECTORS } from './collect/index.js';
import { IMPORTERS } from './import/index.js';

const root = document.getElementById('app');
const embedded = (() => { try { return window.parent !== window && window.parent.location.origin === location.origin; } catch (e) { return false; } })();
document.documentElement.classList.toggle('embed', embedded);
if (!embedded && window.WorkshopTheme) document.body.insertAdjacentHTML('afterbegin', window.WorkshopTheme.toggleHtml());

/* ---------- view state ---------- */
const BLUR_KEY = 'receipts.blur';
const readBlur = () => { try { return sessionStorage.getItem(BLUR_KEY) === '1'; } catch (e) { return false; } };
const V = {
  today: todayLocal(), view: 'log', status: 'loading', statusTip: '', waiting: false, error: null, readOnly: false,
  blurred: readBlur(), settings: settingsOf(null, todayLocal()), people: [], entries: {}, metrics: {},
  logPerson: null, personId: null, cycleId: null, cycle: null, filter: {}, editing: null, packet: {}
};
let ws = null, store = null, loadedYears = new Set(), booted = false;

/* ---------- painting ---------- */
function paint() {
  V.today = todayLocal();
  document.body.classList.toggle('blurred', V.blurred);
  if (V.waiting) { root.innerHTML = view.header({ ...V, status: 'waiting' }) + `<main id="main">${view.waitingHtml(embedded)}</main>`; return; }
  if (V.error) { root.innerHTML = view.header({ ...V, status: 'error' }) + `<main id="main">${view.errorHtml(V.error)}</main>`; return; }
  if (!booted) { root.innerHTML = view.header({ ...V, status: 'loading' }) + '<main id="main"><p class="sub loading">Loading…</p></main>'; return; }
  V.reviewCount = view.reviewItems(V).length;
  V.cycleName = V.cycle ? V.cycle.name : '';
  const body = V.view === 'person' ? view.personView(V) : V.view === 'review' ? view.reviewView(V) : V.view === 'team' ? view.teamView(V)
    : V.view === 'packet' ? view.packetView(V) : V.view === 'settings' ? view.settingsView(V) : view.logView(V);
  root.innerHTML = view.header(V) + `<main id="main">${body}</main>`;
}

// While you type in a form, an update from elsewhere must not wipe it: only the parts around it are redrawn.
let laterPaint = false;
function softPaint() {
  const active = document.activeElement;
  const typing = active && root.contains(active) && active.closest('form, [data-summary]');
  const logDraft = V.view === 'log' && root.querySelector('form[data-form=log] [name=note]');
  if (V.editing || typing || (logDraft && logDraft.value.trim())) {
    laterPaint = true;
    if (V.view === 'log') {
      const aside = root.querySelector('.recent');
      const html = new DOMParser().parseFromString(view.logView(V), 'text/html').querySelector('.recent');
      if (aside && html && !aside.querySelector('form')) aside.replaceWith(html);
    }
    const head = root.querySelector('.rhead .save');
    if (head) { head.dataset.save = V.status; head.textContent = { saved: 'Saved', saving: 'Saving', error: 'Not saved yet', readonly: 'Read only' }[V.status] || V.status; }
    return;
  }
  laterPaint = false;
  paint();
}
let soon = null;
const paintSoon = () => { clearTimeout(soon); soon = setTimeout(softPaint, 60); };
const toast = (text, kind) => ws ? ws.toast(text, kind ? { kind } : undefined).catch(() => {}) : null;

/* ---------- loading ---------- */
function rebuild() {
  const cfg = store.get(CONFIG);
  V.settings = settingsOf(cfg, V.today);
  V.people = peopleOf(cfg);
  const ids = V.settings.rubric.map(r => r.id);
  V.entries = {};
  for (const p of V.people) {
    const list = [];
    for (const y of loadedYears) {
      const env = store.get(entriesName(p.id, y));
      if (env) for (const it of env.items) if (it && typeof it.id === 'string') list.push(cleanEntry(it, ids));
    }
    V.entries[p.id] = list;
  }
  V.cycle = currentCycle(V.settings, V.today);
  if (!V.cycleId || !V.settings.cycles.some(c => c.id === V.cycleId)) V.cycleId = V.cycle && V.cycle.id;
  const active = V.people.filter(p => p.active !== false);
  if (!V.logPerson || !active.some(p => p.id === V.logPerson)) V.logPerson = (active.find(p => p.relation === 'report') || active[0] || {}).id || null;
  if (!V.personId || !V.people.some(p => p.id === V.personId)) V.personId = V.logPerson;
  V.readOnly = store.anyReadOnly;
}

async function loadEntries() {
  const years = yearsToLoad(V.settings, V.today);
  for (const p of V.people) for (const y of years) await store.ensure(entriesName(p.id, y));
  years.forEach(y => loadedYears.add(y));
}

async function boot() {
  ws = ws || await connect({ app: 'receipts' });
  if (ws.backend === 'browser' && ws.storage === 'folder' && !ws.online) return wait();
  store = store || createStore({
    data: ws.data,
    status: s => { V.status = s.state; V.statusTip = s.error ? String(s.error.message || s.error) : ''; paintSoon(); },
    changed: col => { if (kindOf(col) === 'config' || kindOf(col) === 'entries') { rebuild(); if (col === CONFIG) loadEntries().then(() => { rebuild(); paintSoon(); }); } paintSoon(); }
  });
  try {
    let cfg = await store.load(CONFIG);
    if (!cfg) {
      // First run: you as `self`, named from Home's profile if you set one there.
      let selfName = 'You';
      try { const prof = await ws.data.get('profile', { app: 'home' }); if (prof && prof.meta && typeof prof.meta.name === 'string' && prof.meta.name.trim()) selfName = prof.meta.name.trim().slice(0, 80); } catch (e) { /* no profile */ }
      const first = defaultConfig({ today: V.today, selfName });
      await store.update(CONFIG, () => first, () => emptyEnvelope(CONFIG));
    }
    V.settings = settingsOf(store.get(CONFIG), V.today);
    V.people = peopleOf(store.get(CONFIG));
    await loadEntries();
  } catch (e) {
    if (e && e.code === 'unavailable' && ws.backend === 'browser') return wait();
    // For example a damaged file: show what is wrong and save nothing, rather than write over the user's data.
    V.error = e && e.message ? e.message : String(e);
    paint();
    return;
  }
  V.waiting = false; V.error = null;
  rebuild();
  booted = true;
  paint();
  // A summary changed in another window or program: show it, unless you are editing it.
  if (!filesWatched) {
    filesWatched = true;
    ws.files.subscribe('summaries', () => { if (V.view === 'packet' && V.packet.draft == null) loadPacket(V.packet.current && V.packet.current.version); });
  }
}
let filesWatched = false;

/* Chrome must be asked again for the data folder: show the wait, allow nothing, and load once access is back. */
function wait() {
  V.waiting = true; booted = false;
  paint();
}

/* ---------- route and commands ---------- */
function go(viewId, opts = {}) {
  if (V.waiting) return;
  V.view = viewId; V.editing = null;
  // The person you are looking at follows you between views.
  if (opts.person && V.people.some(p => p.id === opts.person)) { V.personId = opts.person; if (V.people.some(p => p.id === opts.person && p.active !== false)) V.logPerson = opts.person; }
  if (opts.cycle && V.settings.cycles.some(c => c.id === opts.cycle)) V.cycleId = opts.cycle;
  paint();
  if (viewId === 'packet') loadPacket();
  if (viewId === 'team') loadMetrics();
  if (viewId === 'log' && opts.focus) { const n = root.querySelector('form[data-form=log] [name=note]'); if (n) n.focus(); }
}
function onRoute(path) {
  const [a, b, c] = String(path || '').split('/');
  if (!a) return;
  if (a === 'log') go('log', { person: b, focus: true });
  else if (a === 'person') go('person', { person: b, cycle: c });
  else if (a === 'review') go('review');
  else if (a === 'team') go('team', { cycle: b });
  else if (a === 'packet') go('packet', { person: b, cycle: c });
  else if (a === 'settings') go('settings');
}
let pendingRoute = null;
function routeWhenReady(path) { if (booted) onRoute(path); else pendingRoute = path; }

/* ---------- entries ---------- */
function readForm(form) {
  const f = new FormData(form);
  const group = name => [...form.querySelectorAll(`[data-chips="${name}"] [aria-pressed="true"]`)].map(b => b.dataset.chip);
  const order = (form.querySelector('[data-chips=rubric]') || {}).dataset;
  const rubric = order && order.sel ? order.sel.split(',').filter(Boolean) : group('rubric');
  const list = (v, re = /,/) => String(v || '').split(re).map(s => s.trim()).filter(Boolean);
  const num = v => (v === '' || v == null ? null : Number(v));
  return {
    person: f.get('person'),
    date: String(f.get('date') || ''),
    kind: group('kind')[0] || 'note',
    note: String(f.get('note') || '').trim(),
    rubric,
    category: group('category')[0] || '',
    bullet: String(f.get('bullet') || '').trim(),
    impact: num(f.get('impact')), effort: f.get('effort') || null, riskReduced: num(f.get('riskReduced')),
    visibility: f.get('visibility') || null, strategic: f.get('strategic') === 'on',
    metric: String(f.get('metric') || '').trim(), metricSource: f.get('metricSource') || '',
    artifact: f.get('artifact') || '', collaborators: list(f.get('collaborators')),
    links: list(f.get('links'), /\s+/), tags: list(f.get('tags')), review: f.get('review') === 'on'
  };
}

function badLinks(links) { return links.filter(u => !/^https?:\/\/\S+$/i.test(u)); }

async function saveNewEntry(form) {
  const v = readForm(form);
  if (!v.note) { toast('Write what happened first.', 'warn'); form.querySelector('[name=note]').focus(); return; }
  if (!isDate(v.date)) { toast('Pick a date.', 'warn'); return; }
  const bad = badLinks(v.links);
  if (bad.length) { toast('Links must start with http:// or https://.', 'warn'); return; }
  const person = v.person || V.logPerson;
  const entry = newEntry({ ...v, person: undefined, source: 'manual' }, V.today);
  delete entry.person;
  const col = entriesName(person, yearOf(entry.date));
  await store.ensure(col); loadedYears.add(yearOf(entry.date));
  V.logPerson = V.personId = person;
  const done = store.update(col, env => { env.items.push(entry); return env; }, () => emptyEnvelope(col));
  rebuild(); paint();
  const note = root.querySelector('form[data-form=log] [name=note]'); if (note) note.focus();
  toast('Receipt logged.', 'success');
  await done;
}

function findEntry(id) {
  for (const p of V.people) { const e = (V.entries[p.id] || []).find(x => x.id === id); if (e) return { person: p, entry: e }; }
  return null;
}

async function saveEditedEntry(form) {
  const found = findEntry(form.dataset.entry);
  if (!found) return;
  const v = readForm(form);
  if (!v.note) { toast('An entry needs some text.', 'warn'); return; }
  if (!isDate(v.date)) { toast('Pick a date.', 'warn'); return; }
  if (badLinks(v.links).length) { toast('Links must start with http:// or https://.', 'warn'); return; }
  const { person, entry } = found;
  delete v.person;
  const next = cleanEntry({ ...entry, ...v }, V.settings.rubric.map(r => r.id));
  const from = entriesName(person.id, yearOf(entry.date)), to = entriesName(person.id, yearOf(next.date));
  V.editing = null;
  if (from === to) {
    store.update(from, env => { env.items = env.items.map(i => i.id === entry.id ? { ...i, ...next } : i); return env; });
  } else {
    // A new year moves the entry to that year's collection.
    await store.ensure(to); loadedYears.add(yearOf(next.date));
    const original = (store.get(from).items.find(i => i.id === entry.id)) || {};
    store.update(to, env => { env.items.push({ ...original, ...next }); return env; }, () => emptyEnvelope(to));
    store.update(from, env => { env.items = env.items.filter(i => i.id !== entry.id); return env; });
  }
  rebuild(); paint();
}

function deleteEntry(id) {
  const found = findEntry(id);
  if (!found || !window.confirm('Delete this entry? This cannot be undone here.')) return;
  V.editing = null;
  store.update(entriesName(found.person.id, yearOf(found.entry.date)), env => { env.items = env.items.filter(i => i.id !== id); return env; });
  rebuild(); paint();
}

/* ---------- metrics (read only in V1) ---------- */
async function loadMetricsFor(personId, cycle) {
  if (!cycle) return [];
  const envs = [];
  for (const m of monthsOf(cycle)) {
    try { const env = await store.ensure(metricsName(personId, m)); if (env) envs.push(env); } catch (e) { /* missing or unreadable month */ }
  }
  (V.metrics[personId] ||= {})[cycle.id] = envs;
  return envs;
}
async function loadMetrics() {
  const cycle = V.settings.cycles.find(c => c.id === V.cycleId);
  await Promise.all(V.people.filter(p => p.active !== false).map(p => loadMetricsFor(p.id, cycle)));
  if (V.view === 'team') softPaint();
}

/* ---------- review packet ---------- */
async function packetInput(person, cycle) {
  const prev = previousCycle(V.settings, cycle);
  const [metrics, prevMetrics] = await Promise.all([loadMetricsFor(person.id, cycle), prev ? loadMetricsFor(person.id, prev) : []]);
  const all = V.entries[person.id] || [];
  const strip = e => { const o = { ...e }; delete o.updatedAt; return o; };
  return {
    person: { id: person.id, name: person.name, relation: person.relation, role: person.role },
    cycle, entries: entriesIn(all, cycle).map(strip), metrics, goals: [],
    previous: prev ? { cycle: prev, entries: entriesIn(all, prev).map(strip), metrics: prevMetrics } : null,
    rubric: V.settings.rubric.map(r => ({ id: r.id, name: r.name })), roles: V.settings.roles
  };
}
const packetCtx = () => ({ person: V.people.find(p => p.id === V.personId) || V.people[0], cycle: V.settings.cycles.find(c => c.id === V.cycleId) || V.cycle });
let packetToken = 0;
async function loadPacket(version) {
  const { person, cycle } = packetCtx();
  if (!person || !cycle) return;
  const token = ++packetToken;
  const P = { mode: V.packet.mode, message: V.packet.message || '' };
  try {
    P.versions = versionsFrom(await ws.files.list(`summaries/${person.id}`), person.id, cycle.id);
    const want = version || (P.versions.length ? P.versions[P.versions.length - 1].version : null);
    P.current = want ? await readVersion({ files: ws.files, store }, person.id, cycle.id, want) : null;
    if (P.current && P.current.sidecar) P.stale = (await sha256(canonical(await packetInput(person, cycle)))) !== P.current.sidecar.inputHash;
  } catch (e) {
    P.message = `Could not read the summary: ${e.message || e}`;
  }
  if (token !== packetToken) return;
  P.draft = null;
  V.packet = P;
  if (V.view === 'packet') paint();
}

async function onGenerate() {
  const { person, cycle } = packetCtx();
  try {
    const r = await generate({ files: ws.files, store, input: await packetInput(person, cycle), summarize });
    V.packet.message = r.action === 'created' ? `Summary written to ${r.path}.` : r.action === 'replaced' ? 'Summary regenerated.'
      : r.action === 'unchanged' ? 'Nothing changed since the last summary.' : `You had edited version ${r.version - 1}, so it was kept. Version ${r.version} is new, beside it.`;
    await loadPacket(r.version);
  } catch (e) {
    V.packet.message = e && e.code === 'conflict' ? 'The summary changed in another window or program. It was read again; try once more.' : `Could not save the summary: ${e.message || e}`;
    await loadPacket();
  }
}

async function onSaveSummary() {
  const { person, cycle } = packetCtx();
  const cur = V.packet.current;
  if (!cur || V.packet.draft == null) return;
  try {
    await saveEdit({ files: ws.files, store }, person.id, cycle.id, cur.version, V.packet.draft, cur.mtime);
    V.packet.message = 'Edits saved.';
    await loadPacket(cur.version);
  } catch (e) {
    if (e && e.code === 'conflict') {
      V.packet.message = 'This summary changed in another window or program. Your edits are below; copy them, then reload the newer version.';
      if (e.current) V.packet.current = { ...cur, content: e.current.content, mtime: e.current.mtime };
      paint();
    } else { V.packet.message = `Could not save: ${e.message || e}`; paint(); }
  }
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function onExport(kind) {
  const { person, cycle } = packetCtx();
  const rows = entryRows(entriesIn(V.entries[person.id] || [], cycle), person, V.settings);
  const cols = columnsOf(V.settings.csvColumns);
  if (kind === 'csv') { download(exportName(person.id, cycle.id, 'csv'), new Blob([toCsv(rows, cols)], { type: 'text/csv;charset=utf-8' })); return; }
  if (!window.XLSX) { toast('Excel tools did not load. Reload the page.', 'error'); return; }
  window.XLSX.writeFile(toWorkbook(window.XLSX, rows, cols, `${person.name} ${cycle.name}`), exportName(person.id, cycle.id, 'xlsx'));
}
async function onCopy(kind) {
  const md = V.packet.draft != null ? V.packet.draft : V.packet.current && V.packet.current.content;
  if (!md) return;
  const text = kind === 'md' ? md : view.mdToText(md);
  try { await navigator.clipboard.writeText(text); toast(kind === 'md' ? 'Copied as Markdown.' : 'Copied as text.', 'success'); }
  catch (e) { toast('Could not reach the clipboard. Select the text and copy it instead.', 'warn'); }
}

/* ---------- settings ---------- */
function saveSettings(form) {
  const kind = form.dataset.settings;
  const msg = form.querySelector('[data-msg]');
  const say = t => { if (msg) msg.textContent = t; };
  if (kind === 'people') {
    const rows = [...form.querySelectorAll('[data-person-row]')];
    const changes = [], added = [];
    for (const r of rows) {
      const get = n => r.querySelector(`[name=${n}]`);
      const name = get('name').value.trim();
      const fields = { name, relation: get('relation').value, role: get('role').value, level: get('level').value.trim(), active: get('active').checked };
      if (!r.dataset.personRow) { if (name) added.push(fields); continue; }
      if (!name) { say('Every person needs a name.'); return; }
      changes.push({ id: r.dataset.personRow, ...fields });
    }
    store.update(CONFIG, env => {
      for (const c of changes) {
        const p = env.items.find(i => i.id === c.id);
        if (!p) continue;
        p.name = c.name; p.role = c.role; p.level = c.level;
        if (p.relation !== 'self') { p.relation = c.relation; p.active = c.active; }
      }
      for (const a of added) env.items.push({ id: slugify(a.name, env.items.map(i => i.id)), ...a, active: true });
      return env;
    });
    rebuild(); loadEntries().then(() => { rebuild(); paint(); });
    say(added.length ? `Added ${added.length === 1 ? added[0].name : added.length + ' people'}.` : 'Saved.');
    return;
  }
  if (kind === 'cycles') {
    const cycles = [];
    for (const r of form.querySelectorAll('[data-cycle-row]')) {
      const get = n => { const el = r.querySelector(`[name=${n}]`); return el ? el.value.trim() : ''; };
      const c = { id: r.dataset.cycleRow || get('id').toLowerCase(), name: get('name'), start: get('start'), end: get('end') };
      if (get('due')) c.due = get('due');
      if (!r.dataset.cycleRow && !c.id && !c.name) continue;
      if (!SEGMENT.test(c.id)) { say(`A cycle id is lowercase letters, digits and dashes, like 2027-h1.`); return; }
      if (!validCycle(c)) { say(`Check ${c.name || c.id}: it needs a name, and its start must not be after its end.`); return; }
      if (cycles.some(x => x.id === c.id)) { say(`There are two cycles with the id ${c.id}.`); return; }
      cycles.push(c);
    }
    const days = Number(form.querySelector('[name=nudgeDays]').value);
    if (!Number.isInteger(days) || days < 1 || days > 365) { say('Days must be a whole number from 1 to 365.'); return; }
    store.update(CONFIG, env => {
      const old = new Map(((env.meta && env.meta.cycles) || []).map(c => [c.id, c]));
      env.meta = { ...env.meta, cycles: cycles.map(c => ({ ...old.get(c.id), ...c })), nudgeDays: days };
      return env;
    });
    rebuild(); loadEntries().then(() => { rebuild(); paint(); });
    say('Saved.');
    return;
  }
  if (kind === 'rubric') {
    const edits = new Map([...form.querySelectorAll('[data-rubric-row]')].map(r => [r.dataset.rubricRow, { name: r.querySelector('[name=name]').value.trim(), description: r.querySelector('[name=description]').value.trim() }]));
    if ([...edits.values()].some(e => !e.name)) { say('Every section needs a name.'); return; }
    store.update(CONFIG, env => { env.meta = { ...env.meta, rubric: settingsOf(env, V.today).rubric.map(r => ({ ...r, ...(edits.get(r.id) || {}) })) }; return env; });
    rebuild(); paint();
    return;
  }
  if (kind === 'columns') {
    const cols = [...form.querySelectorAll('[name=col]:checked')].map(i => i.value);
    if (!cols.length) { say('Pick at least one column.'); return; }
    store.update(CONFIG, env => { env.meta = { ...env.meta, csvColumns: cols }; return env; });
    rebuild(); paint();
  }
}

/* ---------- input ---------- */
function toggleChip(btn) {
  const group = btn.closest('[data-chips]');
  const on = btn.getAttribute('aria-pressed') === 'true';
  if (!group.hasAttribute('data-multi')) {
    group.querySelectorAll('[data-chip]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    // Kind always has one; a category can be cleared.
    btn.setAttribute('aria-pressed', on && group.dataset.chips !== 'kind' ? 'false' : 'true');
    return;
  }
  let selected = group.dataset.sel != null ? group.dataset.sel.split(',').filter(Boolean)
    : [...group.querySelectorAll('[aria-pressed="true"]')].map(b => b.dataset.chip);
  if (on) selected = selected.filter(x => x !== btn.dataset.chip);
  else if (selected.length >= 3) { toast('Up to 3 rubric sections. The first is the primary one.', 'info'); return; }
  else selected.push(btn.dataset.chip);
  group.dataset.sel = selected.join(',');
  group.querySelectorAll('[data-chip]').forEach(b => {
    const i = selected.indexOf(b.dataset.chip);
    b.setAttribute('aria-pressed', i >= 0 ? 'true' : 'false');
    b.classList.toggle('primary', i === 0);
    const tag = b.querySelector('.tag');
    if (i === 0 && !tag) b.insertAdjacentHTML('beforeend', '<span class="tag">primary</span>');
    if (i !== 0 && tag) tag.remove();
  });
}

root.addEventListener('click', e => {
  const t = e.target;
  const q = s => t.closest(s);
  if (q('[data-open-workshop]')) { if (ws) ws.open({ app: 'receipts' }).catch(() => {}); return; }
  if (V.waiting || !booted) return;
  let el;
  if ((el = q('[data-blur]'))) { V.blurred = !V.blurred; try { sessionStorage.setItem(BLUR_KEY, V.blurred ? '1' : '0'); } catch (err) { /* private mode */ } paint(); return; }
  if ((el = q('[data-tab]'))) { go(el.dataset.tab); return; }
  if ((el = q('[data-chip]'))) { toggleChip(el); return; }
  if ((el = q('[data-edit]'))) { V.editing = el.dataset.edit; paint(); const n = root.querySelector('form[data-form=edit] [name=note]'); if (n) n.focus(); return; }
  if (q('[data-cancel]')) { V.editing = null; paint(); return; }
  if (q('[data-delete]')) { const f = q('form[data-entry]'); if (f) deleteEntry(f.dataset.entry); return; }
  if ((el = q('[data-log-for]'))) { go('log', { person: el.dataset.logFor, focus: true }); return; }
  if ((el = q('[data-packet-for]'))) { go('packet', { person: el.dataset.packetFor }); return; }
  if ((el = q('[data-open-person]'))) { go('person', { person: el.dataset.openPerson }); return; }
  if (q('[data-generate]')) { onGenerate(); return; }
  if (q('[data-save-summary]')) { onSaveSummary(); return; }
  if ((el = q('[data-copy]'))) { onCopy(el.dataset.copy); return; }
  if ((el = q('[data-export]'))) { onExport(el.dataset.export); return; }
  if ((el = q('[data-pmode]'))) { const ta = root.querySelector('[data-summary]'); if (ta) V.packet.draft = ta.value === V.packet.current.content ? null : ta.value; V.packet.mode = el.dataset.pmode; paint(); }
});

root.addEventListener('change', e => {
  const t = e.target;
  if (!booted) return;
  if (t.matches('[data-pick=person]') && t.closest('form[data-form=log]')) {
    // A different person: keep what was typed, change the categories to their role's.
    const form = t.closest('form'), draft = readForm(form);
    V.logPerson = V.personId = t.value;
    paint();
    const f = root.querySelector('form[data-form=log]');
    if (f) { f.querySelector('[name=note]').value = draft.note; f.querySelector('[name=date]').value = draft.date; f.querySelector('[name=note]').focus(); }
    return;
  }
  if (t.matches('[data-pick=personId]')) { V.personId = t.value; V.filter = {}; paint(); if (V.view === 'packet') loadPacket(); return; }
  if (t.matches('[data-pick=cycleId]')) { V.cycleId = t.value; paint(); if (V.view === 'packet') loadPacket(); if (V.view === 'team') loadMetrics(); return; }
  if (t.matches('[data-pick=version]')) { loadPacket(Number(t.value)); return; }
  if (t.matches('[data-filter]')) { V.filter = { ...V.filter, [t.dataset.filter]: t.value || undefined }; paint(); }
});

root.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-summary]') && V.packet.current) {
    V.packet.draft = t.value === V.packet.current.content ? null : t.value;
    const b = root.querySelector('[data-save-summary]');
    if (b) b.disabled = V.packet.draft == null || V.readOnly;
  }
});

root.addEventListener('submit', e => {
  e.preventDefault();
  if (V.waiting || V.readOnly || !booted) return;
  const f = e.target;
  Promise.resolve().then(() => {
    if (f.dataset.form === 'log') return saveNewEntry(f);
    if (f.dataset.form === 'edit') return saveEditedEntry(f);
    if (f.dataset.settings) return saveSettings(f);
  }).catch(err => toast(err.message || String(err), 'error'));
});

root.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    const f = e.target.closest && e.target.closest('form.entry-form');
    if (f) { e.preventDefault(); f.requestSubmit(); }
  }
  if (e.key === 'Escape' && V.editing) { V.editing = null; paint(); }
});
root.addEventListener('focusout', () => { if (laterPaint) setTimeout(() => { if (laterPaint) softPaint(); }, 120); });

/* ---------- start ---------- */
paint();
ws = await connect({ app: 'receipts' });
ws.on('route', ({ path }) => routeWhenReady(path));
ws.on('command', ({ id }) => {
  if (id === 'log') routeWhenReady('log');
  if (id === 'blur') { V.blurred = !V.blurred; try { sessionStorage.setItem(BLUR_KEY, V.blurred ? '1' : '0'); } catch (err) { /* private mode */ } paint(); }
});
ws.on('online', ({ online }) => {
  if (online && (V.waiting || !booted)) { boot().then(() => { if (pendingRoute) { onRoute(pendingRoute); pendingRoute = null; } }); return; }
  if (online && store) store.refresh();
  // Folder access lost (browser mode): stop editing and wait for Allow again.
  if (!online && ws.backend === 'browser' && ws.storage === 'folder') wait();
});
addEventListener('beforeunload', e => { if (store && store.unsaved) { e.preventDefault(); e.returnValue = ''; } });

await boot();
if (pendingRoute) { onRoute(pendingRoute); pendingRoute = null; }

/* Test hook for tests/e2e.py: the state and the pieces it drives. Not used by the page. */
window.__receipts = {
  get V() { return V; }, get store() { return store; }, get ws() { return ws; },
  saved: () => (store ? store.idle() : Promise.resolve()), go, loadPacket, onGenerate, rebuild: () => { rebuild(); paint(); },
  interfaces: { collectors: COLLECTORS.length, importers: IMPORTERS.length }, kinds: KINDS.map(k => k.id), selfId: SELF_ID,
  reviewReasons
};
