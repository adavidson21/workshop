// "roadmap": Epics, Features and (with `stories`) their stories, in the ADO connector's roadmap shape, so Roadmaps
// reads GitHub the same way. Read only.
//
// How GitHub maps (the GitHub tracker plan): an Epic is a milestone (a major version), a Feature is an issue with
// the `feature` label, and a story is one of a Feature's sub-issues. A Feature with no date of its own takes its
// milestone's due date as its target date.
//
// Ids are numbers, like ADO's, so Roadmaps keys GitHub items the same way: an issue's or a milestone's GitHub
// database id (the two never share a number in practice: issue ids are in the billions, milestone ids far
// lower). `ref` is the readable name ("acme/web#12", "acme/web milestone v2.1") for the item's description.
import { SettingsError, clientFor } from './client.mjs';
import { REPO_RE, pickConnection } from './config.mjs';
import { splitBody, typeOf } from './issues.mjs';

const MAX = 2000;
const MAX_CHILDREN = 5000;
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const labelNames = i => (i.labels || []).map(l => (typeof l === 'string' ? l : l?.name)).filter(Boolean);

/** {repo, area} from "owner/repo" or "owner/repo/<area>" (slashes or Roadmaps' backslashes). Null when not one. */
export function parseArea(a) {
  const parts = String(a || '').trim().replace(/^github:\s*/i, '').split(/[\\/]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  if (!REPO_RE.test(repo)) return null;
  return { repo, area: parts.slice(2).join('/').trim() };
}

/** The release note, from a "## Release note" or "## Release notes" section of the body, else ''. */
export function releaseNoteOf(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let on = false;
  for (const line of lines) {
    const h = line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/);
    if (h) { on = /^release notes?$/i.test(h[1].trim()); continue; }
    if (on) out.push(line);
  }
  return out.join('\n').trim().slice(0, 2000);
}

const storyType = labels => { const t = typeOf(labels); return t === 'Story' ? 'User Story' : t === 'Issue' || t === 'Bug' || t === 'Task' ? 'Issue' : t; };

function issueItem(i, repo, { type, parentId = null, area, fields, milestoneDue }) {
  const own = day(i.milestone?.due_on) || milestoneDue || null;
  const item = {
    id: i.id, ref: `${repo}#${i.number}`, rev: 0, type,
    title: i.title || '', state: i.state === 'closed' ? 'Closed' : 'Open',
    area, iteration: '', parentId,
    assignee: (i.assignees || [])[0]?.login ? { name: i.assignees[0].login, email: '' } : null,
    targetDate: type === 'Feature' ? own : null, startDate: null,
    changed: i.updated_at || null, url: i.html_url || ''
  };
  if (type === 'Feature') {
    item.storiesTotal = i.sub_issues_summary?.total || 0;
    item.storiesDone = i.sub_issues_summary?.completed || 0;
  }
  if (fields.length) {
    const note = releaseNoteOf(i.body);
    item.custom = Object.fromEntries(fields.map(f => [f, note]));
  }
  return item;
}

/** "roadmap": args {areas (required), includeClosed, stories, fields, connection}. */
export async function roadmapList(d, args = {}) {
  const areas = (Array.isArray(args.areas) ? args.areas : []).map(parseArea);
  if (!areas.length || areas.some(a => !a)) throw new SettingsError('Give each area as owner/repo or owner/repo/<area>.');
  const conn = pickConnection(d.cfg, args.connection);
  const gh = clientFor(conn, d.env, d.signal);
  const state = args.includeClosed ? 'all' : 'open';
  const fields = (Array.isArray(args.fields) ? args.fields : []).filter(f => typeof f === 'string' && f).slice(0, 20);
  const prefix = d.cfg.areaLabelPrefix || '';
  const byRepo = new Map();
  for (const a of areas) {
    const r = byRepo.get(a.repo) || { whole: false, labels: new Set() };
    if (a.area) r.labels.add(a.area); else r.whole = true;
    byRepo.set(a.repo, r);
  }
  const items = [];
  let truncated = false, childrenTruncated = false, children = 0;
  for (const [repo, want] of byRepo) {
    const milestones = await gh.pages(`/repos/${repo}/milestones`, { state }, 500);
    const msById = new Map(milestones.map(m => [m.number, m]));
    // Features: one query per repo, kept when the repo is wanted whole or their area label is one asked for
    // (compared without case or the spaces after the prefix, so "area: auth" and "area:auth" are the same area).
    const seen = new Map();
    const wanted = new Set([...want.labels].map(l => l.toLowerCase()));
    for (const i of await gh.pages(`/repos/${repo}/issues`, { labels: 'feature', state }, MAX)) {
      if (i.pull_request || seen.has(i.id)) continue;
      const area = areaOfLabels(repo, labelNames(i), prefix);
      const name = area === repo ? '' : area.slice(repo.length + 1).toLowerCase();
      if (!want.whole && !wanted.has(name)) continue;
      seen.set(i.id, { issue: i, area });
    }
    // Epics: every milestone of a whole repo, else only those a Feature in scope sits in.
    const usedMs = new Set([...seen.values()].map(x => x.issue.milestone?.number).filter(Boolean));
    for (const m of milestones) {
      if (!want.whole && !usedMs.has(m.number)) continue;
      items.push({
        id: m.id, ref: `${repo} milestone ${m.title}`, rev: 0, type: 'Epic', title: m.title || '', state: m.state === 'closed' ? 'Closed' : 'Open',
        area: repo, iteration: '', parentId: null, assignee: null, targetDate: day(m.due_on), startDate: null,
        changed: m.updated_at || null, url: m.html_url || ''
      });
    }
    for (const { issue, area } of seen.values()) {
      const ms = issue.milestone ? msById.get(issue.milestone.number) || issue.milestone : null;
      items.push(issueItem(issue, repo, { type: 'Feature', parentId: ms ? ms.id : null, area, fields, milestoneDue: day(ms?.due_on) }));
      if (args.stories && (issue.sub_issues_summary?.total || 0) > 0) {
        if (children >= MAX_CHILDREN) { childrenTruncated = true; continue; }
        const kids = await gh.pages(`/repos/${repo}/issues/${issue.number}/sub_issues`, {}, 200);
        for (const k of kids) {
          children++;
          if (k.pull_request || (!args.includeClosed && k.state === 'closed')) continue;
          const kRepo = k.repository?.full_name || String(k.repository_url || '').split('/repos/')[1] || repo;
          items.push(issueItem(k, kRepo, { type: storyType(labelNames(k)), parentId: issue.id, area, fields }));
        }
      }
    }
    if (items.length >= MAX) { truncated = true; break; }
  }
  items.sort((a, b) => String(b.changed || '').localeCompare(String(a.changed || '')));
  return { connection: conn.name, items: items.slice(0, MAX), total: items.length, truncated: truncated || items.length > MAX, childrenTruncated, fetchedAt: (d.now || new Date()).toISOString() };
}

function areaOfLabels(repo, labels, prefix) {
  if (prefix) {
    const l = labels.find(x => String(x).toLowerCase().startsWith(prefix.toLowerCase()) && String(x).length > prefix.length);
    if (l) return `${repo}/${String(l).slice(prefix.length).trim()}`;
  }
  return repo;
}

/** "iterations.list": GitHub has no sprints outside Projects, so none (Roadmaps places items by their own dates). */
export function iterationsList(d, args = {}) {
  const conn = pickConnection(d.cfg, args.connection);
  return { connection: conn.name, project: String(args.project || ''), iterations: [] };
}
