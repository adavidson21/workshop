/* Docket: who a task is for, from Workshop's people directory (docs/people.md in the workshop repo).
   No DOM and no SDK, so state.js can use it without joining the module cycle and Node tests can import it.

   Tasks keep `who`: people (p_) and group (g_) ids from the directory, never names. Names and @handles are
   looked up here at render time, and a person counts as on a task when it is assigned to them or to an active
   group they are in (shared/people.js `reach`). The directory itself is read and changed with ws.people
   (directory.js). */
import * as D from '../../../shared/people.js';

let current = D.EMPTY;

export function setDirectory(dir){ current = dir || D.EMPTY; }
export const getDirectory = () => current;

/** Display name for an id. */
export const nameOf = (id, dir = current) => D.label(dir, id);
/** Names for a task's `who`, in order. */
export const namesOf = (who, dir = current) => (Array.isArray(who) ? who : []).map(id => D.label(dir, id));

/** The id a token points to: an id already in the directory, an @handle, a name (shared/people.js find) or an
    Azure DevOps identity.
    Null when nothing matches; the caller adds a contact for it. */
export function refOf(token, dir = current){
  const t = String(token ?? '').trim();
  if (!t) return null;
  if (D.isRef(t)) return t; // an id stays an id, even one the directory no longer has
  const hit = D.find(dir, t) || D.byAdoIdentity(dir, t);
  return hit ? hit.id : null;
}

/** Tokens split into ids found and names to add: {ids, missing}. Names lose a leading @ and get a capital. */
export function resolve(tokens, dir = current){
  const ids = [], missing = [];
  for (const tok of tokens || []){
    const id = refOf(tok, dir);
    if (id){ if (!ids.includes(id)) ids.push(id); continue; }
    const n = String(tok ?? '').trim().replace(/^@/, '');
    if (n && !missing.some(m => m.toLowerCase() === n.toLowerCase())) missing.push(n[0].toUpperCase() + n.slice(1));
  }
  return {ids, missing};
}

/** Whether a task involves `id`: assigned to it, or (for a person) to an active group they are in. */
export const involves = (t, id, dir = current) => !!D.involves(dir, t.who, id);
/** How: 'direct', a group id, or null. */
export const via = (t, id, dir = current) => D.involves(dir, t.who, id);

/** The directory's active people and groups a People card can be for: everyone with an open task here,
    then your team. You are left out. Ordered like the directory (people by relation, then groups). */
export function cardsFor(tasks, dir = current){
  const open = tasks.filter(t => !t.done);
  const has = new Set();
  for (const t of open) for (const id of t.who || []) has.add(id);
  const show = it => it.relation !== 'self' && (has.has(it.id) || (it.kind === 'person' && D.onTeam(it)) || open.some(t => D.involves(dir, t.who, it.id)));
  return D.active(dir).filter(show);
}

/** Active people and groups without a card, for one-click "add a task for". */
export function others(tasks, dir = current){
  const shown = new Set(cardsFor(tasks, dir).map(it => it.id));
  return D.active(dir, {self: false}).filter(it => !shown.has(it.id));
}

/** What to show for an id where it can be edited: its @handle, or the id itself when the directory does not
    have it (so saving the field keeps it instead of adding someone called "Unknown"). */
export const mentionOf = (id, dir = current) => (dir.byId.has(id) ? D.mention(dir, id) : id);

export { D };
