/* Settings, Data: where your data can go, and what is stored where (docs/data-format.md, Readable without
   Workshop; docs/agent-api.md, Storage). Two cards:
   - "Where your data can go": every place data can leave this computer, on or off. Nothing leaves by default.
   - "Storage": sizes, the readable copy, and old copies Workshop no longer uses, each deleted only by a click.
   With the agent the numbers come from GET /api/storage; deleting runs only on Workshop on this computer.
   This browser's own old copies (from before the data folder) are listed and cleared here too. */

const MB = 1024 * 1024;
export const humanBytes = n => (n < 1024 ? `${n} B` : n < MB ? `${Math.round(n / 1024)} KB` : `${(n / MB).toFixed(1)} MB`);

/* Old copies this browser may still hold for this site, once the data lives in a folder (agent or Chrome's).
   Each: {id, what, has(): Promise<boolean>, clear(): Promise<void>}. */
const LOCAL_KEYS = [
  { id: 'ls-prioritizer', what: 'Docket board from before Workshop (saved in this browser)', key: 'prioritizer.v1', only: () => !!localStorage.getItem('prioritizer.v1.moved') },
  { id: 'ls-loom-reports', what: "Loom's team reports profile, saved in this browser", key: 'slate.reports' },
  { id: 'ls-runway-reports', what: "Runway's old team reports profile, saved in this browser", key: 'runway.reports' },
];
function idbHas(name) {
  if (!indexedDB.databases) return Promise.resolve(false);
  return indexedDB.databases().then(list => list.some(d => d.name === name)).catch(() => false);
}
function idbDelete(name) {
  return new Promise((res, rej) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = () => res(); r.onerror = () => rej(r.error); r.onblocked = () => res(); });
}
/* The IndexedDB copy of Workshop data marked moved (docs/run-modes.md): clear its data, files and trash stores.
   The handles store (the chosen folder) is kept. */
function movedIdbCopy() {
  return new Promise(res => {
    let r;
    try { r = indexedDB.open('workshop'); } catch (e) { res(null); return; }
    r.onerror = () => res(null);
    r.onupgradeneeded = () => { r.transaction.abort(); };
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('data')) { db.close(); res(null); return; }
      const q = db.transaction('data').objectStore('data').get('_moved');
      q.onsuccess = () => res(q.result ? db : (db.close(), null));
      q.onerror = () => { db.close(); res(null); };
    };
  });
}
export function browserLeftovers({ inFolder }) {
  const out = [];
  if (inFolder) {
    for (const k of LOCAL_KEYS) {
      out.push({ id: k.id, what: k.what, has: async () => { try { return localStorage.getItem(k.key) !== null && (!k.only || k.only()); } catch (e) { return false; } }, clear: async () => { localStorage.removeItem(k.key); } });
    }
    out.push({ id: 'idb-slate-cache', what: "Loom's last team report pull, cached in this browser", has: () => idbHas('slate-cache'), clear: () => idbDelete('slate-cache') });
  }
  out.push({
    id: 'idb-moved', what: "This browser's copy of your data from before you chose a folder",
    has: async () => { const db = await movedIdbCopy(); if (db) db.close(); return !!db; },
    clear: async () => {
      const db = await movedIdbCopy();
      if (!db) return;
      await new Promise((res, rej) => {
        const names = ['data', 'files', 'trash'].filter(n => db.objectStoreNames.contains(n));
        const tx = db.transaction(names, 'readwrite');
        for (const n of names) tx.objectStore(n).clear();
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
  });
  return out;
}

/* One row per place data can go. `conns` from ws.connectors.list(), `st` from GET /api/storage (or null). */
export function destinations({ backend, storage, conns = [], st = null, providers = null }) {
  const rows = [];
  const on = id => conns.some(c => c.id === id && c.enabled);
  if (backend === 'agent') {
    rows.push({ id: 'folder', on: !!(st && st.synced), label: 'Your data folder',
      text: st && st.synced ? `Inside ${st.synced}, so ${st.synced} uploads it. Workshop never does.` : 'Stays on this computer. No sync tool uploads it.' });
  } else {
    rows.push({ id: 'folder', on: false, label: storage === 'folder' ? 'Your data folder' : 'This browser', text: 'Stays on this computer. Without Workshop on this computer, no connector can send anything.' });
  }
  if (on('ado')) rows.push({ id: 'ado', on: on('ado'), label: 'Azure DevOps', text: on('ado') ? 'Reads work items and pull requests from your servers. Writes only when you click a button that says so.' : 'Off. Nothing is read or sent.' });
  if (conns.some(c => c.id === 'github')) rows.push({ id: 'github', on: on('github'), label: 'GitHub', text: on('github') ? 'Reads pull requests from GitHub. Writes only when you click a button that says so.' : 'Off. Nothing is read or sent.' });
  if (conns.some(c => c.id === 'opencode')) {
    const who = providers && providers.length ? providers.join(', ') : 'the AI provider opencode is set up with';
    rows.push({ id: 'opencode', on: on('opencode'), label: 'AI through opencode', text: on('opencode') ? `What you send in Chat and Loom, and what agents read for it, goes to ${who}. opencode also keeps its own session history on this computer.` : 'Off. Nothing is sent to an AI provider.' });
  }
  return rows;
}

/**
 * @param {object} o {ws, card, esc, agentCall, toast, errText, readOnly}
 */
export async function mountStorage({ ws, card, esc, agentCall, toast, errText }) {
  const isAgent = ws.backend === 'agent';
  const local = ws.mode === 'local';
  let st = null, conns = [], providers = null;
  if (isAgent) {
    try { st = await agentCall('GET', '/api/storage'); } catch (e) { st = null; }
    try { conns = await ws.connectors.list(); } catch (e) { conns = []; }
    try { const oc = await ws.connectors.getConfig('opencode'); providers = oc && oc.config && Array.isArray(oc.config.approvedProviders) ? oc.config.approvedProviders : null; } catch (e) { providers = null; }
  }

  // Where your data can go.
  const go = card('Where your data can go', '', 'data', 52, 'Every way data can leave this computer. Nothing leaves unless one of these is on.');
  const rows = destinations({ backend: ws.backend, storage: ws.storage, conns, st, providers });
  const leaving = rows.filter(r => r.on).length;
  go.insertAdjacentHTML('beforeend', `<p class="sub">${leaving ? `${leaving} of ${rows.length} can send data off this computer.` : 'Nothing leaves this computer.'}</p>
    <ul class="go-list">${rows.map(r => `<li data-go="${esc(r.id)}"><span class="go-dot${r.on ? ' on' : ''}" aria-hidden="true"></span><b>${esc(r.label)}</b> <span class="soft">${r.on ? 'On' : r.id === 'folder' ? 'Local' : 'Off'}</span><p class="cfg-help">${esc(r.text)}</p></li>`).join('')}</ul>
    ${isAgent ? '<p class="cfg-help">Turn connectors on and off on Connections. The data folder is yours: move it into a synced folder only if you want it uploaded.</p>' : ''}`);

  // Storage.
  const sec = card('Storage', '', 'data', 58, 'How much is kept, a readable copy, and old copies you can delete.');
  const body = document.createElement('div');
  sec.appendChild(body);
  const paint = async () => {
    const parts = [];
    if (st) {
      const d = st.data, t = st.trash, b = st.backups;
      parts.push(`<p>${d ? `${humanBytes(d.bytes)} in ${d.files} file${d.files === 1 ? '' : 's'}` : 'Nothing saved yet'}${t && t.files ? `, ${humanBytes(t.bytes)} in the trash` : ''}${b && b.files ? `, ${humanBytes(b.bytes)} of backups` : ''}.</p>`);
      if (st.loose) parts.push(`<p class="err">Other users on this computer can read your data folder. Run <code>chmod 700 "${esc(st.dataDir)}"</code> to fix it.</p>`);
      parts.push(`<div class="acts left"><button type="button" class="btn" data-readable>Make a readable copy</button><span class="msg" aria-live="polite">${st.readableCopy ? `Last made ${esc(new Date(st.readableCopy.modified).toLocaleString())}` : ''}</span></div>
        <p class="cfg-help">Copies everything as spreadsheets and documents into the <code>Readable copy</code> folder, so your data reads without Workshop.</p>`);
    }
    const items = [];
    if (st) {
      if (st.trash && st.trash.files) items.push({ id: 'trash', what: 'Files you deleted in Workshop (the trash)', size: st.trash, server: true });
      if (st.backups && st.backups.files) items.push({ id: 'backups', what: 'Copies kept before format changes (backups)', size: st.backups, server: true });
      for (const l of st.leftovers || []) items.push({ id: l.id, what: l.what, size: l.size, path: l.path, server: true, folder: l.id.startsWith('folder-') });
    }
    const inFolder = isAgent || ws.storage === 'folder';
    for (const b of browserLeftovers({ inFolder })) if (await b.has()) items.push({ id: b.id, what: b.what, browser: b });
    parts.push(items.length
      ? `<h3>Old copies</h3><p class="cfg-help">Workshop never deletes these by itself. Delete what you no longer need.</p><ul class="old-list">${items.map(i => `<li data-old="${esc(i.id)}"><span>${esc(i.what)}${i.size ? ` <span class="soft">${humanBytes(i.size.bytes)}</span>` : ''}${i.path ? `<br><code class="soft">${esc(i.path)}</code>` : ''}</span>
          ${i.server && !local ? '<span class="soft">Delete from Workshop on this computer</span>' : `<button type="button" class="btn" data-delete="${esc(i.id)}">Delete</button>`}</li>`).join('')}</ul>`
      : (st ? '<p class="cfg-help">No old copies.</p>' : ''));
    body.innerHTML = parts.join('');
    const rb = body.querySelector('[data-readable]');
    if (rb) rb.addEventListener('click', async () => {
      const msg = rb.parentElement.querySelector('.msg');
      rb.disabled = true; msg.textContent = 'Copying...';
      try {
        const r = await agentCall('POST', '/api/storage/readable', {});
        msg.textContent = `Copied ${r.collections} collection${r.collections === 1 ? '' : 's'} and ${r.files} file${r.files === 1 ? '' : 's'}.`;
        toast('Readable copy made', 'success');
      } catch (e) { msg.textContent = errText(e); }
      rb.disabled = false;
    });
    for (const btn of body.querySelectorAll('[data-delete]')) btn.addEventListener('click', async () => {
      const it = items.find(i => i.id === btn.dataset.delete);
      const warn = it.folder ? ' It is under an old name and may hold data Workshop does not show. Move anything you need out of it first.' : '';
      if (!confirm(`Delete ${it.what.charAt(0).toLowerCase() + it.what.slice(1)}?${warn} This cannot be undone.`)) return;
      btn.disabled = true;
      try {
        if (it.browser) await it.browser.clear();
        else await agentCall('POST', '/api/storage/delete', { id: it.id });
        if (st && it.server) st = await agentCall('GET', '/api/storage');
        toast('Deleted', 'success');
        await paint();
      } catch (e) { btn.disabled = false; toast(errText(e), 'error'); }
    });
  };
  await paint();
  if (!body.innerHTML.trim()) sec.remove();
}
