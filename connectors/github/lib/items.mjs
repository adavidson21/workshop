// Work items for Loom: "backlog", "workitem.get" (by number), "workitem.find", "workitem.prs", "workitem.update" and
// "workitem.create", in the ADO connector's shapes.
//
// How Loom names a GitHub item: Loom keys items by a number plus a connection, like ADO (ids are unique only within
// a collection). For GitHub the connection is the repo, "owner/repo", and the number is the issue number, so Loom's
// numeric ids work unchanged. A connection name never has a slash (the settings pattern forbids it), so a
// `connection` with one is always a repo. Epics are milestones (the GitHub tracker plan): an Epic's id is the
// milestone number made negative, so it never collides with an issue number in the same repo.
//
// Writes: workitem.update and workitem.create have `write: true` in index.mjs, so the agent runs them only with
// `confirm: true` from a person's click. "Resolved" has no GitHub state: it is a `resolved` label on an open issue.
import { ConflictError, GhError, SettingsError, clientFor } from './client.mjs';
import { REPO_RE, TYPE_LABELS, pickConnection } from './config.mjs';
import { areaOf, priorityOf, splitBody, typeOf } from './issues.mjs';
import { parseArea, releaseNoteOf } from './roadmap.mjs';

export const isRepo = c => REPO_RE.test(String(c || ''));
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const revOf = updated => { const t = Date.parse(updated || ''); return Number.isFinite(t) ? t : 0; };
const labelsOf = i => (i.labels?.nodes || i.labels || []).map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
const lc = s => String(s || '').toLowerCase();

/** Loom's type names: Story is "User Story". */
export const loomType = labels => { const t = typeOf(labels); return t === 'Story' ? 'User Story' : t; };
/** The label a type gets on create, or '' for a plain Issue. */
export function typeLabel(type) {
  const t = lc(type);
  if (t === 'user story' || t === 'product backlog item' || t === 'story') return 'story';
  return Object.keys(TYPE_LABELS).find(k => lc(TYPE_LABELS[k]) === t && k !== 'user story') || '';
}

const CLOSED = { closed: 'completed', done: 'completed', completed: 'completed', removed: 'not_planned', "won't do": 'not_planned', 'wont do': 'not_planned', cut: 'not_planned' };
export const RESOLVED = 'resolved';

/** {gh, conn, repo} for a call: a repo connection, else a named (or the default) connection with `repo`. */
function target(d, args = {}, { needRepo = true } = {}) {
  if (isRepo(args.connection)) return { gh: clientFor(pickConnection(d.cfg), d.env, d.signal), repo: args.connection };
  const conn = pickConnection(d.cfg, args.connection);
  const repo = isRepo(args.repo) ? args.repo : isRepo(args.project) ? args.project : d.cfg.repos.length === 1 ? d.cfg.repos[0] : '';
  if (needRepo && !repo) throw new SettingsError('Say which repo (owner/repo) the item is in.');
  return { gh: clientFor(conn, d.env, d.signal), repo };
}

const number = id => { const n = Number(id); if (!Number.isInteger(n) || n === 0) throw new SettingsError('Give the item as a number.'); return n; };

/** One issue (REST) in the shape workitem.update and workitem.create answer with. */
function written(i, repo, prefix) {
  const labels = labelsOf(i);
  return {
    id: i.number, rev: revOf(i.updated_at), type: loomType(labels), title: i.title || '',
    state: i.state === 'closed' ? 'Closed' : labels.some(l => lc(l) === RESOLVED) ? 'Resolved' : 'Open',
    reason: i.state_reason || '',
    assignee: (i.assignees || [])[0]?.login ? { name: i.assignees[0].login, email: '' } : null,
    priority: priorityOf(labels), iteration: i.milestone?.title || '', area: areaOf(repo, labels, prefix),
    project: repo, tags: labels, created: i.created_at || null, changed: i.updated_at || null, stateChanged: i.closed_at || null,
    connection: repo, url: i.html_url || ''
  };
}

function milestoneItem(m, repo) {
  return {
    id: -m.number, rev: revOf(m.updated_at), type: 'Epic', title: m.title || '', state: m.state === 'closed' ? 'Closed' : 'Open', reason: '',
    assignee: null, priority: null, iteration: '', area: repo, project: repo, tags: [], created: m.created_at || null, changed: m.updated_at || null,
    stateChanged: m.closed_at || null, connection: repo, url: m.html_url || '', targetDate: day(m.due_on), description: m.description || ''
  };
}

// ---------------------------------------------------------------- backlog

const BACKLOG_Q = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(first:100,after:$after,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){
  totalCount pageInfo{hasNextPage endCursor}
  nodes{number title url updatedAt labels(first:30){nodes{name}} assignees(first:5){nodes{login}} milestone{number title dueOn}
  parent{number repository{nameWithOwner}} comments{totalCount}}}}}`;

/** "backlog": open issues under the areas (owner/repo, or owner/repo/<area> for an area label), newest change first, at most 500. */
export async function backlogList(d, args = {}) {
  const areas = (Array.isArray(args.areas) ? args.areas : []).map(parseArea);
  if (!areas.length || areas.some(a => !a)) throw new SettingsError('Give each area as owner/repo or owner/repo/<area>.');
  const { gh } = target(d, { ...args, repo: areas[0].repo }, { needRepo: false });
  const prefix = d.cfg.areaLabelPrefix || '';
  const types = Array.isArray(args.types) && args.types.length ? new Set(args.types.map(t => (lc(t) === 'product backlog item' ? 'user story' : lc(t)))) : null;
  const byRepo = new Map();
  for (const a of areas) {
    const r = byRepo.get(a.repo) || { whole: false, labels: new Set() };
    if (a.area) r.labels.add(lc(a.area)); else r.whole = true;
    byRepo.set(a.repo, r);
  }
  const items = [];
  let total = 0, truncated = false;
  for (const [repo, want] of byRepo) {
    const [owner, name] = repo.split('/');
    let after = null;
    for (let page = 0; page < 10; page++) {
      const res = await gh.graphql(BACKLOG_Q, { owner, name, after });
      const conn = res?.repository?.issues;
      if (!conn) break;
      for (const i of conn.nodes || []) {
        const labels = labelsOf(i);
        const area = areaOf(repo, labels, prefix);
        const aName = area === repo ? '' : lc(area.slice(repo.length + 1));
        if (!want.whole && !want.labels.has(aName)) continue;
        const type = loomType(labels);
        if (types && !types.has(lc(type))) continue;
        total++;
        if (items.length >= 500) { truncated = true; continue; }
        const par = i.parent && i.parent.repository?.nameWithOwner === repo ? i.parent.number : null;
        items.push({
          id: i.number, rev: revOf(i.updatedAt), type, title: i.title || '', state: labels.some(l => lc(l) === RESOLVED) ? 'Resolved' : 'Open',
          area, iteration: i.milestone?.title || '', parentId: par ?? (i.milestone ? -i.milestone.number : null),
          assignee: i.assignees?.nodes?.[0]?.login ? { name: i.assignees.nodes[0].login, email: '' } : null,
          targetDate: day(i.milestone?.dueOn), startDate: null, changed: i.updatedAt || null, url: i.url || '',
          tags: labels, priority: priorityOf(labels), storyPoints: null, commentCount: i.comments?.totalCount || 0, connection: repo
        });
      }
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
  }
  items.sort((a, b) => String(b.changed || '').localeCompare(String(a.changed || '')));
  return { connection: byRepo.size === 1 ? [...byRepo.keys()][0] : '', items, total, truncated, fetchedAt: (d.now || new Date()).toISOString() };
}

// ---------------------------------------------------------------- one item

const PANEL_Q = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){
  parent{number title url state repository{nameWithOwner} labels(first:20){nodes{name}}}
  subIssues(first:50){nodes{number title url state labels(first:20){nodes{name}}}}}}}`;

/** "workitem.get" for Loom: an issue by number in a repo, or an Epic (a milestone) by its negative id. */
export async function getItem(d, args = {}) {
  const { gh, repo } = target(d, args);
  const n = number(args.id);
  const prefix = d.cfg.areaLabelPrefix || '';
  if (n < 0) {
    const m = await gh.rest('GET', `/repos/${repo}/milestones/${-n}`);
    const out = milestoneItem(m, repo);
    if (args.details) Object.assign(out, { area: repo, iteration: '', tags: [], acceptanceCriteria: '', reproSteps: '', related: [] });
    if (args.comments) out.comments = [];
    return out;
  }
  const i = await gh.rest('GET', `/repos/${repo}/issues/${n}`);
  if (!i || i.pull_request) throw new GhError(`${repo}#${n} is a pull request, not an issue.`, 404);
  const base = written(i, repo, prefix);
  const out = { id: n, title: base.title, type: base.type, state: base.state, rev: base.rev, project: repo, connection: repo, reason: `the repo ${repo}`, url: base.url };
  if (args.details) {
    const parts = splitBody(i.body);
    Object.assign(out, { area: base.area, iteration: base.iteration, tags: base.tags, description: parts.description, acceptanceCriteria: parts.acceptanceCriteria, reproSteps: parts.reproSteps, related: [] });
    if (args.html) out.html = { description: '', acceptanceCriteria: '', reproSteps: '' };
    if (args.pullRequests) out.pullRequests = [];
  }
  if (args.extras) {
    let kids = [];
    try {
      const [owner, name] = repo.split('/');
      const g = await gh.graphql(PANEL_Q, { owner, name, number: n });
      kids = g?.repository?.issue?.subIssues?.nodes || [];
    } catch (e) { if (!(e instanceof GhError)) throw e; }
    const fields = (Array.isArray(args.fields) ? args.fields : []).filter(f => typeof f === 'string').slice(0, 20);
    const note = releaseNoteOf(i.body);
    Object.assign(out, {
      assignee: base.assignee, priority: base.priority, severity: '', storyPoints: null, systemInfo: '', commentCount: i.comments || 0,
      links: {
        items: kids.map(k => ({ id: k.number, name: 'Child', title: k.title || '', type: loomType(labelsOf(k)), state: k.state === 'CLOSED' ? 'Closed' : 'Open', url: k.url || '' })),
        hyperlinks: [], attachments: [], pullRequests: 0
      },
      custom: Object.fromEntries(fields.map(f => [f, /release/i.test(f) ? note : '']))
    });
  }
  if (args.comments) {
    const rows = await gh.pages(`/repos/${repo}/issues/${n}/comments`, {}, 200);
    out.comments = rows.map(c => ({ id: c.id, html: '', text: c.body || '', by: { name: c.user?.login || '', email: '' }, date: c.created_at || null, edited: !!(c.updated_at && c.updated_at !== c.created_at) }));
  }
  if (args.history) out.history = [];
  return out;
}

/** "workitem.find": a bare number looked up in every repo in Settings' Repos. */
export async function findItem(d, args = {}) {
  const n = number(args.id);
  const conn = pickConnection(d.cfg);
  if (!d.cfg.repos.length) return { id: n, matches: [], failed: [{ connection: conn.name, message: 'List your repos in the GitHub connector settings to find an issue by number.' }] };
  const gh = clientFor(conn, d.env, d.signal);
  const matches = [], failed = [];
  for (const repo of d.cfg.repos) {
    try {
      const i = await gh.rest('GET', `/repos/${repo}/issues/${n}`);
      if (!i || i.pull_request) continue;
      const w = written(i, repo, d.cfg.areaLabelPrefix || '');
      matches.push({ id: n, title: w.title, type: w.type, state: w.state, project: repo, connection: repo, url: w.url, area: w.area, rev: w.rev });
    } catch (e) {
      if (e instanceof GhError && e.upstream === 404) continue;
      if (!(e instanceof GhError)) throw e;
      failed.push({ connection: repo, message: e.message });
    }
  }
  return { id: n, matches, failed };
}

// ---------------------------------------------------------------- linked pull requests

const PRS_FIELDS = 'closedByPullRequestsReferences(first:20,includeClosedPrs:true){nodes{number title state merged url baseRefName closedAt repository{nameWithOwner}}}';
const PRS_Q = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){
  number state labels(first:20){nodes{name}} ${PRS_FIELDS}
  subIssues(first:100){totalCount nodes{number title state labels(first:20){nodes{name}} ${PRS_FIELDS}}}}}}`;

const prStatus = p => (p.merged || p.state === 'MERGED' ? 'completed' : p.state === 'CLOSED' ? 'abandoned' : 'active');
export function overall(prs) {
  if (!prs.length) return 'none';
  if (prs.some(p => p.status === 'active')) return 'open';
  if (prs.some(p => p.status === 'completed')) return 'merged';
  return 'abandoned';
}

/** "workitem.prs": PRs that close the issue and (with children, default) its sub-issues. Read only. */
export async function itemPrs(d, args = {}) {
  const { gh, repo } = target(d, args);
  const n = number(args.id);
  const [owner, name] = repo.split('/');
  const g = await gh.graphql(PRS_Q, { owner, name, number: n });
  const issue = g?.repository?.issue;
  if (!issue) throw new GhError(`${repo}#${n} was not found.`, 404);
  const kids = args.children === false ? [] : issue.subIssues?.nodes || [];
  const prs = [];
  const seen = new Set();
  const add = (list, wid) => {
    for (const p of list || []) {
      const key = `${p.repository?.nameWithOwner}#${p.number}`;
      if (seen.has(key) || prs.length >= 60) continue;
      seen.add(key);
      prs.push({ id: p.number, workItemId: wid, status: prStatus(p), title: p.title || '', repository: p.repository?.nameWithOwner || '', targetBranch: p.baseRefName || '', url: p.url || '', closed: p.closedAt || null });
    }
  };
  add(issue.closedByPullRequestsReferences?.nodes, n);
  for (const k of kids) add(k.closedByPullRequestsReferences?.nodes, k.number);
  return {
    id: n, type: loomType(labelsOf(issue)), state: issue.state === 'CLOSED' ? 'Closed' : 'Open', rev: 0, connection: repo,
    children: kids.map(k => ({ id: k.number, title: k.title || '', type: loomType(labelsOf(k)), state: k.state === 'CLOSED' ? 'Closed' : 'Open' })),
    prs, status: overall(prs), truncated: (issue.subIssues?.totalCount || 0) > kids.length || prs.length >= 60
  };
}

// ---------------------------------------------------------------- writes

/** A body with its description and acceptance criteria replaced, the other sections kept. */
export function joinBody(body, { description, acceptance, releaseNote } = {}) {
  const parts = splitBody(body);
  const desc = description !== undefined ? String(description) : parts.description;
  const acc = acceptance !== undefined ? String(acceptance) : parts.acceptanceCriteria;
  const out = [desc.trim()];
  if (parts.reproSteps) out.push(`## Repro steps\n\n${parts.reproSteps}`);
  if (acc.trim()) out.push(`## Acceptance criteria\n\n${acc.trim()}`);
  if (releaseNote && String(releaseNote).trim()) out.push(`## Release note\n\n${String(releaseNote).trim()}`);
  return out.filter(Boolean).join('\n\n');
}

function login(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/[@\s]/.test(s)) throw new SettingsError(`GitHub assigns by login, and "${s}" is not one. Put the person's GitHub login in their identity in Settings, People.`);
  return s.replace(/^@/, '');
}

async function milestoneByTitle(gh, repo, title) {
  const want = lc(String(title).split('\\').pop().trim());
  const all = await gh.pages(`/repos/${repo}/milestones`, { state: 'all' }, 500);
  const m = all.find(x => lc(x.title) === want);
  if (!m) throw new SettingsError(`There is no milestone "${title}" in ${repo}.`);
  return m.number;
}

/** Labels after the changes: tags added and removed, the priority, area and resolved labels swapped. */
function nextLabels(current, ch, prefix) {
  let labels = [...current];
  const drop = test => { labels = labels.filter(l => !test(l)); };
  const add = l => { if (l && !labels.some(x => lc(x) === lc(l))) labels.push(l); };
  for (const t of ch.tagsRemove || []) drop(l => lc(l) === lc(t));
  for (const t of ch.tagsAdd || []) add(String(t).trim());
  if (ch.priority !== undefined && ch.priority !== null && ch.priority !== '') {
    const p = Number(ch.priority);
    if (!(p >= 1 && p <= 4)) throw new SettingsError('Priority is 1 to 4.');
    drop(l => priorityOf([l]) !== null);
    add(`P${p}`);
  }
  if (ch.area !== undefined && prefix) {
    const a = parseArea(ch.area);
    drop(l => lc(l).startsWith(lc(prefix)));
    if (a && a.area) add(/[:\s]$/.test(prefix) ? `${prefix.trimEnd()} ${a.area}` : `${prefix}${a.area}`);
  }
  return labels;
}

/** "workitem.update" (write): one PATCH, then a comment if asked. Refuses with conflict when the issue changed since `rev`. */
export async function updateItem(d, args = {}) {
  const { gh, repo } = target(d, args);
  const n = number(args.id);
  const ch = args.changes || {};
  const prefix = d.cfg.areaLabelPrefix || '';
  if (n < 0) {
    const m = await gh.rest('GET', `/repos/${repo}/milestones/${-n}`);
    if (args.rev && revOf(m.updated_at) !== Number(args.rev)) throw new ConflictError(`Epic ${m.title} changed on GitHub since you read it. Reload it and try again.`);
    const patch = {};
    if (ch.title !== undefined) patch.title = String(ch.title);
    if (ch.description !== undefined) patch.description = String(ch.description);
    if (ch.targetDate !== undefined) patch.due_on = ch.targetDate ? `${ch.targetDate}T00:00:00Z` : null;
    if (ch.state !== undefined) patch.state = CLOSED[lc(ch.state)] ? 'closed' : 'open';
    const m2 = Object.keys(patch).length ? await gh.rest('PATCH', `/repos/${repo}/milestones/${-n}`, { body: patch }) : m;
    return milestoneItem(m2, repo);
  }
  const i = await gh.rest('GET', `/repos/${repo}/issues/${n}`);
  if (!i || i.pull_request) throw new GhError(`${repo}#${n} is a pull request, not an issue.`, 404);
  if (args.rev && revOf(i.updated_at) !== Number(args.rev)) throw new ConflictError(`${repo}#${n} changed on GitHub since you read it. Reload it and try again.`);
  if (ch.startDate || ch.targetDate) throw new SettingsError('GitHub issues have no start or target date. Set the milestone (the sprint) instead.');
  const patch = {};
  if (ch.title !== undefined) patch.title = String(ch.title);
  if (ch.description !== undefined || ch.acceptance !== undefined) patch.body = joinBody(i.body, { description: ch.description, acceptance: ch.acceptance, releaseNote: releaseNoteOf(i.body) });
  let labels = nextLabels(labelsOf(i), ch, prefix);
  if (ch.state !== undefined) {
    const s = lc(ch.state);
    if (CLOSED[s]) { patch.state = 'closed'; patch.state_reason = CLOSED[s]; labels = labels.filter(l => lc(l) !== RESOLVED); }
    else if (s === RESOLVED) { patch.state = 'open'; if (!labels.some(l => lc(l) === RESOLVED)) labels.push(RESOLVED); }
    else { patch.state = 'open'; labels = labels.filter(l => lc(l) !== RESOLVED); }
  }
  if (labels.join('\n') !== labelsOf(i).join('\n')) patch.labels = labels;
  if (ch.assignedTo !== undefined) { const who = login(ch.assignedTo); patch.assignees = who ? [who] : []; }
  if (ch.iteration !== undefined) patch.milestone = ch.iteration ? await milestoneByTitle(gh, repo, ch.iteration) : null;
  const related = (Array.isArray(ch.related) ? ch.related : []).map(Number).filter(x => Number.isInteger(x) && x !== n).slice(0, 20);
  if (!Object.keys(patch).length && !ch.comment && !related.length) {
    if (Array.isArray(ch.related) && ch.related.length) throw new SettingsError('Those items are already linked.');
    return written(i, repo, prefix);
  }
  const after = Object.keys(patch).length ? await gh.rest('PATCH', `/repos/${repo}/issues/${n}`, { body: patch }) : i;
  const text = [ch.comment ? String(ch.comment) : '', related.length ? `Related: ${related.map(r => (r < 0 ? `milestone ${-r}` : `#${r}`)).join(', ')}` : ''].filter(Boolean).join('\n\n');
  let last = after;
  if (text) {
    await gh.rest('POST', `/repos/${repo}/issues/${n}/comments`, { body: { body: text } });
    last = await gh.rest('GET', `/repos/${repo}/issues/${n}`);
  }
  return written(last, repo, prefix);
}

/** "workitem.create" (write): an issue (an Epic is a milestone), with its type label, sections and parent. */
export async function createItem(d, args = {}) {
  const { gh, repo } = target(d, args);
  const f = args.fields || {};
  const prefix = d.cfg.areaLabelPrefix || '';
  const title = String(args.title || '').trim();
  if (!title) throw new SettingsError('Give the new item a title.');
  if (lc(args.type) === 'epic') {
    const m = await gh.rest('POST', `/repos/${repo}/milestones`, { body: { title, ...(f.description ? { description: String(f.description) } : {}) } });
    return milestoneItem(m, repo);
  }
  const labels = nextLabels([typeLabel(args.type)].filter(Boolean), { tagsAdd: Array.isArray(f.tags) ? f.tags : [], priority: f.priority, ...(f.area ? { area: f.area } : {}) }, prefix);
  const note = f.custom && typeof f.custom === 'object' ? Object.entries(f.custom).find(([k]) => /release/i.test(k))?.[1] : '';
  const body = joinBody('', { description: f.description || '', acceptance: f.acceptance || '', releaseNote: note || '' });
  const parent = args.parent !== undefined && args.parent !== null ? Number(args.parent) : null;
  const issueBody = { title, body, labels };
  if (f.assignedTo) issueBody.assignees = [login(f.assignedTo)];
  if (parent && parent < 0) issueBody.milestone = -parent;
  else if (f.iteration) issueBody.milestone = await milestoneByTitle(gh, repo, f.iteration);
  const made = await gh.rest('POST', `/repos/${repo}/issues`, { body: issueBody });
  if (parent && parent > 0) await gh.rest('POST', `/repos/${repo}/issues/${parent}/sub_issues`, { body: { sub_issue_id: made.id } });
  return written(made, repo, prefix);
}

/** "iterations.list" on a repo connection: the repo's open milestones as sprints. */
export async function repoIterations(d, args = {}) {
  const { gh, repo } = target(d, args);
  const ms = await gh.pages(`/repos/${repo}/milestones`, { state: 'open' }, 100);
  const today = (d.now || new Date()).toISOString().slice(0, 10);
  const nextDue = (ms.filter(m => day(m.due_on) && day(m.due_on) >= today).sort((a, b) => day(a.due_on).localeCompare(day(b.due_on)))[0] || {}).number;
  return {
    connection: repo, project: repo,
    // The current sprint: the open milestone due soonest, today or later.
    iterations: ms.map(m => ({ path: m.title || '', name: m.title || '', start: null, finish: day(m.due_on), current: m.number === nextDue }))
  };
}
