/* Runway: team and project roadmaps, typed as an outline or dragged on a timeline, exported as an image or
   Markdown. Runs on its own at runway.alexisdavidson.org and inside Workshop at /apps/runway/.

   store.js saves through the SDK; outline.js, model.js, timeline.js and view.js are pure; this file owns the
   page: painting, the timeline's pointer and keyboard handling, dialogs, routes and commands. */
import { connect } from '../shared/workshop-sdk.js';
import { mountBar } from '../shared/standalone-bar.js';
import { PAIR_HELP, canPair, forgetPairing, isPaired, pairWith } from '../shared/pair.js';
import { saveFile } from '../shared/save-file.js';
import { SNAP, addDays, isDate, periodEnd, periodStart, sizeEnd, sprintOf, toDay, today } from './dates.js';
import { APP, blankDoc, cleanItem, fromEnvelope, goalFor, setGoal, moveItem, newId, nextOrder, removeItem, resizeItem, schedule, setLane, setParent, viewRange } from './model.js';
import { parse, reconcile, serialize } from './outline.js';
import { dateAt, laneAt, layout, svg } from './timeline.js';
import { exportSvg, fileName, markdown, periodName, toPng } from './export.js';
import { exampleOutline } from './example.js';
import { createStore } from './store.js';
import { SENDERS, createPending, ideaToItem, sendersFrom, writeToMap } from './pending.js';
import { buildSummary } from './summary.js';
import { createSummaryWriter } from '../shared/summary.js';
import {
  ICON, OUTLINE_HELP, assignDialog, confirmDialog, exportDialog, importDialog, laneOptions, listHtml, panelHtml, promptDialog, rangeHtml, underOptions,
  settingsDialog, toolbarHtml, trayHtml, warningsHtml, detailsHtml, goalDialog, adoBarHtml, adoDialog
} from './view.js';

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const ws = await connect({ app: APP });
let swReload = null;
if (ws.embedded) document.documentElement.classList.add('embed');
else {
  mountBar('Runway');
  // The "New version" prompt: the SDK's in-page toast, whose button sends the reload-new command below.
  if (window.WorkshopSw) WorkshopSw.register((msg, label, fn) => { swReload = fn; ws.toast(msg, { action: { label, command: 'reload-new' } }).catch(() => {}); });
}

let painting = false;
// Runway's summary for other apps (js/summary.js): written a moment after the roadmap list changes.
const summary = createSummaryWriter({ data: ws.data, app: 'runway', build: () => buildSummary(store.v) });
let summaryKey = '';
const store = createStore(ws, { onChange: () => {
  const key = store.v.loaded ? JSON.stringify(store.v.list.map(r => [r.id, r.title])) : '';
  if (key && key !== summaryKey) { summaryKey = key; summary.schedule(); }
  if (!painting) requestPaint();
} });
const v = store.v;

/* Pending assignment (js/pending.js): ideas captured on Home. The open roadmap takes them through the store,
   so its unsaved edits are kept; other roadmaps get them straight in their collection. */
const pending = createPending(ws, {
  onChange: () => { if (!painting) requestPaint(); },
  hasMap: id => v.list.some(r => r.id === id),
  async addToMap(mapId, idea, opts) {
    if (v.mapId === mapId && v.doc) {
      if (!store.edit(d => d.items.push(ideaToItem(d, idea, opts)))) throw new Error("That roadmap can't be changed right now.");
      await store.flush();
      return;
    }
    await writeToMap(ws, mapId, fromEnvelope, idea, opts);
  }
});
// Senders of captured ideas come from the manifests (ws.apps.list); SENDERS is updated in place. Not awaited, so
// the route handler is in place before the shell's first route event; pickup runs again once they are known.
(ws.apps && ws.apps.list ? ws.apps.list() : Promise.resolve([])).catch(() => []).then(apps => {
  const found = sendersFrom(apps);
  const before = Object.keys(SENDERS).join();
  for (const k of Object.keys(SENDERS)) delete SENDERS[k];
  Object.assign(SENDERS, found);
  if (Object.keys(SENDERS).join() !== before && pending.pickup) pending.pickup();
});
const prefMode = (() => { try { return localStorage.getItem('runway.mode'); } catch (e) { return null; } })();
const ui = {
  mode: ['timeline', 'outline', 'split'].includes(prefMode) ? prefMode : 'split',
  selected: null,
  outline: '',
  warnings: [],
  dragDoc: null,
  drag: null,
  L: null,
  range: null,
  pendingRoute: null,
  opened: null,
  detailsOpen: (() => { try { return localStorage.getItem('runway.details') !== 'closed'; } catch (e) { return true; } })()
};
let unsubMap = null;

/* ---------- Azure DevOps: optional ----------
   js/ado/ is loaded only when Runway uses Workshop on this computer. Without it (Runway on its own, browser mode,
   connector off) nothing below shows and every roadmap works the same. */
let ado = null;
ui.adoRefreshing = false;
ui.adoRefreshed = null;      // the roadmap id refreshed since it was opened
const adoReady = () => !!(ado && ado.state.ready);
const adoMod = () => import('./ado/model.js');
if (ws.backend === 'agent') {
  import('./ado/index.js').then(m => {
    ado = m.createAdo(ws, { onChange: () => { requestPaint(); autoRefresh(); } });
    return ado.check();
  }).catch(() => { ado = null; });
}
/** A live ADO roadmap's items can't be changed here; neither can a roadmap saved by a newer Runway. */
const live = () => !!(v.doc && v.doc.meta.ado && v.doc.meta.ado.mode === 'live');

/* ---------- team reports (moved from Docket): js/ado/reports/ loads the first time the page opens ---------- */
let reports = null;
ui.reports = false;
async function reportsMod() {
  if (reports) return reports;
  const m = await import('./ado/reports/index.js');
  reports = reports || m.createReports({ ws, ado: () => ado, toast, toastErr, showDialog, saveFile, requestPaint, home: () => go('') });
  return reports;
}
const locked = () => !!v.readOnly || live();

const isDark = () => (window.WorkshopTheme ? WorkshopTheme.isDark() : false);
const toast = (text, kind) => ws.toast(text, kind ? { kind } : undefined).catch(() => {});
const toastErr = (e) => toast(e && e.message ? e.message : 'Something went wrong. Try again.', 'error');
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/* ---------- painting ---------- */

let frame = 0;
function requestPaint() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); }

function setHtml(el, html) { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } }

function paint() {
  painting = true;
  try {
    if (v.waiting) {
      app.dataset.view = 'waiting';
      app.innerHTML = `<div class="engcard"><h2>Allow Workshop to use your folder</h2><p>Your roadmaps are files in your Workshop folder, and this browser needs your permission again to open it. ${ws.embedded ? 'Click Allow in the bar at the top.' : 'Open Workshop and allow the folder in Settings.'} Nothing is saved until then.</p></div>`;
      return;
    }
    if (!v.loaded) { app.dataset.view = 'loading'; app.innerHTML = '<p class="loading">Loading your roadmaps.</p>'; return; }
    if (ui.reports) return paintReports();
    if (!v.doc) return paintList();
    paintMap();
  } finally { painting = false; }
}

function paintList() {
  if (app.dataset.view !== 'list') { app.dataset.view = 'list'; app.innerHTML = '<div class="list"></div>'; }
  setHtml(app.firstElementChild, listHtml(v, { canPair: !ws.embedded && canPair(ws), paired: !ws.embedded && isPaired(ws), ado: adoReady(), reports: ws.backend === 'agent', pending: pending.v }));
}

function paintReports() {
  if (app.dataset.view !== 'reports') { app.dataset.view = 'reports'; app.innerHTML = '<div class="list rpage"></div>'; }
  if (!reports) { setHtml(app.firstElementChild, '<p class="loading">Loading team reports.</p>'); reportsMod().then(requestPaint, toastErr); return; }
  setHtml(app.firstElementChild, reports.html());
}

function mapShell() {
  app.dataset.view = 'map';
  app.innerHTML = `
    <div class="map">
      <div data-r="tbar"></div>
      ${v.readOnly ? `<p class="notice">${v.readOnly}</p>` : ''}
      <div data-r="adobar"></div>
      <div class="body" data-mode="${ui.mode}">
        <section class="outline" aria-label="Outline">
          <textarea class="ta mono" spellcheck="false" wrap="off" aria-label="Outline" data-outline${locked() ? ' readonly' : ''}></textarea>
          <div data-r="warns"></div>
          ${OUTLINE_HELP}
        </section>
        <section class="tlwrap" aria-label="Timeline">
          <div data-r="rbar"></div>
          <div class="tl" tabindex="0" data-tl aria-label="Timeline. Arrow keys move the selected item, Shift and arrows change its end, N adds an item."></div>
          <div data-r="tray"></div>
          <div data-r="details"></div>
        </section>
        <aside class="side" data-r="panel"></aside>
      </div>
    </div>`;
  const ta = app.querySelector('[data-outline]');
  ta.value = ui.outline;
  ui.shellLocked = locked();
}

function paintMap() {
  if (app.dataset.view !== 'map' || !app.querySelector('.map') || ui.shellLocked !== locked()) mapShell();
  const doc = ui.dragDoc || v.doc;
  const sched = schedule(doc);
  const range = viewRange(doc, sched);
  const L = layout(doc, { sched, range, gutter: window.innerWidth < 600 ? 120 : 200, goalRow: true });
  ui.L = L; ui.range = range;
  if (ui.selected && !doc.items.some(i => i.id === ui.selected)) ui.selected = null;

  const tbar = app.querySelector('[data-r="tbar"]');
  const title = tbar.querySelector('[data-title]');
  if (!(title && document.activeElement === title)) setHtml(tbar, toolbarHtml(v, ui));
  else { const s = tbar.querySelector('.save'); if (s) { s.dataset.save = v.save; s.textContent = { saved: 'Saved', saving: 'Saving', unsaved: 'Not saved yet' }[v.save]; } }
  app.querySelector('.body').dataset.mode = ui.mode;
  const rbar = app.querySelector('[data-r="rbar"]');
  if (!rbar.contains(document.activeElement)) setHtml(rbar, rangeHtml(v, range, locked()));
  setHtml(app.querySelector('[data-r="adobar"]'), adoBarHtml(doc, { ready: adoReady(), message: ado ? ado.state.message : '', refreshing: ui.adoRefreshing, readOnly: !!v.readOnly }));
  const tl = app.querySelector('[data-tl]');
  const scroll = tl.scrollLeft;
  tl.innerHTML = svg(L, { theme: isDark() ? 'dark' : 'light', selected: ui.selected, today: today(), interactive: true });
  tl.scrollLeft = scroll;
  setHtml(app.querySelector('[data-r="tray"]'), trayHtml(doc, sched));
  setHtml(app.querySelector('[data-r="details"]'), detailsHtml(doc, range, ui.detailsOpen));
  const ta = app.querySelector('[data-outline]');
  if (document.activeElement !== ta && ta.value !== ui.outline) ta.value = ui.outline;
  setHtml(app.querySelector('[data-r="warns"]'), warningsHtml(ui.warnings));
  const panel = app.querySelector('[data-r="panel"]');
  if (!panel.contains(document.activeElement) || ui.selected !== panel.dataset.for) {
    panel.dataset.for = ui.selected || '';
    setHtml(panel, ui.selected ? panelHtml(doc, ui.selected, sched, locked()) : '');
  }
  app.querySelector('.body').classList.toggle('has-panel', !!ui.selected);
}

/** The outline text follows the roadmap unless you are typing in it. */
function syncOutline(force = false) {
  const ta = app.querySelector('[data-outline]');
  if (!force && ta && document.activeElement === ta) return;
  if (!v.doc) return;
  ui.outline = serialize(v.doc);
  ui.warnings = parse(ui.outline, { today: today(), defaults: v.doc.meta }).warnings;
}

/** Change the roadmap from the timeline, panel or a dialog, and refresh the outline. */
function edit(fn) {
  if (!store.edit(fn)) return false;
  syncOutline(true);
  requestPaint();
  return true;
}

/* ---------- navigation ---------- */

function go(id) {
  if (ws.embedded) ws.open({ app: APP, path: id || '' }).catch(() => {});
  else history.pushState(null, '', id ? `#/${id}` : '#/');
  route(id || '');
}

async function route(path) {
  path = String(path || '').replace(/^\/+/, '');
  if (!v.loaded) { ui.pendingRoute = path; return; }
  ui.reports = path === 'reports';
  if (!path || ui.reports) {
    if (unsubMap) { unsubMap(); unsubMap = null; }
    await store.flush();
    store.close(); ui.selected = null; ui.opened = null; requestPaint();
    return;
  }
  if (path === ui.opened && v.mapId === path) return;
  if (unsubMap) { unsubMap(); unsubMap = null; }
  // A roadmap just created is already open in the store.
  const ok = v.mapId === path && v.doc ? true : await store.open(path).catch(e => { toastErr(e); return false; });
  if (!ok) { toast("That roadmap isn't here. It may have been removed."); if (!ws.embedded) history.replaceState(null, '', '#/'); store.close(); requestPaint(); return; }
  ui.selected = null;
  ui.opened = path;
  syncOutline(true);
  unsubMap = ws.data.subscribe(`maps/${path}`, async () => { await store.reload(`maps/${path}`); syncOutline(); requestPaint(); });
  mapShell();
  paint();
  autoRefresh();
}

/* ---------- dialogs ---------- */

function showDialog(html, wire) {
  dlg.innerHTML = html;
  dlg.returnValue = '';
  if (wire) wire(dlg.querySelector('form'));
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? dlg.querySelector('form') : null), { once: true });
    dlg.showModal();
    const f = dlg.querySelector('[autofocus]'); if (f) { f.focus(); if (f.select) f.select(); }
  });
}

/** Assign a pending idea: pick a roadmap, a lane and what it sits under. */
async function assignIdea(id) {
  const idea = pending.v.items.find(x => x.id === id);
  if (!idea || !v.list.length) return;
  let target = null;
  const docOf = async (mapId) => {
    if (v.mapId === mapId && v.doc) return v.doc;
    const e = await ws.data.get(`maps/${mapId}`).catch(() => null);
    return fromEnvelope(e || { items: [] });
  };
  const f = await showDialog(assignDialog(idea, v.list, store.lastOpen()), form => {
    const map = form.querySelector('[data-amap]'), lane = form.querySelector('[data-alane]'), under = form.querySelector('[data-aparent]');
    const fillUnder = () => { if (target) under.innerHTML = underOptions(target, lane.value || null); };
    const fillLanes = async () => { target = await docOf(map.value); lane.innerHTML = laneOptions(target); if (target.lanes.length) lane.value = [...target.lanes].sort((a, b) => a.order - b.order)[0].id; fillUnder(); };
    map.addEventListener('change', fillLanes);
    lane.addEventListener('change', fillUnder);
    fillLanes();
  });
  if (!f) return;
  try {
    const el = f.elements;
    await pending.assign(id, el.map.value, { lane: el.lane.value || null, parent: el.parent.value || null });
    toast(`Added to ${(v.list.find(r => r.id === el.map.value) || {}).title || 'the roadmap'}, unscheduled`, 'success');
  } catch (e) { toastErr(e); }
}

async function newRoadmap(doc) {
  try {
    const id = await store.create(doc || blankDoc());
    go(id);
  } catch (e) { toastErr(e); }
}

function docFromText(text) {
  const parsed = parse(text, { today: today() });
  const r = reconcile(blankDoc(), parsed);
  if (!parsed.meta.title) r.doc.meta.title = 'Imported roadmap';
  return r.doc;
}

async function importMarkdown() {
  const f = await showDialog(importDialog(), form => {
    form.querySelector('[data-file]').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 2e6) { toast('That file is over 2 MB.', 'error'); return; }
      form.querySelector('textarea').value = await file.text();
    });
  });
  if (!f) return;
  const text = f.querySelector('textarea').value;
  if (!text.trim()) return;
  newRoadmap(docFromText(text));
}

async function settings() {
  const f = await showDialog(settingsDialog(v.doc));
  if (!f) return;
  const origin = f.origin.value, anchor = f.anchor.value, weeks = Number(f.weeks.value);
  edit(d => {
    if (isDate(origin)) d.meta.origin = origin;
    d.meta.sprint = isDate(anchor) ? { anchor, weeks } : (weeks !== 2 ? { anchor: d.meta.origin, weeks } : null);
  });
}

async function exportFlow() {
  const f = await showDialog(exportDialog(v.doc, { dark: false }), form => {
    form.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const kind = b.dataset.x;
      const doc = v.doc;
      try {
        if (kind === 'png' || kind === 'svg') {
          const text = exportSvg(doc, { range: ui.range, theme: form.theme.value, title: form.title.checked, todayLine: form.today.checked, details: form.details.checked, showIds: !!(form.ids && form.ids.checked) });
          if (kind === 'svg') await saveFile(fileName(doc.meta.title, 'svg'), text, 'image/svg+xml');
          else await saveFile(fileName(doc.meta.title, 'png'), await toPng(text, 2), 'image/png');
          return;
        }
        const md = markdown(doc, { table: form.table.checked });
        if (kind === 'md') await saveFile(fileName(doc.meta.title, 'md'), md, 'text/markdown');
        if (kind === 'copy') { await navigator.clipboard.writeText(md); toast('Copied as Markdown.', 'success'); }
        if (kind === 'folder') { const p = await store.saveMarkdown(v.mapId, md); toast(`Saved runway/${p} in your Workshop folder.`, 'success'); }
      } catch (err) { toastErr(err); }
    });
  });
  return f;
}

async function addLane() {
  if (locked()) return;
  const f = await showDialog(promptDialog('New lane', 'Name', '', 'Add'));
  if (!f) return;
  const title = f.v.value.trim().slice(0, 80);
  if (!title) return;
  edit(d => d.lanes.push({ id: newId('l'), kind: 'lane', title, order: Math.max(-1, ...d.lanes.map(l => l.order)) + 1 }));
}

function newItem(lane, start) {
  if (!v.doc || locked()) return;
  const doc = v.doc;
  const sel = doc.items.find(i => i.id === ui.selected);
  const laneId = lane !== undefined ? lane : (sel ? sel.lane : ([...doc.lanes].sort((a, b) => a.order - b.order)[0] || {}).id || null);
  const sprint = sprintOf(doc.meta);
  const s = start || periodStart(doc.meta.scale, today(), sprint);
  const id = newId('i');
  edit(d => d.items.push(cleanItem({ id, kind: 'item', lane: laneId, order: nextOrder(d, laneId), title: 'New item', start: s, end: periodEnd(d.meta.scale, periodStart(d.meta.scale, s, sprint), sprint) })));
  select(id);
  requestAnimationFrame(() => { const t = app.querySelector('[data-panel] [data-f="title"]'); if (t) { t.focus(); t.select(); } });
}

async function deleteItem(id) {
  const it = v.doc.items.find(i => i.id === id);
  if (!it) return;
  const f = await showDialog(confirmDialog('Delete this item?', `"${it.title}" is removed from this roadmap.`, 'Delete'));
  if (!f) return;
  ui.selected = null;
  edit(d => removeItem(d, id));
}

function select(id) {
  ui.selected = id;
  requestPaint();
}

async function editGoal(start) {
  if (!v.doc || v.readOnly) return;
  const doc = v.doc;
  const p = { start, end: periodEnd(doc.meta.scale, start, sprintOf(doc.meta)) };
  const f = await showDialog(goalDialog(periodName(doc, p), goalFor(doc, start)));
  if (dlg.returnValue === 'clear') edit(d => setGoal(d, start, ''));
  else if (f) edit(d => setGoal(d, start, f.v.value));
}

app.addEventListener('click', e => {
  if (app.dataset.view !== 'map') return;
  const g = e.target.closest('[data-goal]');
  if (g) { e.preventDefault(); editGoal(g.dataset.goal); return; }
  const pick = e.target.closest('[data-pick]');
  if (pick) { select(pick.dataset.pick); return; }
});
app.addEventListener('toggle', e => {
  if (!e.target.matches || !e.target.matches('[data-details]')) return;
  ui.detailsOpen = e.target.open;
  try { localStorage.setItem('runway.details', e.target.open ? 'open' : 'closed'); } catch (err) { /* private mode */ }
}, true);

/* ---------- list page events ---------- */

app.addEventListener('click', async e => {
  const t = e.target.closest('button, a');
  if (!t || !app.contains(t)) return;
  if (app.dataset.view === 'reports') { if (reports) reports.click(t, e); return; }
  if (app.dataset.view === 'list') {
    if ('reports' in t.dataset) { e.preventDefault(); go('reports'); return; }
    if (t.dataset.open) { e.preventDefault(); go(t.dataset.open); }
    else if ('new' in t.dataset) newRoadmap();
    else if ('example' in t.dataset) newRoadmap(docFromText(exampleOutline()));
    else if ('import' in t.dataset) importMarkdown();
    else if ('fromado' in t.dataset) fromAdo();
    else if (t.dataset.dup) {
      const src = await ws.data.get(`maps/${t.dataset.dup}`).catch(() => null);
      if (!src) return toast("Couldn't read that roadmap.", 'error');
      const { fromEnvelope } = await import('./model.js');
      const doc = fromEnvelope(src);
      doc.meta.title = `${doc.meta.title} (copy)`.slice(0, 120);
      newRoadmap(doc);
    } else if (t.dataset.del) {
      const row = v.list.find(r => r.id === t.dataset.del);
      const f = await showDialog(confirmDialog('Remove this roadmap?', `"${row ? row.title : ''}" leaves the list. Its file stays in your Workshop folder (runway/maps/${t.dataset.del}.json).`));
      if (f) store.remove(t.dataset.del).catch(toastErr);
    } else if (t.dataset.passign) assignIdea(t.dataset.passign);
    else if (t.dataset.premove) {
      const idea = pending.v.items.find(x => x.id === t.dataset.premove);
      const f = await showDialog(confirmDialog('Remove this idea?', `"${idea ? idea.title : ''}" leaves Pending.`));
      if (f) pending.remove(t.dataset.premove).catch(toastErr);
    } else if ('pair' in t.dataset) askPair();
    else if ('unpair' in t.dataset) forgetPairing();
    return;
  }
  if (app.dataset.view !== 'map') return;
  if ('home' in t.dataset) { e.preventDefault(); go(''); }
  else if (t.dataset.mode) { ui.mode = t.dataset.mode; try { localStorage.setItem('runway.mode', ui.mode); } catch (err) { /* private mode */ } requestPaint(); }
  else if ('settings' in t.dataset) settings();
  else if ('export' in t.dataset) exportFlow();
  else if ('fit' in t.dataset) edit(d => { d.meta.range = null; });
  else if ('addlane' in t.dataset) addLane();
  else if ('additem' in t.dataset) newItem();
  else if (t.dataset.tray) select(t.dataset.tray);
  else if ('close' in t.dataset) select(null);
  else if ('delete' in t.dataset) deleteItem(ui.selected);
  else if ('adorefresh' in t.dataset) adoRefresh(true);
  else if ('addado' in t.dataset || 'adoedit' in t.dataset) adoSource();
  else if ('adostop' in t.dataset) adoStop();
  else if ('adodiff' in t.dataset) { const it = v.doc.items.find(i => i.ado && i.ado.remote); if (it) select(it.id); }
  else if ('adoUse' in t.dataset || 'adoKeep' in t.dataset || 'adoUnlink' in t.dataset) adoItem(t.dataset);
  else if ('unschedule' in t.dataset) edit(d => { const it = d.items.find(i => i.id === ui.selected); if (it) { it.start = null; it.end = null; it.size = null; } });
});

/* ---------- Azure DevOps actions ---------- */

async function sourceForm(base, opts) {
  const f = await showDialog(adoDialog({ ...base, ...opts }));
  if (!f) return null;
  const m = await adoMod();
  const src = m.cleanSource({
    mode: f.mode ? f.mode.value : (base.mode || 'linked'),
    areas: f.areas.value,
    types: [...f.querySelectorAll('[name="type"]:checked')].map(x => x.value),
    lanes: f.lanes.value,
    connection: f.connection.value,
    includeClosed: f.closed.checked
  });
  if (!src) { toast('Add at least one area path.', 'warn'); return null; }
  return { src, title: f.title ? f.title.value.trim().slice(0, 120) : '' };
}

/** A new roadmap from ADO: live or linked. */
async function fromAdo() {
  if (!adoReady()) return;
  const d = await ado.defaults();
  const r = await sourceForm({ areas: d.areas, connection: d.connection }, { title: 'Team roadmap' });
  if (!r) return;
  try {
    toast('Reading Epics and Features from ADO.');
    const doc = blankDoc(r.title || 'Team roadmap');
    const out = await ado.refresh(doc, r.src);
    if (!out.doc.items.length) toast('No Epics or Features under those area paths. The roadmap is empty for now.', 'warn');
    ui.adoRefreshed = null;
    const id = await store.create(out.doc);
    ui.adoRefreshed = id;
    go(id);
  } catch (e) { toastErr(e); }
}

/** Add ADO to this roadmap (linked), or change what a roadmap that follows ADO reads. */
async function adoSource() {
  if (!adoReady() || v.readOnly) return;
  const cur = v.doc.meta.ado;
  const d = cur ? { ...cur } : await ado.defaults();
  const r = await sourceForm(d, { chooseMode: false, heading: cur ? 'Change what comes from ADO' : 'Add items from Azure DevOps', mode: cur ? cur.mode : 'linked' });
  if (!r) return;
  edit(doc => { doc.meta.ado = { ...(doc.meta.ado || {}), ...r.src }; });
  adoRefresh(true);
}

/** Refresh from ADO. Applied to the roadmap as it is when the answer comes, so edits made meanwhile are kept. */
async function adoRefresh(manual = false) {
  if (!v.doc || !v.doc.meta.ado || !adoReady() || ui.adoRefreshing || v.readOnly) return;
  const id = v.mapId;
  ui.adoRefreshing = true; ui.adoRefreshed = id; requestPaint();
  try {
    const m = await adoMod();
    const { src, result, data } = await ado.pull(v.doc.meta.ado);
    if (v.mapId !== id || !v.doc) return;
    let counts = null;
    edit(d => {
      const r = src.mode === 'live' ? { doc: m.applyLive(d, data, src, result) } : m.mergeLinked(d, data, src, result);
      d.meta = r.doc.meta; d.lanes = r.doc.lanes; d.items = r.doc.items;
      counts = r;
    });
    if (manual || (counts && (counts.added || counts.differs))) {
      const bits = counts && src.mode !== 'live' ? [counts.added && `${counts.added} added`, counts.updated && `${counts.updated} updated`, counts.differs && `${counts.differs} differ from ADO`, counts.missing && `${counts.missing} not found`].filter(Boolean) : [];
      toast(bits.length ? `From ADO: ${bits.join(', ')}.` : 'Up to date with ADO.', 'success');
    }
  } catch (e) { toastErr(e); }
  finally { ui.adoRefreshing = false; requestPaint(); }
}

/** Refresh once when a roadmap that follows ADO is opened (or when the connector becomes ready). */
function autoRefresh() {
  if (v.doc && v.doc.meta.ado && adoReady() && ui.adoRefreshed !== v.mapId) adoRefresh(false);
}

async function adoStop() {
  const isLive = live();
  const f = await showDialog(confirmDialog(isLive ? 'Make this roadmap editable?' : 'Stop following ADO?',
    isLive ? 'It stops refreshing from ADO and becomes an ordinary roadmap you can edit. Items keep their ADO links.' : 'Refresh stops. Items keep their ADO links and stay as they are.',
    isLive ? 'Make editable' : 'Stop following'));
  if (!f) return;
  const m = await adoMod();
  edit(d => { m.stopFollowing(d); });
}

async function adoItem(ds) {
  if (!ui.selected || locked()) return;
  const m = await adoMod();
  const id = ui.selected;
  edit(d => { if ('adoUse' in ds) m.useRemote(d, id); else if ('adoKeep' in ds) m.keepMine(d, id); else m.unlink(d, id); });
}

function askPair() {
  showDialog(`<form method="dialog" class="sheet small"><h3>Use Workshop on this computer</h3>
    <p>${PAIR_HELP} Roadmaps saved in this browser stay here; export them as Markdown first to bring them along.</p>
    <label class="pf"><span>Port</span><input type="number" name="port" min="1024" max="65535" value="4380" required></label>
    <footer><span class="grow"></span><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">Connect</button></footer></form>`)
    .then(f => {
      if (!f) return;
      const r = pairWith(Number(f.port.value), { onError: m => toast(m, 'error') });
      toast(r === 'blocked' ? 'Your browser blocked the window. Allow pop-ups for this site and try again.' : 'In the window that opened, allow this site. Runway reloads once it is connected.');
    });
}

/* ---------- map page: inputs ---------- */

let outlineTimer = null;
app.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('[data-outline]')) {
    ui.outline = t.value;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(applyOutline, 300);
    return;
  }
  if (t.matches('[data-title]')) { const val = t.value.trim().slice(0, 120); if (val) edit(d => { d.meta.title = val; }); return; }
  const p = t.closest('[data-panel]');
  if (p && locked()) return;
  if (p && (t.dataset.f === 'title' || t.dataset.f === 'notes')) {
    const id = p.dataset.panel, val = t.value;
    edit(d => { const it = d.items.find(i => i.id === id); if (it) it[t.dataset.f] = t.dataset.f === 'title' ? (val.trim() || 'Untitled').slice(0, 200) : val.slice(0, 4000); });
  }
});

function applyOutline() {
  if (!v.doc || locked()) return;
  const parsed = parse(ui.outline, { today: today(), defaults: v.doc.meta });
  const r = reconcile(v.doc, parsed);
  ui.warnings = r.warnings;
  store.edit(d => { d.meta = r.doc.meta; d.lanes = r.doc.lanes; d.items = r.doc.items; });
  requestPaint();
}

app.addEventListener('change', e => {
  const t = e.target;
  if (app.dataset.view === 'reports') { if (reports) reports.change(t); return; }
  if (t.matches('[data-scale]')) return edit(d => { d.meta.scale = t.value; d.meta.range = null; });
  if (t.matches('[data-from], [data-to]')) {
    const from = app.querySelector('[data-from]').value, to = app.querySelector('[data-to]').value;
    if (isDate(from) && isDate(to) && from <= to && toDay(to) - toDay(from) <= 3660) edit(d => { d.meta.range = { from, to }; });
    else toast('Pick a start date before the end date, within 10 years.', 'warn');
    return;
  }
  const p = t.closest('[data-panel]');
  if (!p || locked()) return;
  const id = p.dataset.panel;
  const doc = v.doc;
  const sched = schedule(doc);
  const s = sched.get(id);
  const sprint = sprintOf(doc.meta);
  edit(d => {
    const it = d.items.find(i => i.id === id);
    if (!it) return;
    if (t.dataset.dep) {
      it.dependsOn = t.checked ? [...new Set([...it.dependsOn, t.dataset.dep])] : it.dependsOn.filter(x => x !== t.dataset.dep);
      return;
    }
    switch (t.dataset.f) {
      case 'lane': setLane(d, it.id, t.value || null); break;
      case 'parent': setParent(d, it.id, t.value || null); break;
      case 'status': it.status = t.value; break;
      case 'color': if (t.checked) it.color = t.value; break;
      case 'milestone':
        it.milestone = t.checked;
        if (t.checked) { it.start = it.start || (s && s.start) || today(); it.end = it.start; it.size = null; }
        else if (it.start) it.end = periodEnd(d.meta.scale, periodStart(d.meta.scale, it.start, sprint), sprint) < it.start ? it.start : sizeEnd(it.start, { n: 1, unit: d.meta.scale }, sprint);
        break;
      case 'start': {
        if (!isDate(t.value)) break;
        if (it.milestone) { it.start = t.value; it.end = t.value; break; }
        const len = s ? toDay(s.end) - toDay(s.start) : 0;
        const end = it.end || (s && s.end);
        it.start = t.value; it.size = null;
        it.end = end && end >= t.value ? end : addDays(t.value, len);
        break;
      }
      case 'end': {
        if (!isDate(t.value)) break;
        it.start = it.start || (s && s.start) || t.value; it.size = null;
        it.end = t.value < it.start ? it.start : t.value;
        break;
      }
    }
  });
});

/* ---------- the timeline: pointer, keyboard, drop ---------- */

const pt = (e) => { const r = app.querySelector('[data-tl] svg').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

app.addEventListener('pointerdown', e => {
  const tl = e.target.closest('[data-tl]');
  if (!tl || e.button !== 0 || !ui.L) return;
  const bar = e.target.closest('g.bar');
  const lane = e.target.closest('g.lane');
  const p = pt(e);
  // Leave the outline or a panel field, so the outline shows what the timeline does.
  if (document.activeElement !== tl) tl.focus({ preventScroll: true });
  if (bar) {
    const id = bar.dataset.id;
    if (ui.selected !== id) ui.selected = id;
    if (locked()) return requestPaint();
    const grip = e.target.closest('.grip');
    ui.drag = { id, edge: grip ? grip.dataset.edge : null, x0: p.x, y0: p.y, moved: false, base: structuredClone(v.doc), L: ui.L, pointer: e.pointerId };
    tl.setPointerCapture(e.pointerId);
    requestPaint();
    e.preventDefault();
    return;
  }
  if (lane) { ui.drag = { lane: lane.dataset.lane, x0: p.x, y0: p.y, moved: false, pointer: e.pointerId }; return; }
  if (ui.selected) { ui.selected = null; requestPaint(); }
});

app.addEventListener('pointermove', e => {
  const d = ui.drag;
  if (!d || d.pointer !== e.pointerId || !d.id) return;
  const p = pt(e);
  const dx = p.x - d.x0;
  if (!d.moved && Math.abs(dx) < 4 && Math.abs(p.y - d.y0) < 6) return;
  d.moved = true;
  const snap = SNAP[d.base.meta.scale] || 1;
  const days = Math.round(dx / d.L.px / snap) * snap;
  const tmp = structuredClone(d.base);
  const sched = schedule(tmp);
  const s = sched.get(d.id);
  if (!s) return;
  if (d.edge === 'start') resizeItem(tmp, d.id, addDays(s.start, days), 'start', sched);
  else if (d.edge === 'end') resizeItem(tmp, d.id, addDays(s.end, days), 'end', sched);
  else {
    moveItem(tmp, d.id, addDays(s.start, days), sched);
    const lane = laneAt(d.L, p.y);
    const it = tmp.items.find(i => i.id === d.id);
    if (lane && (lane.id || null) !== (it.lane || null) && !lane.collapsed) setLane(tmp, it.id, lane.id);
  }
  ui.dragDoc = tmp;
  paintMap();
});

function endDrag(e) {
  const d = ui.drag;
  if (!d || d.pointer !== e.pointerId) return;
  ui.drag = null;
  if (d.lane && !d.moved) { edit(doc => { const h = new Set(doc.meta.hidden); if (h.has(d.lane)) h.delete(d.lane); else h.add(d.lane); doc.meta.hidden = [...h]; }); return; }
  if (d.id && d.moved && ui.dragDoc) {
    const next = ui.dragDoc;
    ui.dragDoc = null;
    edit(doc => { const it = next.items.find(i => i.id === d.id); const i = doc.items.findIndex(x => x.id === d.id); if (it && i >= 0) doc.items[i] = it; });
    return;
  }
  ui.dragDoc = null;
}
app.addEventListener('pointerup', endDrag);
app.addEventListener('pointercancel', e => { if (ui.drag && ui.drag.pointer === e.pointerId) { ui.drag = null; ui.dragDoc = null; requestPaint(); } });

app.addEventListener('dblclick', e => {
  if (!e.target.closest('[data-tl]') || e.target.closest('g.bar') || !ui.L || locked()) return;
  const p = pt(e);
  const lane = laneAt(ui.L, p.y);
  if (!lane || p.x < ui.L.gutter) return;
  const sprint = sprintOf(v.doc.meta);
  newItem(lane.id, periodStart(v.doc.meta.scale, dateAt(ui.L, p.x), sprint));
});

app.addEventListener('dragstart', e => {
  const c = e.target.closest('[data-tray]');
  if (!c) return;
  e.dataTransfer.setData('text/x-runway-item', c.dataset.tray);
  e.dataTransfer.effectAllowed = 'move';
});
app.addEventListener('dragover', e => { if (e.target.closest('[data-tl]') && [...e.dataTransfer.types].includes('text/x-runway-item')) e.preventDefault(); });
app.addEventListener('drop', e => {
  if (!e.target.closest('[data-tl]') || !ui.L || locked()) return;
  const id = e.dataTransfer.getData('text/x-runway-item');
  if (!id) return;
  e.preventDefault();
  const p = pt(e);
  const lane = laneAt(ui.L, p.y);
  const sprint = sprintOf(v.doc.meta);
  const start = periodStart(v.doc.meta.scale, dateAt(ui.L, Math.max(ui.L.gutter, p.x)), sprint);
  edit(d => {
    const it = d.items.find(i => i.id === id);
    if (!it) return;
    it.start = start;
    it.end = it.milestone ? start : sizeEnd(start, it.size || { n: 1, unit: d.meta.scale }, sprint);
    it.size = null;
    if (lane && !lane.collapsed) setLane(d, it.id, lane.id);
  });
  select(id);
});

/** Bars in reading order: lane by lane, top to bottom, left to right. */
const barOrder = () => [...(ui.L ? ui.L.bars : [])].sort((a, b) => a.y - b.y || a.x - b.x).map(b => b.id);

document.addEventListener('keydown', e => {
  if (dlg.open || e.defaultPrevented) return;
  if (app.dataset.view !== 'map' || !v.doc) return;
  if (typing(document.activeElement)) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (e.ctrlKey || e.metaKey) return;
  const key = e.key;
  if ((key === 'n' || key === 'N') && !e.altKey && !locked()) { e.preventDefault(); newItem(); return; }
  if (!ui.selected) {
    if ((key === 'ArrowDown' || key === 'ArrowRight') && document.activeElement && document.activeElement.matches('[data-tl]')) { const o = barOrder(); if (o.length) { e.preventDefault(); select(o[0]); } }
    return;
  }
  const id = ui.selected;
  if (key === 'Escape') { e.preventDefault(); select(null); return; }
  if (key === 'Enter') { e.preventDefault(); const t = app.querySelector('[data-panel] [data-f="title"]'); if (t) t.focus(); return; }
  if ((key === 'Delete' || key === 'Backspace') && !locked()) { e.preventDefault(); deleteItem(id); return; }
  if ((key === 'ArrowUp' || key === 'ArrowDown') && !e.altKey) {
    const o = barOrder(); const i = o.indexOf(id);
    if (o.length) { e.preventDefault(); select(o[Math.max(0, Math.min(o.length - 1, (i < 0 ? 0 : i) + (key === 'ArrowDown' ? 1 : -1)))]); }
    return;
  }
  if (locked()) return;
  const snap = SNAP[v.doc.meta.scale] || 1;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    e.preventDefault();
    const n = key === 'ArrowRight' ? snap : -snap;
    edit(d => {
      const sched = schedule(d); const s = sched.get(id);
      if (!s) return;
      if (e.shiftKey) resizeItem(d, id, addDays(s.end, n), 'end', sched);
      else moveItem(d, id, addDays(s.start, n), sched);
    });
    return;
  }
  if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    e.preventDefault();
    edit(d => {
      const lanes = [null, ...[...d.lanes].sort((a, b) => a.order - b.order).map(l => l.id)];
      const it = d.items.find(i => i.id === id);
      const k = lanes.indexOf(it.lane || null) + (key === 'ArrowDown' ? 1 : -1);
      if (k < 0 || k >= lanes.length) return;
      setLane(d, it.id, lanes[k]);
    });
  }
});

/* ---------- routes, commands, events ---------- */

if (ws.embedded) ws.on('route', p => route((p && p.path) || ''));
else {
  window.addEventListener('hashchange', () => route(location.hash.replace(/^#\/?/, '')));
  window.addEventListener('popstate', () => route(location.hash.replace(/^#\/?/, '')));
}
ws.commands.register({ id: 'new-roadmap', title: 'New roadmap' });
ws.commands.register({ id: 'new-item', title: 'New roadmap item' });
ws.commands.register({ id: 'export', title: 'Export roadmap' });
ws.on('command', p => {
  if (p.id === 'new-roadmap') newRoadmap();
  if (p.id === 'new-item') newItem();
  if (p.id === 'export' && v.doc) exportFlow();
  if (p.id === 'reload-new' && swReload) swReload();
});
ws.on('theme', () => requestPaint());
if (window.WorkshopTheme && WorkshopTheme.onChange) WorkshopTheme.onChange(() => requestPaint());
ws.on('online', () => { if (v.waiting) { v.waiting = false; store.load().then(() => route(ui.pendingRoute || v.mapId || '')); } pending.load().then(() => pending.pickup()).catch(() => {}); });
ws.data.subscribe('index', () => store.reload('index'));
ws.data.subscribe('pending', () => pending.load().catch(() => {}));
for (const app of ['home', 'agents']) ws.data.subscribe('handoffs', () => pending.pickup(), { app });
document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); });
window.addEventListener('beforeunload', e => { if (store.hasPending()) { store.flush(); e.preventDefault(); } });

// Tests drive the page through this.
window.__runway = { store, ui, ws, paint, route, edit, applyOutline, flush: () => store.flush(), get ado() { return ado; }, get reports() { return reports; } };

paint();
await store.load();
pending.load().then(() => pending.pickup()).catch(() => {});
const first = ui.pendingRoute ?? (ws.embedded ? null : location.hash.replace(/^#\/?/, ''));
ui.pendingRoute = null;
if (first) await route(first);
requestPaint();
