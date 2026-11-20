// "pr.status": where a published pull request stands, for Workshop's after-Publish watcher (GitHub connector 1.4.0,
// Workshop project doc claude/after-publish-v1-plan.md). Read only.
//
// The PR is found by its head branch in the repo the remote names. CI comes from the head commit's check runs and
// commit statuses; with `logs`, each failed check's output and annotations (GitHub's job logs live on another host,
// so they are not read), and whether the same check also fails on the target branch. Review comes from the latest
// review per person, and comments from the PR's review comments and conversation (people only, not the author).
import { SettingsError } from './client.mjs';

const MAX_THREADS = 50;
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure']);

/** {host, owner, repo} from a git remote (https, ssh or scp form), or null. */
export function parseRemote(remote) {
  const s = String(remote || '').trim();
  let m = /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(s);
  if (!m) m = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(s);
  if (!m) m = /^(?:[^@/]+@)?([^:/]+):([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(s);
  return m ? { host: m[1].toLowerCase(), owner: m[2], repo: m[3] } : null;
}

/** The connection whose web address is on the remote's host. */
export function connectionFor(cfg, remote) {
  const r = parseRemote(remote);
  if (!r) throw new SettingsError('That remote is not a GitHub repo.');
  const conn = (cfg.connections || []).find(c => { try { return new URL(c.webUrl).hostname.toLowerCase() === r.host; } catch { return false; } });
  if (!conn) throw new SettingsError(`No GitHub connection for ${r.host}. Add it in Settings.`);
  return { conn, ...r };
}

/** The latest review per person as one word: changes, approved or waiting. */
export function reviewOf(reviews) {
  const last = new Map();
  for (const r of reviews || []) {
    if (!r || !r.user || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) continue;
    last.set(r.user.login, r.state);
  }
  const v = [...last.values()];
  return v.includes('CHANGES_REQUESTED') ? 'changes' : v.includes('APPROVED') ? 'approved' : 'waiting';
}

/** Check runs and commit statuses as [{id, name, state, url}]. */
export function checksOf(runs, statuses) {
  const out = [];
  for (const r of runs || []) {
    const state = r.status !== 'completed' ? 'running' : FAILED.has(r.conclusion) ? 'failed' : 'passed';
    out.push({ id: r.id, name: r.name, state, url: r.html_url || r.details_url || null, output: r.output || null });
  }
  for (const s of statuses || []) {
    const state = s.state === 'pending' ? 'running' : s.state === 'success' ? 'passed' : 'failed';
    out.push({ id: null, name: s.context || 'Status', state, url: s.target_url || null, output: s.description ? { title: s.description } : null });
  }
  return out;
}
export const ciState = checks => (checks.some(c => c.state === 'failed') ? 'failed' : checks.some(c => c.state === 'running') ? 'running' : checks.length ? 'passed' : 'none');

/** Review comments and conversation from people: [{id, path, line, author, text, resolved}]. */
export function threadsOf(reviewComments, issueComments, author) {
  const people = c => c && c.user && c.user.type !== 'Bot' && c.user.login !== author && c.body;
  const out = [];
  for (const c of reviewComments || []) {
    if (!people(c) || c.in_reply_to_id) continue;
    out.push({ id: `gh-${c.id}`, path: c.path || null, line: c.line || c.original_line || null, author: c.user.login, text: String(c.body).slice(0, 2000), replies: 0, resolved: false });
  }
  for (const c of issueComments || []) {
    if (!people(c)) continue;
    out.push({ id: `ghc-${c.id}`, path: null, line: null, author: c.user.login, text: String(c.body).slice(0, 2000), replies: 0, resolved: false });
  }
  return out.slice(-MAX_THREADS);
}

/** A failed check's output and annotations as one text. */
export function checkLog(run, annotations) {
  const o = (run && run.output) || {};
  const parts = [`## ${run.name}`];
  for (const k of ['title', 'summary', 'text']) if (o[k]) parts.push(String(o[k]).trim());
  const ann = (annotations || []).slice(0, 30).map(a => `${a.path || ''}${a.start_line ? ':' + a.start_line : ''} ${a.annotation_level || ''}: ${a.message || ''}`.trim());
  if (ann.length) parts.push(ann.join('\n'));
  return parts.join('\n').slice(-20000);
}

/** @param gh a GitHub client (rest) @param {{remote, branch, target?, logs?}} args */
export async function prStatus(gh, args, r) {
  const repo = `${r.owner}/${r.repo}`;
  const list = await gh.rest('GET', `/repos/${repo}/pulls`, { query: { head: `${r.owner}:${args.branch}`, state: 'all', per_page: 10 } });
  const prs = (Array.isArray(list) ? list : []).slice().sort((a, b) => (a.state === 'open' ? -1 : 0) - (b.state === 'open' ? -1 : 0) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (!prs.length) return { found: false, host: 'github' };
  const pr = await gh.rest('GET', `/repos/${repo}/pulls/${prs[0].number}`);
  const author = pr.user && pr.user.login;
  const out = { found: true, host: 'github', id: pr.number, url: pr.html_url, title: pr.title || '', status: pr.merged ? 'completed' : pr.state === 'open' ? 'active' : 'abandoned',
    merged: !!pr.merged, abandoned: pr.state !== 'open' && !pr.merged, conflict: pr.mergeable_state === 'dirty' || pr.mergeable === false && pr.mergeable_state !== 'unknown',
    head: (pr.head && pr.head.sha) || null, review: 'waiting', ci: { state: 'none', checks: [], baseFailing: false }, threads: [] };
  if (pr.state !== 'open') return out;
  out.review = reviewOf(await gh.rest('GET', `/repos/${repo}/pulls/${pr.number}/reviews`, { query: { per_page: 100 } }));
  const runs = await gh.rest('GET', `/repos/${repo}/commits/${out.head}/check-runs`, { query: { per_page: 100 } });
  const combined = await gh.rest('GET', `/repos/${repo}/commits/${out.head}/status`);
  const checks = checksOf(runs && runs.check_runs, combined && combined.statuses);
  out.ci = { state: ciState(checks), checks: checks.map(({ name, state, url }) => ({ name, state, url })), baseFailing: false };
  if (args.logs && out.ci.state === 'failed') {
    for (const c of checks.filter(x => x.state === 'failed').slice(0, 3)) {
      const row = out.ci.checks.find(x => x.name === c.name && x.state === 'failed' && !x.log);
      const ann = c.id ? await gh.rest('GET', `/repos/${repo}/check-runs/${c.id}/annotations`, { query: { per_page: 50 } }) : [];
      if (row) row.log = checkLog(c, Array.isArray(ann) ? ann : []);
      if (c.id && args.target) {
        const base = await gh.rest('GET', `/repos/${repo}/commits/${encodeURIComponent(String(args.target).replace(/^origin\//, ''))}/check-runs`, { query: { check_name: c.name, per_page: 1 } });
        const last = base && base.check_runs && base.check_runs[0];
        if (last && last.status === 'completed' && FAILED.has(last.conclusion)) out.ci.baseFailing = true;
      }
    }
  }
  const rc = await gh.rest('GET', `/repos/${repo}/pulls/${pr.number}/comments`, { query: { per_page: 100 } });
  const ic = await gh.rest('GET', `/repos/${repo}/issues/${pr.number}/comments`, { query: { per_page: 100 } });
  out.threads = threadsOf(rc, ic, author);
  return out;
}
