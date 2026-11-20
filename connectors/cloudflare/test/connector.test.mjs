// The Cloudflare connector against a fake Cloudflare (fake-cloudflare.mjs). No test reaches the real API.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import connector, { setFetch } from '../index.mjs';
import { checkSet, normalize, zoneOf, fullName, MAX_CHANGES } from '../lib/changes.mjs';
import { fakeCloudflare, ACCOUNT, TOKEN, REC_ID, BUILD, VERSION, DEPLOY } from './fake-cloudflare.mjs';

const A = connector.actions;
const AGENT = Object.freeze({ caller: 'agent' });
const PERSON = Object.freeze({ caller: 'person' });
const base = { accountId: ACCOUNT, tokenSecret: 'cloudflare', zones: ['example.org'], agents: true, apiUrl: 'https://api.cloudflare.test/client/v4' };

function makeCtx({ config = {}, workMode = false, token = TOKEN } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-test-'));
  const events = [], logs = [], asked = [];
  let statusCalls = 0;
  const cfg = Object.freeze({ ...base, ...config });
  const ctx = {
    config: cfg, dataDir, events, logs, asked,
    // Workshop's Approvals, faked: records what was asked; `ruleCovers` makes it apply at once instead.
    ruleCovers: false,
    async requestApproval(action, args, opts) {
      asked.push({ action, args, ...opts });
      if (ctx.ruleCovers) return { rule: 'r-00000000', result: await A[action].run(args, ctx, { caller: 'agent', rule: 'r-00000000' }) };
      return { approval: { id: `ap-20261119-${String(asked.length).padStart(8, '0')}`, status: 'waiting', title: opts.title } };
    },
    secret: async n => (n === cfg.tokenSecret ? token : undefined),
    workMode: () => workMode,
    log: { info: m => logs.push(m), warn: m => logs.push(m), error: m => logs.push(m) },
    emit: (e, p) => events.push([e, p]),
    statusChanged: () => { statusCalls += 1; },
    get statusCalls() { return statusCalls; },
    signal: new AbortController().signal,
    done: () => fs.rmSync(dataDir, { recursive: true, force: true })
  };
  return ctx;
}

/** Apply as Settings does: read the set (its digest), then apply with it. */
async function applyIt(id, ctx) {
  const got = await A['changes.get'].run({ id }, ctx, PERSON);
  return A['changes.apply'].run({ id, digest: got.digest }, ctx, PERSON);
}

let fake;
beforeEach(() => { fake = fakeCloudflare(); setFetch(fake.fetchImpl); });

test('zones: only listed zones, longest match, and names in full', () => {
  assert.equal(zoneOf('a.b.example.org', ['example.org', 'b.example.org']), 'b.example.org');
  assert.equal(zoneOf('example.org.', ['Example.org']), 'example.org');
  assert.equal(zoneOf('badexample.org', ['example.org']), null);
  assert.equal(fullName('@', 'example.org'), 'example.org');
  assert.equal(fullName('rally', 'example.org'), 'rally.example.org');
  assert.equal(fullName('Rally.Example.org', 'example.org'), 'rally.example.org');
  assert.equal(fullName('_dmarc', 'example.org'), '_dmarc.example.org');
  assert.throws(() => fullName('bad name', 'example.org'), /not a valid DNS name/);
});

test('change sets: every change is checked against the settings, and problems are all reported at once', () => {
  const ok = normalize({ op: 'dns.create', zone: 'example.org', type: 'cname', name: 'rally', content: 'rally.workers.dev', proxied: true }, base);
  assert.deepEqual(ok, { op: 'dns.create', zone: 'example.org', type: 'CNAME', name: 'rally.example.org', content: 'rally.workers.dev', proxied: true });
  const bad = [
    [{ op: 'dns.create', zone: 'other.net', type: 'A', name: 'x', content: '192.0.2.1' }, /not one of the zones/],
    [{ op: 'dns.create', zone: 'example.org', type: 'TXT', name: 'x', content: 'v', proxied: true }, /cannot be proxied/],
    [{ op: 'dns.create', zone: 'example.org', type: 'NS', name: 'x', content: 'ns' }, /not supported/],
    [{ op: 'dns.create', zone: 'example.org', type: 'MX', name: '@', content: 'mx.example.org' }, /priority/],
    [{ op: 'dns.update', zone: 'example.org', id: REC_ID }, /at least one/],
    [{ op: 'dns.delete', zone: 'example.org', id: 'short' }, /32-character/],
    [{ op: 'workers.domain.attach', hostname: 'app.other.net', service: 'rally' }, /not in a zone Workshop may change/],
    [{ op: 'workers.domain.attach', hostname: 'app.example.org', service: 'Bad Name' }, /not a Worker name/],
    [{ op: 'pages.env.set', project: 'wishlist', environment: 'production', vars: { API_TOKEN: 'abc' } }, /looks like a secret/],
    [{ op: 'pages.env.set', project: 'wishlist', environment: 'staging', vars: { A: 'b' } }, /production or preview/],
    [{ op: 'pages.delete', project: 'wishlist' }, /not a change Workshop can make/],
    [{ op: 'zones.delete', zone: 'example.org' }, /not a change Workshop can make/],
    [{ op: 'workers.rollback', script: 'rally', versionId: 'v1' }, /version id/]
  ];
  for (const [c, re] of bad) assert.throws(() => normalize(c, base), re, JSON.stringify(c));
  // Removing a secret-looking variable is fine: no value is handled.
  assert.deepEqual(normalize({ op: 'pages.env.set', project: 'wishlist', environment: 'preview', vars: { API_TOKEN: null } }, base).vars, { API_TOKEN: null });
  const set = checkSet([{ op: 'dns.create', zone: 'example.org', type: 'A', name: 'a', content: '192.0.2.1' }, { op: 'nope' }, { op: 'dns.delete', zone: 'other.net', id: REC_ID }], base);
  assert.equal(set.ok, false);
  assert.deepEqual(set.steps.map(s => !!s.problem), [false, true, true]);
  assert.throws(() => checkSet(Array(MAX_CHANGES + 1).fill({ op: 'dns.delete', zone: 'example.org', id: REC_ID }), base), /At most/);
  assert.throws(() => checkSet([], base), /at least one/);
  // An empty zone list means no DNS or domain change at all.
  assert.throws(() => normalize({ op: 'dns.delete', zone: 'example.org', id: REC_ID }, { ...base, zones: [] }), /not one of the zones/);
});

test('reads send the token only to the API address, and answer in small shapes', async () => {
  const ctx = makeCtx();
  try {
    const zones = await A['zones.list'].run({}, ctx, AGENT);
    assert.deepEqual(zones.map(z => [z.name, z.mayChange]), [['example.org', true], ['other.net', false]]);
    const dns = await A['dns.list'].run({ zone: 'example.org' }, ctx, AGENT);
    assert.deepEqual(dns.records[0], { id: REC_ID, type: 'CNAME', name: 'old.example.org', content: 'old.pages.dev', proxied: true, ttl: 1, comment: null });
    assert.deepEqual(await A['workers.list'].run({}, ctx, AGENT), [{ name: 'rally', tag: 'tag-rally', modified: '2026-11-18T00:00:00Z', hasAssets: true }]);
    const builds = await A['workers.builds'].run({ script: 'rally' }, ctx, AGENT);
    assert.deepEqual(builds[0], { buildId: BUILD, status: 'stopped', outcome: 'fail', branch: 'main', commit: 'abc123', message: 'Add Rally', created: '2026-11-18T10:00:00Z', stopped: '2026-11-18T10:02:00Z' });
    const log = await A['workers.buildLog'].run({ buildId: BUILD }, ctx, AGENT);
    assert.match(log.lines.at(-1), /wrangler\.jsonc not found/);
    const project = await A['pages.project'].run({ project: 'wishlist' }, ctx, AGENT);
    assert.deepEqual(project.env.production, { MODE: { type: 'plain_text', value: 'live' }, API_TOKEN: { type: 'secret_text' } });
    const deps = await A['pages.deployments'].run({ project: 'wishlist' }, ctx, AGENT);
    assert.equal(deps[0].status, 'failure');
    const plog = await A['pages.deploymentLog'].run({ project: 'wishlist', deployment: DEPLOY }, ctx, AGENT);
    assert.match(plog.lines[0], /missing script: build/);
    assert.ok(fake.calls.every(c => c.auth === `Bearer ${TOKEN}`));
    assert.deepEqual(fake.writes(), [], 'reads change nothing');
  } finally { ctx.done(); }
});

test('Tandem proposes, the set waits, and only a person applying it changes Cloudflare', async () => {
  const ctx = makeCtx();
  try {
    const changes = [
      { op: 'dns.create', zone: 'example.org', type: 'CNAME', name: 'notes', content: 'notes.pages.dev', proxied: true },
      { op: 'workers.domain.attach', hostname: 'api.example.org', service: 'rally' },
      { op: 'pages.env.set', project: 'wishlist', environment: 'production', vars: { MODE: 'beta' } },
      { op: 'dns.update', zone: 'example.org', id: REC_ID, content: 'new.pages.dev' }
    ];
    const p = await A['changes.propose'].run({ title: 'Set up notes', why: 'New app', item: 'L7', changes }, ctx, AGENT);
    assert.match(p.id, /^cf-\d{8}-[0-9a-f]{6}$/);
    assert.equal(p.status, 'waiting');
    assert.match(p.steps[3].summary, /now: CNAME old\.example\.org pointing to old\.pages\.dev/);
    assert.deepEqual(fake.writes(), [], 'proposing changes nothing on Cloudflare');
    assert.equal(connector.status !== undefined, true);
    const list = await A['changes.list'].run({ status: 'waiting' }, ctx, AGENT);
    assert.deepEqual(list.map(s => [s.id, s.from, s.steps]), [[p.id, 'Tandem', 4]]);
    assert.deepEqual(ctx.events.at(-1), ['changes', { waiting: 1 }]);
    // Apply is a write agents may only ask for (agent: "ask"): Approvals runs it after a person approves. Here a person applies.
    assert.equal(A['changes.apply'].write, true);
    assert.equal(A['changes.apply'].agent, 'ask');
    const r = await applyIt(p.id, ctx);
    assert.equal(r.status, 'applied');
    assert.deepEqual(fake.writes().map(c => `${c.method} ${c.path.replace(`/accounts/${ACCOUNT}`, '')}`), [
      'POST /zones/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/dns_records',
      'PUT /workers/domains',
      'PATCH /pages/projects/wishlist',
      `PATCH /zones/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/dns_records/${REC_ID}`
    ]);
    assert.deepEqual(fake.writes()[2].body, { deployment_configs: { production: { env_vars: { MODE: { type: 'plain_text', value: 'beta' } } } } });
    const got = await A['changes.get'].run({ id: p.id }, ctx, AGENT);
    assert.equal(got.status, 'applied');
    assert.equal(got.results.every(x => x.ok), true);
    const log = fs.readFileSync(path.join(ctx.dataDir, 'cloudflare', 'log.md'), 'utf8');
    assert.match(log, /Set up notes \(applied\)/);
    assert.match(log, /Done: Add DNS CNAME record notes\.example\.org/);
    await assert.rejects(applyIt(p.id, ctx), /already applied/);
    await assert.rejects(A['changes.apply'].run({ id: p.id, digest: 'f'.repeat(64) }, ctx, PERSON), /already applied/);
  } finally { ctx.done(); }
});

test('a change set with a problem is not saved, and applying stops at the first failure', async () => {
  const ctx = makeCtx();
  try {
    await assert.rejects(A['changes.propose'].run({ title: 'Bad', changes: [{ op: 'dns.create', zone: 'other.net', type: 'A', name: 'x', content: '192.0.2.1' }] }, ctx, AGENT), /Not saved\. Fix these first: 1\./);
    await assert.rejects(A['changes.propose'].run({ title: 'Gone', changes: [{ op: 'dns.delete', zone: 'example.org', id: 'f'.repeat(32) }] }, ctx, AGENT), /Record not found/);
    assert.deepEqual(await A['changes.list'].run({}, ctx, AGENT), []);
    const p = await A['changes.propose'].run({ title: 'Two', changes: [
      { op: 'pages.domain.add', project: 'missing', domain: 'm.example.org' },
      { op: 'dns.create', zone: 'example.org', type: 'A', name: 'later', content: '192.0.2.9' }
    ] }, ctx, AGENT);
    fake.db.projects.length = 0;
    const r = await applyIt(p.id, ctx);
    assert.equal(r.status, 'applied', 'the fake accepts a domain on any project name');
    const q = await A['changes.propose'].run({ title: 'Three', changes: [
      { op: 'workers.domain.detach', hostname: 'rally.example.org' },
      { op: 'workers.build.retry', script: 'nosuch', buildId: BUILD },
      { op: 'dns.create', zone: 'example.org', type: 'A', name: 'after', content: '192.0.2.10' }
    ] }, ctx, AGENT);
    const r2 = await applyIt(q.id, ctx);
    assert.equal(r2.status, 'failed');
    assert.deepEqual(r2.results.map(x => (x.ok ? 'ok' : x.skipped ? 'skipped' : 'failed')), ['ok', 'failed', 'skipped']);
    assert.match(r2.results[1].error, /no Worker named nosuch/);
    assert.ok(!fake.writes().some(c => c.body && c.body.name === 'after.example.org'), 'nothing after a failure');
  } finally { ctx.done(); }
});

test('applying checks the set again: a zone taken off the list since it was proposed is refused', async () => {
  const ctx = makeCtx();
  try {
    const p = await A['changes.propose'].run({ title: 'DNS', changes: [{ op: 'dns.create', zone: 'example.org', type: 'A', name: 'x', content: '192.0.2.1' }] }, ctx, AGENT);
    const later = { ...ctx, config: Object.freeze({ ...ctx.config, zones: [] }) };
    await assert.rejects(applyIt(p.id, later), /not one of the zones/);
    assert.deepEqual(fake.writes(), []);
    await A['changes.apply'].onReject({ id: p.id }, ctx, 'Not now');
    assert.equal((await A['changes.get'].run({ id: p.id }, ctx, PERSON)).status, 'rejected');
    assert.match(fs.readFileSync(path.join(ctx.dataDir, 'cloudflare', 'log.md'), 'utf8'), /Rejected: Not now\. Nothing was changed\./);
  } finally { ctx.done(); }
});

test('off in work mode, off for Tandem when the switch is off, and a clear message without a token', async () => {
  const work = makeCtx({ workMode: true });
  try {
    await assert.rejects(A['zones.list'].run({}, work, PERSON), /off in work mode/);
    await connector.start(work);
    assert.equal(connector.status().state, 'error');
    assert.match(connector.status().message, /work mode/);
    await connector.stop();
  } finally { work.done(); }
  const noAgents = makeCtx({ config: { agents: false } });
  try {
    await assert.rejects(A['zones.list'].run({}, noAgents, AGENT), /Tandem may not use Cloudflare/);
    assert.equal((await A['zones.list'].run({}, noAgents, PERSON)).length, 2);
  } finally { noAgents.done(); }
  const none = makeCtx({ token: null });
  try { await assert.rejects(A['zones.list'].run({}, none, PERSON), /Add it in Settings, Tokens & sign-ins/); } finally { none.done(); }
  assert.deepEqual(fake.writes(), []);
});

test('status: checks the token at start, counts waiting sets, and shows a rejected token', async () => {
  const ctx = makeCtx();
  try {
    await A['changes.propose'].run({ title: 'One', changes: [{ op: 'dns.create', zone: 'example.org', type: 'A', name: 'x', content: '192.0.2.1' }] }, ctx, AGENT);
    await connector.start(ctx);
    for (let i = 0; i < 50 && connector.status().state === 'starting'; i += 1) await new Promise(r => setTimeout(r, 5));
    const s = connector.status();
    assert.equal(s.state, 'ready');
    assert.equal(s.message, '1 change set waiting for you.');
    assert.deepEqual(s.details, { waiting: 1, zones: 1, tokenExpires: '2027-02-01T00:00:00Z' });
    setFetch(fakeCloudflare({ token: 'a-different-token-entirely' }).fetchImpl);
    await assert.rejects(A['zones.list'].run({}, ctx, PERSON), /rejected the token saved as "cloudflare"/);
    assert.equal(connector.status().state, 'error');
    await connector.stop();
    assert.equal(connector.status().state, 'stopped');
  } finally { ctx.done(); }
});

test('rollbacks and retries go to the right place', async () => {
  const ctx = makeCtx();
  try {
    const p = await A['changes.propose'].run({ title: 'Roll back', changes: [
      { op: 'workers.rollback', script: 'rally', versionId: VERSION, message: 'Back to Tuesday' },
      { op: 'workers.build.retry', script: 'rally', buildId: BUILD },
      { op: 'pages.rollback', project: 'wishlist', deployment: DEPLOY }
    ] }, ctx, AGENT);
    fake.calls.length = 0;
    await applyIt(p.id, ctx);
    const w = fake.writes();
    assert.deepEqual(w[0].body, { strategy: 'percentage', versions: [{ version_id: VERSION, percentage: 100 }], annotations: { 'workers/message': 'Back to Tuesday' } });
    assert.match(w[1].path, /\/builds\/workers\/tag-rally\/builds\/.*\/retry$/);
    assert.match(w[2].path, /\/pages\/projects\/wishlist\/deployments\/.*\/rollback$/);
  } finally { ctx.done(); }
});

test('what you apply is what you read: an edit to the file after review is refused, and steps never come from the file', async () => {
  const ctx = makeCtx();
  try {
    const p = await A['changes.propose'].run({ title: 'Safe', changes: [{ op: 'dns.create', zone: 'example.org', type: 'A', name: 'safe', content: '192.0.2.1' }] }, ctx, AGENT);
    const read = await A['changes.get'].run({ id: p.id }, ctx, PERSON);
    assert.match(read.digest, /^[0-9a-f]{64}$/);
    assert.equal(read.ok, true);
    // Something running as you edits the waiting set: a different target, and a summary that hides it.
    const file = path.join(ctx.dataDir, 'cloudflare', 'changes', `${p.id}.json`);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    j.changes[0].content = '203.0.113.66';
    j.steps[0].summary = 'Add DNS A record safe.example.org pointing to 192.0.2.1';
    fs.writeFileSync(file, JSON.stringify(j));
    await assert.rejects(A['changes.apply'].run({ id: p.id, digest: read.digest }, ctx, PERSON), /changed since you read it/);
    assert.deepEqual(fake.writes(), []);
    const again = await A['changes.get'].run({ id: p.id }, ctx, PERSON);
    assert.match(again.steps[0].summary, /203\.0\.113\.66/, 'the steps shown are worked out from the changes');
    // An edit that takes the set outside your zones shows as a problem, and Apply refuses it either way.
    j.changes[0].zone = 'other.net';
    fs.writeFileSync(file, JSON.stringify(j));
    const bad = await A['changes.get'].run({ id: p.id }, ctx, PERSON);
    assert.equal(bad.ok, false);
    await assert.rejects(A['changes.apply'].run({ id: p.id, digest: bad.digest }, ctx, PERSON), /not one of the zones/);
    assert.deepEqual(fake.writes(), []);
  } finally { ctx.done(); }
});

test('a proposal waits in Approvals; what Approvals shows is worked out from the set, and a rule over its zones applies it at once', async () => {
  const ctx = makeCtx();
  try {
    const changes = [{ op: 'dns.create', zone: 'example.org', type: 'CNAME', name: 'app', content: 'app.pages.dev' }, { op: 'workers.rollback', script: 'rally', versionId: VERSION }];
    const p = await A['changes.propose'].run({ title: 'App', why: 'New app', changes }, ctx, AGENT);
    assert.match(p.approval, /^ap-/);
    assert.equal(ctx.asked.length, 1);
    assert.equal(ctx.asked[0].action, 'changes.apply');
    assert.equal(ctx.asked[0].by, 'agent');
    assert.equal(ctx.asked[0].title, 'Cloudflare: App');
    assert.equal((await A['changes.get'].run({ id: p.id }, ctx, AGENT)).approval, p.approval);
    const lines = await A['changes.apply'].describe(ctx.asked[0].args, ctx);
    assert.deepEqual(lines, ['Why: New app', '1. Add DNS CNAME record app.example.org pointing to app.pages.dev', '2. Roll Worker rally back to version 99999999 (all traffic)']);
    assert.deepEqual(A['changes.apply'].scope(ctx.asked[0].args, ctx), ['example.org', 'worker:rally']);
    assert.equal(A['changes.apply'].agent, 'ask');
    // An edited set cannot be shown as approvable.
    await assert.rejects(A['changes.apply'].describe({ id: p.id, digest: 'f'.repeat(64) }, ctx), /changed after it was proposed/);
    assert.deepEqual(fake.writes(), []);
    ctx.ruleCovers = true;
    const q = await A['changes.propose'].run({ title: 'Covered', changes: [{ op: 'dns.create', zone: 'example.org', type: 'A', name: 'c', content: '192.0.2.4' }] }, ctx, AGENT);
    assert.equal(q.status, 'applied');
    assert.equal(q.rule, 'r-00000000');
    assert.equal(fake.writes().length, 1);
  } finally { ctx.done(); }
});
