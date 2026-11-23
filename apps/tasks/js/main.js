/* Tasks: Startup. Connects to the Workshop shell through the SDK, installs the test hook, and
   does the first render. Imported last by index.html as the app's one module entry; it pulls in every
   other module. */
import { watchAdo } from '../../../shared/ado.js';
import { $, todayStr } from './util.js';
import { urgency, score, tier, isStale, eKey, vKey } from './model.js';
import { commit, state, setState, sanitize, migrateTask, triageQueue, ui } from './state.js';
import { parseQuick } from './quick-add.js';
import { render, capacityCut, row, setView } from './render.js';
import { openDisplay } from './display.js';
import { buildWorkbook, exportXlsx, parseWorkbook, doImport } from './excel.js';
import { trackerApply, trackerDetect, trackerInit, trackerPick, trackerReview, trackerSync, trackerSchedule, prRelease, setTracker } from './tracker.js';
import { eng, engCheck, engSchedule } from './eng.js';
import { prAiInit, prAiRefresh } from './pr-ai.js';
import * as prAiModel from './pr-ai-model.js';
import { applySide } from './events.js';
import { downloadBackup, importFile, store } from './storage.js';
import { openCmd } from './command-bar.js';
import { openSortRun } from './sort-run.js';
import { closeDrawer, drawerId, drawerInit, openDrawer, syncDrawer } from './drawer.js';
import { reportRoute } from './route.js';
import { pasteInit } from './paste.js';
import { dayInit, setDate } from './day-view.js';
import { maybeOnboard, openTour, tourInit } from './onboarding.js';
import { dp, recurTick } from './dayplan.js';
import * as focusModel from './focus-model.js';
import { focusCommand, focusLog, focusTransition, fstore, openShutdown } from './focus.js';
import { toggleDone } from './actions.js';
import { activeTask, startNext } from './focus.js';
import * as dayModel from './dayplan-model.js';
import { offers, watchSender } from './offers.js';
import { boot, dstore } from './storage.js';
import { showHelp, toast } from './overlays.js';
import { startNotesLink } from './notes-link.js';
import { startSlateLink } from './builds-link.js';
import { watchLoom } from './tandem-build.js';
import { startAgentQueue } from './agent-queue.js';
import { startProductsLink } from './products-link.js';
import { findTask } from './state.js';
import { ready, embedded, peoplePlaceOn } from './ws.js';
import { mountBar } from '../../../shared/standalone-bar.js';
import { startDirectory } from './directory.js';
import { focusHoursBoot } from './focus-hours.js';
import { refreshSummary } from './storage.js';

// Inside the shell the rail names the app (no second logo), and the shell owns the light/dark toggle, the service worker, Alt+<n> and Ctrl+K.
// On its own page, Tasks gets the same top bar as the other tools (crumbs and the toggle) and registers the worker itself.
if (embedded) document.body.classList.add('embedded');
else { mountBar('Tasks'); if (window.WorkshopSw) WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000)); }

// From the shell, through the SDK: deep links (#/tasks/task/<id>), palette commands, ADO status.
const loaded = boot();
ready.then(ws => {
  if (!ws) return;
  // Management off (docs/apps.md, Areas): the People place leaves the sidebar, and a saved view of it opens Today.
  if (!peoplePlaceOn()) loaded.then(() => { if (state.view === 'people') setView('today'); else render(); });
  // Azure DevOps on or off (shared/ado.js): while off, Tasks names it nowhere and hides ADO items' links and chips.
  watchAdo(ws, () => loaded.then(() => { render(); syncDrawer(); setTracker(); }));
  // Notes about each task, for the drawer's Notes line (notes-link.js). Inside Workshop only.
  startNotesLink(ws, embedded, () => loaded.then(syncDrawer));
  // Where ADO tasks stand on Builds' board, for the In Builds chip and the drawer (builds-link.js).
  startSlateLink(ws, embedded, () => loaded.then(() => { render(); syncDrawer(); }));
  // Build with Tandem on any task needs Builds on this site (tandem-build.js).
  if (embedded) watchLoom(ws, () => loaded.then(syncDrawer));
  startAgentQueue(ws, embedded, () => loaded.then(() => { render(); syncDrawer(); }));
  // Your products from Workshop Settings, for +product and the Product field (products-link.js).
  startProductsLink(ws, () => loaded.then(() => { render(); syncDrawer(); }));
  // #/tasks/<path> (Workshop) or #/<path> (Tasks' own site): links from other apps, the palette, Back and
  // Forward. Any place but a task closes the task drawer; Tasks then writes where it is (route.js), replacing the
  // entry, so a one-time path (shutdown) is not repeated on reload.
  ws.on('route', ({path}) => loaded.then(() => {
    path = path || '';
    const m = /^task\/(.+)$/.exec(path);
    if (!m && path && drawerId) closeDrawer(true);
    if (m && findTask(m[1])) openDrawer(m[1]);
    else if (m) toast("That task isn't in Tasks anymore. It may have been deleted.");
    // day/<yyyy-mm-dd> or day/today: the Day view.
    const d = /^day(?:\/(\d{4}-\d{2}-\d{2}|today))?$/.exec(path);
    if (d){ setView('day'); setDate(!d[1] || d[1] === 'today' ? todayStr() : d[1]); }
    // shutdown: wrap up the day.
    if (path === 'shutdown') openShutdown();
    // A view, Plan week with a lens, or an old name (Triage and Prioritize are Today's Inbox and Plan week since Tasks 6.0).
    const V = {today: 'today', inbox: 'triage', triage: 'triage', 'plan-week': 'week', 'plan-week/list': 'rank', 'plan-week/eisenhower': 'eisen', 'plan-week/value-effort': 've', week: 'week',
      ranked: 'prio', prioritize: 'prio', list: 'rank', eisenhower: 'eisen', 'value-effort': 've', done: 'archive', people: 'people'};
    // Team reports moved to Roadmaps (Tasks 4.18.0); an old link opens them there.
    if (path === 'reports') ws.open({app: 'roadmaps', path: 'reports'}).catch(() => {});
    if (Object.hasOwn(V, path)) setView(V[path]);
    reportRoute({replace: true, force: true});
  }));
  ws.on('command', ({id, text}) => {
    // The running task's buttons in Workshop's top bar (focus.js shellStatus).
    if (/^focus-/.test(id)) loaded.then(() => {
      if (id === 'focus-done'){ const t = activeTask(); if (t) toggleDone(t.id); }
      else focusCommand(id, text);
    });
    if (id === 'add-task') openCmd();
    if (id === 'sort-one-by-one') loaded.then(() => { setView('today'); openSortRun(); });
    if (id === 'sync-ado') trackerSync(true);
    if (id === 'shortcuts') showHelp();
    if (id === 'shutdown-day') loaded.then(openShutdown);
    if (id === 'start-next') loaded.then(startNext);
    if (id === 'stuck') loaded.then(() => focusCommand('focus-stuck'));
  });
  // The ADO connector was turned on or off, or became ready: sync through the right source.
  ws.connectors.onStatus('ado', () => trackerDetect().then(() => trackerSync(false)));
  // Workshop stopped answering, or is back: say so on the ADO button, and sync once it is back.
  ws.on('online', () => trackerDetect().then(() => trackerSync(false)));
});

/* test hook: lets automated checks call the model without the UI */
window.__tasks = {
  get state(){ return state; }, set state(s){ setState(s); },
  trackerApply, trackerPick, trackerReview, trackerSync, ui, sanitize, migrateTask, urgency, score, tier, isStale,
  eKey, vKey, parseQuick, capacityCut, buildWorkbook,
  parseWorkbook, doImport, render, commit, triageQueue,
  engCheck, get eng(){ return eng; }, prAiRefresh, prAiModel, prRelease, exportXlsx, downloadBackup, importFile,
  // Resolves after pending saves and updates from other windows have run.
  saved: () => Promise.all([store ? store.idle() : null, dstore ? dstore.idle() : null, fstore ? fstore.idle() : null]), get store(){ return store; },
  get dp(){ return dp; }, recurTick, openTour, get dstore(){ return dstore; }, dayModel, offers, watchSender,
  get focusLog(){ return focusLog; }, get fstore(){ return fstore; }, focusModel, openShutdown, openDrawer, row, openDisplay
};

drawerInit(); dayInit(); tourInit(); pasteInit();
// Focus hours and lunch (Workshop docs/focus.md): hold what can wait, and ask for a breadcrumb on the running task
// when a block ends, lunch starts or focus starts now (focus.js focusTransition, one prompt per event).
focusHoursBoot({render: () => loaded.then(render), summary: refreshSummary, transition: focusTransition});
trackerInit();
applySide();
// Load the saved board (Workshop's data folder, or this browser in browser mode) before the first render.
await loaded;
render();
startDirectory();
maybeOnboard();
setTracker(); trackerSchedule(); trackerDetect().then(() => trackerSync(false));
engSchedule(); engCheck(); prAiInit();
