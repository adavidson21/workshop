/* Prioritizer: Workshop's people directory, read only (Settings' `people`, docs/people.md in the workshop
   repo). No imports and no DOM, so state.js can use it without joining the module cycle and Node tests can
   import it.

   Docket's people stay Docket's: anyone you wait on or talk to, teams and vendors included. The directory
   only adds name suggestions, a link from a Docket person to the matching directory person (`personId` on
   their item in prioritizer.people, an extra field, so the collection stays v1), and a quick fill for the
   Reports team profile. */

let current = null; // [{id, name, relation, team, adoIdentity, archived}] or null when there is no directory

/** The directory's people from Settings' envelope, or null when it is missing or a version we can't read. */
export function readDirectory(env){
  if (!env || env.schema !== 'settings.people' || env.version !== 1) return null;
  return (Array.isArray(env.items) ? env.items : [])
    .filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim())
    .map(p => ({
      id: p.id, name: p.name.trim(), relation: p.relation,
      team: typeof p.team === 'boolean' ? p.team : p.relation === 'self' || p.relation === 'report',
      adoIdentity: typeof p.adoIdentity === 'string' ? p.adoIdentity.trim() : '',
      archived: !!p.archived
    }));
}

export function setDirectory(list){ current = list; }
export const getDirectory = () => current;

const key = n => String(n || '').trim().toLowerCase();

/** Active directory names not already among Docket's people, for suggestions. You are left out. */
export function suggestions(names, dir = current){
  if (!dir) return [];
  const have = new Set(names.map(key));
  return dir.filter(p => !p.archived && p.relation !== 'self' && !have.has(key(p.name))).map(p => p.name);
}

/** Links Docket people to directory people with the same name (ignoring case). A link made earlier is kept
    when the directory no longer has that name. Returns true if any link changed. */
export function linkPeople(board, dir = current){
  if (!dir) return false;
  const links = board.personLinks && typeof board.personLinks === 'object' ? board.personLinks : (board.personLinks = {});
  let changed = false;
  for (const n of board.people || []){
    const p = dir.find(x => key(x.name) === key(n));
    if (p && links[key(n)] !== p.id){ links[key(n)] = p.id; changed = true; }
  }
  return changed;
}

/** Lines for the Reports team profile: the ADO email or display name of everyone active on your team. */
export function teamLines(dir = current){
  if (!dir) return [];
  return [...new Set(dir.filter(p => p.team && !p.archived).map(p => p.adoIdentity || p.name))];
}
