/* Prioritizer: Startup. Connects to the Workshop shell through the SDK, installs the test hook, and
   does the first render. Imported last by index.html as the app's one module entry; it pulls in every
   other module. */
import { $ } from './util.js';
import { urgency, score, tier, isStale, eKey, vKey } from './model.js';
import { commit, state, setState, sanitize, migrateTask, triageQueue, ui } from './state.js';
import { parseQuick } from './quick-add.js';
import { render, capacityCut } from './render.js';
import { buildWorkbook, exportXlsx, parseWorkbook, doImport } from './excel.js';
import { buildReportsWorkbook, rp, rpCompute, rpInit, rpRefresh } from './reports.js';
import { adoApply, adoDetect, adoInit, adoPick, adoReview, adoSync, adoSchedule, setAdo } from './ado.js';
import { eng, engCheck, engSchedule } from './eng.js';
import { applySide } from './events.js';
import { boot, downloadBackup, importFile, store } from './storage.js';
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
const loaded = boot();
ready.then(ws => {
  if (!ws) return;
  ws.on('route', ({path}) => loaded.then(() => {
    const m = /^task\/(.+)$/.exec(path || '');
    if (m && findTask(m[1])) openDrawer(m[1]);
  }));
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
  get rp(){ return rp; }, parseWorkbook, doImport, render, commit, triageQueue,
  engCheck, get eng(){ return eng; }, exportXlsx, downloadBackup, importFile,
  // Resolves after pending saves and updates from other windows have run.
  saved: () => store ? store.idle() : Promise.resolve(), get store(){ return store; }
};

adoInit(); rpInit();
applySide();
// Load the saved board (Workshop's data folder, or this browser in browser mode) before the first render.
await loaded;
render();
setAdo(); adoSchedule(); adoDetect().then(() => adoSync(false));
engSchedule(); engCheck();
