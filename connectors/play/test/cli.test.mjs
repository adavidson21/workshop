// `workshop secret set --from-file / --password` and `workshop play build|release` (scripts/lib/play.mjs). The
// secret store, the build programs and the running agent are all faked: nothing here runs Bubblewrap or Gradle,
// touches a real Keychain or reaches Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { main, passwordProblem } from '../../../workshop.mjs';
import { writeIndexEntry } from '../../../scripts/lib/secrets-store.mjs';
import { storeName } from '../../../agent/lib/secrets.mjs';
import { parseKey } from '../lib/key.mjs';
import { buildSteps, findOnPath, BUBBLEWRAP } from '../../../scripts/lib/play.mjs';
import { bundle } from './fake-play.mjs';

const PKG = 'org.example.wishlist';
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

function cli({ platform = 'darwin', typed = [], stored = {}, apps = null, enabled = true } = {}) {
  const lines = [], saves = [], runs = [], proposals = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-play-'));
  const userHome = path.join(home, 'me');
  fs.mkdirSync(userHome);
  if (apps) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, connectors: { play: { enabled, config: { keySecret: 'play', apps } } } }));
  const queue = [...typed];
  const io = {
    out: s => lines.push(s), env: { WORKSHOP_HOME: home }, platform, userHome, now: () => new Date('2026-11-19T12:00:00Z'),
    secret: async () => queue.shift(),
    probe: async () => null,
    secretStore: {
      save: async (h, n, v, o) => { saves.push({ n, v, note: o.note }); stored[n] = v; writeIndexEntry(h, n, { store: storeName(platform), saved: 'now', expires: o.expires, note: o.note }); return { ok: true, message: '' }; },
      read: async n => stored[n]
    },
    // The build programs: record what ran and with which environment, and make the bundle a build would.
    run: (cmd, args, opts) => {
      runs.push({ cmd, args, cwd: opts.cwd, env: opts.env, shell: opts.shell });
      if (io.buildFails) return { status: 3 };
      if (args.includes('build') || args.includes('bundleRelease')) {
        const out = args.includes('bundleRelease') ? path.join(opts.cwd, 'app/build/outputs/bundle/release/app-release.aab') : path.join(opts.cwd, 'app-release-bundle.aab');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, bundle({ packageName: io.builtPackage || PKG, versionCode: 7, versionName: '1.4' }));
      }
      return { status: 0 };
    },
    which: () => null,
    npx: '/opt/node/bin/npx',
    callAgent: async (method, pathname, body) => { proposals.push({ method, pathname, body }); return { result: { id: 'gp-20261119-abcdef', status: 'waiting', steps: [{ summary: 'Upload app-release-bundle.aab (version code 7) ...' }] } }; }
  };
  return { io, lines, saves, runs, proposals, home, userHome, stored, text: () => lines.join('\n'), done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

const project = (c, name = 'wishlist-android', files = { 'twa-manifest.json': '{}' }) => {
  const dir = path.join(c.userHome, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t);
  return dir;
};
const WISHLIST = { packageName: PKG, name: 'Wishlist', folder: '~/wishlist-android', kind: 'bubblewrap', signingSecret: 'play-wishlist' };

test('secret set --from-file keeps only what signing needs, and says to delete the file', async () => {
  const c = cli();
  try {
    const file = path.join(c.home, 'my-project-1234.json');
    fs.writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'my-project', private_key_id: 'abc', private_key: PEM, client_email: 'workshop@my-project.iam.gserviceaccount.com' }, null, 2));
    assert.equal(await main(['secret', 'set', 'play', '--from-file', file], c.io), 0);
    assert.equal(c.saves.length, 1);
    assert.match(c.saves[0].v, /^gsa1\.[\w-]+\.[\w-]+$/);
    assert.equal(parseKey(c.saves[0].v).email, 'workshop@my-project.iam.gserviceaccount.com');
    assert.equal(c.saves[0].note, 'Google service account workshop@my-project.iam.gserviceaccount.com');
    assert.match(c.text(), /Saved play \(the service account key for workshop@my-project\.iam\.gserviceaccount\.com\) in macOS Keychain/);
    assert.match(c.text(), new RegExp(`Delete the key file now; Workshop has what it needs: rm "${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.ok(!c.text().includes('PRIVATE KEY') && !c.text().includes(c.saves[0].v), 'the key is never printed');
    assert.ok(!/Tip: add its expiry/.test(c.text()));
  } finally { c.done(); }
});

test('secret set --from-file refuses what is not a service account key, and Windows (too big for it)', async () => {
  const c = cli();
  try {
    const user = path.join(c.home, 'user.json');
    fs.writeFileSync(user, JSON.stringify({ type: 'authorized_user', client_id: 'x' }));
    assert.equal(await main(['secret', 'set', 'play', '--from-file', user], c.io), 1);
    assert.match(c.text(), /not a service account key .*Nothing was saved/);
    assert.equal(await main(['secret', 'set', 'play', '--from-file', path.join(c.home, 'missing.json')], c.io), 1);
    assert.match(c.text(), /Could not read/);
    assert.equal(await main(['secret', 'set', 'play', '--from-file'], c.io), 1);
    assert.equal(await main(['secret', 'set', 'play', '--from-file', user, '--password'], c.io), 1);
    assert.deepEqual(c.saves, []);
  } finally { c.done(); }
  const w = cli({ platform: 'win32' });
  try {
    const file = path.join(w.home, 'k.json');
    fs.writeFileSync(file, JSON.stringify({ type: 'service_account', private_key: PEM, client_email: 'a@b.iam.gserviceaccount.com' }));
    assert.equal(await main(['secret', 'set', 'play', '--from-file', file], w.io), 1);
    assert.match(w.text(), /too big for Windows Credential Manager/);
    assert.deepEqual(w.saves, []);
  } finally { w.done(); }
});

test('secret set --password asks twice and takes what a keystore takes', async () => {
  assert.equal(passwordProblem('abc de f'), null, 'spaces inside are fine');
  assert.match(passwordProblem('12345'), /at least 6/);
  assert.match(passwordProblem(''), /Nothing was entered/);
  const c = cli({ typed: ['correct horse', 'correct horse'] });
  try {
    assert.equal(await main(['secret', 'set', 'play-wishlist', '--password'], c.io), 0);
    assert.deepEqual(c.saves.map(s => [s.n, s.v]), [['play-wishlist', 'correct horse']]);
    assert.match(c.text(), /Saved play-wishlist \(13 characters\)/);
    assert.ok(!c.text().includes('correct horse'));
  } finally { c.done(); }
  const m = cli({ typed: ['correct horse', 'correct house'] });
  try { assert.equal(await main(['secret', 'set', 'play-wishlist', '--password'], m.io), 1); assert.match(m.text(), /do not match/); assert.deepEqual(m.saves, []); } finally { m.done(); }
  const s = cli({ typed: ['abc', 'abc'] });
  try { assert.equal(await main(['secret', 'set', 'play-wishlist', '--password'], s.io), 1); assert.match(s.text(), /at least 6/); } finally { s.done(); }
});

test('play build runs Bubblewrap in the project with the passwords in its environment only', async () => {
  const c = cli({ apps: [WISHLIST], stored: { 'play-wishlist': 'keystore-pass-1' } });
  try {
    const dir = project(c);
    assert.equal(await main(['play', 'build', 'wishlist', '--bump'], c.io), 0, c.text());
    assert.deepEqual(c.runs.map(r => [r.cmd, r.args.join(' '), r.cwd]), [
      ['/opt/node/bin/npx', `--yes ${BUBBLEWRAP} update`, dir],
      ['/opt/node/bin/npx', `--yes ${BUBBLEWRAP} build`, dir]
    ]);
    assert.equal(c.runs[1].env.BUBBLEWRAP_KEYSTORE_PASSWORD, 'keystore-pass-1');
    assert.equal(c.runs[1].env.BUBBLEWRAP_KEY_PASSWORD, 'keystore-pass-1');
    assert.ok(c.runs.every(r => !r.args.some(a => a.includes('keystore-pass'))), 'never on a command line');
    assert.ok(!c.text().includes('keystore-pass-1'), 'never printed');
    assert.match(c.text(), /org\.example\.wishlist, version code 7 \(1\.4\), 0\.0 MB, SHA-256 [0-9a-f]{12}/);
    assert.match(c.text(), /Next: workshop play release Wishlist --track internal/);
    assert.deepEqual(c.proposals, []);
  } finally { c.done(); }
});

test('play build --release proposes it through Workshop; nothing is uploaded from here', async () => {
  const c = cli({ apps: [WISHLIST], stored: { 'play-wishlist': 'keystore-pass-1' } });
  try {
    project(c);
    assert.equal(await main(['play', 'build', '--release', 'beta', '--notes', 'Sharing works again.'], c.io), 0, c.text());
    assert.deepEqual(c.proposals, [{ method: 'POST', pathname: '/api/connectors/play/releases.propose', body: { args: { title: 'Wishlist 1.4 to Open testing', app: PKG, changes: [{ op: 'release.upload', track: 'beta', notes: 'Sharing works again.' }] } } }]);
    assert.match(c.text(), /Proposed\. Approve it in Workshop: Settings, Manager, Approvals/);
    // Production needs its release said in full, checked before anything is built.
    c.runs.length = 0;
    assert.equal(await main(['play', 'build', '--release', 'production'], c.io), 1);
    assert.match(c.text(), /Say how to release to Production/);
    assert.deepEqual(c.runs, []);
    assert.equal(await main(['play', 'build', '--release'], c.io), 1);
    assert.match(c.text(), /--release needs a track/);
    assert.deepEqual(c.runs, []);
    assert.equal(await main(['play', 'release', 'wishlist', '--track', 'production', '--status', 'inProgress', '--fraction', '0.1'], c.io), 0);
    assert.deepEqual(c.proposals.at(-1).body.args.changes, [{ op: 'release.upload', track: 'production', status: 'inProgress', userFraction: 0.1 }]);
  } finally { c.done(); }
});

test('play build says what is missing, and stops when the build fails or makes another app', async () => {
  const none = cli();
  try { assert.equal(await main(['play', 'build'], none.io), 1); assert.match(none.text(), /Google Play is not set up yet/); } finally { none.done(); }
  const c = cli({ apps: [{ ...WISHLIST, signingSecret: undefined }] });
  try {
    project(c);
    assert.equal(await main(['play', 'build'], c.io), 1);
    assert.match(c.text(), /Set "Signing password \(secret name\)" .*workshop secret set play-wishlist --password/);
  } finally { c.done(); }
  const unsaved = cli({ apps: [WISHLIST] });
  try { project(unsaved); assert.equal(await main(['play', 'build'], unsaved.io), 1); assert.match(unsaved.text(), /"play-wishlist" is not saved on this computer/); } finally { unsaved.done(); }
  const noProject = cli({ apps: [WISHLIST], stored: { 'play-wishlist': 'keystore-pass-1' } });
  try { assert.equal(await main(['play', 'build'], noProject.io), 1); assert.match(noProject.text(), /does not exist/); } finally { noProject.done(); }
  const noTwa = cli({ apps: [WISHLIST], stored: { 'play-wishlist': 'keystore-pass-1' } });
  try { project(noTwa, 'wishlist-android', {}); assert.equal(await main(['play', 'build'], noTwa.io), 1); assert.match(noTwa.text(), /no twa-manifest\.json .* init --manifest=/); } finally { noTwa.done(); }
  const fails = cli({ apps: [WISHLIST], stored: { 'play-wishlist': 'keystore-pass-1' } });
  try {
    project(fails);
    fails.io.buildFails = true;
    assert.equal(await main(['play', 'build', '--release', 'internal'], fails.io), 1);
    assert.match(fails.text(), /Bubblewrap \(build\) stopped \(exit code 3\)\. Nothing was uploaded\./);
    assert.deepEqual(fails.proposals, []);
  } finally { fails.done(); }
  const other = cli({ apps: [WISHLIST], stored: { 'play-wishlist': 'keystore-pass-1' } });
  try {
    project(other);
    other.io.builtPackage = 'org.someone.else';
    assert.equal(await main(['play', 'build', '--release', 'internal'], other.io), 1);
    assert.match(other.text(), /This bundle is for org\.someone\.else, not org\.example\.wishlist/);
    assert.deepEqual(other.proposals, []);
  } finally { other.done(); }
});

test('Gradle projects: ./gradlew bundleRelease with ANDROID_* passwords; your own bubblewrap is used when installed', async () => {
  const c = cli({ apps: [{ packageName: 'org.example.rally', name: 'Rally', folder: '~/rally', kind: 'gradle', signingSecret: 'play-rally', keyPasswordSecret: 'play-rally-key' }], stored: { 'play-rally': 'store-pw-22', 'play-rally-key': 'key-pw-33' } });
  try {
    const dir = project(c, 'rally', { gradlew: '#!/bin/sh\n' });
    c.io.builtPackage = 'org.example.rally';
    assert.equal(await main(['play', 'build', 'rally'], c.io), 0, c.text());
    assert.deepEqual([c.runs[0].cmd, c.runs[0].args], [path.join(dir, 'gradlew'), ['bundleRelease']]);
    assert.equal(c.runs[0].env.ANDROID_KEYSTORE_PASSWORD, 'store-pw-22');
    assert.equal(c.runs[0].env.ANDROID_KEY_PASSWORD, 'key-pw-33');
    assert.equal(await main(['play', 'build', 'rally', '--bump'], c.io), 1);
    assert.match(c.text(), /--bump is for Bubblewrap projects/);
  } finally { c.done(); }
  const steps = buildSteps('bubblewrap', '/p', { which: () => '/usr/local/bin/bubblewrap', exists: () => true });
  assert.deepEqual(steps.map(s => [s.cmd, s.args]), [['/usr/local/bin/bubblewrap', ['build']]]);
  assert.equal(buildSteps('bubblewrap', 'C:\\p', { platform: 'win32', which: () => null, npx: 'C:\\node\\npx.cmd', exists: () => true })[0].shell, true, 'npx.cmd needs a shell on Windows');
  assert.equal(findOnPath('bubblewrap', { env: { PATH: '/a:/b' }, platform: 'darwin', exists: f => f === path.join('/b', 'bubblewrap') }), path.join('/b', 'bubblewrap'));
});
