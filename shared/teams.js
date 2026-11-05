/* Your team's Azure DevOps area paths (docs/teams.md): collection `teams` in Settings' folder (settings.teams v1),
   like the people directory. The People app edits it through the SDK's `ws.teams`; Runway's ADO roadmaps and the
   Dispatch hub read it with {app: 'settings'}. Version 1 has one team, t_mine. Pure, no DOM or SDK
   (shared/test/teams.test.mjs). */
export const APP = 'settings';
export const COLLECTION = 'teams';
export const SCHEMA = 'settings.teams';
export const VERSION = 1;
export const MINE = 't_mine';
export const MAX_AREAS = 20;

export const blank = () => ({ schema: SCHEMA, version: VERSION, rev: 0, items: [], deleted: {} });
export const readable = env => !env || (env.schema === SCHEMA && env.version === VERSION && Array.isArray(env.items));

/** Area paths from a textarea: one per line, trimmed, no blanks or repeats, at most MAX_AREAS. */
export function parseAreas(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const a = line.trim().slice(0, 400);
    if (a && !out.some(x => x.toLowerCase() === a.toLowerCase())) out.push(a);
  }
  return out.slice(0, MAX_AREAS);
}

/** Your team from the envelope: {name, areas, connection}, empty when none. */
export function mine(env) {
  const t = env && Array.isArray(env.items) ? env.items.find(x => x && x.id === MINE) : null;
  return {
    name: t && typeof t.name === 'string' && t.name ? t.name : 'My team',
    areas: t && Array.isArray(t.areas) ? t.areas.filter(a => typeof a === 'string' && a) : [],
    connection: t && typeof t.connection === 'string' ? t.connection : ''
  };
}

/** Puts your team into a copy of the envelope's items (the caller stamps and saves). */
export function withMine(items, { areas, connection }) {
  const team = { id: MINE, name: 'My team', areas: parseAreas(Array.isArray(areas) ? areas.join('\n') : areas), connection: String(connection || '').trim().slice(0, 120) };
  const rest = (items || []).filter(x => x && x.id !== MINE);
  const old = (items || []).find(x => x && x.id === MINE);
  return [...rest, { ...(old || {}), ...team }];
}
