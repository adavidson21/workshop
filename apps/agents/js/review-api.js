/* The code review screen's data, behind one interface:
     item(id)                         { id, title, folder, repos: [repo folder, ...], pushed: { repo: true|false } }
     session(id, repo)                ReviewSession
     file(id, repo, path, side)       FileContent
     submit(id, repo, feedback)       { ok, status, revision, submittedAt }
     push(folder, repo)               { ok, message }: the existing Push (git push -u origin <pr.md branch>)
     onChange(id, repo, fn)           calls fn when that review changes; returns an unsubscribe function
   reviewApi(ws) uses the opencode connector (connectors/opencode/README.md, Code review).
   mockReviewApi() serves FIXTURE from memory, so the screen can be tried and tested with no agent:
   open review.html?mock=1. It also plays the agent: request changes comes back as revision 2. */

import { FIXTURE } from './review-fixture.js';

const OC = 'opencode';

export function reviewApi(ws) {
  const read = (action, args) => ws.connectors.call(OC, action, args);
  return {
    async item(id) {
      const d = await read('state');
      const it = (d.items || []).find(i => String(i.id) === String(id) || i.folder === id);
      if (!it) throw Object.assign(new Error(`No work item ${id} in .work.`), { code: 'not_found' });
      const pushed = {};
      for (const p of it.pr || []) if (p.repo) pushed[p.repo] = !!(p.push && p.push.remote && !p.push.unpushed);
      return { id: String(it.id || it.folder), title: it.title || it.folder, folder: it.folder, repos: [...new Set((it.pr || []).map(p => p.repo).filter(Boolean))], pushed };
    },
    session: (id, repo) => read('review.session', { id, repo }),
    file: (id, repo, path, side) => read('review.file', { id, repo, path, side }),
    // A write action: the reviewer's click on Approve or Request changes is the approval.
    submit: (id, repo, feedback) => ws.connectors.call(OC, 'review.submit', { id, repo, feedback }, { confirm: true }),
    // Also a write action, sent only from the click on Approve and Push PR (or Push PR after a failed push).
    push: (folder, repo) => ws.connectors.call(OC, 'push', { folder, repo }, { confirm: true }),
    onChange(id, repo, fn) {
      const off = ws.connectors.on(OC, 'review', p => { if (p && String(p.id) === String(id) && p.repo === repo) fn(); });
      return typeof off === 'function' ? off : () => {};
    },
  };
}

const fail = (code, message) => Object.assign(new Error(message), { code });
const sha = n => (n.toString(16).padStart(2, '0')).repeat(20);
const clone = v => JSON.parse(JSON.stringify(v));

export function mockReviewApi({ agentDelayMs = 1500 } = {}) {
  const repos = {};
  for (const [name, r] of Object.entries(FIXTURE.repos)) {
    repos[name] = { def: r, revision: 1, status: 'awaiting_review', head: { ...r.head }, files: r.files, prevHead: null, previousFeedback: null, previousResponses: null, since: null, run: null, headN: name === 'shop-api' ? 1 : 11 };
  }
  const listeners = new Set();
  const pushed = Object.fromEntries(Object.keys(FIXTURE.repos).map(r => [r, false]));
  let pushFails = 0;
  const changed = (repo) => { for (const l of listeners) if (l.repo === repo) l.fn(); };
  const repoOf = (id, repo) => {
    if (id !== FIXTURE.id) throw fail('not_found', `No work item ${id} in .work.`);
    const r = repos[repo];
    if (!r) throw fail('conflict', `Work item ${id} has no pr.md section for ${repo} yet.`);
    return r;
  };

  const api = {
    mock: true,
    lastFeedback: null, // for tests: the last ReviewFeedback submitted
    pushes: [], // for tests: every push, in order
    failNextPush() { pushFails += 1; }, // for tests: the next push fails, as git would
    // For tests: the branch moves on, as if the agent or someone else committed meanwhile.
    moveHead(repo) { repos[repo].headN += 50; },
    async item(id) {
      if (id !== FIXTURE.id) throw fail('not_found', `No work item ${id} in .work.`);
      return { id: FIXTURE.id, title: FIXTURE.title, folder: FIXTURE.folder, repos: Object.keys(FIXTURE.repos), pushed: { ...pushed } };
    },
    async session(id, repo) {
      const r = repoOf(id, repo);
      return clone({
        workItemId: id, repo, revision: r.revision, branch: r.def.branch, baseBranch: r.def.baseBranch,
        baseSha: sha(r.headN + 100), headSha: sha(r.headN), status: r.status, files: r.files,
        ...(r.previousFeedback ? { previousFeedback: r.previousFeedback } : {}),
        ...(r.previousResponses ? { previousResponses: r.previousResponses } : {}),
        ...(r.since ? { sinceLastReview: r.since } : {}),
        ...(r.run ? { revisionRun: r.run } : {}),
      });
    },
    async file(id, repo, path, side) {
      const r = repoOf(id, repo);
      const src = side === 'old' ? r.def.base : side === 'prev' ? r.prevHead : r.head;
      if (side === 'prev' && !src) throw fail('bad_request', 'side=prev is only for revision 2 and later.');
      return path in src ? { kind: 'text', text: src[path] } : { kind: 'absent' };
    },
    async submit(id, repo, fb) {
      const r = repoOf(id, repo);
      if (r.status !== 'awaiting_review') throw fail('conflict', `This review is ${r.status.replace('_', ' ')}, so it cannot take a new verdict.`);
      if (fb.revision !== r.revision) throw fail('conflict', `This is revision ${r.revision}, not ${fb.revision}. Reload the review.`);
      if (fb.headSha !== sha(r.headN)) throw fail('conflict', `${r.def.branch} changed since this review was loaded. Reload to see the new code.`);
      const submittedAt = new Date().toISOString();
      api.lastFeedback = clone(fb);
      if (fb.verdict === 'approve') {
        r.status = 'approved';
        setTimeout(() => changed(repo), 0);
        return { ok: true, status: r.status, revision: r.revision, submittedAt };
      }
      r.status = 'revising';
      r.run = { status: 'running', message: 'The agent is revising.', session: 'ses_mock', revision: r.revision };
      const saved = { ...clone(fb), submittedAt };
      setTimeout(() => changed(repo), 0);
      // The mock agent: commits a fix, answers every comment, and returns the item to review.
      setTimeout(() => {
        r.prevHead = { ...r.head };
        Object.assign(r.head, r.def.revised || {});
        r.files = r.def.revisedFiles || r.files;
        r.since = r.def.since || [];
        r.previousFeedback = saved;
        r.previousResponses = saved.comments.map(c => ({
          commentId: c.id,
          status: c.type === 'question' ? 'answered' : 'fixed',
          note: c.type === 'question' ? 'Answered in the response file.' : 'Changed as asked.',
        }));
        r.revision += 1;
        r.headN += 1;
        r.status = 'awaiting_review';
        r.run = { status: 'done', message: `Revision ${r.revision} is ready for review.`, session: 'ses_mock', revision: r.revision - 1 };
        changed(repo);
      }, agentDelayMs);
      return { ok: true, status: r.status, revision: r.revision, submittedAt };
    },
    async push(folder, repo) {
      if (folder !== FIXTURE.folder || !(repo in pushed)) throw fail('not_found', `No work item folder "${folder}".`);
      if (pushFails > 0) { pushFails -= 1; throw fail('unavailable', `Push failed for ${repo}: could not reach origin.`); }
      pushed[repo] = true;
      api.pushes.push(repo);
      return { ok: true, message: `Pushed ${FIXTURE.repos[repo].branch} in ${repo}.` };
    },
    onChange(id, repo, fn) {
      const l = { repo, fn };
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return api;
}
