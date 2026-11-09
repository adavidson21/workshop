/* Settings: the pages and how connector fields are spread across them. Pure, no DOM, so test/pages.test.mjs
   can import it. settings.js draws the nav and the pages from this.

   The nav is grouped by task, not by connector. A connector's top-level config fields go on its main page
   unless the field says otherwise with `x-workshop-page` (docs/connector.md). Fields Settings draws itself
   (ADO connections, repo mapping, PR sources, opencode hidden folders) are listed in CUSTOM and left out of the generated forms. A new
   connector needs no change here: its fields land on its own page, `c-<id>`, in the Connectors group. */

export const GROUPS = [
  { id: 'workshop', label: 'Workshop' },
  { id: 'people', label: 'People & teams' },
  { id: 'ado', label: 'Azure DevOps', connector: 'ado' },
  { id: 'code', label: 'Code & agents', connector: 'opencode' },
  { id: 'connectors', label: 'Connectors' }
];

// owner: the connector a page belongs to. Its fields are only shown while that connector is set up.
export const PAGES = {
  overview: { label: 'Overview', group: 'workshop' },
  apps: { label: 'Apps', group: 'workshop' },
  focus: { label: 'Focus hours', group: 'workshop' },
  computer: { label: 'This computer', group: 'workshop' },
  data: { label: 'Data & backups', group: 'workshop' },
  people: { label: 'People & groups', group: 'people' },
  team: { label: 'Team area paths', group: 'people' },
  connections: { label: 'Connections', group: 'ado', owner: 'ado' },
  'work-items': { label: 'Work items', group: 'ado', owner: 'ado' },
  'pull-requests': { label: 'Pull requests', group: 'ado', owner: 'ado' },
  repos: { label: 'Repos', group: 'code' },
  agents: { label: 'Agents', group: 'code', owner: 'opencode' }
};
export const ORDER = Object.keys(PAGES);

// A connector's main page: its switch, status and the fields with no x-workshop-page.
const MAIN = { ado: 'connections', opencode: 'agents' };
export const mainPageOf = id => MAIN[id] || `c-${id}`;

// Top-level fields Settings draws itself rather than with the generated form.
export const CUSTOM = { ado: ['connections', 'paths', 'prSources'], opencode: ['hiddenRepos'] };

/** The page a top-level field goes on. `x-workshop-tab` is the older name of `x-workshop-page`. */
export function pageOfField(connId, prop) {
  const p = prop && (prop['x-workshop-page'] || prop['x-workshop-tab']);
  return p && PAGES[p] ? p : mainPageOf(connId);
}

/** The top-level keys of a connector's config that its generated form shows on `page`, in schema order. */
export function formKeys(connId, schema, page) {
  const props = (schema && schema.properties) || {};
  const custom = new Set(CUSTOM[connId] || []);
  return Object.keys(props).filter(k => !custom.has(k) && pageOfField(connId, props[k]) === page);
}

/** Every page a connector's generated form puts fields on. */
export function formPages(connId, schema) {
  const props = (schema && schema.properties) || {};
  const custom = new Set(CUSTOM[connId] || []);
  return [...new Set(Object.keys(props).filter(k => !custom.has(k)).map(k => pageOfField(connId, props[k])))];
}

/** The schema cut down to `keys`, for one page's form. */
export function subSchema(schema, keys) {
  const props = (schema && schema.properties) || {};
  return {
    ...schema,
    properties: Object.fromEntries(keys.filter(k => props[k]).map(k => [k, props[k]])),
    required: (schema.required || []).filter(k => keys.includes(k))
  };
}

/** Save one page: the connector's config as it is now, with only this page's keys replaced. */
export function mergeKeys(fresh, keys, value) {
  const out = { ...(fresh || {}) };
  for (const k of keys) {
    if (value[k] === undefined) delete out[k];
    else out[k] = value[k];
  }
  return out;
}

/**
 * Where a connector stands, for the nav, Overview and the pages that depend on it.
 *   missing  not installed          off    installed, switched off
 *   empty    on, nothing to talk to (ADO: no connection)
 *   error    on and set up, but not working        ready   working
 */
export function connectorState(info, config) {
  if (!info) return 'missing';
  if (!info.enabled) return 'off';
  if (info.id === 'ado' && !(config && Array.isArray(config.connections) && config.connections.length)) return 'empty';
  return info.status && info.status.state === 'error' ? 'error' : 'ready';
}

/** One Overview row: a word for the state, the connector's message, and what the link does. */
export function statusRow(info, config) {
  const state = connectorState(info, config);
  const message = (info && info.status && info.status.message) || '';
  if (state === 'off') return { state, label: 'Off', message: '', action: 'Set up' };
  if (state === 'empty') return { state, label: 'Not set up', message: '', action: 'Set up' };
  if (state === 'error') return { state, label: 'Needs attention', message, action: 'Fix' };
  if (info && info.status && info.status.state === 'starting') return { state, label: 'Starting', message, action: '' };
  return { state, label: 'Ready', message, action: message ? 'Check' : '' };
}

/** The one line a page shows instead of its form when the connector it belongs to is not set up. */
export function gateNote(state, name, mainLabel) {
  if (state === 'off') return `${name} is off. Turn it on in ${mainLabel}.`;
  if (state === 'empty') return `Add a connection first, in ${mainLabel}.`;
  return '';
}

// Old addresses: the tabs before the nav, and the People app's routes (#/people/... opens Settings now).
const OLD = { general: 'overview', 'c-ado': 'connections', 'c-opencode': 'agents' };

/** The page (and part of it) a route opens, or null. `#/settings/<page>`. */
export function routeToPage(path) {
  const [a, b] = String(path || '').split('/').filter(Boolean);
  if (!a) return null;
  if (a === 'people') {
    if (b === 'you') { const c = String(path || '').split('/').filter(Boolean)[2]; let name = ''; try { name = c ? decodeURIComponent(c) : ''; } catch { name = ''; } return { page: 'people', focus: 'you', name: name.slice(0, 200) }; }
    return b === 'team' ? { page: 'team' } : b === 'import' ? { page: 'people', focus: 'import' } : { page: 'people' };
  }
  if (a === 'import') return { page: 'people', focus: 'import' };
  return { page: OLD[a] || a };
}
