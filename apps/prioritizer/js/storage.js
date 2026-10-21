/* Prioritizer: where the board is saved, and the file menu (the folder icon in the sidebar).

   The board is saved through the SDK: with Workshop running, as files in ~/.workshop/data/prioritizer/
   (other apps can read them); in browser mode, in this browser's storage. store.js does the saving and
   keeps windows in step; this module connects it to the board, the status icon and the file menu.

   First run: if nothing is saved yet and this browser has a board from the localStorage versions of
   Prioritizer (same site), it is moved in once and the old copy is left in place untouched. A board on
   another site (adavidson21.github.io) can't be read from here, so the file menu imports a file
   exported there: an Excel copy, or a Workshop backup (.json). */
import { KEY } from './constants.js';
import { hideTip, placeTip, tipFor } from './events.js';
import { exportXlsx, importFile as importExcel } from './excel.js';
import { closeMenu, closeModal, popMenu, showModal, toast } from './overlays.js';
import { render } from './render.js';
import { sanitize, setState, state } from './state.js';
import { createStore } from './store.js';
import { envelopesFromBundle, legacyToEnvelopes } from './store-format.js';
import { $, esc, plural, todayStr } from './util.js';
import { ready } from './ws.js';

const MOVED_KEY = 'prioritizer.v1.moved'; // set once the localStorage board was moved into Workshop storage
let store = null, ws = null, booted = false, status = {state: 'saved'};

function where(){
  if (!ws) return 'nowhere';
  return ws.backend === 'agent' ? 'on this computer, in Workshop\'s data folder' : 'in this browser';
}
function setStatus(s){
  const was = status.state;
  status = s;
  const b = $('#syncBtn'); if (!b) return;
  b.dataset.sync = s.state === 'saved' ? 'on' : s.state === 'saving' ? 'saving' : 'error';
  b.dataset.tip = s.state === 'error' ? (s.retry === false ? 'Not saving. Click for details.' : 'Not saved yet. Retrying. Click for details.')
    : s.state === 'readonly' ? 'Read only: saved by a newer Workshop'
    : `Saved ${where()}. Download, back up or import.`;
  b.setAttribute('aria-label', s.state === 'error' ? 'Files: not saved yet' : 'Files and saving');
  if (tipFor === b) placeTip(b);
  if (s.state === 'error' && was !== 'error' && s.retry !== false) toast('Changes are not saved yet. Retrying.');
  if (s.state === 'readonly' && was !== 'readonly') toast('This board was saved by a newer Workshop. Update Workshop to make changes here.', 20000);
  if (s.state === 'saved' && was === 'error') toast('Saved');
}

function readLegacy(){
  try {
    if (localStorage.getItem(MOVED_KEY)) return null;
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    return raw && Array.isArray(raw.lists) && raw.lists.length ? raw : null;
  } catch (e){ return null; }
}

/* Load the board. Resolves once it is on screen-ready in `state`. */
async function boot(){
  ws = await ready;
  if (!ws){
    // No storage at all (should not happen): show the old browser copy if any, and say nothing is saved.
    const raw = readLegacy();
    if (raw) setState(sanitize(JSON.parse(JSON.stringify(raw))));
    booted = true;
    setStatus({state: 'error', error: new Error('Storage is not available.'), retry: false});
    return;
  }
  store = createStore({
    data: ws.data,
    board: () => state,
    applied: () => { setState(sanitize(state)); if (booted) render(); },
    status: setStatus
  });
  let empty;
  try { ({empty} = await store.load()); }
  catch (e){
    // For example a damaged data file (the agent leaves it untouched and says so). Show what loaded,
    // save nothing, and say why, rather than risk writing over the user's data.
    store = null; booted = true;
    setStatus({state: 'error', error: e, retry: false});
    toast(`Could not load your board: ${e.message || e}. Nothing will be saved until this is fixed.`, 60000);
    return;
  }
  if (empty){
    const raw = readLegacy();
    if (raw){
      await store.seed(legacyToEnvelopes(sanitize(JSON.parse(JSON.stringify(raw)))));
      try { localStorage.setItem(MOVED_KEY, new Date().toISOString()); } catch (e){}
    }
  }
  store.start();
  ws.on('online', ({online}) => { if (online) store.refresh(); });
  addEventListener('pagehide', () => { if (store.unsaved) store.flushAll(); });
  addEventListener('beforeunload', e => { if (status.state === 'error'){ e.preventDefault(); e.returnValue = ''; } });
  booted = true;
  if (store.isNew && ws.backend === 'agent'){
    toast('Moving from the Prioritizer website? Export your board there, then import the file here.', 'Import', () => $('#importFile').click(), 15000);
  }
}

/* Called on every change to the board (state.js save()). */
const scheduleSave = () => { if (store) store.schedule(); };

/* ---------- file menu ---------- */
function onSyncClick(btn){
  hideTip();
  const why = esc(status.error && status.error.message || 'unknown error');
  const note = status.state === 'error' ? `<div class="mnote warn">${status.retry === false ? `Not saving: ${why}` : `Not saved yet: ${why}. Retrying every few seconds.`}</div>`
    : status.state === 'readonly' ? `<div class="mnote warn">Read only. This board was saved by a newer Workshop.</div>`
    : `<div class="mnote">Saved ${esc(where())}.</div>`;
  popMenu(note + `<button data-s="download">Download an Excel copy</button><button data-s="backup">Download a backup (.json)</button>`
    + `<button data-s="import">Import a file</button>` + (status.state === 'error' && store ? `<div class="sep"></div><button data-s="retry">Try saving now</button>` : ''), btn)
    .addEventListener('click', e => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      closeMenu();
      if (b.dataset.s === 'download') exportXlsx();
      if (b.dataset.s === 'backup') downloadBackup();
      if (b.dataset.s === 'import') $('#importFile').click();
      if (b.dataset.s === 'retry' && store) store.flushAll();
    });
}

/* A Workshop bundle of Prioritizer's collections (docs/data-format.md, Bundles). */
async function downloadBackup(){
  if (!ws){ toast('Storage is not available.'); return; }
  try {
    if (store) await store.idle();
    const bundle = await ws.data.export({apps: ['prioritizer']});
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2) + '\n'], {type: 'application/json'}));
    const a = document.createElement('a');
    a.href = url; a.download = `workshop-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup downloaded');
  } catch (e){ toast('Could not make a backup.'); }
}

/* The import button takes an Excel file (as before) or a Workshop backup (.json). */
function importFile(file){
  if (/\.json$/i.test(file.name) || file.type === 'application/json') return importBackup(file);
  return importExcel(file);
}
async function importBackup(file){
  if (!store){ toast('Storage is not available.'); return; }
  let envs;
  try { envs = envelopesFromBundle(JSON.parse(await file.text())); }
  catch (e){ toast(e instanceof SyntaxError ? 'That file is not a Workshop backup.' : e.message); return; }
  const n = envs.tasks ? envs.tasks.items.length : 0;
  await store.idle();
  if (store.isNew){ await store.seed(envs); render(); toast(`Imported ${plural(n, 'task')}`); return; }
  showModal(`<div class="sheet small" role="dialog" aria-modal="true" aria-label="Import a backup"><h3>Import ${plural(n, 'task')}</h3>
    <p>The backup is merged into your board. Where both have the same task, the one changed last is kept. Nothing is lost.</p>
    <footer><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-merge>Merge</button></footer></div>`,
    s => s.addEventListener('click', async e => {
      if (!e.target.closest('[data-merge]')) return;
      closeModal();
      await store.importEnvelopes(envs);
      render();
      toast(`Imported ${plural(n, 'task')}`);
    }));
}

export { boot, downloadBackup, importFile, onSyncClick, scheduleSave, store };
