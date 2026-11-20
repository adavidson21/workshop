/* The code review screen's data, behind one interface:
     item(id)                         { id, title, folder, repos: [repo folder, ...], ready, published, prItems: ["repo: branch → target"] }
     session(id, repo)                ReviewSession
     file(id, repo, path, side)       FileContent
     submit(id, repo, feedback)       { ok, status, revision, submittedAt }
     publish(folder)                  { ok, folder, repos: [{repo, branch, target, pr}] }: Loom's Publish (every branch of the build)
     revise(id)                       { ok }: start Tandem on comments it is not working on (review.revise)
     onChange(id, repo, fn)           calls fn when that review changes; returns an unsubscribe function
   Since connector 1.28.0 Approve publishes the build and Send back (request changes) runs Tandem's /revise; the
   screen no longer pushes one branch on its own.
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
      const pub = (d.publish || {})[it.folder] || null;
      const reviewed = Object.keys((d.reviews || {})[it.folder] || {});
      const repos = [...new Set([...(it.pr || []).map(p => p.repo), ...reviewed].filter(Boolean))];
      const targets = [...new Set((it.pr || []).map(r => String(r.target || 'main').replace(/^origin\//, '')))];
      return { id: String(it.id || it.folder), title: it.title || it.folder, folder: it.folder, repos, ready: !!(it.next && it.next.stage === 'ship'), published: !!(pub && pub.published),
        prItems: (it.pr || []).map(r => `${r.repo}: ${r.branch || '?'} → ${r.target || 'main'}`),
        // Merge without a PR (connector 1.29.0): Approve merges into the target instead.
        merge: !!(pub && pub.mode === 'merge'), mergeInto: targets.length === 1 ? targets[0] : null };
    },
    session: (id, repo) => read('review.session', { id, repo }),
    file: (id, repo, path, side) => read('review.file', { id, repo, path, side }),
    // A write action: the reviewer's click on Approve or Request changes is the approval.
    submit: (id, repo, feedback) => ws.connectors.call(OC, 'review.submit', { id, repo, feedback }, { confirm: true }),
    // Write actions, sent only from the click on Approve and publish (after the outside confirm), or Start Tandem on them.
    publish: folder => ws.connectors.call(OC, 'publish', { folder }, { confirm: true }),
    revise: id => ws.connectors.call(OC, 'review.revise', { id }, { confirm: true }),
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
  const stalled = new Set();
  let published = false;
  let publishFails = 0;
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
    publishes: [], // for tests: every publish, in order
    failNextPublish() { publishFails += 1; }, // for tests: the next publish fails, as git would
    revises: 0, // for tests: Start Tandem on them clicks
    // For tests: Tandem stops on the comments (the banner then offers Start Tandem on them).
    stall(repo) { stalled.add(repo); },
    // For tests: the branch moves on, as if the agent or someone else committed meanwhile.
    moveHead(repo) { repos[repo].headN += 50; },
    async item(id) {
      if (id !== FIXTURE.id) throw fail('not_found', `No work item ${id} in .work.`);
      return { id: FIXTURE.id, title: FIXTURE.title, folder: FIXTURE.folder, repos: Object.keys(FIXTURE.repos), ready: true, published,
        prItems: Object.entries(FIXTURE.repos).map(([name, r]) => `${name}: ${r.branch} → main`) };
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
        ...(r.def.notes ? { notes: r.def.notes } : {}),
        ...(r.def.threads ? { threads: r.def.threads } : {}),
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
      r.run = { status: 'running', message: 'Running /revise L1 auto', session: 'ses_mock', revision: r.revision };
      const saved = { ...clone(fb), submittedAt };
      r.saved = saved;
      setTimeout(() => changed(repo), 0);
      if (stalled.has(repo)) {
        r.run = { status: 'failed', message: 'Tandem stopped.', session: null, revision: r.revision };
        return { ok: true, status: r.status, revision: r.revision, submittedAt };
      }
      agent(r, repo, saved);
      return { ok: true, status: r.status, revision: r.revision, submittedAt };
    },
    async revise(id) {
      if (id !== FIXTURE.id) throw fail('not_found', `No work item ${id} in .work.`);
      const list = Object.entries(repos).filter(([, r]) => r.status === 'revising');
      if (!list.length) throw fail('conflict', 'There are no comments waiting for Tandem on this item.');
      api.revises += 1;
      for (const [name, r] of list) { stalled.delete(name); r.run = { status: 'running', message: 'Running /revise L1 auto', session: 'ses_mock', revision: r.revision }; changed(name); agent(r, name, r.saved); }
      return { ok: true };
    },
    async publish(folder) {
      if (folder !== FIXTURE.folder) throw fail('not_found', `No work item folder "${folder}".`);
      if (publishFails > 0) { publishFails -= 1; throw fail('unavailable', 'Push failed for shop-api: could not reach origin.'); }
      published = true;
      api.publishes.push(folder);
      return { ok: true, folder, repos: Object.entries(FIXTURE.repos).map(([name, r]) => ({ repo: name, branch: r.branch, target: 'main', pr: null })) };
    },
    onChange(id, repo, fn) {
      const l = { repo, fn };
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  // The mock Tandem: fixes, answers every comment, and returns the item to review as the next revision.
  function agent(r, repo, saved) {
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
        r.run = null;
        changed(repo);
      }, agentDelayMs);
  }
  return api;
}
