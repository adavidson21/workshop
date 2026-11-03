/* Roadmap: your products' Epics and Features on a time axis, release health per Epic, and the sprint's ceremonies.

   Reads Epics and Features in your products' area paths through the ADO connector's roadmap action (read only),
   shows them as one lane per product, and keeps the last copy so it opens offline. Ceremonies are offered to
   Docket as every-sprint tasks through this app's own handoffs collection.

   data.js loads, saves and calls the connector; view.js and model.js are pure; this file owns the page. */
import { connect } from '../../../shared/workshop-sdk.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { createPm } from './data.js';
import { APP, DOCKET, parseProducts, slugId } from './model.js';
import { render } from './view.js';

const app = document.getElementById('app');
const ws = await connect({ app: APP });
document.documentElement.classList.toggle('embed', ws.embedded);
if (!ws.embedded) mountBar('Roadmap');

const pm = createPm(ws, { onChange: () => paint() });
const v = pm.v;

const ui = {
  tab: 'roadmap',          // roadmap | releases | cadence | settings
  open: new Set(),         // Epic ids whose features show
  release: null,           // Epic id picked in Release health, or null for all
  draft: null              // unsaved ceremony edits, or null
};
let visibleNow = true;

function paint() {
  // Keep focus and the caret in a ceremony field across repaints.
  const a = document.activeElement;
  const keep = a && a.dataset && a.dataset.cf ? { ci: a.closest('[data-ci]')?.dataset.ci, cf: a.dataset.cf, pos: a.selectionStart } : a && a.dataset && a.dataset.toggle ? { toggle: a.dataset.toggle } : null;
  const scroll = [...app.querySelectorAll('.chart')].map(c => c.scrollLeft);
  app.innerHTML = `<div class="page">${render(v, ui, Date.now(), ws.embedded)}</div>`;
  app.querySelectorAll('.chart').forEach((c, i) => { if (scroll[i]) c.scrollLeft = scroll[i]; });
  if (keep && keep.cf) {
    const f = app.querySelector(`[data-ci="${keep.ci}"] [data-cf="${keep.cf}"]`);
    if (f) { f.focus(); if (typeof keep.pos === 'number' && f.setSelectionRange && f.type !== 'number') f.setSelectionRange(keep.pos, keep.pos); }
  }
  if (keep && keep.toggle) { const t = app.querySelector(`[data-toggle="${keep.toggle}"]`); if (t) t.focus(); }
}

const toastErr = e => ws.toast(e && e.message ? e.message : 'Something went wrong. Try again.', { kind: 'error' });

function setTab(tab) {
  ui.tab = tab;
  paint();
  const t = app.querySelector(`.tab[data-tab="${tab}"]`);
  if (t) t.focus();
}

/* ---------- cadence edits ---------- */
const draft = () => (ui.draft ||= structuredClone(v.cadence));
const newId = () => `cer_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function readField(el) {
  const row = el.closest('[data-ci]');
  if (!row) return;
  const c = draft()[Number(row.dataset.ci)];
  const f = el.dataset.cf;
  if (f === 'due') { c.last = el.value === 'last'; if (!c.last) c.dueDay = Number(el.value); return; }
  if (f === 'minutes') { c.minutes = el.value === '' ? null : Number(el.value); return; }
  c[f] = el.value;
}

async function saveCadence() {
  const list = draft().filter(c => String(c.name || '').trim()).map(c => ({ ...c, id: c.id || slugId('cer', c.name) }));
  try { await pm.saveCadence(list); ui.draft = null; paint(); ws.toast('Saved the ceremonies.', { kind: 'success' }); }
  catch (e) { toastErr(e); }
}

async function sendToDocket() {
  try {
    const n = await pm.sendToDocket();
    ws.toast(`Offered ${n} ${n === 1 ? 'ceremony' : 'ceremonies'} to Docket. Accept them in Docket's Day view settings.`, { kind: 'success' });
  } catch (e) { toastErr(e); }
}

function scope() {
  ws.toast('In Dispatch, use Start work to scope it.');
  ws.open({ app: 'agents' });
}

/* ---------- input ---------- */
app.addEventListener('click', async e => {
  const el = s => e.target.closest(s);
  let x;
  if ((x = el('[data-tab]'))) { setTab(x.dataset.tab); return; }
  if ((x = el('[data-toggle]'))) {
    const id = Number(x.dataset.toggle);
    if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id);
    paint();
    return;
  }
  if ((x = el('[data-release]'))) { ui.release = Number(x.dataset.release); setTab('releases'); return; }
  if ((x = el('[data-seen]'))) {
    const id = Number(x.dataset.seen);
    const items = v.items.filter(i => i.id === id || i.parentId === id);
    pm.markSeen(items).catch(toastErr);
    return;
  }
  if ((x = el('[data-open-app]'))) { ws.open({ app: x.dataset.openApp }); return; }
  if (el('[data-open-docket]')) { ws.open({ app: DOCKET, path: 'day/today' }); return; }
  if (el('[data-refresh]')) { pm.refresh(); return; }
  if (el('[data-scope]')) { scope(); return; }
  if (el('[data-cadd]')) {
    draft().push({ id: newId(), name: '', dueDay: 1, last: false, minutes: 60, planKind: 'meetings', role: '' });
    paint();
    const names = app.querySelectorAll('[data-cf="name"]');
    if (names.length) names[names.length - 1].focus();
    return;
  }
  if ((x = el('[data-cdel]'))) { draft().splice(Number(x.closest('[data-ci]').dataset.ci), 1); paint(); return; }
  if (el('[data-csave]')) { saveCadence(); return; }
  if (el('[data-ccancel]')) { ui.draft = null; paint(); return; }
  if (el('[data-send]')) { sendToDocket(); }
});

app.addEventListener('input', e => { if (e.target.dataset.cf && e.target.tagName === 'INPUT') { const was = !!ui.draft; readField(e.target); if (!was) paint(); } });
app.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.cf) { readField(t); paint(); return; }
  if (t.matches('[data-release-pick]')) { ui.release = t.value ? Number(t.value) : null; paint(); }
});

app.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  if (!f.matches('[data-settings]')) return;
  const d = new FormData(f);
  const settings = {
    connection: String(d.get('connection') || '').trim(),
    useQueueAreas: d.get('useQueueAreas') === 'on',
    staleDays: Number(d.get('staleDays')),
    refreshMinutes: Number(d.get('refreshMinutes'))
  };
  try { ui.tab = 'roadmap'; await pm.saveSettings({ products: parseProducts(d.get('products')), settings }); ws.toast('Saved the roadmap settings.', { kind: 'success' }); paint(); }
  catch (err) { ui.tab = 'settings'; toastErr(err); paint(); }
});

/* ---------- routes, commands, events ---------- */
ws.on('route', p => {
  const path = (p && p.path) || '';
  const m = /^releases\/(\d+)$/.exec(path);
  if (m) { ui.release = Number(m[1]); ui.tab = 'releases'; }
  else if (['releases', 'cadence', 'settings'].includes(path)) ui.tab = path;
  else ui.tab = 'roadmap';
  paint();
});
ws.commands.register({ id: 'refresh', title: 'Refresh the roadmap' });
ws.commands.register({ id: 'scope', title: 'Scope new work' });
ws.on('command', p => {
  if (p.id === 'refresh') pm.refresh();
  if (p.id === 'scope') scope();
});
ws.on('visible', p => { visibleNow = !!p.visible; if (visibleNow) maybeRefresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeRefresh(); });

for (const name of pm.COLLECTIONS) ws.data.subscribe(name, () => { if (!v.waiting) pm.reload(name); });
ws.data.subscribe('settings', () => pm.reloadOthers(), { app: 'queue' });
ws.data.subscribe('dayplan/settings', () => pm.reloadOthers(), { app: DOCKET });
ws.data.subscribe('dayplan/recurring', () => pm.reloadOthers(), { app: DOCKET });
if (ws.backend === 'agent') ws.connectors.onStatus('ado', async () => { await pm.checkConnectors(); maybeRefresh(true); });

/** Refresh when the copy is older than the interval. Never while hidden. */
function maybeRefresh(force = false) {
  if (!visibleNow || document.hidden || v.waiting || v.refreshing) return;
  const age = v.snap.fetchedAt ? Date.now() - Date.parse(v.snap.fetchedAt) : Infinity;
  if (force || age >= v.settings.refreshMinutes * 60000) pm.refresh();
}
setInterval(() => { maybeRefresh(); if (!document.hidden && !ui.draft && ui.tab !== 'settings') paint(); }, 60000);

paint();
await pm.loadAll();
maybeRefresh(true);
