/* Your team's Azure DevOps area paths (docs/teams.md): collection `teams` in Settings' folder (settings.teams v1),
   like the people directory. The People app edits it through the SDK's `ws.teams`; Runway's ADO roadmaps and the
   Loom hub read it with {app: 'settings'}. A team whose areas are in more than one collection keeps a
   connection per area (`areaConnections`); groups() splits the areas into one read per connection. Version 1 has one team, t_mine. Pure, no DOM or SDK
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

/** Area path to connection name, kept only for paths in `areas` and only where a name is set. */
export function cleanAreaConnections(map, areas) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const a of areas) {
    const c = typeof map[a] === 'string' ? map[a].trim().slice(0, 120) : '';
    if (c) out[a] = c;
  }
  return out;
}

/** Your team from the envelope: {name, areas, connection, areaConnections}, empty when none. */
export function mine(env) {
  const t = env && Array.isArray(env.items) ? env.items.find(x => x && x.id === MINE) : null;
  const areas = t && Array.isArray(t.areas) ? t.areas.filter(a => typeof a === 'string' && a) : [];
  return {
    name: t && typeof t.name === 'string' && t.name ? t.name : 'My team',
    areas,
    connection: t && typeof t.connection === 'string' ? t.connection : '',
    areaConnections: cleanAreaConnections(t && t.areaConnections, areas)
  };
}

/** The connection an area path is read on: its own, else the team's ('' means the connector's default). */
export const connectionOfArea = (team, area) => ((team && team.areaConnections) || {})[area] || (team && team.connection) || '';

/**
 * The team's area paths grouped by connection, in the order the areas are listed: [{connection, areas}]. One ADO
 * read per group (docs/teams.md, rule 3). `connection` '' is the connector's default.
 */
export function groups(team) {
  const out = [];
  for (const a of (team && team.areas) || []) {
    const c = connectionOfArea(team, a);
    const g = out.find(x => x.connection === c);
    if (g) g.areas.push(a); else out.push({ connection: c, areas: [a] });
  }
  return out;
}

/**
 * The connection for an area path that may sit under one of the team's: the deepest team area it is under (ADO
 * paths are backslash separated and case-insensitive), else the team's connection.
 */
export function connectionForPath(team, path) {
  const key = p => String(p || '').split('\\').map(x => x.trim()).filter(Boolean).join('\\').toLowerCase();
  const k = key(path);
  let best = null;
  for (const a of (team && team.areas) || []) {
    const r = key(a);
    if (r && (k === r || k.startsWith(r + '\\')) && (!best || r.length > key(best).length)) best = a;
  }
  return best ? connectionOfArea(team, best) : ((team && team.connection) || '');
}

/** Puts your team into a copy of the envelope's items (the caller stamps and saves). Without `areaConnections`
    the saved ones are kept for paths still listed. */
export function withMine(items, { areas, connection, areaConnections }) {
  const old = (items || []).find(x => x && x.id === MINE);
  const list = parseAreas(Array.isArray(areas) ? areas.join('\n') : areas);
  const team = {
    id: MINE, name: 'My team', areas: list,
    connection: String(connection || '').trim().slice(0, 120),
    areaConnections: cleanAreaConnections(areaConnections === undefined ? old && old.areaConnections : areaConnections, list)
  };
  const rest = (items || []).filter(x => x && x.id !== MINE);
  return [...rest, { ...(old || {}), ...team }];
}
