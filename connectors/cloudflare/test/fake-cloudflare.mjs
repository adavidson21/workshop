// A fake Cloudflare API v4 for the connector's tests: a fetch function over an in-memory account. It checks the
// token on every call and records what was asked, so tests can say exactly what reached Cloudflare.
export const ACCOUNT = '0123456789abcdef0123456789abcdef';
export const TOKEN = 'cf-test-token-0123456789abcdefghij';
export const ZONE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const REC_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const BUILD = '11111111-2222-3333-4444-555555555555';
export const VERSION = '99999999-8888-7777-6666-555555555555';
export const DEPLOY = 'dddddddd-eeee-ffff-0000-111111111111';

export function fakeCloudflare({ token = TOKEN, verify = { status: 'active', expires_on: '2027-02-01T00:00:00Z' } } = {}) {
  const calls = [];
  const db = {
    zones: [{ id: ZONE_ID, name: 'example.org', status: 'active', plan: { name: 'Free Website' } }, { id: 'c'.repeat(32), name: 'other.net', status: 'active', plan: { name: 'Free Website' } }],
    records: [{ id: REC_ID, zone: ZONE_ID, type: 'CNAME', name: 'old.example.org', content: 'old.pages.dev', proxied: true, ttl: 1 }],
    scripts: [{ id: 'rally', tag: 'tag-rally', modified_on: '2026-11-18T00:00:00Z', has_assets: true }],
    domains: [{ id: 'dom-1', hostname: 'rally.example.org', service: 'rally', zone_name: 'example.org', enabled: true }],
    projects: [{ name: 'wishlist', subdomain: 'wishlist.pages.dev', domains: ['wishlist.example.org'], production_branch: 'main', source: { config: { owner: 'me', repo_name: 'wishlist' } },
      deployment_configs: { production: { env_vars: { MODE: { type: 'plain_text', value: 'live' }, API_TOKEN: { type: 'secret_text', value: '' } } }, preview: { env_vars: {} } },
      build_config: { build_command: 'npm run build', destination_dir: 'dist' } }]
  };
  const ok = (result, info) => new Response(JSON.stringify({ success: true, errors: [], result, ...(info ? { result_info: info } : {}) }), { status: 200, headers: { 'content-type': 'application/json' } });
  const err = (status, message) => new Response(JSON.stringify({ success: false, errors: [{ code: status, message }], result: null }), { status });
  const A = `/accounts/${ACCOUNT}`;

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const p = u.pathname.replace(/^\/client\/v4/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: p, query: Object.fromEntries(u.searchParams), body, auth: init.headers && init.headers.Authorization });
    if (u.host !== 'api.cloudflare.test') return err(599, 'wrong host');
    if (!init.headers || init.headers.Authorization !== `Bearer ${token}`) return err(401, 'Invalid API Token');

    if (method === 'GET' && p === '/user/tokens/verify') return ok({ id: 't', ...verify });
    if (method === 'GET' && p === '/zones') {
      const name = u.searchParams.get('name');
      return ok(db.zones.filter(z => !name || z.name === name), { page: 1, total_pages: 1 });
    }
    let m;
    if ((m = p.match(/^\/zones\/(\w+)\/dns_records$/))) {
      if (method === 'GET') return ok(db.records.filter(r => r.zone === m[1]), { page: 1, total_pages: 1 });
      if (method === 'POST') { const r = { id: 'e'.repeat(32), zone: m[1], ...body }; db.records.push(r); return ok(r); }
    }
    if ((m = p.match(/^\/zones\/(\w+)\/dns_records\/(\w+)$/))) {
      const r = db.records.find(x => x.id === m[2] && x.zone === m[1]);
      if (!r) return err(404, 'Record not found');
      if (method === 'GET') return ok(r);
      if (method === 'PATCH') { Object.assign(r, body); return ok(r); }
      if (method === 'DELETE') { db.records.splice(db.records.indexOf(r), 1); return ok({ id: r.id }); }
    }
    if (p === `${A}/workers/scripts` && method === 'GET') return ok(db.scripts);
    if (p === `${A}/workers/domains`) {
      if (method === 'GET') { const h = u.searchParams.get('hostname'); return ok(db.domains.filter(d => !h || d.hostname === h)); }
      if (method === 'PUT') { const d = { id: `dom-${db.domains.length + 1}`, enabled: true, ...body }; db.domains.push(d); return ok(d); }
    }
    if ((m = p.match(new RegExp(`^${A}/workers/domains/([\\w-]+)$`))) && method === 'DELETE') { db.domains = db.domains.filter(d => d.id !== m[1]); return ok(null); }
    if (p === `${A}/builds/workers/tag-rally/builds` && method === 'GET') {
      return ok([{ build_uuid: BUILD, status: 'stopped', build_outcome: 'fail', created_on: '2026-11-18T10:00:00Z', stopped_on: '2026-11-18T10:02:00Z', build_trigger_metadata: { branch: 'main', commit_hash: 'abc123', commit_message: 'Add Rally' } }]);
    }
    if (p === `${A}/builds/builds/${BUILD}/logs`) return ok({ lines: [[1763460000, 'Installing'], [1763460010, 'Error: wrangler.jsonc not found']], truncated: false, cursor: null });
    if (p === `${A}/builds/workers/tag-rally/builds/${BUILD}/retry` && method === 'POST') return ok({ build_uuid: 'new-build' });
    if (p === `${A}/workers/scripts/rally/deployments` && method === 'POST') return ok({ id: 'dep-1', ...body });
    if (p === `${A}/pages/projects`) {
      if (method === 'GET') return ok(db.projects, { page: 1, total_pages: 1 });
      if (method === 'POST') { const pr = { ...body, subdomain: `${body.name}.pages.dev` }; db.projects.push(pr); return ok(pr); }
    }
    if ((m = p.match(new RegExp(`^${A}/pages/projects/([\\w-]+)$`)))) {
      const pr = db.projects.find(x => x.name === m[1]);
      if (!pr) return err(404, 'Project not found');
      if (method === 'GET') return ok(pr);
      if (method === 'PATCH') return ok(pr);
    }
    if ((m = p.match(new RegExp(`^${A}/pages/projects/([\\w-]+)/domains$`))) && method === 'POST') return ok({ name: body.name });
    if ((m = p.match(new RegExp(`^${A}/pages/projects/([\\w-]+)/deployments$`)))) return ok([{ id: DEPLOY, environment: 'production', url: 'https://x.pages.dev', latest_stage: { name: 'build', status: 'failure' }, deployment_trigger: { metadata: { branch: 'main', commit_hash: 'def', commit_message: 'Oops' } }, created_on: '2026-11-18' }]);
    if ((m = p.match(new RegExp(`^${A}/pages/projects/([\\w-]+)/deployments/([\\w-]+)/history/logs$`)))) return ok({ data: [{ ts: '2026-11-18T10:00:01Z', line: 'npm ERR! missing script: build' }], total: 1 });
    return err(404, `No fake for ${method} ${p}`);
  }
  return { fetchImpl, calls, db, writes: () => calls.filter(c => c.method !== 'GET') };
}
