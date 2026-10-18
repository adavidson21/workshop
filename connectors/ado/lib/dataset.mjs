// "dataset": port of dataset() in prioritizer/ado-helper/ado_helper.py.
//
// Read-only raw data for the Reports view, for a whole team rather than just you. The app computes
// every report from this one pull, so new reports need no connector change.
//   items       items in scope changed in the window, plus every open item in scope
//   events      priority, iteration (sprint), assignment and state changes in the window, and creations
//   iterations  sprint start and finish dates for the projects involved
// Scope is area paths (UNDER) and/or people (Assigned To), sent by the app. Collections are limited to
// configured connections, so a page can never point a PAT at another server.
import { AdoError, SettingsError, clientFor } from './client.mjs';
import { connectionForBase, resolveConnection, syncConnection } from './config.mjs';
import { shape } from './sync.mjs';
import { asInt, cleanList, day, email, get, isoSeconds, mapLimit, or, person, truthy, who, wiqlList } from './util.mjs';

const PRIORITY = 'Microsoft.VSTS.Common.Priority';
const ITERATION = 'System.IterationPath';
const ASSIGNED = 'System.AssignedTo';
const STATE = 'System.State';

async function updates(ado, wid) {
  const out = [];
  let skip = 0;
  for (;;) {
    const res = await ado.call('GET', `wit/workItems/${wid}/updates`, { query: { $top: 200, $skip: skip } });
    const page = res.value || [];
    out.push(...page);
    if (page.length < 200 || skip > 5000) return out;
    skip += 200;
  }
}

const nv = (f, k) => get(or(get(f, k), {}), 'newValue');

/** Changes in the window from one item's update history. */
export function eventsOf(wid, ups, since) {
  const out = [];
  for (const u of ups) {
    const f = or(u.fields, {});
    const when = or(nv(f, 'System.ChangedDate'), nv(f, 'System.AuthorizedDate'), get(u, 'revisedDate'), '');
    if (!when || when.slice(0, 4) === '9999' || when < since) continue;
    const by = or(person(nv(f, 'System.ChangedBy')), person(get(u, 'revisedBy')));
    const base = { id: wid, date: when.slice(0, 19), by };
    if (get(u, 'rev') === 1) {
      out.push({ ...base, kind: 'created', priority: asInt(nv(f, PRIORITY)), iteration: nv(f, ITERATION), to: who(nv(f, ASSIGNED)) });
      continue;
    }
    const p = get(f, PRIORITY);
    if (truthy(p) && Object.hasOwn(p, 'oldValue') && asInt(p.oldValue) !== null && asInt(get(p, 'newValue')) !== null) {
      out.push({ ...base, kind: 'priority', from: asInt(p.oldValue), to: asInt(p.newValue) });
    }
    const it = get(f, ITERATION);
    if (truthy(it) && truthy(it.oldValue) && truthy(it.newValue) && it.oldValue !== it.newValue) {
      out.push({ ...base, kind: 'iteration', from: it.oldValue, to: it.newValue });
    }
    const a = get(f, ASSIGNED);
    if (truthy(a) && (Object.hasOwn(a, 'oldValue') || Object.hasOwn(a, 'newValue')) && person(get(a, 'oldValue')) !== person(get(a, 'newValue'))) {
      out.push({ ...base, kind: 'assigned', from: who(get(a, 'oldValue')), to: who(get(a, 'newValue')) });
    }
    const st = get(f, STATE);
    if (truthy(st) && truthy(st.oldValue) && truthy(st.newValue) && st.oldValue !== st.newValue) {
      out.push({ ...base, kind: 'state', from: st.oldValue, to: st.newValue });
    }
  }
  return out;
}

/** Sprint dates for one project, keyed by the iteration path work items use (Project\Sprint). */
async function iterations(ado, project) {
  const out = {};
  let res;
  try {
    res = await ado.call('GET', 'wit/classificationnodes/Iterations', { project, query: { $depth: 10 } });
  } catch (e) {
    if (e instanceof AdoError) return out;
    throw e;
  }
  const walk = node => {
    let parts = String(get(node, 'path') || '').split('\\').filter(Boolean);
    if (parts.length >= 2 && parts[1].toLowerCase() === 'iteration') parts = [parts[0], ...parts.slice(2)];
    const attrs = or(get(node, 'attributes'), {});
    if (parts.length > 1 && truthy(attrs.startDate) && truthy(attrs.finishDate)) {
      out[parts.join('\\')] = { start: day(attrs.startDate), finish: day(attrs.finishDate) };
    }
    for (const c of or(get(node, 'children'), [])) walk(c);
  };
  walk(res);
  return out;
}

/** Which connection a dataset request is for: `connection` by name, `base` as the helper took it, else my work items' connection. */
function pick(cfg, req) {
  if (req.connection) return resolveConnection(cfg, { connection: req.connection }).connection;
  if (req.base) {
    const c = connectionForBase(cfg, req.base);
    if (!c) throw new SettingsError('That collection is not one of your ADO connections. Add it in Settings first.');
    return c;
  }
  return syncConnection(cfg);
}

/** @param {object} d {cfg, env, signal, now} */
export async function dataset(d, req) {
  const { cfg } = d;
  const days = Math.max(7, Math.min(180, asInt(req.days) || 42));
  const conn = pick(cfg, req);
  const areas = cleanList(req.areas, 25);
  const people = cleanList(req.people, 60);
  if (!areas.length && !people.length) throw new SettingsError('Add at least one area path or person to your team profile.');
  const ado = clientFor(conn, d.env, d.signal);
  const rc = cfg.reports;
  const types = wiqlList(rc.workloadTypes.length ? rc.workloadTypes : cfg.types);
  const done = wiqlList([...cfg.closedStates, ...cfg.removedStates]);
  const scope = [...areas.map(a => `[System.AreaPath] UNDER ${wiqlList([a])}`),
    ...(people.length ? [`[System.AssignedTo] IN (${wiqlList(people)})`] : [])].join(' OR ');
  const now = d.now || new Date();
  const since = isoSeconds(new Date(now.getTime() - days * 86400000));

  let changed = await ado.wiql(`[System.WorkItemType] IN (${types}) AND (${scope}) AND [System.ChangedDate] >= @Today - ${days}`);
  let openIds = await ado.wiql(`[System.WorkItemType] IN (${types}) AND (${scope}) AND [System.State] NOT IN (${done})`);
  const cap = rc.maxItems;
  const truncated = changed.length > cap || openIds.length > 3 * cap;
  changed = changed.slice(0, cap);
  openIds = openIds.slice(0, 3 * cap);
  const ids = [...new Set([...changed, ...openIds])];
  const info = await ado.details(ids);

  const chunks = await mapLimit(changed, 6, async i => eventsOf(i, await updates(ado, i), since));
  const evs = chunks.flat();
  evs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const items = [];
  const withHistory = new Set(changed);
  for (const i of ids) {
    const w = info.get(i);
    if (!w) continue;
    const f = w.fields || {};
    const s = shape(w, ado.base);
    const field = rc.effortFields.find(k => get(f, k) !== null) || null;
    Object.assign(s, {
      assignedEmail: email(get(f, ASSIGNED)),
      area: get(f, 'System.AreaPath', ''),
      iteration: get(f, ITERATION, ''),
      created: day(get(f, 'System.CreatedDate')),
      createdBy: person(get(f, 'System.CreatedBy')),
      closed: day(get(f, 'Microsoft.VSTS.Common.ClosedDate')),
      changed: day(get(f, 'System.ChangedDate')),
      effort: field ? get(f, field) : null,
      effortField: field ? field.split('.').pop() : '',
      tags: get(f, 'System.Tags', ''),
      history: withHistory.has(i)
    });
    items.push(s);
  }

  const projects = [...new Set(items.map(it => it.project).filter(truthy))].sort();
  const its = {};
  for (const p of projects.slice(0, 10)) Object.assign(its, await iterations(ado, p));

  return {
    schema: 1,
    days,
    since: since.slice(0, 10),
    base: ado.base,
    connection: conn.name,
    areas,
    people,
    truncated,
    scanned: changed.length,
    config: {
      highPriorities: (rc.highPriorities.length ? rc.highPriorities : ['1', '2']).map(p => parseInt(p, 10)).filter(Number.isInteger),
      escalationPriority: rc.escalationPriority,
      bugTypes: rc.bugTypes.length ? rc.bugTypes : ['Bug'],
      closedStates: cfg.closedStates,
      removedStates: cfg.removedStates
    },
    items,
    events: evs,
    iterations: its,
    generatedAt: now.toISOString()
  };
}
