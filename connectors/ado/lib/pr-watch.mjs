// "pr.status": where a published pull request stands, for Workshop's after-Publish watcher (ADO connector 1.16.0,
// Workshop project doc claude/after-publish-v1-plan.md). Read only.
//
// The PR is found by its source branch in the repo the remote names (Workshop pushed the branch; you created the PR
// on the page Publish opened). Its CI comes from the PR's policy evaluations (build validation) and its statuses
// (other CI that posts to the PR); with `logs`, the end of each failed build step's log, and whether the same pipeline
// also fails on the target branch (then it is not this change). Review comes from the reviewers' votes, and comments
// from the PR's threads (people only, not the PR's author, not system threads).
import { AdoError, SettingsError, clientFor } from './client.mjs';
import { baseOf } from './config.mjs';
import { parseAdoUrl } from './url.mjs';

const LOG_LINES = 120;
const MAX_LOGS = 3;
const MAX_THREADS = 50;
const enc = s => encodeURIComponent(s);

/** The connection whose server and collection the remote is on, or a plain-words error. */
export function connectionFor(cfg, remote) {
  let parts;
  try { parts = parseAdoUrl(remote); } catch { throw new SettingsError('That remote is not an Azure DevOps repo.'); }
  if (!parts.repo) throw new SettingsError('That remote is not an Azure DevOps repo.');
  if (!parts.project) throw new SettingsError('That remote names no ADO project.');
  const want = baseOf(parts).toLowerCase();
  const conn = (cfg.connections || []).find(c => baseOf(c).toLowerCase() === want);
  if (!conn) throw new SettingsError(`No ADO connection for ${baseOf(parts)}. Add it in Settings, Connections.`);
  return { conn, parts };
}

/** The reviewers' votes as one word: approved, changes (waiting for author or rejected) or waiting. */
export function reviewOf(reviewers) {
  const list = (reviewers || []).filter(r => r && !r.isContainer);
  if (list.some(r => r.vote <= -5)) return 'changes';
  const required = list.filter(r => r.isRequired);
  const enough = required.length ? required.every(r => r.vote >= 5) : list.some(r => r.vote >= 5);
  return enough ? 'approved' : 'waiting';
}

const EVAL = { queued: 'running', running: 'running', approved: 'passed', rejected: 'failed', broken: 'failed' };
const STATE = { pending: 'running', succeeded: 'passed', failed: 'failed', error: 'failed' };

/** CI checks from policy evaluations (build validation only) and PR statuses: [{name, state, buildId, definitionId}]. */
export function checksOf(evaluations, statuses) {
  const out = [];
  for (const e of evaluations || []) {
    const cfg = e.configuration || {};
    const s = cfg.settings || {};
    const isBuild = /build/i.test((cfg.type && cfg.type.displayName) || '') || s.buildDefinitionId != null;
    if (!isBuild || !EVAL[e.status]) continue;
    out.push({ name: s.displayName || (e.context && e.context.buildDefinitionName) || 'Build', state: EVAL[e.status], buildId: (e.context && e.context.buildId) || null, definitionId: s.buildDefinitionId || null, url: null });
  }
  const latest = new Map();
  for (const st of statuses || []) {
    const key = `${(st.context && st.context.genre) || ''}/${(st.context && st.context.name) || ''}`;
    const prev = latest.get(key);
    if (!prev || String(st.creationDate || '') > String(prev.creationDate || '')) latest.set(key, st);
  }
  for (const st of latest.values()) {
    if (!STATE[st.state]) continue;
    out.push({ name: st.description || (st.context && st.context.name) || 'Check', state: STATE[st.state], buildId: null, definitionId: null, url: st.targetUrl || null });
  }
  return out;
}

/** One word for many checks: failed, running, passed or none. */
export const ciState = checks => (checks.some(c => c.state === 'failed') ? 'failed' : checks.some(c => c.state === 'running') ? 'running' : checks.length ? 'passed' : 'none');

/** The last lines of a log, without the timestamps ADO puts in front. */
export function logTail(text, n = LOG_LINES) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ''));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-n).join('\n');
}

/** Threads people wrote on the PR: [{id, path, line, author, text, resolved}], newest last. */
export function threadsOf(threads, authorId) {
  const out = [];
  for (const t of threads || []) {
    if (!t || t.isDeleted) continue;
    const comments = (t.comments || []).filter(c => c && !c.isDeleted && (c.commentType || 'text') === 'text' && c.content);
    if (!comments.length) continue;
    const first = comments[0];
    if (authorId && first.author && first.author.id === authorId) continue;
    const ctx = t.threadContext || {};
    const start = ctx.rightFileStart || ctx.leftFileStart || null;
    out.push({ id: `ado-${t.id}`, path: ctx.filePath ? String(ctx.filePath).replace(/^\/+/, '') : null, line: start && start.line ? start.line : null,
      author: (first.author && first.author.displayName) || '', text: String(first.content).slice(0, 2000), replies: comments.length - 1, resolved: !['active', 'pending'].includes(String(t.status || 'active').toLowerCase()) });
  }
  return out.slice(-MAX_THREADS);
}

/** @param {object} d {cfg, env, signal} @param {{remote, branch, target?, logs?}} args */
export async function prStatus(d, args) {
  const { conn, parts } = connectionFor(d.cfg, args.remote);
  const ado = clientFor(conn, d.env, d.signal);
  const project = parts.project;
  const repoPath = `git/repositories/${enc(parts.repo)}`;
  const list = await ado.call('GET', `${repoPath}/pullrequests`, { project, query: { 'searchCriteria.sourceRefName': `refs/heads/${args.branch}`, 'searchCriteria.status': 'all', $top: 10 } });
  const prs = (list.value || []).slice().sort((a, b) => (a.status === 'active' ? -1 : 0) - (b.status === 'active' ? -1 : 0) || String(b.creationDate || '').localeCompare(String(a.creationDate || '')));
  const pr = prs[0];
  if (!pr) return { found: false, host: 'ado', connection: conn.name };
  const id = pr.pullRequestId;
  const projectId = (pr.repository && pr.repository.project && pr.repository.project.id) || project;
  const url = `${parts.serverUrl}/${enc(parts.collection)}/${enc(project)}/_git/${enc(parts.repo)}/pullrequest/${id}`;
  const out = { found: true, host: 'ado', connection: conn.name, id, url, title: pr.title || '', status: pr.status, merged: pr.status === 'completed', abandoned: pr.status === 'abandoned',
    conflict: pr.mergeStatus === 'conflicts', head: (pr.lastMergeSourceCommit && pr.lastMergeSourceCommit.commitId) || null, review: reviewOf(pr.reviewers), ci: { state: 'none', checks: [], baseFailing: false }, threads: [] };
  if (pr.status !== 'active') return out;

  let evaluations = [];
  try {
    const ev = await ado.call('GET', 'policy/evaluations', { project, api: '5.0-preview.1', query: { artifactId: `vstfs:///CodeReview/CodeReviewId/${projectId}/${id}` }, need: 'Code (Read)' });
    evaluations = ev.value || [];
  } catch (e) { if (!(e instanceof AdoError) || e.upstream !== 404) throw e; } // older servers: statuses only
  let statuses = [];
  try { statuses = (await ado.call('GET', `${repoPath}/pullRequests/${id}/statuses`, { project })).value || []; } catch (e) { if (!(e instanceof AdoError) || e.upstream !== 404) throw e; }
  const checks = checksOf(evaluations, statuses);
  out.ci = { state: ciState(checks), checks: checks.map(({ name, state, url: u }) => ({ name, state, url: u })), baseFailing: false };

  if (args.logs && out.ci.state === 'failed') {
    const failed = checks.filter(c => c.state === 'failed');
    let shown = 0;
    for (const c of failed) {
      const row = out.ci.checks.find(x => x.name === c.name && x.state === 'failed' && !x.log);
      if (!c.buildId || shown >= MAX_LOGS) continue;
      if (row) row.url = `${parts.serverUrl}/${enc(parts.collection)}/${enc(project)}/_build/results?buildId=${c.buildId}`;
      // Logs are extra: a PAT without Build (Read), or a build ADO no longer has, still answers where the PR stands.
      let tl;
      try { tl = await ado.call('GET', `build/builds/${c.buildId}/timeline`, { project, need: 'Build (Read)' }); }
      catch (e) { if (row) row.log = `Workshop could not read the log: ${e.message}`; continue; }
      const steps = (tl.records || []).filter(r => r.result === 'failed' && r.log && r.log.id && (r.type || 'Task') === 'Task').slice(0, 2);
      const parts2 = [];
      for (const st of steps) {
        const res = await ado.request('GET', `${ado.base}/${encodeURIComponent(project)}/_apis/build/builds/${c.buildId}/logs/${st.log.id}?api-version=${conn.apiVersion || '6.0'}`);
        if (res.status >= 200 && res.status < 300) parts2.push(`## ${st.name || 'Step'}\n${logTail(res.text)}`);
        shown++;
      }
      if (row) row.log = parts2.join('\n\n').slice(-20000) || (steps.length ? null : 'No failed step had a log.');
      // The same pipeline on the target branch: failing there too means it is not this change.
      if (c.definitionId && args.target) {
        let base = null;
        try { base = await ado.call('GET', 'build/builds', { project, query: { definitions: c.definitionId, branchName: `refs/heads/${String(args.target).replace(/^origin\//, '')}`, $top: 1, queryOrder: 'finishTimeDescending', statusFilter: 'completed' }, need: 'Build (Read)' }); }
        catch { base = null; }
        const last = ((base && base.value) || [])[0];
        if (last && last.result === 'failed') out.ci.baseFailing = true;
      }
    }
  }

  const th = await ado.call('GET', `${repoPath}/pullRequests/${id}/threads`, { project });
  out.threads = threadsOf(th.value, pr.createdBy && pr.createdBy.id);
  return out;
}
