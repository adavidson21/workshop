// The Cloudflare connector (README.md): reads your Cloudflare account (zones, DNS, Workers, Workers Builds,
// Pages) and makes changes only from a change set a person applied in Workshop. Tandem's agents can read and
// propose through /api/tools (docs/agent-api.md, Tools for agents); they can never apply. The token comes from
// this computer's secret store (`workshop secret set cloudflare`), never an environment variable. Off in work
// mode: it is for your own computer. Node standard library only. It calls only the API address in its settings.
import { CfError, DEFAULT_API, SettingsError, clientFor } from './lib/client.mjs';
import { OPS, MAX_CHANGES, applySet, checkSet, describe, normalize, preview, scriptTag, zoneIds, zoneOf } from './lib/changes.mjs';
import * as store from './lib/store.mjs';

const enc = encodeURIComponent;
let running = null;      // ctx while started
let state = { verified: null, problem: null, expiresOn: null, checking: false };
let waiting = 0;
let fetchImpl = null;    // tests only

/** Tests point the client at a fake fetch. */
export function setFetch(f) { fetchImpl = f; }

function guard(ctx, meta) {
  if (ctx.workMode()) throw new SettingsError('The Cloudflare connector is off in work mode. It is for your own computer.', 'disabled');
  if (!ctx.config.accountId) throw new SettingsError('Add your Cloudflare account ID in Settings, Cloudflare first.');
  if (meta && meta.caller === 'agent' && ctx.config.agents !== true) throw new SettingsError('Tandem may not use Cloudflare: "Let Tandem read and propose changes" is off in Settings, Cloudflare.', 'forbidden');
}

async function cf(ctx, meta) {
  guard(ctx, meta);
  try { return await clientFor(ctx, { fetchImpl }); }
  catch (e) { noteAuth(e); throw e; }
}

function noteAuth(e) {
  if (e instanceof CfError && (e.upstream === 401 || /No Cloudflare token saved/.test(e.message))) {
    state.problem = e.message;
    if (running) running.statusChanged();
  }
}

/** Runs fn with a client; a 401 or a missing token shows on the connector's status. */
const withCf = fn => async (args, ctx, meta) => {
  const c = await cf(ctx, meta);
  try { return await fn(c, args || {}, ctx, meta); } catch (e) { noteAuth(e); throw e; }
};

function countWaiting(ctx) {
  try { waiting = store.list(ctx.dataDir).filter(s => s.status === 'waiting').length; } catch { waiting = 0; }
  return waiting;
}
function changed(ctx) {
  countWaiting(ctx);
  try { ctx.emit('changes', { waiting }); } catch { /* best effort */ }
  ctx.statusChanged();
}

async function verify(c) {
  // A user token verifies at /user/tokens/verify, an account token at /accounts/<id>/tokens/verify.
  let r, kind = 'user';
  try { r = await c.get('/user/tokens/verify'); }
  catch (first) {
    if (!(first instanceof CfError) || !first.upstream) throw first;
    kind = 'account';
    try { r = await c.get(c.acct('tokens/verify')); } catch { throw first; }
  }
  return { status: r && r.status, expiresOn: (r && r.expires_on) || null, notBefore: (r && r.not_before) || null, kind };
}

const zoneArg = { type: 'string', minLength: 3, maxLength: 253 };
const scriptArg = { type: 'string', minLength: 1, maxLength: 63 };
const projectArg = { type: 'string', minLength: 1, maxLength: 58 };
const changesArg = { type: 'array', minItems: 1, maxItems: MAX_CHANGES, items: { type: 'object' } };
const tailLines = (lines, tail) => (lines.length > tail ? { lines: lines.slice(-tail), truncated: true } : { lines, truncated: false });

export default {
  api: 1,
  id: 'cloudflare',
  name: 'Cloudflare',
  version: '1.0.0',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      accountId: { type: 'string', title: 'Account ID', pattern: '^[0-9a-f]{32}$', description: 'In the Cloudflare dashboard: Account home, the menu next to your account name, Copy account ID.' },
      tokenSecret: { type: 'string', title: 'API token (secret name)', 'x-workshop-secret': true, default: 'cloudflare', description: 'The name you saved the token under with: workshop secret set cloudflare --expires YYYY-MM-DD. See the connector README for the permissions to give it.' },
      zones: { type: 'array', title: 'Zones Workshop may change', items: { type: 'string' }, default: [], description: 'Your domains, like example.org. DNS records and custom domains outside these are refused, even in a change set you apply. Empty means no DNS or domain changes at all.' },
      agents: { type: 'boolean', title: 'Let Tandem read and propose changes', default: true, description: 'Tandem can read your account and propose change sets. Only you can apply them, here in Workshop.' },
      apiUrl: { type: 'string', format: 'uri', title: 'API address', default: DEFAULT_API, 'x-workshop-section': 'Advanced' }
    }
  },
  test: { action: 'zones.list', arg: 'name', label: 'Zone name (optional)' },
  actions: {
    'token.verify': {
      title: 'Check the Cloudflare token', write: false, agent: true,
      async run(args, ctx, meta) {
        const c = await cf(ctx, meta);
        try {
          const v = await verify(c);
          state = { ...state, verified: new Date().toISOString(), problem: v.status === 'active' ? null : `Cloudflare says the token is ${v.status}.`, expiresOn: v.expiresOn };
          ctx.statusChanged();
          return v;
        } catch (e) { noteAuth(e); throw e; }
      }
    },
    'zones.list': {
      title: 'List your zones (domains)', write: false, agent: true,
      argsSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 253 } } },
      run: withCf(async (c, args, ctx) => {
        const list = await c.all(`/zones?account.id=${enc(c.account)}${args.name ? `&name=${enc(String(args.name).trim().toLowerCase())}` : ''}`);
        return list.map(z => ({ name: z.name, id: z.id, status: z.status, plan: z.plan && z.plan.name, mayChange: (ctx.config.zones || []).map(x => String(x).trim().toLowerCase()).includes(z.name) }));
      })
    },
    'dns.list': {
      title: 'List DNS records in a zone', write: false, agent: true,
      argsSchema: { type: 'object', required: ['zone'], properties: { zone: zoneArg, type: { type: 'string', maxLength: 10 }, name: { type: 'string', maxLength: 253 } } },
      run: withCf(async (c, args) => {
        const zone = String(args.zone).trim().toLowerCase();
        const zid = await zoneIds(c)(zone);
        let q = '';
        if (args.type) q += `&type=${enc(String(args.type).toUpperCase())}`;
        if (args.name) q += `&name=${enc(String(args.name).toLowerCase())}`;
        const records = await c.all(`/zones/${zid}/dns_records?order=name${q}`, { max: 2000 });
        return { zone, records: records.map(r => ({ id: r.id, type: r.type, name: r.name, content: r.content, proxied: r.proxied === true, ttl: r.ttl, comment: r.comment || null })) };
      })
    },
    'workers.list': {
      title: 'List your Workers', write: false, agent: true,
      run: withCf(async c => (await c.get(c.acct('workers/scripts')) || []).map(s => ({ name: s.id, tag: s.tag || null, modified: s.modified_on || null, hasAssets: s.has_assets === true })))
    },
    'workers.domains': {
      title: 'List the custom domains your Workers serve', write: false, agent: true,
      argsSchema: { type: 'object', properties: { service: scriptArg } },
      run: withCf(async (c, args) => {
        const list = await c.get(c.acct(`workers/domains${args.service ? `?service=${enc(args.service)}` : ''}`)) || [];
        return list.map(d => ({ hostname: d.hostname, service: d.service, zone: d.zone_name, enabled: d.enabled !== false }));
      })
    },
    'workers.versions': {
      title: "List a Worker's versions", write: false, agent: true,
      argsSchema: { type: 'object', required: ['script'], properties: { script: scriptArg } },
      run: withCf(async (c, args) => {
        const r = await c.get(c.acct(`workers/scripts/${enc(args.script)}/versions`));
        const items = Array.isArray(r) ? r : (r && r.items) || [];
        return items.slice(0, 50).map(v => ({ id: v.id, number: v.number ?? null, created: (v.metadata && v.metadata.created_on) || null, source: (v.metadata && v.metadata.source) || null, message: (v.annotations && v.annotations['workers/message']) || null }));
      })
    },
    'workers.deployments': {
      title: "List a Worker's deployments", write: false, agent: true,
      argsSchema: { type: 'object', required: ['script'], properties: { script: scriptArg } },
      run: withCf(async (c, args) => {
        const r = await c.get(c.acct(`workers/scripts/${enc(args.script)}/deployments`));
        const items = Array.isArray(r) ? r : (r && r.deployments) || [];
        return items.slice(0, 20).map(d => ({ id: d.id, created: d.created_on || null, source: d.source || null, message: (d.annotations && d.annotations['workers/message']) || null, versions: (d.versions || []).map(v => ({ versionId: v.version_id, percentage: v.percentage })) }));
      })
    },
    'workers.builds': {
      title: "List a Worker's recent builds (Workers Builds)", write: false, agent: true,
      argsSchema: { type: 'object', required: ['script'], properties: { script: scriptArg, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
      run: withCf(async (c, args) => {
        const tag = await scriptTag(c, args.script);
        const r = await c.request('GET', c.acct(`builds/workers/${enc(tag)}/builds?page=1&per_page=${args.limit || 10}`));
        return (Array.isArray(r.result) ? r.result : []).map(b => {
          const m = b.build_trigger_metadata || {};
          return { buildId: b.build_uuid, status: b.status || null, outcome: b.build_outcome || null, branch: m.branch || null, commit: m.commit_hash || null, message: m.commit_message || null, created: b.created_on || null, stopped: b.stopped_on || null };
        });
      })
    },
    'workers.buildLog': {
      title: "Read a Worker build's log", write: false, agent: true,
      argsSchema: { type: 'object', required: ['buildId'], properties: { buildId: { type: 'string', maxLength: 64 }, tail: { type: 'integer', minimum: 10, maximum: 2000 } } },
      run: withCf(async (c, args) => {
        const lines = [];
        let cursor = null;
        for (let i = 0; i < 20; i += 1) {
          const r = await c.get(c.acct(`builds/builds/${enc(args.buildId)}/logs${cursor ? `?cursor=${enc(cursor)}` : ''}`));
          for (const l of (r && r.lines) || []) if (Array.isArray(l)) lines.push(`${typeof l[0] === 'number' ? new Date(l[0] * (l[0] > 1e12 ? 1 : 1000)).toISOString().slice(11, 19) : ''} ${l[1] ?? ''}`.trim());
          if (!r || !r.cursor || r.truncated === false || !(r.lines || []).length) break;
          cursor = r.cursor;
        }
        return tailLines(lines, args.tail || 400);
      })
    },
    'pages.projects': {
      title: 'List your Pages projects', write: false, agent: true,
      run: withCf(async c => (await c.all(c.acct('pages/projects'), { perPage: 10, max: 200 })).map(p => ({
        name: p.name, subdomain: p.subdomain || null, domains: p.domains || [], productionBranch: p.production_branch || null,
        repo: p.source && p.source.config ? `${p.source.config.owner}/${p.source.config.repo_name}` : null,
        latest: p.latest_deployment ? { id: p.latest_deployment.id, environment: p.latest_deployment.environment, status: p.latest_deployment.latest_stage && `${p.latest_deployment.latest_stage.name} ${p.latest_deployment.latest_stage.status}`, created: p.latest_deployment.created_on } : null
      })))
    },
    'pages.project': {
      title: 'Read one Pages project, its build settings and variable names', write: false, agent: true,
      argsSchema: { type: 'object', required: ['project'], properties: { project: projectArg } },
      run: withCf(async (c, args) => {
        const p = await c.get(c.acct(`pages/projects/${enc(args.project)}`));
        const env = {};
        for (const k of ['production', 'preview']) {
          const vars = (p.deployment_configs && p.deployment_configs[k] && p.deployment_configs[k].env_vars) || {};
          // Encrypted values never leave Cloudflare; plain ones are shown as they are.
          env[k] = Object.fromEntries(Object.entries(vars).filter(([, v]) => v).map(([n, v]) => [n, v.type === 'plain_text' ? { type: 'plain_text', value: v.value } : { type: v.type }]));
        }
        const b = p.build_config || {};
        return { name: p.name, subdomain: p.subdomain || null, domains: p.domains || [], productionBranch: p.production_branch || null, repo: p.source && p.source.config ? `${p.source.config.owner}/${p.source.config.repo_name}` : null, build: { command: b.build_command || null, outputDir: b.destination_dir || null, rootDir: b.root_dir || null }, env };
      })
    },
    'pages.deployments': {
      title: "List a Pages project's deployments", write: false, agent: true,
      argsSchema: { type: 'object', required: ['project'], properties: { project: projectArg, environment: { type: 'string', enum: ['production', 'preview'] } } },
      run: withCf(async (c, args) => {
        const r = await c.request('GET', c.acct(`pages/projects/${enc(args.project)}/deployments?page=1&per_page=15${args.environment ? `&env=${args.environment}` : ''}`));
        return (Array.isArray(r.result) ? r.result : []).map(d => {
          const m = (d.deployment_trigger && d.deployment_trigger.metadata) || {};
          return { id: d.id, environment: d.environment, url: d.url || null, branch: m.branch || null, commit: m.commit_hash || null, message: m.commit_message || null, stage: d.latest_stage ? d.latest_stage.name : null, status: d.latest_stage ? d.latest_stage.status : null, created: d.created_on || null };
        });
      })
    },
    'pages.deploymentLog': {
      title: "Read a Pages deployment's build log", write: false, agent: true,
      argsSchema: { type: 'object', required: ['project', 'deployment'], properties: { project: projectArg, deployment: { type: 'string', maxLength: 64 }, tail: { type: 'integer', minimum: 10, maximum: 2000 } } },
      run: withCf(async (c, args) => {
        const r = await c.get(c.acct(`pages/projects/${enc(args.project)}/deployments/${enc(args.deployment)}/history/logs`));
        const lines = ((r && r.data) || []).map(l => `${String(l.ts || '').slice(11, 19)} ${l.line ?? ''}`.trim());
        return { ...tailLines(lines, args.tail || 400), total: (r && r.total) || lines.length };
      })
    },
    'changes.check': {
      title: 'Check a change set without saving it', write: false, agent: true,
      argsSchema: { type: 'object', required: ['changes'], properties: { changes: changesArg } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        return withPreview(ctx, meta, checkSet(args.changes, ctx.config));
      }
    },
    'changes.propose': {
      title: 'Propose a change set for you to apply', write: false, agent: true,
      argsSchema: { type: 'object', required: ['title', 'changes'], properties: {
        title: { type: 'string', minLength: 3, maxLength: 120 }, why: { type: 'string', maxLength: 2000 },
        item: { type: 'string', maxLength: 80 }, changes: changesArg
      } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        const checked = await withPreview(ctx, meta, checkSet(args.changes, ctx.config));
        if (!checked.ok) {
          const e = new SettingsError(`Not saved. Fix these first: ${checked.steps.map((s, i) => (s.problem ? `${i + 1}. ${s.problem}` : '')).filter(Boolean).join(' ')}`);
          e.extra = { steps: checked.steps };
          throw e;
        }
        const now = new Date();
        const set = {
          id: store.newId(now), title: args.title.trim(), why: (args.why || '').trim(), item: (args.item || '').trim() || null,
          from: meta && meta.caller === 'agent' ? 'Tandem' : 'you', created: now.toISOString(), status: 'waiting',
          changes: checked.steps.map(s => s.change), steps: checked.steps.map(s => ({ summary: s.summary, ...(s.now ? { now: s.now } : {}) }))
        };
        store.save(ctx.dataDir, set);
        ctx.log.info(`Change set ${set.id} proposed by ${set.from}: ${set.title} (${set.steps.length} changes).`);
        changed(ctx);
        return { id: set.id, status: set.status, steps: set.steps, next: 'Waiting for you to apply it in Workshop (Settings, Cloudflare, or Needs you). Check back with changes.get.' };
      }
    },
    'changes.list': {
      title: 'List change sets', write: false, agent: true,
      argsSchema: { type: 'object', properties: { status: { type: 'string', enum: store.STATUSES } } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        return store.list(ctx.dataDir).filter(s => !args.status || s.status === args.status).slice(0, 50).map(store.brief);
      }
    },
    'changes.get': {
      title: 'Read one change set and what happened to it', write: false, agent: true,
      argsSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 40 } } },
      async run(args, ctx, meta) {
        guard(ctx, meta);
        const s = store.load(ctx.dataDir, args.id);
        if (!s) throw Object.assign(new Error(`There is no change set ${args.id}.`), { status: 404, code: 'not_found' });
        if (s.status !== 'waiting') return s;
        // A waiting set's steps are worked out again from its changes (never taken from the file, which anything
        // running as you could have edited), with what each update or removal replaces read from Cloudflare now.
        // `digest` goes back with Apply.
        const checked = await withPreview(ctx, meta, checkSet(s.changes, ctx.config));
        return { ...s, steps: checked.steps.map(st => ({ summary: st.summary, ...(st.now ? { now: st.now } : {}), ...(st.problem ? { problem: st.problem } : {}) })), ok: checked.ok, digest: store.digest(s.changes) };
      }
    },
    'changes.apply': {
      title: 'Apply a change set on Cloudflare', write: true,
      argsSchema: { type: 'object', required: ['id', 'digest'], properties: { id: { type: 'string', maxLength: 40 }, digest: { type: 'string', pattern: '^[0-9a-f]{64}$' } } },
      async run(args, ctx, meta) {
        const s = store.load(ctx.dataDir, args.id);
        if (!s) throw Object.assign(new Error(`There is no change set ${args.id}.`), { status: 404, code: 'not_found' });
        if (s.status !== 'waiting') throw Object.assign(new Error(`Change set ${s.id} was already ${s.status}.`), { status: 409, code: 'conflict' });
        // The set must be exactly the one the person read (changes.get's digest): an edit since then is refused.
        if (store.digest(s.changes) !== args.digest) throw Object.assign(new Error(`Change set ${s.id} changed since you read it. Nothing was applied. Read it again before applying.`), { status: 409, code: 'conflict' });
        // Checked again against the settings as they are now: a zone taken off the list since it was proposed is refused.
        const changes = (s.changes || []).map(c => normalize(c, ctx.config));
        const c = await cf(ctx, meta);
        const r = await applySet(c, changes);
        const done = { ...s, status: r.status, decided: new Date().toISOString(), results: r.results };
        store.save(ctx.dataDir, done);
        store.appendLog(ctx.dataDir, done);
        ctx.log.info(`Change set ${s.id} applied: ${r.status} (${r.results.filter(x => x.ok).length} of ${r.results.length} done).`);
        changed(ctx);
        return { id: s.id, status: r.status, results: r.results };
      }
    },
    'changes.reject': {
      title: 'Reject a change set (nothing changes on Cloudflare)', write: false,
      argsSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 40 }, note: { type: 'string', maxLength: 500 } } },
      async run(args, ctx) {
        const s = store.load(ctx.dataDir, args.id);
        if (!s) throw Object.assign(new Error(`There is no change set ${args.id}.`), { status: 404, code: 'not_found' });
        if (s.status !== 'waiting') throw Object.assign(new Error(`Change set ${s.id} was already ${s.status}.`), { status: 409, code: 'conflict' });
        const done = { ...s, status: 'rejected', decided: new Date().toISOString(), note: (args.note || '').trim() || null };
        store.save(ctx.dataDir, done);
        store.appendLog(ctx.dataDir, done);
        changed(ctx);
        return { id: s.id, status: 'rejected' };
      }
    }
  },
  async start(ctx) {
    running = ctx;
    state = { verified: null, problem: null, expiresOn: null, checking: false };
    countWaiting(ctx);
    if (ctx.workMode() || !ctx.config.accountId) return;
    state.checking = true;
    // Check the token once in the background; status says what it found.
    (async () => {
      try {
        const c = await clientFor(ctx, { fetchImpl });
        const v = await verify(c);
        state.problem = v.status === 'active' ? null : `Cloudflare says the token is ${v.status}.`;
        state.expiresOn = v.expiresOn;
        state.verified = new Date().toISOString();
      } catch (e) { state.problem = e && e.message ? e.message : 'Could not check the token.'; }
      state.checking = false;
      if (running === ctx) ctx.statusChanged();
    })();
  },
  async stop() { running = null; },
  status() {
    if (!running) return { state: 'stopped', message: null };
    const ctx = running;
    if (ctx.workMode()) return { state: 'error', message: 'Off in work mode. The Cloudflare connector is for your own computer.' };
    if (!ctx.config.accountId) return { state: 'error', message: 'Add your Cloudflare account ID.' };
    if (state.checking) return { state: 'starting', message: 'Checking the token.' };
    const details = { waiting, zones: (ctx.config.zones || []).length, ...(state.expiresOn ? { tokenExpires: state.expiresOn } : {}) };
    if (state.problem) return { state: 'error', message: state.problem, details };
    const days = state.expiresOn ? Math.round((Date.parse(state.expiresOn) - Date.now()) / 86400000) : null;
    const msg = waiting ? `${waiting} change set${waiting === 1 ? '' : 's'} waiting for you.` : days !== null && days <= 14 ? `The token expires in ${days} days.` : null;
    return { state: 'ready', message: msg, details };
  }
};

/** Adds what each update or removal replaces (reads only). A change that cannot be previewed gets a problem. */
async function withPreview(ctx, meta, checked) {
  const needs = checked.steps.filter(s => s.change && ['dns.update', 'dns.delete', 'workers.domain.detach'].includes(s.change.op));
  if (!needs.length) return checked;
  const c = await cf(ctx, meta);
  const zid = zoneIds(c);
  for (const s of needs) {
    try { const now = await preview(c, s.change, zid); if (now) { s.now = now; s.summary = describe(s.change, now); } }
    catch (e) { s.problem = e && e.message ? e.message : 'Could not read what this changes.'; }
  }
  return { ok: checked.steps.every(s => !s.problem), steps: checked.steps };
}

export { OPS };
