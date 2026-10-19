import { hideTip, placeTip, tipFor } from './events.js';
import { NO_XLSX, buildWorkbook, exportXlsx, parseWorkbook } from './excel.js';
import { closeMenu, closeModal, popMenu, showModal, toast } from './overlays.js';
import { commit, sanitize, setState, state } from './state.js';
import { $, plural } from './util.js';
/* Prioritizer: Autosave to a folder (Chrome or Edge, File System Access API). */
/* ---------- autosave to a folder (Chrome / Edge) ---------- */
const FILE_NAME = 'prioritizer.xlsx';
const fsOK = typeof window.showDirectoryPicker === 'function';
let dirHandle = null, sync = 'off', lastSig = '', lastFileMod = 0, writeTimer = null, writing = false, syncWarned = false;
const dataSig = () => JSON.stringify([state.lists, state.tasks]);
const isBlank = () => !state.tasks.length && state.lists.length === 1;

function idb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open('prioritizer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvGet(k){
  const db = await idb();
  return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
}
async function kvSet(k, v){
  const db = await idb();
  return new Promise(res => {
    const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
    v === undefined ? st.delete(k) : st.put(v, k);
    tx.oncomplete = () => res(); tx.onerror = () => res();
  });
}
const xlsxReady = () => new Promise(res => window.XLSX || document.readyState === 'complete' ? res() : window.addEventListener('load', res, {once: true}));

function setSync(s){
  sync = s;
  const b = $('#syncBtn'), where = dirHandle ? `${dirHandle.name}/${FILE_NAME}` : FILE_NAME;
  b.dataset.sync = fsOK ? s : 'na';
  b.dataset.tip = !fsOK ? 'Download or import an Excel copy'
    : s === 'on' ? `Saving a copy to ${where}`
    : s === 'paused' ? `Folder copy paused. Click to reconnect to ${dirHandle ? dirHandle.name : 'your folder'}.`
    : s === 'error' ? `Can't save to ${where}. Close it in Excel if it's open.`
    : 'Excel copy: download, import, or keep one in a folder';
  if (tipFor === b) placeTip(b);
}
async function readFolderFile(){
  let fh;
  try { fh = await dirHandle.getFileHandle(FILE_NAME); } catch(e){ if (e.name === 'NotFoundError') return null; throw e; }
  const f = await fh.getFile();
  const p = f.size ? parseWorkbook(XLSX.read(new Uint8Array(await f.arrayBuffer()), {type: 'array', cellDates: true})) : null;
  return {p: p && p.lists.length ? p : null, mod: f.lastModified};
}
function applyFile(p){
  state.lists = p.lists; state.tasks = p.tasks;
  setState(sanitize(state));
  lastSig = dataSig();
  commit();
}
function scheduleWrite(){
  if (sync !== 'on' && sync !== 'error') return;
  clearTimeout(writeTimer); writeTimer = setTimeout(writeFolderFile, 600);
}
async function writeFolderFile(){
  if (!dirHandle || !window.XLSX || (sync !== 'on' && sync !== 'error')) return;
  const sig = dataSig(); if (sig === lastSig) return;
  if (writing){ scheduleWrite(); return; }
  writing = true;
  try {
    const fh = await dirHandle.getFileHandle(FILE_NAME, {create: true});
    const w = await fh.createWritable();
    await w.write(new Uint8Array(XLSX.write(buildWorkbook(), {bookType: 'xlsx', type: 'array'})));
    await w.close();
    lastSig = sig; lastFileMod = (await fh.getFile()).lastModified; syncWarned = false;
    setSync('on');
  } catch(e){
    setSync('error');
    if (!syncWarned){ syncWarned = true; toast(`Couldn't save to ${FILE_NAME}. If it's open in Excel, close it and it will retry.`); }
  } finally { writing = false; }
}
async function connect(handle, interactive){
  dirHandle = handle;
  await kvSet('dir', handle);
  await xlsxReady();
  if (!window.XLSX){ setSync('paused'); toast(NO_XLSX); return; }
  let r;
  try { r = await readFolderFile(); } catch(e){ setSync('error'); toast(`Couldn't read ${FILE_NAME}.`); return; }
  setSync('on');
  if (!r || !r.p){ lastSig = ''; await writeFolderFile(); if (interactive) toast(`Saving to ${handle.name}/${FILE_NAME}`); return; }
  lastFileMod = r.mod;
  const fileWins = () => { applyFile(r.p); toast(`Loaded ${FILE_NAME} from ${handle.name}`); };
  const boardWins = async () => { lastSig = ''; await writeFolderFile(); toast(`Saving to ${handle.name}/${FILE_NAME}`); };
  if (isBlank()) return fileWins();
  if (!interactive) return r.mod > (state.updatedAt || 0) ? fileWins() : boardWins();
  showModal(`<div class="sheet small" role="dialog" aria-modal="true" aria-label="File exists"><h3>${FILE_NAME} already exists</h3>
    <p>This folder has a saved board with ${plural(r.p.tasks.length,'task')}. Which one should be kept?</p>
    <div class="choice">
      <button class="opt" data-keep="file"><b>Load the file</b><span>Replace what's on screen with the saved board.</span></button>
      <button class="opt" data-keep="board"><b>Keep what's on screen</b><span>Overwrite the file with your current board.</span></button>
    </div></div>`,
    s => s.addEventListener('click', e => {
      const b = e.target.closest('[data-keep]'); if (!b) return;
      closeModal(); b.dataset.keep === 'file' ? fileWins() : boardWins();
    }));
}
async function pickFolder(){
  let h;
  try { h = await window.showDirectoryPicker({id: 'prioritizer', mode: 'readwrite'}); }
  catch(e){ if (e.name !== 'AbortError') toast("Couldn't use that folder. Try one in Documents or Desktop."); return; }
  connect(h, true);
}
async function reconnect(){
  try {
    const p = await dirHandle.requestPermission({mode: 'readwrite'});
    if (p === 'granted') return connect(dirHandle, false);
  } catch(e){}
  toast('Folder copy is paused. Click the folder icon to try again.');
}
async function stopSync(){
  dirHandle = null; clearTimeout(writeTimer); await kvSet('dir', undefined); setSync('off');
  toast('Stopped saving to the folder. Your board is still saved in this browser.');
}
function onSyncClick(btn){
  hideTip();
  if (fsOK && sync === 'paused') return reconnect();
  const syncing = fsOK && sync !== 'off';
  popMenu((!fsOK ? '' : syncing ? `<button data-s="now">Save now</button><button data-s="change">Change folder</button>`
      : `<button data-s="change"><b>Keep a copy in a folder</b></button>`)
    + `<button data-s="download">Download a copy</button><button data-s="import">Import a file</button>`
    + (syncing ? `<div class="sep"></div><button data-s="stop" class="danger">Stop saving to folder</button>` : ''), btn)
    .addEventListener('click', async e => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      closeMenu();
      if (b.dataset.s === 'now'){ lastSig = ''; await writeFolderFile(); if (sync === 'on') toast('Saved'); }
      if (b.dataset.s === 'change') pickFolder();
      if (b.dataset.s === 'download') exportXlsx();
      if (b.dataset.s === 'import') $('#importFile').click();
      if (b.dataset.s === 'stop') stopSync();
    });
}
// Pick up edits made to the file in Excel while this tab was in the background.
async function checkExternal(){
  if (sync !== 'on' || writing || !dirHandle || !window.XLSX) return;
  try {
    const fh = await dirHandle.getFileHandle(FILE_NAME), f = await fh.getFile();
    if (f.lastModified <= lastFileMod) return;
    lastFileMod = f.lastModified;
    const r = await readFolderFile();
    if (r && r.p){ applyFile(r.p); toast('Loaded changes from Excel'); }
  } catch(e){}
}
async function restoreSync(){
  setSync('off');
  if (!fsOK) return;
  let h; try { h = await kvGet('dir'); } catch(e){}
  if (!h) return;
  dirHandle = h;
  let perm = 'prompt';
  try { perm = await h.queryPermission({mode: 'readwrite'}); } catch(e){}
  if (perm === 'granted') return connect(h, false);
  setSync('paused');
  toast(`Reconnect to ${h.name} to keep the folder copy`, 'Reconnect', reconnect, 20000);
}

export { checkExternal, kvGet, kvSet, onSyncClick, restoreSync, scheduleWrite };
