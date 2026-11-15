// A fake GitHub API on 127.0.0.1 for the connector tests: the REST calls and the three GraphQL queries the connector
// makes, from synthetic data. Records every request. No real data.
import http from 'node:http';

export const TOKEN = 'test-github-token';
export const EXPIRES = '2099-01-31 00:00:00 UTC';

const issue = (repo, number, title, { labels = [], assignees = ['me'], state = 'open', reason = null, milestone = null, body = '', pr = false, updated = '2026-11-10T12:00:00Z', subs = null } = {}) => ({
  id: 1000 + number, number, title, state, state_reason: reason, body, comments: 2,
  labels: labels.map(name => ({ name })), assignees: assignees.map(login => ({ login })), assignee: assignees[0] ? { login: assignees[0] } : null,
  milestone, updated_at: updated, html_url: `https://github.com/${repo}/issues/${number}`,
  repository_url: `https://api.github.com/repos/${repo}`, repository: { full_name: repo },
  ...(subs ? { sub_issues_summary: { total: subs[0], completed: subs[1], percent_completed: 0 } } : {}),
  ...(pr ? { pull_request: { url: 'x' } } : {})
});

const pr = (repo, number, title, { author = 'alex', draft = false, state = 'OPEN', merged = false, decision = 'REVIEW_REQUIRED', users = [], teams = [], reviews = [], head = 'abc1234' } = {}) => ({
  number, title, url: `https://github.com/${repo}/pull/${number}`, createdAt: '2026-11-09T10:00:00Z', isDraft: draft, state, merged,
  headRefOid: head, reviewDecision: decision, repository: { nameWithOwner: repo, name: repo.split('/')[1] }, author: { login: author },
  reviewRequests: { nodes: [...users.map(login => ({ requestedReviewer: { __typename: 'User', login } })),
    ...teams.map(t => ({ requestedReviewer: { __typename: 'Team', slug: t.split('/')[1], organization: { login: t.split('/')[0] } } }))] },
  latestReviews: { nodes: reviews.map(([login, s]) => ({ state: s, author: { login } })) }
});

/** The default scenario. Tests may change it before starting the server. */
export function scenario() {
  const m1 = { id: 501, number: 1, title: 'v2.1', state: 'open', due_on: '2026-12-15T08:00:00Z', updated_at: '2026-11-01T00:00:00Z', html_url: 'https://github.com/acme/web/milestone/1' };
  const m2 = { id: 502, number: 2, title: 'v3.0', state: 'open', due_on: null, updated_at: '2026-11-02T00:00:00Z', html_url: 'https://github.com/acme/web/milestone/2' };
  return {
    me: 'me',
    issues: {
      'acme/web': [
        issue('acme/web', 1, 'Fix login timeout', { labels: ['bug', 'P2', 'area: auth'], milestone: m1,
          body: 'The login page times out.\n\n## Repro steps\n1. Open login\n2. Wait\n\n## Acceptance criteria\n- No timeout' }),
        issue('acme/web', 2, 'Add dark mode', { labels: ['story'] }),
        issue('acme/web', 3, 'Big epic', { labels: ['epic'] }),
        issue('acme/web', 4, 'A pull request', { pr: true }),
        issue('acme/web', 5, 'Closed done', { state: 'closed', reason: 'completed' }),
        issue('acme/web', 6, 'Closed not planned', { state: 'closed', reason: 'not_planned' }),
        issue('acme/web', 7, 'Someone else has it', { assignees: ['sam'] }),
        issue('acme/web', 40, 'Sign-in overhaul', { labels: ['feature', 'area: auth'], milestone: m1, assignees: ['kim'], subs: [2, 1],
          body: 'Make sign-in faster.\n\n## Release note\nSign-in is faster.' }),
        issue('acme/web', 41, 'Reports', { labels: ['feature'], assignees: [] }),
        issue('acme/web', 42, 'Old feature', { labels: ['feature'], state: 'closed', reason: 'completed', assignees: [] })
      ],
      'me/tools': [issue('me/tools', 9, 'Personal task')]
    },
    milestones: { 'acme/web': [m1, m2] },
    subIssues: { 'acme/web#40': [issue('acme/web', 43, 'Faster token check', { labels: ['story'], assignees: [] }), issue('acme/web', 44, 'Done story', { labels: ['story'], state: 'closed', assignees: [] })] },
    parents: { 'acme/web#2': { number: 3, title: 'Big epic', url: 'https://github.com/acme/web/issues/3', state: 'OPEN', repository: { nameWithOwner: 'acme/web' }, labels: { nodes: [{ name: 'epic' }] } } },
    comments: { 'acme/web#1': [{ id: 1, body: 'First', user: { login: 'sam' }, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' }] },
    teams: [{ slug: 'platform', name: 'Platform', organization: { login: 'acme' } }],
    prs: {
      requested: [
        pr('acme/web', 10, 'Only me asked', { users: ['me'] }),
        pr('acme/web', 11, 'Me and sam asked', { users: ['me', 'sam'] }),
        pr('acme/web', 12, 'Team only', { teams: ['acme/platform'] }),
        pr('acme/web', 13, 'Draft', { users: ['me'], draft: true }),
        pr('acme/web', 14, 'Approved twice', { users: ['me', 'kim'], reviews: [['sam', 'APPROVED'], ['lee', 'APPROVED']], decision: 'REVIEW_REQUIRED' }),
        pr('me/tools', 15, 'My own', { author: 'me', users: ['me'] })
      ],
      reviewed: [
        pr('acme/web', 20, 'I requested changes', { reviews: [['me', 'CHANGES_REQUESTED']] }),
        pr('acme/web', 21, 'I approved', { reviews: [['me', 'APPROVED']] })
      ],
      byNumber: {
        'acme/web#30': pr('acme/web', 30, 'Merged since', { merged: true, state: 'MERGED' })
      }
    }
  };
}

export async function startFakeGitHub(data = scenario()) {
  const requests = [];
  const all = () => Object.values(data.issues).flat();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization || '' });
      const send = (status, obj, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', 'github-authentication-token-expiration': EXPIRES, ...headers });
        res.end(obj === undefined ? '' : JSON.stringify(obj));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Bad credentials' });
      if (data.rateLimited) return send(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4102444800' });
      const p = u.pathname;
      if (req.method === 'GET' && p === '/user') return send(200, { login: data.me });
      if (req.method === 'GET' && p === '/user/teams') return data.teamsForbidden ? send(403, { message: 'Resource not accessible' }) : send(200, data.teams);
      if (req.method === 'GET' && p === '/issues') {
        const rows = all().filter(i => i.state === 'open' && i.assignees.some(a => a.login === data.me));
        const page = Number(u.searchParams.get('page') || 1);
        const per = Number(u.searchParams.get('per_page') || 30);
        return send(200, rows.slice((page - 1) * per, page * per));
      }
      let mm = p.match(/^\/repos\/([^/]+\/[^/]+)\/milestones$/);
      if (req.method === 'GET' && mm) {
        const st = u.searchParams.get('state') || 'open';
        return send(200, (data.milestones[mm[1]] || []).filter(x => st === 'all' || x.state === st));
      }
      mm = p.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/);
      if (req.method === 'GET' && mm) {
        const st = u.searchParams.get('state') || 'open';
        const want = (u.searchParams.get('labels') || '').split(',').filter(Boolean).map(x => x.toLowerCase());
        const rows = (data.issues[mm[1]] || []).filter(i => (st === 'all' || i.state === st) && want.every(w => i.labels.some(l => l.name.toLowerCase() === w)));
        return send(200, rows);
      }
      mm = p.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/sub_issues$/);
      if (req.method === 'GET' && mm) return send(200, data.subIssues[`${mm[1]}#${mm[2]}`] || []);
      let m = p.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)(\/comments)?$/);
      if (req.method === 'GET' && m) {
        const it = (data.issues[m[1]] || []).find(i => i.number === Number(m[2]));
        if (!it) return send(404, { message: 'Not Found' });
        if (m[3]) return send(200, data.comments[`${m[1]}#${m[2]}`] || []);
        return send(200, it);
      }
      if (req.method === 'POST' && p === '/graphql') {
        if (data.graphqlDown) return send(502, { message: 'Server Error' });
        let q;
        try { q = JSON.parse(body); } catch { return send(400, { message: 'bad json' }); }
        const text = String(q.query || '');
        if (text.includes('search(')) {
          const s = String(q.variables?.q || '');
          const nodes = s.includes('review-requested:@me') ? data.prs.requested : s.includes('reviewed-by:@me') ? data.prs.reviewed : [];
          return send(200, { data: { search: { nodes } } });
        }
        if (text.includes('parent{')) {
          const key = `${q.variables.owner}/${q.variables.name}#${q.variables.number}`;
          return send(200, { data: { repository: { issue: { parent: data.parents[key] || null, subIssuesSummary: { total: 2, completed: 1 } } } } });
        }
        const out = {};
        for (const a of text.matchAll(/(p\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)\{pullRequest\(number:(\d+)\)/g)) {
          const found = data.prs.byNumber[`${a[2]}/${a[3]}#${a[4]}`];
          out[a[1]] = { pullRequest: found || null };
        }
        return send(200, { data: out });
      }
      send(404, { message: 'Not Found' });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, data, close: () => new Promise(r => server.close(r)) };
}
