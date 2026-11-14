/* Settings: the pages and how connector fields are spread across them. Pure, no DOM, so test/pages.test.mjs
   can import it. settings.js draws the nav and the pages from this.

   The nav is grouped by task, not by connector. A connector's top-level config fields go on its main page
   unless the field says otherwise with `x-workshop-page` (docs/connector.md). Fields Settings draws itself
   (ADO connections, repo mapping, PR sources, opencode hidden folders) are listed in CUSTOM and left out of the generated forms. A new
   connector needs no change here: its fields land on its own page, `c-<id>`, in the Connections group.

   A nav item can hold several pages as tabs (NAV): People & teams, Writing voice, Azure DevOps. Page ids stay
   the same either way, so routes, `x-workshop-page` values and saved page ids never change. */

export const GROUPS = [
  { id: 'workshop', label: 'Workshop' },
  { id: 'you', label: 'You & your team' },
  { id: 'connections', label: 'Connections' }
];

// owner: the connector a page belongs to. Its fields are only shown while that connector is set up.
// nav: the nav item a page is a tab of (NAV below). A page with no nav is a nav item of its own.
// hidden: no nav item (opened by its route or a link), like the User guide.
export const PAGES = {
  overview: { label: 'Status', group: 'workshop' },
  apps: { label: 'Apps', group: 'workshop' },
  computer: { label: 'This computer', group: 'workshop' },
  data: { label: 'Data & backups', group: 'workshop' },
  people: { label: 'People & groups', group: 'you', nav: 'people-teams' },
  team: { label: 'Team area paths', group: 'you', nav: 'people-teams' },
  products: { label: 'Products', group: 'you' },
  focus: { label: 'Focus hours', group: 'you' },
  'writing-voice': { label: 'Voice', group: 'you', nav: 'writing' },
  'writing-audiences': { label: 'Audiences', group: 'you', nav: 'writing' },
  'writing-rules': { label: 'Rules', group: 'you', nav: 'writing' },
  connections: { label: 'Connections', group: 'connections', owner: 'ado', nav: 'ado' },
  'work-items': { label: 'Work items', group: 'connections', owner: 'ado', nav: 'ado' },
  'pull-requests': { label: 'Pull requests', group: 'connections', owner: 'ado', nav: 'ado' },
  agents: { label: 'opencode', group: 'connections', owner: 'opencode' },
  repos: { label: 'Repos', group: 'connections' },
  guide: { label: 'User guide', group: 'workshop', hidden: true }
};
export const ORDER = Object.keys(PAGES);

// Nav items that hold more than one page, as tabs. dot: the connector whose state shows on the nav item.
export const NAV = {
  'people-teams': { label: 'People & teams' },
  writing: { label: 'Writing voice' },
  ado: { label: 'Azure DevOps', dot: 'ado' }
};
// A page that is a nav item of its own and shows a connector's state.
const PAGE_DOT = { agents: 'opencode' };

/** The nav item a page is shown under: its `nav`, else the page itself. */
export const navOf = id => (PAGES[id] && PAGES[id].nav) || id;
/** The pages of a nav item, in order. Unknown ids are a nav item of one page. */
export function tabsOf(nav) {
  const l = ORDER.filter(id => navOf(id) === nav);
  return l.length ? l : [nav];
}
/** The connector whose state shows on a nav item, or ''. */
export const dotOf = nav => (NAV[nav] && NAV[nav].dot) || PAGE_DOT[nav] || '';
/** A nav item's label: NAV's for a tabbed one, else its page's. */
export const navLabel = (nav, fallback) => (NAV[nav] && NAV[nav].label) || (PAGES[nav] && PAGES[nav].label) || fallback || nav;

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
 * Where a connector stands, for the nav, Status and the pages that depend on it.
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

/** One Status row: a word for the state, the connector's message, and what the link does. */
export function statusRow(info, config) {
  const state = connectorState(info, config);
  const message = (info && info.status && info.status.message) || '';
  if (state === 'off') return { state, label: 'Off', message: '', action: 'Set up' };
  if (state === 'empty') return { state, label: 'Not set up', message: '', action: 'Set up' };
  if (state === 'error') return { state, label: 'Needs attention', message, action: 'Fix' };
  if (info && info.status && info.status.state === 'starting') return { state, label: 'Starting', message, action: '' };
  return { state, label: 'Ready', message, action: message ? 'Check' : '' };
}

/**
 * Status's Needs you banner: one line per connector that is set up and broken (Fix) or set up with a warning,
 * such as a PAT that expires soon (Check). Off, not installed and not set up never show here.
 * rows: [{info, config}] -> [{id, name, message, action, page}]
 */
export function needsYou(rows) {
  const out = [];
  for (const { info, config } of rows || []) {
    if (!info) continue;
    const r = statusRow(info, config);
    if (r.state === 'error' || (r.state === 'ready' && r.action === 'Check')) {
      out.push({ id: info.id, name: info.name || info.id, message: r.message || 'Needs attention.', action: r.action, page: mainPageOf(info.id) });
    }
  }
  return out.sort((a, b) => (a.action === 'Fix' ? 0 : 1) - (b.action === 'Fix' ? 0 : 1));
}

/** The one line a page shows instead of its form when the connector it belongs to is not set up. */
export function gateNote(state, name, mainLabel) {
  if (state === 'off') return `${name} is off. Turn it on in ${mainLabel}.`;
  if (state === 'empty') return `Add a connection first, in ${mainLabel}.`;
  return '';
}

// Old addresses: the tabs before the nav, and the People app's routes (#/people/... opens Settings now).
const OLD = { general: 'overview', status: 'overview', 'c-ado': 'connections', 'c-opencode': 'agents', opencode: 'agents', ado: 'connections' };

/** The page (and part of it) a route opens, or null. `#/settings/<page>`. */
export function routeToPage(path) {
  const [a, b] = String(path || '').split('/').filter(Boolean);
  if (!a) return null;
  if (a === 'people') {
    if (b === 'you') { const c = String(path || '').split('/').filter(Boolean)[2]; let name = ''; try { name = c ? decodeURIComponent(c) : ''; } catch { name = ''; } return { page: 'people', focus: 'you', name: name.slice(0, 200) }; }
    return b === 'team' ? { page: 'team' } : b === 'import' ? { page: 'people', focus: 'import' } : { page: 'people' };
  }
  if (a === 'writing' || a === 'voice') return { page: 'writing-voice' };
  if (a === 'import') return { page: 'people', focus: 'import' };
  return { page: OLD[a] || a };
}
