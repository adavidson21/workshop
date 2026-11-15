// "sync.prs": pull requests waiting on my review, in the ADO connector's shape ({items, gone, notes, notNeeded}).
//
// GitHub has no per-person "required reviewer" or "waiting for author" vote, so the tiers map like this:
//   blocking  you were asked by name, you are the only reviewer still asked, and the PR needs a review to merge
//   asked     you were asked by name
//   pool      only one of your teams was asked
// Your latest review decides whether it is still on you once GitHub drops your request: Changes requested =
// waiting (like ADO's Waiting for author), Approved or Commented = reviewed (done).
// Not needed (cfg.prNotNeeded), never for blocking: team-only PRs (teamOnly), PRs already approved enough to
// merge (canMerge, GitHub's review decision), and PRs this many other people approved (approvals).
import { GhError } from './client.mjs';
import { inScope } from './config.mjs';

const PR_FIELDS = `number title url createdAt isDraft state merged headRefOid reviewDecision
  repository{nameWithOwner name} author{login}
  reviewRequests(first:50){nodes{requestedReviewer{__typename ... on User{login} ... on Team{slug organization{login}}}}}
  latestReviews(first:50){nodes{state author{login}}}`;
const SEARCH_Q = `query($q:String!){search(query:$q,type:ISSUE,first:100){nodes{... on PullRequest{${PR_FIELDS}}}}}`;

export function prKey(web, repo, number) {
  return `${String(web).replace(/\/+$/, '')}|${repo}|${number}`;
}

const lc = s => String(s || '').toLowerCase();

/** [status, info] for one PR. status: review, waiting, reviewed, covered, notneeded, unassigned, draft, own, merged, abandoned. */
export function classify(pr, { me, teams, web, nn }) {
  const repo = pr.repository?.nameWithOwner || '';
  const reqs = (pr.reviewRequests?.nodes || []).map(n => n.requestedReviewer).filter(Boolean);
  const users = reqs.filter(r => r.__typename === 'User').map(r => lc(r.login));
  const teamReqs = reqs.filter(r => r.__typename === 'Team').map(r => `${lc(r.organization?.login)}/${lc(r.slug)}`);
  const meAsked = users.includes(lc(me));
  const myTeams = teamReqs.filter(t => teams.has(t));
  const reviews = (pr.latestReviews?.nodes || []).filter(r => r.author);
  const mine = reviews.find(r => lc(r.author.login) === lc(me)) || null;
  const othersApproved = reviews.filter(r => lc(r.author.login) !== lc(me) && r.state === 'APPROVED').length;
  const blocking = meAsked && pr.reviewDecision === 'REVIEW_REQUIRED' && users.length === 1 && teamReqs.length === 0;
  const info = {
    key: prKey(web, repo, pr.number),
    id: pr.number,
    title: pr.title || '',
    repo: pr.repository?.name || repo.split('/').pop() || '',
    project: repo,
    author: pr.author?.login || '',
    created: typeof pr.createdAt === 'string' ? pr.createdAt.slice(0, 10) : null,
    url: pr.url || '',
    commit: pr.headRefOid || null,
    tier: blocking ? 'blocking' : meAsked ? 'asked' : 'pool',
    via: myTeams.map(t => teams.get(t)),
    lastBlocker: Boolean(blocking && othersApproved > 0)
  };
  if (pr.merged || pr.state === 'MERGED') return ['merged', info];
  if (pr.state === 'CLOSED') return ['abandoned', info];
  if (lc(pr.author?.login) === lc(me)) return ['own', info];
  if (pr.isDraft) return ['draft', info];
  if (!meAsked) {
    if (mine && mine.state === 'CHANGES_REQUESTED') return ['waiting', info];
    if (mine) return ['reviewed', info];
    if (!myTeams.length) return [reviews.length ? 'covered' : 'unassigned', info];
  }
  if (!blocking && nn) {
    const why = !meAsked && nn.teamOnly ? 'team'
      : nn.canMerge && pr.reviewDecision === 'APPROVED' ? 'merge'
      : nn.approvals > 0 && othersApproved >= nn.approvals ? 'approvals' : null;
    if (why) { info.notNeeded = why; return ['notneeded', info]; }
  }
  return ['review', info];
}

/** Repo qualifiers for a search, from the repos setting. */
const repoQ = cfg => cfg.repos.map(r => ` repo:${r}`).join('');

/** PRs on me now, plus what happened to known PRs that dropped off. `gh` is a client from clientFor. */
export async function syncPrs(d, knownList, gh) {
  const me = await gh.me();
  const notes = [];
  const teams = new Map(); // org/slug (lower case) -> display name
  try {
    const rows = await gh.pages('/user/teams', {}, 500);
    const wanted = new Set(d.cfg.prTeams);
    for (const t of rows) {
      const key = `${lc(t.organization?.login)}/${lc(t.slug)}`;
      if (!wanted.size || wanted.has(key) || wanted.has(lc(t.name))) teams.set(key, t.name || t.slug);
    }
  } catch (e) {
    if (!(e instanceof GhError)) throw e;
    notes.push(`Team PRs skipped: ${e.message}`);
  }
  const ctx = { me, teams, web: gh.web, nn: d.cfg.prNotNeeded };
  const found = new Map();
  for (const q of [`is:pr is:open archived:false review-requested:@me${repoQ(d.cfg)}`,
    `is:pr is:open archived:false reviewed-by:@me -author:@me${repoQ(d.cfg)}`]) {
    const res = await gh.graphql(SEARCH_Q, { q });
    for (const pr of res?.search?.nodes || []) {
      if (!pr || !pr.repository || !inScope(d.cfg, pr.repository.nameWithOwner)) continue;
      found.set(prKey(gh.web, pr.repository.nameWithOwner, pr.number), pr);
    }
  }
  const items = [];
  const gone = [];
  let notNeeded = 0;
  const known = new Set(knownList);
  const seen = new Set();
  const take = (st, info) => {
    if (st === 'notneeded') notNeeded++;
    if (st === 'review' || st === 'waiting') { info.waiting = st === 'waiting'; items.push(info); seen.add(info.key); }
    else if (known.has(info.key)) { info.reason = st; gone.push(info); seen.add(info.key); }
  };
  for (const pr of found.values()) {
    const [st, info] = classify(pr, ctx);
    // A PR you reviewed earlier, found only by reviewed-by: on you again only if it is known (waiting) or asked.
    if (st === 'reviewed' && !known.has(info.key)) continue;
    if (st === 'waiting' && !known.has(info.key)) continue;
    take(st, info);
  }
  // Known PRs from this host that neither search found: ask for each (one GraphQL call, up to 50).
  const prefix = `${String(gh.web).replace(/\/+$/, '')}|`;
  const missing = [...known].filter(k => k.startsWith(prefix) && !seen.has(k)).slice(0, 50);
  if (missing.length) {
    const parts = [];
    const keys = [];
    missing.forEach((k, i) => {
      const [, repo, num] = k.split('|');
      const [owner, name] = String(repo || '').split('/');
      if (!owner || !name || !/^\d+$/.test(num || '')) { gone.push({ key: k, reason: 'missing' }); return; }
      parts.push(`p${i}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){pullRequest(number:${Number(num)}){${PR_FIELDS}}}`);
      keys.push([`p${i}`, k]);
    });
    if (parts.length) {
      const res = await gh.graphql(`query{${parts.join('\n')}}`, {}, { partial: true });
      for (const [alias, k] of keys) {
        const pr = res?.[alias]?.pullRequest;
        if (!pr) { gone.push({ key: k, reason: 'missing' }); continue; }
        const [st, info] = classify(pr, ctx);
        if (st === 'review' || st === 'waiting') { info.waiting = st === 'waiting'; items.push(info); }
        else { info.reason = st; gone.push(info); }
      }
    }
  }
  return { items, gone, notes, notNeeded };
}
