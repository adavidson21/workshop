/* Runway: who a roadmap item is for, from Workshop's people directory (docs/people.md in the workshop repo).
   No DOM and no SDK, so Node tests drive it. main.js keeps the directory current through ws.people.

   Items keep `who`: people (p_) and group (g_) ids, never names. The outline and the panel show @handles; a
   person counts as an owner of an item assigned to them or to an active group they are in. */
import * as D from '../../../shared/people.js';

let current = D.EMPTY;
export const setDirectory = (dir) => { current = dir || D.EMPTY; };
export const getDirectory = () => current;

/** What to show for an id where it can be edited: its @handle, or the id itself when the directory does not
    have it (so a round trip through the outline keeps it). */
export const mentionOf = (id, dir = current) => (dir.byId.has(id) ? D.mention(dir, id) : id);
export const namesOf = (who, dir = current) => (Array.isArray(who) ? who : []).map(id => D.label(dir, id));

/** Tokens (ids, @handles or names) to {ids, missing}: ids stay ids; names the directory does not have are
    missing (capitalized, once each), for the caller to add as contacts. */
export function resolve(tokens, dir = current) {
  const ids = [], missing = [];
  for (const raw of tokens || []) {
    const t = String(raw ?? '').trim();
    if (!t) continue;
    const hit = D.isRef(t) ? t : (D.find(dir, t) || {}).id;
    if (hit) { if (!ids.includes(hit)) ids.push(hit); continue; }
    const n = t.replace(/^@/, '');
    if (n && !missing.some(m => m.toLowerCase() === n.toLowerCase())) missing.push(n[0].toUpperCase() + n.slice(1));
  }
  return { ids, missing };
}

/** Items that do not involve `id` (directly or through a group), for dimming the rest of the timeline. */
export function notFor(items, id, dir = current) {
  if (!id) return new Set();
  return new Set(items.filter(it => it.kind === 'item' && !D.involves(dir, it.who, id)).map(it => it.id));
}

/** The active person with an ADO assignee's identity ({name, email}): email first, then display name. Or null. */
export const adoOwner = (a, dir = current) => (a && ((a.email && D.byAdoIdentity(dir, a.email)) || (a.name && D.byAdoIdentity(dir, a.name)))) || null;

/** Choices for the owner filter and the panel: active people (not you) and groups. */
export const choices = (dir = current) => D.active(dir, { self: false });

export { D };
