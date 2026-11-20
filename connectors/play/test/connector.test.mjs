// The Google Play connector against a fake Google (fake-play.mjs). No test reaches Google.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import connector, { setFetch, setHome, scopesOf } from '../index.mjs';
import { compactKey, parseKey, signedAssertion, KeyError } from '../lib/key.mjs';
import { clearTokens, explain } from '../lib/client.mjs';
import { inspectBundle, readManifest } from '../lib/aab.mjs';
import { checkSet, normalize, bundlePath, fingerprint, appOf } from '../lib/releases.mjs';
import { fakePlay, bundle, manifestProto, PKG, OTHER, EMAIL, API, TOKEN_URL, SITE, APP_SIGNING_HEX } from './fake-play.mjs';

const A = connector.actions;
const AGENT = Object.freeze({ caller: 'agent' });
const PERSON = Object.freeze({ caller: 'person' });
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_FILE = JSON.stringify({ type: 'service_account', project_id: 'my-project', private_key_id: 'abcdef0123456789', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), client_email: EMAIL, token_uri: TOKEN_URL }, null, 2);
const STORED = compactKey(KEY_FILE).value;
const APP_SIGNING = APP_SIGNING_HEX.toUpperCase().match(/../g).join(':');
const UPLOAD_FP = 'B2:'.repeat(31) + 'B2';

let home, project;
function makeCtx({ config = {}, workMode = false, key = STORED, apps } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-test-'));
  const events = [], logs = [], asked = [];
  const cfg = Object.freeze({
    keySecret: 'play', agents: true, apiUrl: API, tokenUrl: TOKEN_URL,
    apps: apps || [{ packageName: PKG, name: 'Wishlist', folder: '~/wishlist-android', kind: 'bubblewrap', site: SITE, signingSecret: 'play-wishlist' }, { packageName: OTHER, name: 'Rally', folder: '~/rally', kind: 'gradle' }],
    ...config
  });
  const ctx = {
    config: cfg, dataDir, events, logs, asked,
    ruleCovers: false,
    async requestApproval(action, args, opts) {
      asked.push({ action, args, ...opts });
      if (ctx.ruleCovers) return { rule: 'r-00000000', result: await A[action].run(args, ctx, { caller: 'agent', rule: 'r-00000000' }) };
      return { approval: { id: `ap-20261119-${String(asked.length).padStart(8, '0')}`, status: 'waiting', title: opts.title } };
    },
    secret: async n => (n === cfg.keySecret ? key : undefined),
    workMode: () => workMode,
    log: { info: m => logs.push(m), warn: m => logs.push(m), error: m => logs.push(m) },
    emit: (e, p) => events.push([e, p]),
    statusChanged: () => {},
    signal: new AbortController().signal,
    done: () => fs.rmSync(dataDir, { recursive: true, force: true })
  };
  return ctx;
}

/** Approve as Approvals does: read the set (its digest), then apply with it. */
async function approve(id, ctx) {
  const got = await A['releases.get'].run({ id }, ctx, PERSON);
  return A['releases.apply'].run({ id, digest: got.digest }, ctx, PERSON);
}
const writeBundle = opts => fs.writeFileSync(path.join(project, 'app-release-bundle.aab'), bundle(opts));

let fake;
beforeEach(() => {
  clearTokens();
  fake = fakePlay({ publicKey });
  setFetch(fake.fetchImpl);
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-home-'));
  setHome(home);
  project = path.join(home, 'wishlist-android');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'twa-manifest.json'), JSON.stringify({ packageId: PKG, fingerprints: [{ name: 'upload', value: UPLOAD_FP }] }));
  writeBundle();
});

test('the key is stored small and whole, and signs a JWT Google can check', () => {
  const k = compactKey(KEY_FILE);
  assert.equal(k.email, EMAIL);
  assert.equal(k.keyId, 'abcdef01');
  assert.match(k.value, /^gsa1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'one line, no spaces');
  assert.ok(k.value.length < 2000);
  const parsed = parseKey(k.value);
  assert.equal(parsed.email, EMAIL);
  const jwt = signedAssertion(parsed, { tokenUrl: TOKEN_URL, now: Date.parse('2026-11-19T12:00:00Z') });
  const [h, b, s] = jwt.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')));
  const iat = Date.parse('2026-11-19T12:00:00Z') / 1000;
  assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url')), { iss: EMAIL, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: TOKEN_URL, iat, exp: iat + 3600 });
  for (const [text, re] of [['nope', /not JSON/], ['{"type":"authorized_user"}', /not a service account key/], [JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: 'x' }), /cannot be read/], [JSON.stringify({ type: 'service_account', private_key: 'x' }), /no service account email/]]) {
    assert.throws(() => compactKey(text), err => err instanceof KeyError && re.test(err.message) && !err.message.includes('PRIVATE'));
  }
  assert.throws(() => parseKey('cf-token-abc'), /not a service account key/);
});

test('bundles: package, version code and version name come from the manifest inside the zip', async () => {
  const b = await inspectBundle(path.join(project, 'app-release-bundle.aab'));
  assert.equal(b.packageName, PKG);
  assert.equal(b.versionCode, 4);
  assert.equal(b.versionName, '1.3');
  assert.match(b.sha256, /^[0-9a-f]{64}$/);
  // A version code aapt2 kept only in compiled form is read too.
  assert.equal(readManifest(manifestProto({ versionCode: 77, compiledOnly: true })).versionCode, 77);
  const junk = path.join(home, 'junk.aab');
  fs.writeFileSync(junk, 'not a zip at all, just some text in a file');
  const j = await inspectBundle(junk);
  assert.equal(j.packageName, null);
  assert.match(j.problem, /no zip directory/);
});

test('settings: apps by package or name, bundles only inside the project folder', () => {
  const cfg = { apps: [{ packageName: PKG, name: 'Wishlist', folder: '~/w' }, { packageName: OTHER, folder: '/x' }] };
  assert.equal(appOf(cfg, 'wishlist').packageName, PKG);
  assert.throws(() => appOf(cfg, ''), /Say which app/);
  assert.throws(() => appOf(cfg, 'org.nope'), /not one of your apps/);
  assert.equal(appOf({ apps: [cfg.apps[0]] }, undefined).packageName, PKG);
  assert.equal(bundlePath(cfg.apps[0], { home: '/h' }).file, path.resolve('/h/w/app-release-bundle.aab'));
  assert.equal(bundlePath({ packageName: OTHER, folder: '/x', kind: 'gradle' }).file, path.resolve('/x/app/build/outputs/bundle/release/app-release.aab'));
  for (const [app, re] of [
    [{ packageName: PKG }, /Set the project folder/],
    [{ packageName: PKG, folder: 'relative/dir' }, /must be a full path/],
    [{ packageName: PKG, folder: '/x', bundle: '../../etc/passwd.aab' }, /inside its project folder/],
    [{ packageName: PKG, folder: '/x', bundle: '/etc/app.aab' }, /inside its project folder/],
    [{ packageName: PKG, folder: '/x', bundle: 'app.apk' }, /must be an \.aab/]
  ]) assert.throws(() => bundlePath(app), re, JSON.stringify(app));
});

test('release sets: every change is checked, and every problem is reported at once', () => {
  const cfg = { apps: [{ packageName: PKG, folder: '/x' }] };
  assert.deepEqual(normalize({ op: 'release.upload', track: 'internal', notes: 'Fixes', bundle: { file: '/etc/passwd' } }), { op: 'release.upload', track: 'internal', status: 'completed', notes: [{ language: 'en-US', text: 'Fixes' }] }, 'a bundle from the caller is dropped');
  assert.deepEqual(normalize({ op: 'release.promote', versionCode: '3', track: 'production', status: 'inProgress', userFraction: 0.1 }), { op: 'release.promote', versionCode: 3, track: 'production', status: 'inProgress', userFraction: 0.1 });
  const bad = [
    [{ op: 'release.upload', track: 'production' }, /Say how to release to Production/],
    [{ op: 'release.upload', track: 'internal', status: 'inProgress', userFraction: 0.5 }, /Internal testing has no staged rollouts/],
    [{ op: 'release.upload', track: 'beta', status: 'inProgress' }, /userFraction must be a number/],
    [{ op: 'release.upload', track: 'beta', status: 'inProgress', userFraction: 1 }, /less than 1/],
    [{ op: 'release.upload', track: 'beta', userFraction: 0.5 }, /only with status "inProgress"/],
    [{ op: 'release.upload', track: 'beta', notes: 'x'.repeat(501) }, /Play allows 500/],
    [{ op: 'release.upload', track: 'beta', notes: { english: 'hi' } }, /not a language code/],
    [{ op: 'release.promote', track: 'beta', versionCode: -1 }, /whole number/],
    [{ op: 'rollout.update', action: 'pause' }, /increase, halt, resume or complete/],
    [{ op: 'rollout.update', action: 'halt', userFraction: 0.5 }, /does not go with halt/],
    [{ op: 'review.reply', reviewId: 'gp:1', text: 'y'.repeat(351) }, /Play allows 350/],
    [{ op: 'app.delete' }, /not a change Workshop can make/],
    [{ op: 'listing.update', title: 'x' }, /not a change Workshop can make/]
  ];
  for (const [c, re] of bad) assert.throws(() => normalize(c), re, JSON.stringify(c));
  const set = checkSet([{ op: 'release.upload', track: 'internal' }, { op: 'release.upload', track: 'beta' }, { op: 'release.promote', versionCode: 3, track: 'internal' }, { op: 'nope' }], cfg, PKG);
  assert.equal(set.ok, false);
  assert.deepEqual(set.steps.map(s => s.problem || null).map(p => p && p.slice(0, 20)), [null, 'Only one upload per ', 'Two changes to Inter', '"nope" is not a chan']);
  assert.throws(() => checkSet([], cfg, PKG), /at least one/);
  assert.throws(() => checkSet(Array(7).fill({ op: 'review.reply', reviewId: 'a', text: 'b' }), cfg, PKG), /At most 6/);
});

test('reads: one access token for many calls, edits always thrown away, nothing changes on Play', async () => {
  const ctx = makeCtx();
  try {
    const tracks = await A['tracks.list'].run({ app: 'wishlist' }, ctx, AGENT);
    assert.deepEqual(tracks.tracks.map(t => [t.track, t.label, t.releases[0].status]), [['internal', 'Internal testing', 'completed'], ['production', 'Production', 'inProgress']]);
    assert.deepEqual(tracks.tracks[1].releases[0], { name: '2 (1.1)', versionCodes: [2], status: 'inProgress', userFraction: 0.2, notes: [] });
    assert.deepEqual((await A['bundles.list'].run({ app: PKG }, ctx, AGENT)).map(b => b.versionCode), [3, 2, 1]);
    const reviews = await A['reviews.list'].run({ app: PKG }, ctx, AGENT);
    assert.deepEqual(reviews[0], { reviewId: 'gp:AOqpTOE-1', author: 'Sam', stars: 4, text: 'Love it, but it crashes on share.', lastModified: new Date(1763500000000).toISOString(), versionCode: 3, versionName: '1.2', device: 'pixel8', language: 'en', reply: null });
    const apps = await A['apps.list'].run({}, ctx, AGENT);
    assert.deepEqual(apps.map(a => [a.packageName, a.bundleExists]), [[PKG, true], [OTHER, false]]);
    const b = await A['bundle.inspect'].run({ app: PKG }, ctx, AGENT);
    assert.equal(b.versionCode, 4);
    assert.equal(b.matches, true);
    assert.equal(fake.tokenRequests, 1, 'the access token is reused');
    assert.equal(fake.openEdits(), 0, 'every read edit was deleted');
    assert.deepEqual(fake.writes(), []);
    assert.ok(fake.calls.filter(c => !c.site).every(c => c.auth === 'Bearer ya29.test-1'));
  } finally { ctx.done(); }
});

test('Tandem proposes an upload; it waits; approving uploads exactly that file and releases it', async () => {
  const ctx = makeCtx();
  try {
    const p = await A['releases.propose'].run({ title: 'Wishlist 1.3 to testers', why: 'Share fix', item: 'L9', app: 'wishlist', changes: [{ op: 'release.upload', track: 'internal', notes: 'Sharing works again.' }] }, ctx, AGENT);
    assert.match(p.id, /^gp-\d{8}-[0-9a-f]{6}$/);
    assert.equal(p.status, 'waiting');
    assert.match(p.steps[0].summary, /^Upload app-release-bundle\.aab \(version code 4, version 1\.3, 0\.0 MB, SHA-256 [0-9a-f]{12}\), then release it to Internal testing for everyone on that track\. Release notes: en-US "Sharing works again\."\.$/);
    assert.deepEqual(fake.writes(), [], 'proposing changes nothing on Play');
    assert.equal(ctx.asked[0].action, 'releases.apply');
    assert.equal(ctx.asked[0].title, 'Google Play: Wishlist 1.3 to testers');
    assert.deepEqual(A['releases.apply'].scope(ctx.asked[0].args, ctx), [`${PKG}:internal`]);
    const lines = await A['releases.apply'].describe(ctx.asked[0].args, ctx);
    assert.equal(lines[0], `App: Wishlist (${PKG})`);
    assert.equal(lines[1], 'Why: Share fix');
    assert.match(lines[2], /^1\. Upload app-release-bundle\.aab \(version code 4/);
    assert.deepEqual(ctx.events.at(-1), ['releases', { waiting: 1 }]);
    const r = await approve(p.id, ctx);
    assert.equal(r.status, 'applied');
    assert.equal(r.results[0].versionCode, 4);
    const w = fake.writes();
    assert.deepEqual(w.map(c => `${c.method} ${c.path.replace(`/applications/${PKG}`, '').replace(/edit-\d+/, 'edit-N')}`), ['POST /edits/edit-N/bundles', 'PUT /edits/edit-N/tracks/internal', 'POST /edits/edit-N:commit']);
    assert.equal(new Set(w.map(c => c.path.match(/edit-\d+/)[0])).size, 1, 'one edit');
    assert.equal(w[0].bytes, fs.statSync(path.join(project, 'app-release-bundle.aab')).size);
    assert.deepEqual(w[1].body, { track: 'internal', releases: [{ versionCodes: ['4'], status: 'completed', releaseNotes: [{ language: 'en-US', text: 'Sharing works again.' }] }] });
    assert.deepEqual(w[2].query, { changesInReviewBehavior: 'ERROR_IF_IN_REVIEW' }, 'never cancels a review in progress');
    assert.deepEqual(fake.db.apps[PKG].tracks.internal.map(x => x.versionCodes), [['4']]);
    const log = fs.readFileSync(path.join(ctx.dataDir, 'play', 'log.md'), 'utf8');
    assert.match(log, /Wishlist 1\.3 to testers \(applied\)/);
    assert.match(log, /Done: Upload app-release-bundle\.aab/);
    await assert.rejects(approve(p.id, ctx), /already applied/);
    assert.equal(fake.openEdits(), 0);
  } finally { ctx.done(); }
});

test('what you approve is what goes out: a rebuilt bundle or an edited set is refused', async () => {
  const ctx = makeCtx();
  try {
    const p = await A['releases.propose'].run({ title: 'Upload', app: PKG, changes: [{ op: 'release.upload', track: 'internal' }] }, ctx, AGENT);
    const read = await A['releases.get'].run({ id: p.id }, ctx, PERSON);
    assert.equal(read.ok, true);
    writeBundle({ versionName: '1.3-b' }); // built again after it was proposed
    const again = await A['releases.get'].run({ id: p.id }, ctx, PERSON);
    assert.equal(again.ok, false);
    assert.match(again.steps[0].problem, /bundle file changed since this was proposed/);
    await assert.rejects(A['releases.apply'].run({ id: p.id, digest: read.digest }, ctx, PERSON), /Nothing was done\. The bundle file changed/);
    await assert.rejects(A['releases.apply'].describe({ id: p.id, digest: read.digest }, ctx), /bundle file changed/);
    // Something running as you edits the waiting set to point at another file and track.
    const file = path.join(ctx.dataDir, 'play', 'releases', `${p.id}.json`);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    j.changes[0].track = 'production'; j.changes[0].status = 'completed';
    fs.writeFileSync(file, JSON.stringify(j));
    await assert.rejects(A['releases.apply'].run({ id: p.id, digest: read.digest }, ctx, PERSON), /changed since you read it/);
    assert.deepEqual(fake.writes(), []);
  } finally { ctx.done(); }
});

test('an upload is refused when the bundle is missing, for another app, or its version code is already on Play', async () => {
  const ctx = makeCtx();
  try {
    const up = { op: 'release.upload', track: 'internal' };
    writeBundle({ packageName: 'org.someone.else' });
    await assert.rejects(A['releases.propose'].run({ title: 'x1', app: PKG, changes: [up] }, ctx, AGENT), /is for org\.someone\.else, not org\.example\.wishlist/);
    writeBundle({ versionCode: 3 });
    await assert.rejects(A['releases.propose'].run({ title: 'x2', app: PKG, changes: [up] }, ctx, AGENT), /Version code 3 is already on Play\. Raise it/);
    fs.rmSync(path.join(project, 'app-release-bundle.aab'));
    await assert.rejects(A['releases.propose'].run({ title: 'x3', app: PKG, changes: [up] }, ctx, AGENT), /workshop play build org\.example\.wishlist/);
    const chk = await A['releases.check'].run({ app: PKG, changes: [up, { op: 'release.promote', versionCode: 9, track: 'beta' }] }, ctx, AGENT);
    assert.equal(chk.ok, false);
    assert.equal(chk.steps.filter(s => s.problem).length, 2);
    assert.deepEqual(await A['releases.list'].run({}, ctx, AGENT), []);
    assert.deepEqual(fake.writes(), []);
  } finally { ctx.done(); }
});

test('staged rollouts: raise, halt and finish keep the release and say what it is now', async () => {
  const ctx = makeCtx();
  try {
    await assert.rejects(A['releases.propose'].run({ title: 'Down', app: PKG, changes: [{ op: 'rollout.update', action: 'increase', userFraction: 0.1 }] }, ctx, AGENT), /only goes up: Production is at 20%/);
    const p = await A['releases.propose'].run({ title: 'More', app: PKG, changes: [{ op: 'rollout.update', action: 'increase', userFraction: 0.5 }] }, ctx, AGENT);
    assert.equal(p.steps[0].summary, 'Raise the Production staged rollout of version code 2 from 20% to 50% of users.');
    assert.deepEqual(scopesOf(PKG, [{ op: 'rollout.update', track: 'production' }]), [`${PKG}:production`]);
    await approve(p.id, ctx);
    assert.deepEqual(fake.writes().find(c => c.method === 'PUT').body, { track: 'production', releases: [{ name: '2 (1.1)', versionCodes: ['2'], status: 'inProgress', userFraction: 0.5 }] });
    const h = await A['releases.propose'].run({ title: 'Stop', app: PKG, changes: [{ op: 'rollout.update', action: 'halt' }] }, ctx, AGENT);
    assert.equal(h.steps[0].summary, 'Halt the Production rollout of version code 2 at 50%: no one new gets it, and people who have it keep it.');
    fake.calls.length = 0;
    await approve(h.id, ctx);
    assert.equal(fake.writes().find(c => c.method === 'PUT').body.releases[0].status, 'halted');
    await assert.rejects(A['releases.propose'].run({ title: 'Finish', app: PKG, changes: [{ op: 'rollout.update', action: 'complete' }] }, ctx, AGENT), /no staged rollout going on Production/);
    const r = await A['releases.propose'].run({ title: 'Resume', app: PKG, changes: [{ op: 'rollout.update', action: 'resume' }] }, ctx, AGENT);
    assert.equal(r.steps[0].summary, 'Resume the halted Production rollout of version code 2 at 50% of users.');
  } finally { ctx.done(); }
});

test('promote keeps the release notes, replies name the review, and both happen on approval', async () => {
  const ctx = makeCtx();
  try {
    const p = await A['releases.propose'].run({ title: 'Ship 1.2', app: PKG, changes: [
      { op: 'release.promote', versionCode: 3, track: 'production', status: 'completed' },
      { op: 'review.reply', reviewId: 'gp:AOqpTOE-1', text: 'Thanks Sam! Fixed in 1.2.' }
    ] }, ctx, AGENT);
    assert.equal(p.steps[0].summary, 'Release version code 3 (now on Internal testing) to Production for all users.');
    assert.equal(p.steps[1].summary, 'Reply publicly to the 4-star review by Sam ("Love it, but it crashes on share."): "Thanks Sam! Fixed in 1.2."');
    assert.deepEqual(A['releases.apply'].scope(ctx.asked[0].args, ctx), [`${PKG}:production`, `${PKG}:reviews`]);
    const r = await approve(p.id, ctx);
    assert.equal(r.status, 'applied');
    const w = fake.writes();
    assert.deepEqual(w.find(c => c.method === 'PUT').body.releases[0], { versionCodes: ['3'], status: 'completed', releaseNotes: [{ language: 'en-US', text: 'Lists you can share.' }] });
    assert.deepEqual(w.at(-1).body, { replyText: 'Thanks Sam! Fixed in 1.2.' });
    assert.ok(w.findIndex(c => /:commit$/.test(c.path)) < w.findIndex(c => /:reply$/.test(c.path)), 'replies after the release is committed');
    await assert.rejects(A['releases.propose'].run({ title: 'No review', app: PKG, changes: [{ op: 'review.reply', reviewId: 'gp:gone', text: 'Hi' }] }, ctx, AGENT), /no review gp:gone/);
  } finally { ctx.done(); }
});

test('a release set goes in together or not at all', async () => {
  const ctx = makeCtx();
  try {
    const p = await A['releases.propose'].run({ title: 'Two tracks', app: PKG, changes: [
      { op: 'release.promote', versionCode: 3, track: 'beta' },
      { op: 'release.promote', versionCode: 3, track: 'production', status: 'draft' },
      { op: 'review.reply', reviewId: 'gp:AOqpTOE-1', text: 'Thanks!' }
    ] }, ctx, AGENT);
    fake.db.apps[PKG].failTrack = 'production';
    const before = JSON.stringify(fake.db.apps[PKG].tracks);
    const r = await approve(p.id, ctx);
    assert.equal(r.status, 'failed');
    assert.deepEqual(r.results.map(x => (x.ok ? 'ok' : x.skipped ? 'skipped' : 'failed')), ['skipped', 'failed', 'skipped']);
    assert.match(r.results[0].error, /Play takes these changes together/);
    assert.match(r.results[1].error, /cannot take this release/);
    assert.equal(JSON.stringify(fake.db.apps[PKG].tracks), before, 'nothing committed');
    assert.ok(!fake.writes().some(c => /:commit$|:reply$/.test(c.path)));
    assert.equal(fake.openEdits(), 0, 'the edit was deleted');
    assert.equal((await A['releases.get'].run({ id: p.id }, ctx, AGENT)).status, 'failed');
  } finally { ctx.done(); }
});

test('Play\'s own rules: changes for manual review, a review in progress, and draft-only apps', async () => {
  const ctx = makeCtx();
  try {
    const app = fake.db.apps[PKG];
    app.manualReview = true;
    const p = await A['releases.propose'].run({ title: 'Manual', app: PKG, changes: [{ op: 'release.promote', versionCode: 3, track: 'beta' }] }, ctx, AGENT);
    const r = await approve(p.id, ctx);
    assert.equal(r.status, 'applied');
    assert.match(r.results[0].note, /sent for review by hand/);
    assert.deepEqual(fake.writes().filter(c => /:commit$/.test(c.path)).map(c => c.query.changesNotSentForReview || null), [null, 'true']);
    app.manualReview = false;
    app.inReview = true;
    const q = await A['releases.propose'].run({ title: 'In review', app: PKG, changes: [{ op: 'release.promote', versionCode: 3, track: 'alpha' }] }, ctx, AGENT);
    const r2 = await approve(q.id, ctx);
    assert.equal(r2.status, 'failed');
    assert.match(r2.results[0].error, /already has changes in review on Play\. Workshop never cancels a review/);
    app.inReview = false;
    app.draftApp = true;
    const d = await A['releases.propose'].run({ title: 'Draft app', app: PKG, changes: [{ op: 'release.promote', versionCode: 3, track: 'production', status: 'completed' }] }, ctx, AGENT);
    const r3 = await approve(d.id, ctx);
    assert.match(r3.results[0].error, /only takes draft releases for this app/);
  } finally { ctx.done(); }
});

test('signing: Play\'s app signing key plus your upload key, as the assetlinks.json the site needs', async () => {
  const ctx = makeCtx();
  try {
    assert.equal(fingerprint(Buffer.from(APP_SIGNING_HEX, 'hex').toString('base64')), APP_SIGNING);
    assert.equal(fingerprint(APP_SIGNING_HEX), APP_SIGNING);
    assert.equal(fingerprint('abc'), null);
    const s = await A['signing.info'].run({ app: PKG }, ctx, AGENT);
    assert.equal(s.versionCode, 3);
    assert.deepEqual(s.appSigning, [APP_SIGNING]);
    assert.deepEqual(s.local, [UPLOAD_FP]);
    assert.deepEqual(s.assetlinks, [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PKG, sha256_cert_fingerprints: [APP_SIGNING, UPLOAD_FP] } }]);
    assert.match(s.next, /https:\/\/wishlist\.example\.test\/\.well-known\/assetlinks\.json/);
  } finally { ctx.done(); }
});

test('assetlinks.check: says exactly what is wrong with the site\'s file, and sends it no token', async () => {
  const ctx = makeCtx();
  try {
    const site = fake.db.site;
    let r = await A['assetlinks.check'].run({ app: PKG }, ctx, AGENT);
    assert.match(r.problem, /HTTP 404/);
    site.body = [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PKG, sha256_cert_fingerprints: [UPLOAD_FP] } }];
    r = await A['assetlinks.check'].run({ app: PKG }, ctx, AGENT);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, [APP_SIGNING]);
    assert.match(r.problem, /does not list Play's app signing key/);
    site.body[0].target.sha256_cert_fingerprints.push(APP_SIGNING.toLowerCase());
    r = await A['assetlinks.check'].run({ app: PKG }, ctx, AGENT);
    assert.equal(r.ok, true, JSON.stringify(r));
    site.type = 'text/html';
    assert.match((await A['assetlinks.check'].run({ app: PKG }, ctx, AGENT)).problem, /application\/json/);
    site.location = 'https://elsewhere.test/x';
    assert.match((await A['assetlinks.check'].run({ app: PKG }, ctx, AGENT)).problem, /redirects/);
    site.location = null; site.type = 'application/json'; site.body = [{ relation: ['x'], target: { namespace: 'android_app', package_name: 'other' } }];
    assert.match((await A['assetlinks.check'].run({ app: PKG }, ctx, AGENT)).problem, /no entry for org\.example\.wishlist/);
    assert.ok(fake.calls.filter(c => c.site).every(c => !c.auth), 'the site never sees a token');
    await assert.rejects(A['assetlinks.check'].run({ app: OTHER }, ctx, AGENT), /Set the Site/);
  } finally { ctx.done(); }
});

test('off in work mode, off for Tandem when the switch is off, and clear messages about the key', async () => {
  const work = makeCtx({ workMode: true });
  try {
    await assert.rejects(A['tracks.list'].run({ app: PKG }, work, PERSON), /off in work mode/);
    await connector.start(work);
    assert.match(connector.status().message, /work mode/);
    await connector.stop();
  } finally { work.done(); }
  const noAgents = makeCtx({ config: { agents: false } });
  try {
    await assert.rejects(A['tracks.list'].run({ app: PKG }, noAgents, AGENT), /Tandem may not use Google Play/);
    assert.equal((await A['tracks.list'].run({ app: PKG }, noAgents, PERSON)).tracks.length, 2);
  } finally { noAgents.done(); }
  const none = makeCtx({ key: null });
  try { await assert.rejects(A['tracks.list'].run({ app: PKG }, none, PERSON), /workshop secret set play --from-file/); } finally { none.done(); }
  const wrong = makeCtx({ key: 'a-cloudflare-token-1234567890' });
  try { await assert.rejects(A['tracks.list'].run({ app: PKG }, wrong, PERSON), /not a service account key/); } finally { wrong.done(); }
  // A key Google no longer accepts (deleted in Google Cloud).
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const revoked = makeCtx({ key: compactKey(JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: other.export({ type: 'pkcs8', format: 'pem' }) })).value });
  try { await assert.rejects(A['tracks.list'].run({ app: PKG }, revoked, PERSON), /Google refused the service account key saved as "play" \(Invalid JWT Signature\.\)/); } finally { revoked.done(); }
  await assert.rejects(A['tracks.list'].run({ app: 'org.unknown' }, makeCtx(), PERSON), /not one of your apps/);
  assert.deepEqual(fake.writes(), []);
});

test('status: checks the key at start, counts waiting sets, and asks for an app when there is none', async () => {
  const ctx = makeCtx();
  try {
    await A['releases.propose'].run({ title: 'One', app: PKG, changes: [{ op: 'release.upload', track: 'internal' }] }, ctx, AGENT);
    await connector.start(ctx);
    for (let i = 0; i < 100 && connector.status().state === 'starting'; i += 1) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(connector.status(), { state: 'ready', message: '1 release set waiting for you.', details: { waiting: 1, apps: 2, serviceAccount: EMAIL } });
    await connector.stop();
    assert.equal(connector.status().state, 'stopped');
  } finally { ctx.done(); }
  const empty = makeCtx({ apps: [] });
  try {
    await connector.start(empty);
    for (let i = 0; i < 100 && connector.status().state === 'starting'; i += 1) await new Promise(r => setTimeout(r, 5));
    assert.match(connector.status().message, /Add your first app/);
    await connector.stop();
  } finally { empty.done(); }
});

test('an always-allow rule over a track applies a set at once; rejecting marks it rejected', async () => {
  const ctx = makeCtx();
  try {
    ctx.ruleCovers = true;
    const p = await A['releases.propose'].run({ title: 'Covered', app: PKG, changes: [{ op: 'release.upload', track: 'internal' }] }, ctx, AGENT);
    assert.equal(p.status, 'applied');
    assert.equal(p.rule, 'r-00000000');
    assert.equal(fake.writes().length, 3);
    ctx.ruleCovers = false;
    writeBundle({ versionCode: 5 });
    const q = await A['releases.propose'].run({ title: 'Later', app: PKG, changes: [{ op: 'release.upload', track: 'internal' }] }, ctx, AGENT);
    await A['releases.apply'].onReject({ id: q.id }, ctx, 'Not tonight');
    assert.equal((await A['releases.get'].run({ id: q.id }, ctx, PERSON)).status, 'rejected');
    assert.match(fs.readFileSync(path.join(ctx.dataDir, 'play', 'log.md'), 'utf8'), /Rejected: Not tonight\. Nothing was changed\./);
  } finally { ctx.done(); }
});

test('Google\'s errors in plain words', () => {
  assert.match(explain(403, 'Google Play Android Developer API has not been used in project 123 before or it is disabled.', 'SERVICE_DISABLED', 'play').message, /not turned on in the service account's Google Cloud project/);
  assert.match(explain(403, 'The caller does not have permission', 'PERMISSION_DENIED', 'play').message, /Users and permissions/);
  assert.match(explain(404, 'Package not found: org.x.', 'NOT_FOUND', 'play').message, /upload its first bundle there by hand/);
  assert.equal(explain(400, 'Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.', '', 'play').needsManualReview, true);
});
