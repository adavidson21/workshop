/* Dispatch: sidebar view state kept in this browser only. Folders (groups of projects) and pins are personal
   view state, so they stay here and never reach Workshop or a server. Projects and runs live in the opencode
   connector (.work/_dashboard/projects.json), because agents need them.

   Shape (localStorage "dispatch.sidebar"):
     { folders: [{ id, name }],            // one level: folders hold projects, not other folders
       placement: { "<project id>": "<folder id>" },
       pins: [{ kind: "run" | "project", id }],   // run id = its .work folder
       closed: { "<folder or project id>": true } } // collapsed in the sidebar

   Pure functions take and return the state; main.js loads and saves it. */
export const LOCAL_KEY = 'dispatch.sidebar';
const MAX = 200;

export function emptyLocal() { return { folders: [], placement: {}, pins: [], closed: {} }; }

/** Clean whatever was stored (another version, a hand edit) into the current shape. */
export function cleanLocal(raw) {
  const out = emptyLocal();
  if (!raw || typeof raw !== 'object') return out;
  const ids = new Set();
  for (const f of Array.isArray(raw.folders) ? raw.folders : []) {
    if (!f || typeof f.id !== 'string' || !/^f-[a-z0-9]{1,24}$/.test(f.id) || ids.has(f.id) || typeof f.name !== 'string' || !f.name.trim()) continue;
    ids.add(f.id);
    out.folders.push({ id: f.id, name: f.name.trim().slice(0, 60) });
    if (out.folders.length >= MAX) break;
  }
  for (const [p, f] of Object.entries(raw.placement && typeof raw.placement === 'object' ? raw.placement : {})) if (ids.has(f) && typeof p === 'string') out.placement[p] = f;
  const seen = new Set();
  for (const pin of Array.isArray(raw.pins) ? raw.pins : []) {
    if (!pin || (pin.kind !== 'run' && pin.kind !== 'project') || typeof pin.id !== 'string' || !pin.id) continue;
    const k = pin.kind + ':' + pin.id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.pins.push({ kind: pin.kind, id: pin.id });
    if (out.pins.length >= MAX) break;
  }
  for (const [k, v] of Object.entries(raw.closed && typeof raw.closed === 'object' ? raw.closed : {})) if (v === true && typeof k === 'string') out.closed[k] = true;
  return out;
}

export function loadLocal(storage) {
  try { return cleanLocal(JSON.parse(storage.getItem(LOCAL_KEY) || 'null')); } catch (e) { return emptyLocal(); }
}
export function saveLocal(storage, st) {
  try { storage.setItem(LOCAL_KEY, JSON.stringify(st)); return true; } catch (e) { return false; } // private mode: this visit only
}

const newId = () => 'f-' + Math.random().toString(36).slice(2, 10);

export function addFolder(st, name) {
  const n = String(name || '').trim();
  if (!n) return { error: 'Give the folder a name.' };
  if (n.length > 60) return { error: 'Keep the name under 60 characters.' };
  if (st.folders.length >= MAX) return { error: `Keep it to ${MAX} folders.` };
  const id = newId();
  st.folders.push({ id, name: n });
  return { id };
}
export function renameFolder(st, id, name) {
  const f = st.folders.find(x => x.id === id);
  const n = String(name || '').trim();
  if (!f) return { error: 'That folder is gone.' };
  if (!n) return { error: 'Give the folder a name.' };
  if (n.length > 60) return { error: 'Keep the name under 60 characters.' };
  f.name = n;
  return { id };
}
/** Remove a folder. Its projects go back to the top level; the projects themselves are not touched. */
export function removeFolder(st, id) {
  st.folders = st.folders.filter(f => f.id !== id);
  for (const [p, f] of Object.entries(st.placement)) if (f === id) delete st.placement[p];
  delete st.closed[id];
}
/** Put a project in a folder, or at the top level with folder null. */
export function placeProject(st, projectId, folderId) {
  if (!folderId || !st.folders.some(f => f.id === folderId)) delete st.placement[projectId];
  else st.placement[projectId] = folderId;
}

export const isPinned = (st, kind, id) => st.pins.some(p => p.kind === kind && p.id === id);
export function togglePin(st, kind, id) {
  if (isPinned(st, kind, id)) st.pins = st.pins.filter(p => !(p.kind === kind && p.id === id));
  else st.pins.push({ kind, id });
}
export function toggleClosed(st, key) {
  if (st.closed[key]) delete st.closed[key]; else st.closed[key] = true;
}
/** Drop pins and placements for projects and runs that no longer exist. Returns true if anything changed. */
export function pruneLocal(st, projectIds, runIds) {
  const before = JSON.stringify(st);
  st.pins = st.pins.filter(p => (p.kind === 'project' ? projectIds.has(p.id) : runIds.has(p.id)));
  for (const p of Object.keys(st.placement)) if (!projectIds.has(p)) delete st.placement[p];
  return JSON.stringify(st) !== before;
}
