/* Docket: keeps Workshop's people directory (directory-model.js) up to date through ws.people, and adds people
   to it. A name typed in Quick add, the drawer, an Excel import or an offer that the directory does not have
   becomes a contact (docs/people.md), so tasks only ever keep ids.

   Tasks saved before ids (prioritizer.tasks v3) carry names in `people`; adoptNames() turns those into ids
   once the directory has loaded, adding contacts for names it does not know, and drops `people`. */
import { getDirectory, resolve, setDirectory } from './directory-model.js';
import { ready } from './ws.js';
import { commit, findTask, state } from './state.js';
import { render } from './render.js';
import { toast } from './overlays.js';
import { refreshSummary } from './storage.js';

let ws = null;
let loaded = false;

async function load(){
  try { setDirectory(await ws.people.get()); } catch (e) { /* keep what we had; the next change reads again */ }
  loaded = true;
}

/** Adds contacts for names (one at a time, so each sees the last) and resolves to their ids, in order. */
async function addContacts(names, {ado = false} = {}){
  const ids = [];
  for (const name of names){
    try {
      const again = resolve([name], getDirectory());
      if (again.ids.length){ ids.push(again.ids[0]); continue; }
      const it = await ws.people.add({name, relation: 'contact', ...(ado ? {adoIdentity: name} : {})});
      ids.push(it.id);
      setDirectory(await ws.people.get());
    } catch (e) { toast(`Couldn't add ${name} to People: ${e.message || e}`); }
  }
  return ids;
}

/** Sets or adds to a task's `who` from tokens (ids, @handles or names). Known ones apply now; new names are
    added as contacts and applied when that finishes; `ado` saves each new name as its Azure DevOps identity too
    (a PR author). Returns the ids applied now. */
function assign(t, tokens, {add = false, ado = false} = {}){
  const {ids, missing} = resolve(tokens);
  t.who = [...new Set([...(add ? t.who || [] : []), ...ids])];
  if (missing.length){
    if (!ws){ toast('People can only be added once Workshop storage is ready.'); return ids; }
    addContacts(missing, {ado}).then(more => {
      const cur = findTask(t.id);
      if (!cur || !more.length) return;
      cur.who = [...new Set([...(cur.who || []), ...more])];
      commit();
    });
  }
  return ids;
}

/** Adds a contact by name (the People view's Add a person). Resolves the new or existing item, or null. */
async function addPerson(name){
  const w = await ready;
  if (!w) return null;
  ws = w;
  const {ids, missing} = resolve([name]);
  const id = ids[0] || (await addContacts(missing))[0];
  render();
  return id ? getDirectory().byId.get(id) || null : null;
}

/** Turns names left in tasks' `people` (boards saved before ids, imports, old offers) into ids. */
let adopting = null;
function adoptNames(){
  if (!ws || !loaded) return Promise.resolve();
  adopting = (adopting || Promise.resolve()).then(adoptNow, adoptNow);
  return adopting;
}
async function adoptNow(){
  const pending = state.tasks.filter(t => Array.isArray(t.people));
  if (!pending.length) return;
  const all = [...new Set(pending.flatMap(t => t.people.map(n => String(n ?? '').trim()).filter(Boolean)))];
  const {missing} = resolve(all);
  if (missing.length) await addContacts(missing);
  for (const t of state.tasks.filter(x => Array.isArray(x.people))){
    const {ids} = resolve(t.people);
    t.who = [...new Set([...(t.who || []), ...ids])];
    delete t.people;
  }
  commit();
}

/** Call once the board is loaded: reads the directory, adopts old names, and follows changes. */
async function startDirectory(){
  ws = await ready;
  if (!ws) return;
  await load();
  render();
  refreshSummary();
  await adoptNames();
  ws.people.subscribe(dir => { setDirectory(dir); render(); refreshSummary(); });
}

export { addPerson, adoptNames, assign, startDirectory };
