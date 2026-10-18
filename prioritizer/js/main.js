/* Prioritizer: Startup: service worker, test hook, first render. Loaded last. */
'use strict';
// On its own, Prioritizer registers the site's service worker itself; inside the shell, the shell does.
if (!EMBEDDED) WorkshopSw.register((msg, label, fn) => toast(msg, label, fn, 30000));
if (EMBEDDED){
  $('#themeBtn').hidden = true;
  // Alt+1, Alt+2, ... switch apps in the shell, even while focus is in here.
  document.addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)){ e.preventDefault(); window.parent.postMessage({type: 'em-key', code: e.code}, location.origin); }
  }, true);
}

/* test hook: lets automated checks call the model without the UI */
window.__prioritizer = {get state(){ return state; }, set state(s){ state = s; }, adoApply, adoPick, adoReview, adoSync, ui, sanitize, migrateTask, urgency, score, tier, isStale, eKey, vKey, parseQuick, capacityCut, buildWorkbook, buildReportsWorkbook, rpCompute, rpRefresh, get rp(){ return rp; }, parseWorkbook, doImport, render, commit, triageQueue, takeSnap, setSnap: s => { snap = s; }, engCheck, get eng(){ return eng; }};

applySide();
// First load after the v2 upgrade: diff against the stored v1 board so migrated tasks get change stamps.
const bootRaw = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ return null; } })();
if (bootRaw && bootRaw.version !== 2 && Array.isArray(bootRaw.tasks) && Array.isArray(bootRaw.lists)){
  snap = {tasks: new Map(bootRaw.tasks.map(t => [t.id, stripStamp(t)])), lists: new Map(bootRaw.lists.map(l => [l.id, stripStamp(l)])),
          people: new Set((bootRaw.people || []).map(p => String(p).toLowerCase()))};
  save();
} else snap = takeSnap();
render();
restoreSync();
setAdo(); adoSchedule(); adoSync(false);
engSchedule(); engCheck();
