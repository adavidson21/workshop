/* Queue: your team's Azure DevOps work, without opening ADO.

   Reads open work items in your team's area paths through the ADO connector, shows them as Mine, Team,
   Unassigned, Current sprint, All and your saved views, and lets you change state, assignee, priority,
   sprint and tags, comment, and create items. Every change to ADO is a click, then a confirm that says what
   will change, then the connector's write action with confirm: true.

   data.js loads, saves and calls the connector; view.js and model.js are pure; this file owns the page. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { createQueue } from './data.js';
import { APP, EMPTY_FILTERS, describeChange, diffItems, meOf } from './model.js';
import { confirmHtml, detail, identity, listModel, newItemHtml, parsePeople, render, settingsHtml } from './view.js';

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Queue');

const q = createQueue(ws, { onChange: () => paint() });
const v = q.v;

const ui = {
  route: '',               // '' or 'settings'
  view: 'mine',
  filters: { ...EMPTY_FILTERS },
  sort: 'changed',
  filtersTouched: false,
  selected: null,
  d: null,                 // the detail pane: {item, details, loading, error, pending, note, draft}
};
let visibleNow = true;

/* ---------- paint ---------- */
function paint() {
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.filter === 'q' ? { pos: active.selectionStart } : null;
  if (ui.route === 'settings') {
    app.innerHTML = `<div class="page">${settingsHtml(v)}</div>`;
    return;
  }
  if (ui.d) {
    const fresh = v.items.find(i => i.id === ui.d.item.id);
    if (fresh) ui.d.item = fresh;
  }
  const pane = ui.d ? detail(v, ui.d, Date.now()) : '';
  app.innerHTML = `<div class="layout${pane ? ' has-detail' : ''}"><div class="page">${render(v, ui, Date.now(), ws.embedded)}</div>${pane ? `<aside class="detail" aria-label="Work item">${pane}</aside>` : ''}</div>`;
  if (ui.d && ui.d.draft) { const t = app.querySelector('[data-comment] textarea'); if (t) t.value = ui.d.draft; }
  if (keep) {
    const f = app.querySelector('[data-filter="q"]');
    if (f) { f.focus(); f.setSelectionRange(keep.pos, keep.pos); }
  }
}

const toastErr = e => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });

/* ---------- confirm and dialogs ---------- */
function showDialog(html) {
  dlg.innerHTML = html;
  dlg.returnValue = '';
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? dlg.querySelector('form') : null), { once: true });
    dlg.showModal();
  });
}
async function confirmWrite(opts) {
  return !!(await showDialog(confirmHtml({ connection: v.snap.connection, ...opts })));
}

/* ---------- the detail pane ---------- */
function openItem(id) {
  const item = v.items.find(i => i.id === id);
  if (!item) return;
  ui.selected = id;
  ui.d = { item, details: null, loading: true, error: '', pending: null, note: '', draft: '' };
  paint();
  loadDetails(item);
}
async function loadDetails(item) {
  if (v.ado.state !== 'ready') { if (ui.d) { ui.d.loading = false; ui.d.error = 'Details need Workshop on this computer and the ADO connector.'; paint(); } return; }
  try {
    const x = await q.details(item);
    if (ui.d && ui.d.item.id === item.id) { ui.d.details = x; ui.d.loading = false; ui.d.error = ''; paint(); }
  } catch (e) {
    if (ui.d && ui.d.item.id === item.id) { ui.d.loading = false; ui.d.error = e.message || "Couldn't load the details."; paint(); }
  }
}
function closeItem() { ui.selected = null; ui.d = null; paint(); }

const nameFor = who => {
  const p = v.settings.people.find(x => identity(x) === who);
  return p ? p.name : who;
};

/** Ask, then write. The person's click started this; nothing is sent until they confirm. */
async function change(changes, { title = 'Change this work item?', action = 'Save to ADO' } = {}) {
  const d = ui.d;
  if (!d) return;
  const item = d.item;
  const lines = describeChange(item, changes, nameFor);
  if (!lines.length) return;
  if (!(await confirmWrite({ title, item, lines, action }))) { paint(); return; }
  d.note = ''; d.pending = null;
  try {
    const r = await q.update(item, changes);
    if (r.conflict) {
      const diff = r.after ? diffItems(r.before, r.after) : [];
      d.note = r.after
        ? `Someone changed this item in ADO since you loaded it, so nothing was saved.${diff.length ? ' ' + diff.join('; ') + '.' : ''} Check the new values and try again.`
        : 'This item changed in ADO and is no longer in your queue. Nothing was saved.';
      if (r.after) d.item = r.after;
    } else {
      d.item = r.item;
      ws.toast(`Saved #${item.id} to ADO.`, { kind: 'success' });
      loadDetails(r.item);
    }
  } catch (e) {
    d.pending = { changes, error: e.message || 'ADO did not answer.' };
  }
  paint();
}

async function sendComment(text) {
  const d = ui.d;
  const item = d.item;
  const short = text.length > 120 ? text.slice(0, 117) + '...' : text;
  if (!(await confirmWrite({ title: 'Post this comment?', item, lines: [`Comment: ${short}`], action: 'Post comment' }))) { paint(); return; }
  try {
    await q.comment(item, text);
    d.draft = '';
    ws.toast(`Commented on #${item.id}.`, { kind: 'success' });
    loadDetails(item);
  } catch (e) {
    d.draft = text;
    toastErr(e);
  }
  paint();
}

async function newItem() {
  const form = await showDialog(newItemHtml(v));
  if (!form) return;
  const f = new FormData(form);
  const fields = {
    type: String(f.get('type') || ''),
    title: String(f.get('title') || '').trim(),
    description: String(f.get('description') || '').trim() || undefined,
    area: String(f.get('area') || '') || undefined,
    iteration: String(f.get('iteration') || '') || undefined,
    priority: f.get('priority') ? Number(f.get('priority')) : undefined,
    assignedTo: String(f.get('assignedTo') || '') || undefined,
  };
  if (!fields.title) return;
  fields.project = (fields.area || '').split('\\')[0] || undefined;
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  const lines = [`${fields.type}: ${fields.title}`, fields.area && `Area: ${fields.area}`, fields.iteration && `Sprint: ${fields.iteration.split('\\').pop()}`,
    fields.priority && `Priority: ${fields.priority}`, `Assigned to: ${fields.assignedTo ? nameFor(fields.assignedTo) : 'nobody'}`].filter(Boolean);
  if (!(await confirmWrite({ title: 'Create this work item?', lines, action: 'Create in ADO' }))) return;
  try {
    const it = await q.create(fields);
    ws.toast(`Created #${it.id}.`, { kind: 'success' });
    openItem(it.id);
  } catch (e) { toastErr(e); }
}

/* ---------- input ---------- */
app.addEventListener('click', async e => {
  const t = e.target;
  const el = s => t.closest(s);
  let x;
  if ((x = el('[data-item]'))) { openItem(Number(x.dataset.item)); return; }
  if ((x = el('[data-view]'))) { ui.view = x.dataset.view; ui.filtersTouched = false; ui.filters = { ...EMPTY_FILTERS }; paint(); return; }
  if ((x = el('[data-route]'))) { ui.route = x.dataset.route; paint(); return; }
  if ((x = el('[data-open-app]'))) { ws.open({ app: x.dataset.openApp }); return; }
  if (el('[data-close]')) { closeItem(); return; }
  if (el('[data-refresh]')) { q.refresh(); return; }
  if (el('[data-new]')) { newItem(); return; }
  if (el('[data-clear-filters]')) { ui.filters = { ...EMPTY_FILTERS }; ui.filtersTouched = false; paint(); return; }
  if ((x = el('[data-person]'))) { ui.view = 'all'; ui.filters = { ...EMPTY_FILTERS, assignee: x.dataset.person }; ui.filtersTouched = true; paint(); return; }
  if (el('[data-save-view]')) {
    const saved = v.views.find(s => s.id === ui.view);
    const m = listModel(v, ui, Date.now());
    let name = saved ? saved.name : '';
    if (!saved) {
      const form = await showDialog(`<form method="dialog" class="confirm"><h2>Name this view</h2>
        <label>Name<input name="name" maxlength="60" required autocomplete="off"></label>
        <div class="acts"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Save view</button></div></form>`);
      name = form ? String(new FormData(form).get('name') || '').trim() : '';
    }
    if (!name) return;
    try {
      const row = await q.saveView({ id: saved ? saved.id : undefined, name, base: m.viewId, filters: m.filters, sort: m.sort });
      ui.view = row.id; ui.filtersTouched = false; paint();
      ws.toast(`Saved the view ${name}.`, { kind: 'success' });
    } catch (err) { toastErr(err); }
    return;
  }
  if ((x = el('[data-delete-view]'))) {
    const ok = await showDialog(`<form method="dialog" class="confirm"><h2>Delete this view?</h2><p class="soft">Your work items are not touched.</p>
      <div class="acts"><button class="btn" value="cancel">Cancel</button><button class="btn danger" value="ok">Delete view</button></div></form>`);
    if (!ok) return;
    try { await q.deleteView(x.dataset.deleteView); ui.view = 'mine'; paint(); } catch (err) { toastErr(err); }
    return;
  }
  if (!ui.d) return;
  if ((x = el('[data-tag-remove]'))) { change({ tagsRemove: [x.dataset.tagRemove] }); return; }
  if (el('[data-assign-me]')) {
    const me = meOf(v.settings, v.snap.me);
    if (me) change({ assignedTo: identity({ name: me.name, email: me.email }) }, { title: 'Assign this to you?', action: 'Assign to me' });
    return;
  }
  if (el('[data-retry]') && ui.d.pending) { change(ui.d.pending.changes); return; }
  if (el('[data-discard]')) { ui.d.pending = null; paint(); return; }
  if (el('[data-dispatch]')) {
    const it = ui.d.item;
    const lane = it.type === 'Bug' ? 'bug' : 'feature';
    if (!(await confirmWrite({ title: 'Start this in Dispatch?', item: it, lines: [`Start a ${lane} run for #${it.id} with your opencode agents`], action: 'Start' }))) return;
    try { await q.startInDispatch(it); ws.open({ app: 'agents', path: String(it.id) }); } catch (err) { toastErr(err); }
  }
});

app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.filter && t.dataset.filter !== 'q') {
    ui.filters = { ...listModel(v, ui, Date.now()).filters, [t.dataset.filter]: t.type === 'checkbox' ? t.checked : t.value };
    ui.filtersTouched = true; paint(); return;
  }
  if (t.matches('[data-sort]')) { ui.filters = { ...listModel(v, ui, Date.now()).filters }; ui.sort = t.value; ui.filtersTouched = true; paint(); return; }
  if (t.dataset.change && ui.d) {
    const field = t.dataset.change;
    const value = field === 'priority' ? Number(t.value) : t.value;
    if (field === 'priority' && !value) { paint(); return; }
    change({ [field]: value });
  }
});

let qTimer = null;
app.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.filter === 'q') {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { ui.filters = { ...listModel(v, ui, Date.now()).filters, q: t.value }; ui.filtersTouched = true; paint(); }, 120);
  }
  if (t.closest('[data-comment]') && ui.d) ui.d.draft = t.value;
});

app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (f.matches('[data-tag-add]')) {
    const tag = String(new FormData(f).get('tag') || '').trim();
    if (tag) change({ tagsAdd: [tag] });
    return;
  }
  if (f.matches('[data-comment]')) {
    const text = String(new FormData(f).get('text') || '').trim();
    if (text) sendComment(text);
    return;
  }
  if (f.matches('[data-settings]')) {
    const d = new FormData(f);
    const next = {
      areas: String(d.get('areas') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      people: parsePeople(d.get('people')),
      types: String(d.get('types') || '').split(',').map(s => s.trim()).filter(Boolean),
      refreshMinutes: Number(d.get('refreshMinutes')),
      staleDays: Number(d.get('staleDays')),
      connection: String(d.get('connection') || '').trim(),
      meEmail: String(d.get('meEmail') || '').trim(),
    };
    try { ui.route = ''; await q.saveSettings(next); ws.toast('Saved the queue settings.', { kind: 'success' }); paint(); }
    catch (err) { ui.route = 'settings'; toastErr(err); paint(); }
  }
});

// Keyboard: j and k move, Enter opens, / filters, Escape closes. Not while typing in a field or a dialog.
document.addEventListener('keydown', e => {
  if (dlg.open || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'Escape') { if (typing) document.activeElement.blur(); else if (ui.d) closeItem(); return; }
  if (typing || ui.route) return;
  if (e.key === '/') { e.preventDefault(); const f = app.querySelector('[data-filter="q"]'); if (f) f.focus(); return; }
  if (e.key === 'j' || e.key === 'k') {
    const rows = listModel(v, ui, Date.now()).rows;
    if (!rows.length) return;
    const at = rows.findIndex(i => i.id === ui.selected);
    const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (e.key === 'j' ? 1 : -1)))];
    ui.selected = next.id;
    if (ui.d) openItem(next.id); else paint();
    const b = app.querySelector(`[data-item="${next.id}"]`); if (b) b.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Enter' && ui.selected && !ui.d) openItem(ui.selected);
});

/* ---------- routes, commands, events ---------- */
ws.on('route', p => {
  const path = (p && p.path) || '';
  if (path === 'settings') { ui.route = 'settings'; paint(); return; }
  ui.route = '';
  if (/^\d+$/.test(path)) { const id = Number(path); if (v.items.some(i => i.id === id)) openItem(id); else { ui.selected = id; paint(); } }
  else paint();
});
ws.commands.register({ id: 'refresh', title: 'Refresh the queue' });
ws.commands.register({ id: 'new', title: 'New ADO work item' });
ws.on('command', p => {
  if (p.id === 'refresh') q.refresh();
  if (p.id === 'new' && v.ado.state === 'ready' && v.settings.areas.length) newItem();
});
ws.on('visible', p => { visibleNow = !!p.visible; if (visibleNow) maybeRefresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeRefresh(); });

for (const name of ['settings', 'views', 'snapshot', 'seen']) ws.data.subscribe(name, () => { if (!v.waiting) q.reload(name); });
if (ws.backend === 'agent') {
  ws.connectors.onStatus('ado', async () => { await q.checkConnectors(); maybeRefresh(true); });
  ws.connectors.onStatus('opencode', () => q.checkConnectors());
}

/** Refresh when the copy is older than the interval. Never while hidden. */
function maybeRefresh(force = false) {
  if (!visibleNow || document.hidden || v.waiting || v.refreshing) return;
  const age = v.snap.fetchedAt ? Date.now() - Date.parse(v.snap.fetchedAt) : Infinity;
  if (force || age >= v.settings.refreshMinutes * 60000) q.refresh();
}
setInterval(() => { maybeRefresh(); if (!ui.d && !document.hidden) paint(); }, 60000);

paint();
await q.loadAll();
// A deep link to an item that arrived before the snapshot loaded.
if (ui.selected && !ui.d && v.items.some(i => i.id === ui.selected)) openItem(ui.selected);
maybeRefresh(true);
