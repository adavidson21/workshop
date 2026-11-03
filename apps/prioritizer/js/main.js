/* Prioritizer: Startup. Connects to the Workshop shell through the SDK, installs the test hook, and
   does the first render. Imported last by index.html as the app's one module entry; it pulls in every
   other module. */
import { $, todayStr } from './util.js';
import { urgency, score, tier, isStale, eKey, vKey } from './model.js';
import { commit, state, setState, sanitize, migrateTask, triageQueue, ui } from './state.js';
import { parseQuick } from './quick-add.js';
import { render, capacityCut, setView } from './render.js';
import { buildWorkbook, exportXlsx, parseWorkbook, doImport } from './excel.js';
import { buildReportsWorkbook, rp, rpCompute, rpInit, rpRefresh } from './reports.js';
import { adoApply, adoDetect, adoInit, adoPick, adoReview, adoSync, adoSchedule, setAdo } from './ado.js';
import { eng, engCheck, engSchedule } from './eng.js';
import { applySide } from './events.js';
import { downloadBackup, importFile, store } from './storage.js';
import { openCmd } from './command-bar.js';
import { drawerInit, openDrawer } from './drawer.js';
import { dayInit, setDate } from './day-view.js';
import { maybeOnboard, openTour, tourInit } from './onboarding.js';
import { dp, recurTick } from './dayplan.js';
import * as focusModel from './focus-model.js';
import { focusLog, fstore, openShutdown } from './focus.js';
import * as dayModel from './dayplan-model.js';
import { offers } from './offers.js';
import { boot, dstore } from './storage.js';
import { showHelp, toast } from './overlays.js';
import { findTask } from './state.js';
import { ready, embedded } from './ws.js';
import { mountBar } from '../shared/standalone-bar.js';
import { mountAppBanner } from './app-banner.js';
import { startNative } from './native.js';
import { startDirectory } from './directory.js';

// Inside the shell the rail names the app (no second logo), and the shell owns the light/dark toggle, the service worker, Alt+<n> and Ctrl+K.
// On its own page, Prioritizer gets the same top bar as the other tools (crumbs and the toggle) and registers the worker itself.
if (embedded) document.body.classList.add('embedded');
else { mountBar('Docket'); mountAppBanner(); startNative(); if (window.WorkshopSw) WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000)); }

// From the shell, through the SDK: deep links (#/prioritizer/task/<id>), palette commands, ADO status.
const loaded = boot();
ready.then(ws => {
  if (!ws) return;
  ws.on('route', ({path}) => loaded.then(() => {
    const m = /^task\/(.+)$/.exec(path || '');
    if (m && findTask(m[1])) openDrawer(m[1]);
    // #/prioritizer/day/<yyyy-mm-dd> or day/today: the Day view (Workshop Home's Today card links here).
    const d = /^day(?:\/(\d{4}-\d{2}-\d{2}|today))?$/.exec(path || '');
    if (d){ setView('day'); setDate(!d[1] || d[1] === 'today' ? todayStr() : d[1]); }
    // #/prioritizer/shutdown: wrap up the day (Workshop Home's Wrap up card links here).
    if (path === 'shutdown') openShutdown();
    // #/prioritizer/<view>: Workshop Home's tiles and the palette open a view directly.
    const V = {today: 'today', triage: 'triage', prioritize: null, list: 'rank', eisenhower: 'eisen', 'value-effort': 've', done: 'archive', people: 'people', reports: 'reports'};
    if (Object.hasOwn(V, path)) setView(V[path] || state.lens);
  }));
  ws.on('command', ({id}) => {
    if (id === 'add-task') openCmd();
    if (id === 'sync-ado') adoSync(true);
    if (id === 'shortcuts') showHelp();
    if (id === 'shutdown-day') loaded.then(openShutdown);
    if (id === 'start-next') loaded.then(startNext);
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
  saved: () => Promise.all([store ? store.idle() : null, dstore ? dstore.idle() : null, fstore ? fstore.idle() : null]), get store(){ return store; },
  get dp(){ return dp; }, recurTick, openTour, get dstore(){ return dstore; }, dayModel, offers,
  get focusLog(){ return focusLog; }, get fstore(){ return fstore; }, focusModel, openShutdown
};

drawerInit(); dayInit(); tourInit();
adoInit(); rpInit();
applySide();
// Load the saved board (Workshop's data folder, or this browser in browser mode) before the first render.
await loaded;
render();
startDirectory();
maybeOnboard();
setAdo(); adoSchedule(); adoDetect().then(() => adoSync(false));
engSchedule(); engCheck();
