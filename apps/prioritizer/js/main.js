/* Prioritizer: Startup. Connects to the Workshop shell through the SDK, installs the test hook, and
   does the first render. Imported last by index.html as the app's one module entry; it pulls in every
   other module. */
import { $, todayStr } from './util.js';
import { urgency, score, tier, isStale, eKey, vKey } from './model.js';
import { commit, state, setState, sanitize, migrateTask, triageQueue, ui } from './state.js';
import { parseQuick } from './quick-add.js';
import { render, capacityCut, row, setView } from './render.js';
import { openDisplay } from './display.js';
import { buildWorkbook, exportXlsx, parseWorkbook, doImport } from './excel.js';
import { adoApply, adoDetect, adoInit, adoPick, adoReview, adoSync, adoSchedule, prRelease, setAdo } from './ado.js';
import { eng, engCheck, engSchedule } from './eng.js';
import { prAiInit, prAiRefresh } from './pr-ai.js';
import * as prAiModel from './pr-ai-model.js';
import { applySide } from './events.js';
import { downloadBackup, importFile, store } from './storage.js';
import { openCmd } from './command-bar.js';
import { drawerInit, openDrawer, syncDrawer } from './drawer.js';
import { pasteInit } from './paste.js';
import { dayInit, setDate } from './day-view.js';
import { maybeOnboard, openTour, tourInit } from './onboarding.js';
import { dp, recurTick } from './dayplan.js';
import * as focusModel from './focus-model.js';
import { focusCommand, focusLog, fstore, openShutdown } from './focus.js';
import { toggleDone } from './actions.js';
import { activeTask, startNext } from './focus.js';
import * as dayModel from './dayplan-model.js';
import { offers, watchSender } from './offers.js';
import { boot, dstore } from './storage.js';
import { showHelp, toast } from './overlays.js';
import { startNotesLink } from './notes-link.js';
import { startSlateLink } from './slate-link.js';
import { startProductsLink } from './products-link.js';
import { findTask } from './state.js';
import { ready, embedded } from './ws.js';
import { mountBar } from '../shared/standalone-bar.js';
import { mountAppBanner } from './app-banner.js';
import { startNative } from './native.js';
import { startDirectory } from './directory.js';
import { focusHoursBoot } from './focus-hours.js';
import { askLeftOff, leftOffBoot, onLeftOffSaved } from './left-off.js';
import { refreshSummary } from './storage.js';

// Inside the shell the rail names the app (no second logo), and the shell owns the light/dark toggle, the service worker, Alt+<n> and Ctrl+K.
// On its own page, Prioritizer gets the same top bar as the other tools (crumbs and the toggle) and registers the worker itself.
if (embedded) document.body.classList.add('embedded');
else { mountBar('Docket'); mountAppBanner(); startNative(); if (window.WorkshopSw) WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000)); }

// From the shell, through the SDK: deep links (#/prioritizer/task/<id>), palette commands, ADO status.
const loaded = boot();
ready.then(ws => {
  if (!ws) return;
  // Notes about each task, for the drawer's Notes line (notes-link.js). Inside Workshop only.
  startNotesLink(ws, embedded, () => loaded.then(syncDrawer));
  // Where ADO tasks stand on Slate's board, for the In Slate chip and the drawer (slate-link.js).
  startSlateLink(ws, embedded, () => loaded.then(() => { render(); syncDrawer(); }));
  // Your products from Workshop Settings, for +product and the Product field (products-link.js).
  startProductsLink(ws, () => loaded.then(() => { render(); syncDrawer(); }));
  ws.on('route', ({path}) => loaded.then(() => {
    const m = /^task\/(.+)$/.exec(path || '');
    if (m && findTask(m[1])) openDrawer(m[1]);
    else if (m) toast("That task isn't in Docket anymore. It may have been deleted.");
    // #/prioritizer/day/<yyyy-mm-dd> or day/today: the Day view (Workshop Home's Today card links here).
    const d = /^day(?:\/(\d{4}-\d{2}-\d{2}|today))?$/.exec(path || '');
    if (d){ setView('day'); setDate(!d[1] || d[1] === 'today' ? todayStr() : d[1]); }
    // #/prioritizer/shutdown: wrap up the day (Workshop Home's Wrap up card links here).
    if (path === 'shutdown') openShutdown();
    // #/prioritizer/<view>: Workshop Home and the palette open a view directly. Triage and Prioritize are Today's
    // Inbox and Ranked columns since Docket 6.0, so their old links focus those.
    const V = {today: 'today', inbox: 'triage', triage: 'triage', ranked: 'prio', prioritize: 'prio', list: 'rank', eisenhower: 'eisen', 'value-effort': 've', done: 'archive', people: 'people'};
    // Team reports moved to Runway (Docket 4.18.0); an old link opens them there.
    if (path === 'reports') ws.open({app: 'runway', path: 'reports'}).catch(() => {});
    if (Object.hasOwn(V, path)) setView(V[path]);
  }));
  ws.on('command', ({id, text}) => {
    // The running task's buttons in Workshop's top bar (focus.js shellStatus).
    if (/^focus-/.test(id)) loaded.then(() => {
      if (id === 'focus-done'){ const t = activeTask(); if (t) toggleDone(t.id); }
      else focusCommand(id, text);
    });
    if (id === 'add-task') openCmd();
    if (id === 'sync-ado') adoSync(true);
    if (id === 'shortcuts') showHelp();
    if (id === 'shutdown-day') loaded.then(openShutdown);
    if (id === 'start-next') loaded.then(startNext);
  });
  // The ADO connector was turned on or off, or became ready: sync through the right source.
  ws.connectors.onStatus('ado', () => adoDetect().then(() => adoSync(false)));
  // Workshop stopped answering, or is back: say so on the ADO button, and sync once it is back.
  ws.on('online', () => adoDetect().then(() => adoSync(false)));
});

/* test hook: lets automated checks call the model without the UI */
window.__prioritizer = {
  get state(){ return state; }, set state(s){ setState(s); },
  adoApply, adoPick, adoReview, adoSync, ui, sanitize, migrateTask, urgency, score, tier, isStale,
  eKey, vKey, parseQuick, capacityCut, buildWorkbook,
  parseWorkbook, doImport, render, commit, triageQueue,
  engCheck, get eng(){ return eng; }, prAiRefresh, prAiModel, prRelease, exportXlsx, downloadBackup, importFile,
  // Resolves after pending saves and updates from other windows have run.
  saved: () => Promise.all([store ? store.idle() : null, dstore ? dstore.idle() : null, fstore ? fstore.idle() : null]), get store(){ return store; },
  get dp(){ return dp; }, recurTick, openTour, get dstore(){ return dstore; }, dayModel, offers, watchSender,
  get focusLog(){ return focusLog; }, get fstore(){ return fstore; }, focusModel, openShutdown, openDrawer, row, openDisplay
};

drawerInit(); dayInit(); tourInit(); pasteInit();
// Focus hours and lunch (Workshop docs/focus.md): hold what can wait, and ask where you left off when a block ends,
// lunch starts or focus starts now.
leftOffBoot({active: activeTask});
onLeftOffSaved((t, text) => focusModel.addCrumb(t, text, new Date().toISOString()));
focusHoursBoot({render: () => loaded.then(render), summary: refreshSummary, transition: (prev, f) => {
  const t = activeTask();
  if (!t || !prev.enabled) return;
  if (f.state === 'lunch' && prev.state !== 'lunch') askLeftOff(t.id, 'Lunch');
  else if (prev.state === 'focus' && f.state !== 'focus') askLeftOff(t.id, 'Focus ended');
  else if (f.state === 'focus' && f.source === 'manual' && prev.state !== 'focus') askLeftOff(t.id, 'Focus started');
}});
adoInit();
applySide();
// Load the saved board (Workshop's data folder, or this browser in browser mode) before the first render.
await loaded;
render();
startDirectory();
maybeOnboard();
setAdo(); adoSchedule(); adoDetect().then(() => adoSync(false));
engSchedule(); engCheck(); prAiInit();
