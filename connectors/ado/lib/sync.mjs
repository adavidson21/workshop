// "sync" and "sync.prs": ports of sync() and sync_prs() in Docket's ado-helper/ado_helper.py.
// Output matches the helper's JSON so Prioritizer can switch from the helper to the agent unchanged.
import { AdoError, clientFor } from './client.mjs';
import { syncConnection, resolveConnection } from './config.mjs';
import { day, get, or, person, pyQuote, truthy, wiqlList } from './util.mjs';

/** One work item in the helper's shape. */
export function shape(w, base) {
  const f = w.fields || {};
  const project = get(f, 'System.TeamProject', '');
  const link = or(get(get(or(get(w, '_links'), {}), 'html') || {}, 'href'),
    `${base}/${pyQuote(project)}/_workitems/edit/${w.id}`);
  return {
    id: w.id,
    title: get(f, 'System.Title', ''),
    type: get(f, 'System.WorkItemType', ''),
    state: get(f, 'System.State', ''),
    project,
    assignedTo: person(get(f, 'System.AssignedTo')),
    priority: get(f, 'Microsoft.VSTS.Common.Priority'),
    due: day(or(get(f, 'Microsoft.VSTS.Scheduling.DueDate'), get(f, 'Microsoft.VSTS.Scheduling.TargetDate'))),
    changed: get(f, 'System.ChangedDate'),
    url: link
  };
}

/** Same filtering the helper applied to the request body. */
export function cleanKnown(known) {
  return (Array.isArray(known) ? known : [])
    .filter(x => (typeof x === 'number' && Number.isInteger(x) && x >= 0) || (typeof x === 'string' && /^\d+$/.test(x)))
    .map(Number).slice(0, 5000);
}

export function cleanKnownPrs(knownPrs) {
  return (Array.isArray(knownPrs) ? knownPrs : []).filter(x => typeof x === 'string').map(x => x.slice(0, 500)).slice(0, 2000);
}

/**
 * Open items assigned to me, plus what happened to known items that dropped off.
 * @param {object} d {cfg, env, signal, now}
 */
export async function sync(d, known, knownPrs, { prs = true } = {}) {
  const { cfg } = d;
  const ado = clientFor(syncConnection(cfg), d.env, d.signal);
  const types = wiqlList(cfg.types);
  const done = wiqlList([...cfg.closedStates, ...cfg.removedStates]);
  const mine = await ado.wiql(`[System.AssignedTo] = @Me AND [System.WorkItemType] IN (${types}) AND [System.State] NOT IN (${done})`);
  const mineSet = new Set(mine);
  const dropped = known.filter(i => !mineSet.has(i));
  const info = await ado.details([...mine, ...dropped]);
  const items = mine.filter(i => info.has(i)).map(i => shape(info.get(i), ado.base));
  const gone = [];
  for (const i of dropped) {
    const w = info.get(i);
    if (!w) {
      gone.push({ id: i, reason: 'missing' });
      continue;
    }
    const s = shape(w, ado.base);
    if (cfg.closedStates.includes(s.state)) s.reason = 'closed';
    else if (cfg.removedStates.includes(s.state)) s.reason = 'removed';
    else if (!cfg.types.includes(s.type)) s.reason = 'filtered';
    else s.reason = 'reassigned';
    gone.push(s);
  }
  const out = { items, gone, syncedAt: (d.now || new Date()).toISOString() };
  if (prs && cfg.prSources.length) {
    try {
      out.prs = await syncPrs(d, knownPrs);
    } catch (e) {
      if (!(e instanceof AdoError)) throw e;
      out.prError = e.message;
    }
  }
  return out;
}

// ---------------------------------------------------------------- pull requests
//
// Tiers (how much a PR is waiting on you):
//   blocking  you were added by name as a Required reviewer
//   asked     you were added by name, optional
//   pool      only one of your teams was added, so any teammate can take it
// Your vote decides whether it is on you: none = to review, "Waiting for author" = waiting,
// Approve / Approve with suggestions / Reject = done. For team-only PRs, a teammate voting for
// the team also counts as done.
// Not needed (cfg.prNotNeeded): a PR you are not required on drops off when it is team-only, every
// required reviewer already approved, or enough other people approved. It never shows in Docket or
// Dispatch, and a known one is reported gone with reason "notneeded".

const SUGGEST = 5;
const WAITING = -5;

export function prKey(base, project, pid) {
  return `${base.replace(/\/+$/, '')}|${project}|${pid}`;
}

class PrSource {
  constructor(d, src) {
    const conn = resolveConnection(d.cfg, { connection: src.connection }).connection;
    this.d = d;
    this.ado = clientFor(conn, d.env, d.signal);
    this.base = this.ado.base;
    this.project = src.project;
    this.repos = new Set((src.repos || []).map(r => r.toLowerCase()));
    this.me = null;
    this.teams = new Map(); // id -> name
    this.teamError = null;
  }

  /** Who am I here, and which teams am I on. */
  async identify() {
    for (const url of [this.base, this.base.split('/').slice(0, 3).join('/')]) { // collection, then server root
      try {
        const res = await this.ado.at(url).call('GET', 'connectionData', { api: '1.0' });
        this.me = get(or(res.authenticatedUser, {}), 'id');
      } catch (e) {
        if (!(e instanceof AdoError)) throw e;
        continue;
      }
      if (this.me) break;
    }
    if (!this.me) throw new AdoError(`Could not tell who you are on ${this.base}.`);
    const wanted = new Set(this.d.cfg.prTeams.map(t => t.toLowerCase()));
    try {
      const res = await this.ado.call('GET', `projects/${pyQuote(this.project)}/teams`, { query: { $mine: 'true', $top: 500 } });
      for (const t of res.value || []) {
        if (!wanted.size || wanted.has(String(t.name).toLowerCase())) this.teams.set(t.id, t.name);
      }
    } catch (e) {
      if (!(e instanceof AdoError)) throw e;
      this.teamError = e.message; // still works for PRs you are named on
    }
  }

  /** Active PRs where you or one of your teams is a reviewer, as a Map by PR id. */
  async active() {
    const out = new Map();
    for (const rid of [this.me, ...this.teams.keys()]) {
      const res = await this.ado.call('GET', 'git/pullrequests', {
        project: this.project,
        query: { 'searchCriteria.status': 'active', 'searchCriteria.reviewerId': rid, $top: 500 }
      });
      for (const pr of res.value || []) {
        if (this.repos.size && !this.repos.has(String(get(or(pr.repository, {}), 'name') || '').toLowerCase())) continue;
        out.set(pr.pullRequestId, pr);
      }
    }
    return out;
  }

  async one(pid) {
    try {
      return await this.ado.call('GET', `git/pullrequests/${pid}`, { project: this.project });
    } catch (e) {
      if (e instanceof AdoError && e.upstream === 404) return null;
      throw e;
    }
  }

  /** [status, info]. status: review, waiting, reviewed, covered, notneeded, unassigned, draft, own, merged, abandoned. */
  classify(pr) {
    const revs = pr.reviewers || [];
    const mine = revs.find(r => r.id === this.me) || null;
    const teams = revs.filter(r => this.teams.has(r.id));
    const repo = get(or(pr.repository, {}), 'name', '');
    const reqOthers = revs.filter(r => r.isRequired && r.id !== this.me);
    const info = {
      key: prKey(this.base, this.project, pr.pullRequestId),
      id: pr.pullRequestId,
      title: get(pr, 'title', ''),
      repo,
      project: this.project,
      author: person(get(pr, 'createdBy')),
      created: day(get(pr, 'creationDate')),
      url: `${this.base}/${pyQuote(this.project)}/_git/${pyQuote(repo)}/pullrequest/${pr.pullRequestId}`,
      // the PR's latest source commit: Dispatch's Review all skips PRs already reviewed at it
      commit: get(or(pr.lastMergeSourceCommit, {}), 'commitId') || null,
      tier: mine && mine.isRequired ? 'blocking' : mine ? 'asked' : 'pool',
      via: teams.map(r => this.teams.get(r.id)),
      // every other required reviewer already approved: you are the last one holding it up
      lastBlocker: Boolean(mine && mine.isRequired && reqOthers.every(r => (r.vote ?? 0) >= SUGGEST))
    };
    const status = pr.status;
    if (status === 'completed') return ['merged', info];
    if (status === 'abandoned') return ['abandoned', info];
    if (get(or(pr.createdBy, {}), 'id') === this.me) return ['own', info];
    if (pr.isDraft) return ['draft', info];
    if (!mine && !teams.length) return ['unassigned', info];
    const vote = mine ? (mine.vote ?? 0) : 0;
    if (vote === WAITING) return ['waiting', info];
    if (truthy(vote)) return ['reviewed', info];
    const teamIds = new Set(teams.map(r => r.id));
    const votedForTeam = revs.some(r => truthy(r.vote ?? 0) && (r.votedFor || []).some(v => teamIds.has(v.id)));
    if (!mine && (votedForTeam || teams.some(r => truthy(r.vote ?? 0)))) return ['covered', info];
    const why = this.notNeeded(revs, mine, reqOthers);
    if (why) { info.notNeeded = why; return ['notneeded', info]; }
    return ['review', info];
  }

  /** Why a PR does not need you (team, merge, approvals), or null. Never when you are a required reviewer. */
  notNeeded(revs, mine, reqOthers) {
    const nn = this.d.cfg.prNotNeeded;
    if (!nn || (mine && mine.isRequired)) return null;
    if (!mine && nn.teamOnly) return 'team';
    const ok = r => (r.vote ?? 0) >= SUGGEST;
    if (nn.canMerge && reqOthers.length && reqOthers.every(ok)) return 'merge';
    const people = revs.filter(r => r.id !== this.me && !r.isContainer && !this.teams.has(r.id) && ok(r));
    if (nn.approvals > 0 && people.length >= nn.approvals) return 'approvals';
    return null;
  }
}

/** PRs on you now, plus what happened to known PRs that dropped off. */
export async function syncPrs(d, knownList) {
  const items = [];
  const gone = [];
  const notes = [];
  let notNeeded = 0;
  const known = [...new Set(knownList)];
  const knownSet = new Set(known);
  for (const src of d.cfg.prSources) {
    const ps = new PrSource(d, src);
    await ps.identify();
    if (ps.teamError) notes.push(`Team-only PRs skipped for ${ps.project}: ${ps.teamError}`);
    const active = await ps.active();
    const seen = new Set();
    for (const pr of active.values()) {
      const [st, info] = ps.classify(pr);
      if (st === 'notneeded') notNeeded++;
      if (st === 'review' || st === 'waiting') {
        info.waiting = st === 'waiting';
        items.push(info);
        seen.add(info.key);
      } else if (knownSet.has(info.key)) {
        info.reason = st;
        gone.push(info);
        seen.add(info.key);
      }
    }
    const prefix = prKey(ps.base, ps.project, '');
    for (const key of known) {
      if (seen.has(key) || !key.startsWith(prefix)) continue;
      const pid = key.slice(prefix.length);
      const pr = /^\d+$/.test(pid) ? await ps.one(parseInt(pid, 10)) : null;
      if (!pr) {
        gone.push({ key, reason: 'missing' });
        continue;
      }
      const [st, info] = ps.classify(pr);
      if (st === 'review' || st === 'waiting') { // repo filter or paging missed it; still yours
        info.waiting = st === 'waiting';
        items.push(info);
      } else {
        info.reason = st;
        gone.push(info);
      }
    }
  }
  return { items, gone, notes, notNeeded };
}

/**
 * "areas.mine": the area paths of your open work items (the same items sync reads), with how many items sit in
 * each, most first. For Settings' Team area paths "Suggest from ADO". Read only. Resolves {areas: [{path, count}]}.
 */
export async function areasMine(d) {
  const { cfg } = d;
  const ado = clientFor(syncConnection(cfg), d.env, d.signal);
  const types = wiqlList(cfg.types);
  const done = wiqlList([...cfg.closedStates, ...cfg.removedStates]);
  const mine = await ado.wiql(`[System.AssignedTo] = @Me AND [System.WorkItemType] IN (${types}) AND [System.State] NOT IN (${done})`);
  const info = await ado.details(mine.slice(0, 500));
  const counts = new Map();
  for (const w of info.values()) {
    const a = get(w.fields || {}, 'System.AreaPath', '');
    if (a) counts.set(a, (counts.get(a) || 0) + 1);
  }
  return { areas: [...counts].map(([path, count]) => ({ path, count })).sort((x, y) => y.count - x.count || x.path.localeCompare(y.path)).slice(0, 50) };
}
