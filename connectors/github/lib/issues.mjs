// Issues: "sync" (open issues assigned to me), "areas.mine" and "workitem.get". Output follows the ADO connector's
// shapes so apps treat both the same, with two differences: an id is "owner/repo#number" (a string), and the
// project is the repo (owner/repo).
import { GhError, SettingsError, clientFor } from './client.mjs';
import { REPO_RE, TYPE_LABELS, inScope, pickConnection } from './config.mjs';
import { syncPrs } from './prs.mjs';

export const ID_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100})#(\d{1,9})$/;

/** {repo, number} from "owner/repo#12", or from a number plus a repo. Null when neither works. */
export function parseId(id, repo) {
  const s = String(id ?? '').trim();
  const m = s.match(ID_RE);
  if (m) return { repo: m[1], number: Number(m[2]) };
  const n = s.replace(/^#/, '');
  if (/^\d{1,9}$/.test(n) && Number(n) > 0 && REPO_RE.test(String(repo || ''))) return { repo: String(repo), number: Number(n) };
  return null;
}

const labelNames = issue => (issue.labels || []).map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean);

/** Type from labels (epic, feature, story, bug, task), else Issue. */
export function typeOf(labels) {
  for (const l of labels) {
    const t = TYPE_LABELS[String(l).toLowerCase()];
    if (t) return t;
  }
  return 'Issue';
}

/** Priority 1 to 4 from a label such as P1, p2, priority: 3 or priority-4. */
export function priorityOf(labels) {
  for (const l of labels) {
    const m = String(l).trim().match(/^(?:p|priority[\s:/-]*)([1-4])$/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** The area: an area label (prefix, default "area:") inside the repo as owner/repo/<area>, else the repo. */
export function areaOf(repo, labels, prefix = 'area:') {
  if (prefix) {
    const l = labels.find(x => String(x).toLowerCase().startsWith(prefix.toLowerCase()) && String(x).length > prefix.length);
    if (l) return `${repo}/${String(l).slice(prefix.length).trim()}`;
  }
  return repo;
}

const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const repoOf = issue => issue.repository?.full_name || String(issue.repository_url || '').split('/repos/')[1] || '';

/** One issue in the ADO connector's sync shape. */
export function shape(issue, repo = repoOf(issue)) {
  const labels = labelNames(issue);
  return {
    id: `${repo}#${issue.number}`,
    number: issue.number,
    title: issue.title || '',
    type: typeOf(labels),
    state: issue.state === 'closed' ? 'Closed' : 'Open',
    project: repo,
    assignedTo: (issue.assignees || [])[0]?.login || issue.assignee?.login || '',
    priority: priorityOf(labels),
    due: day(issue.milestone?.due_on),
    changed: issue.updated_at || null,
    url: issue.html_url || '',
    labels
  };
}

const isMine = (issue, me) => (issue.assignees || []).some(a => String(a.login).toLowerCase() === me.toLowerCase())
  || String(issue.assignee?.login || '').toLowerCase() === me.toLowerCase();

export function cleanKnown(known) {
  return (Array.isArray(known) ? known : []).filter(x => typeof x === 'string' && ID_RE.test(x)).slice(0, 5000);
}
export function cleanKnownPrs(knownPrs) {
  return (Array.isArray(knownPrs) ? knownPrs : []).filter(x => typeof x === 'string').map(x => x.slice(0, 500)).slice(0, 2000);
}

/** My open issues (in scope, of a synced type) as a Map by id. */
async function mine(d, gh) {
  const rows = await gh.pages('/issues', { filter: 'assigned', state: 'open', sort: 'updated' }, 2000);
  const out = new Map();
  for (const issue of rows) {
    if (issue.pull_request) continue;
    const repo = repoOf(issue);
    if (!repo || !inScope(d.cfg, repo)) continue;
    const s = shape(issue, repo);
    if (!d.cfg.types.includes(s.type)) continue;
    out.set(s.id, s);
  }
  return out;
}

/** Open issues assigned to me, plus what happened to known issues that dropped off. */
export async function sync(d, known, knownPrs, { prs = true } = {}) {
  const gh = clientFor(pickConnection(d.cfg), d.env, d.signal);
  const me = await gh.me();
  const items = await mine(d, gh);
  const gone = [];
  for (const id of known) {
    if (items.has(id)) continue;
    const p = parseId(id);
    let issue;
    try {
      issue = await gh.rest('GET', `/repos/${p.repo}/issues/${p.number}`);
    } catch (e) {
      if (e instanceof GhError && e.upstream === 404) { gone.push({ id, reason: 'missing' }); continue; }
      throw e;
    }
    if (!issue || issue.pull_request) { gone.push({ id, reason: 'missing' }); continue; }
    const s = shape(issue, p.repo);
    if (issue.state === 'closed') s.reason = ['not_planned', 'duplicate'].includes(issue.state_reason) ? 'removed' : 'closed';
    else if (!inScope(d.cfg, p.repo) || !d.cfg.types.includes(s.type)) s.reason = 'filtered';
    else if (!isMine(issue, me)) s.reason = 'reassigned';
    else { items.set(s.id, s); continue; } // still mine; the list missed it
    gone.push(s);
  }
  const out = { items: [...items.values()], gone, syncedAt: (d.now || new Date()).toISOString() };
  if (prs && d.cfg.prs) {
    try {
      out.prs = await syncPrs(d, knownPrs, gh);
    } catch (e) {
      if (!(e instanceof GhError)) throw e;
      out.prError = e.message;
    }
  }
  return out;
}

/** "areas.mine": the areas (repo, or repo/area label) of my open issues, most first, up to 50. */
export async function areasMine(d, args = {}) {
  const conn = pickConnection(d.cfg, args.connection);
  const gh = clientFor(conn, d.env, d.signal);
  const items = await mine(d, gh);
  const counts = new Map();
  for (const it of items.values()) {
    const a = areaOf(it.project, it.labels, d.cfg.areaLabelPrefix);
    counts.set(a, (counts.get(a) || 0) + 1);
  }
  return { connection: conn.name, areas: [...counts].map(([path, count]) => ({ path, count })).sort((x, y) => y.count - x.count || x.path.localeCompare(y.path)).slice(0, 50) };
}

// Sections of an issue body that stand in for ADO's separate fields.
const SECTIONS = [
  ['acceptanceCriteria', /^acceptance criteria$/i],
  ['reproSteps', /^(repro steps|steps to reproduce|reproduction steps)$/i]
];

/** Splits a Markdown body into description, acceptance criteria and repro steps (## or ### headings). */
export function splitBody(body) {
  const out = { description: '', acceptanceCriteria: '', reproSteps: '' };
  let key = 'description';
  const parts = { description: [], acceptanceCriteria: [], reproSteps: [] };
  for (const line of String(body || '').replace(/\r\n?/g, '\n').split('\n')) {
    const h = line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/);
    if (h) {
      const hit = SECTIONS.find(([, re]) => re.test(h[1].trim()));
      if (hit) { key = hit[0]; continue; }
      if (key !== 'description') key = 'description';
    }
    parts[key].push(line);
  }
  for (const k of Object.keys(out)) out[k] = parts[k].join('\n').trim();
  return out;
}

const PARENT_Q = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){
  parent{number title url state repository{nameWithOwner} labels(first:20){nodes{name}}}
  subIssuesSummary{total completed}}}}`;

/** "workitem.get": one issue. `details` adds body sections, labels, milestone and parent; `comments` adds comments. */
export async function getIssue(d, args = {}) {
  const p = parseId(args.id, args.repo || (d.cfg.repos.length === 1 ? d.cfg.repos[0] : ''));
  if (!p) throw new SettingsError('Give the issue as owner/repo#number, or a number with the repo.');
  const conn = pickConnection(d.cfg, args.connection);
  const gh = clientFor(conn, d.env, d.signal);
  const issue = await gh.rest('GET', `/repos/${p.repo}/issues/${p.number}`);
  if (!issue || issue.pull_request) throw new GhError(`${p.repo}#${p.number} is a pull request, not an issue.`, 404);
  const s = shape(issue, p.repo);
  const out = {
    id: s.id, number: s.number, title: s.title, type: s.type, state: s.state, rev: issue.updated_at || null,
    project: p.repo, connection: conn.name, url: s.url,
    reason: args.connection ? `connection "${conn.name}" was asked for` : `the default connection (${conn.name})`
  };
  if (args.details) {
    const parts = splitBody(issue.body);
    Object.assign(out, {
      area: areaOf(p.repo, s.labels, d.cfg.areaLabelPrefix),
      iteration: issue.milestone?.title || '',
      tags: s.labels,
      description: parts.description,
      acceptanceCriteria: parts.acceptanceCriteria,
      reproSteps: parts.reproSteps,
      related: [],
      parent: null
    });
    try {
      const [owner, name] = p.repo.split('/');
      const g = await gh.graphql(PARENT_Q, { owner, name, number: p.number });
      const node = g?.repository?.issue;
      const par = node?.parent;
      if (par) {
        out.parent = {
          id: `${par.repository.nameWithOwner}#${par.number}`, title: par.title || '', url: par.url || '',
          state: par.state === 'CLOSED' ? 'Closed' : 'Open', type: typeOf((par.labels?.nodes || []).map(l => l.name))
        };
      }
      if (node?.subIssuesSummary) out.children = { total: node.subIssuesSummary.total || 0, done: node.subIssuesSummary.completed || 0 };
    } catch (e) {
      if (!(e instanceof GhError)) throw e; // parent is a nice-to-have: leave it null
    }
    if (issue.milestone) out.milestone = { title: issue.milestone.title || '', due: day(issue.milestone.due_on), url: issue.milestone.html_url || '' };
  }
  if (args.extras || args.details) {
    out.assignee = s.assignedTo ? { name: s.assignedTo, email: '' } : null;
    out.priority = s.priority;
    out.commentCount = issue.comments || 0;
  }
  if (args.comments) {
    const rows = await gh.pages(`/repos/${p.repo}/issues/${p.number}/comments`, {}, 200);
    out.comments = rows.map(c => ({ id: c.id, html: '', text: c.body || '', by: c.user?.login || '', date: c.created_at || null, edited: !!(c.updated_at && c.updated_at !== c.created_at) }));
  }
  return out;
}
