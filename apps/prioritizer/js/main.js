/* Prioritizer: Startup. Connects to the Workshop shell through the SDK, installs the test hook, and
   does the first render. Imported last by index.html as the app's one module entry; it pulls in every
   other module. */
import { KEY } from './constants.js';
import { $ } from './util.js';
import { urgency, score, tier, isStale, eKey, vKey } from './model.js';
import { commit, state, setState, setSnap, save, sanitize, migrateTask, stripStamp, takeSnap, triageQueue, ui } from './state.js';
import { parseQuick } from './quick-add.js';
import { render, capacityCut } from './render.js';
import { buildWorkbook, exportXlsx, parseWorkbook, doImport } from './excel.js';
import { buildReportsWorkbook, rp, rpCompute, rpInit, rpRefresh } from './reports.js';
import { adoApply, adoDetect, adoInit, adoPick, adoReview, adoSync, adoSchedule, setAdo } from './ado.js';
import { eng, engCheck, engSchedule } from './eng.js';
import { applySide } from './events.js';
import { restoreSync } from './folder-sync.js';
import { openCmd } from './command-bar.js';
import { openDrawer } from './drawer.js';
import { toast } from './overlays.js';
import { findTask } from './state.js';
import { ready, embedded } from './ws.js';

// Inside the shell the shell owns the theme picker, the service worker, Alt+<n> and Ctrl+K; on its own,
// Prioritizer shows the picker and registers the worker itself.
if (embedded) { const tb = $('#themeBtn'); if (tb) tb.hidden = true; }
else if (window.WorkshopSw) WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000));

// From the shell, through the SDK: deep links (#/prioritizer/task/<id>), palette commands, ADO status.
ready.then(ws => {
  if (!ws) return;
  ws.on('route', ({path}) => {
    const m = /^task\/(.+)$/.exec(path || '');
    if (m && findTask(m[1])) openDrawer(m[1]);
  });
  ws.on('command', ({id}) => {
    if (id === 'add-task') openCmd();
    if (id === 'sync-ado') adoSync(true);
  });
  // The ADO connector was turned on or off, or became ready: sync through the right source.
  ws.connectors.onStatus('ado', () => adoDetect().then(() => adoSync(false)));
});

/* test hook: lets automated checks call the model without the UI */
window.__prioritizer = {
  get state(){ return state; }, set state(s){ setState(s); },
  adoApply, adoPick, adoReview, adoSync, ui, sanitize, migrateTask, urgency, score, tier, isStale,
  eKey, vKey, parseQuick, capacityCut, buildWorkbook, buildReportsWorkbook, rpCompute, rpRefresh,
  get rp(){ return rp; }, parseWorkbook, doImport, render, commit, triageQueue, takeSnap,
  setSnap: s => { setSnap(s); }, engCheck, get eng(){ return eng; }, exportXlsx
};

adoInit(); rpInit();
applySide();
// First load after the v2 upgrade: diff against the stored v1 board so migrated tasks get change stamps.
const bootRaw = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ return null; } })();
if (bootRaw && bootRaw.version !== 2 && Array.isArray(bootRaw.tasks) && Array.isArray(bootRaw.lists)){
  setSnap({tasks: new Map(bootRaw.tasks.map(t => [t.id, stripStamp(t)])), lists: new Map(bootRaw.lists.map(l => [l.id, stripStamp(l)])),
           people: new Set((bootRaw.people || []).map(p => String(p).toLowerCase()))});
  save();
} else setSnap(takeSnap());
render();
restoreSync();
setAdo(); adoSchedule(); adoDetect().then(() => adoSync(false));
engSchedule(); engCheck();
