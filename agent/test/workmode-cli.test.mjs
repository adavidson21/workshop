// The workshop command's work mode parts: pin, install --work-mode, update by release tag, and what doctor
// says about the pinned copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, doctorReport, parseUpdateArgs, parsePinArgs, parseInstallArgs, validTag, checkoutTag, listTags, gitInfo, pin, planLatest, latestTag, versionAt } from '../../workshop.mjs';
import { verifyPinned } from '../lib/pinned.mjs';
import { REPO } from './helpers.mjs';

const tempDir = pfx => fs.mkdtempSync(path.join(os.tmpdir(), pfx));
const rm = d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
const noAgent = async () => null;
const hasGit = spawnSync('git', ['--version']).status === 0;

test('release tags are plain names, never options or paths', () => {
  for (const t of ['v1.2.0', '1.0', 'v2.0.0-rc.1', 'release_3']) assert.ok(validTag(t), t);
  for (const t of ['', '-x', '--upload-pack=evil', 'a/b', '../x', 'v1..2', 'a b', 'a;b', 'x'.repeat(101), undefined]) assert.ok(!validTag(t), String(t));
});

test('update, pin and install read their options', () => {
  assert.deepEqual(parseUpdateArgs([]).opts, { tag: null, docketTag: null, receiptsTag: null, notesTag: null, engAgentsTag: null, engAgents: null, latest: true, check: false, verbose: false, restart: false }, 'plain update means the newest releases');
  assert.deepEqual(parseUpdateArgs(['--check']).opts, { tag: null, docketTag: null, receiptsTag: null, notesTag: null, engAgentsTag: null, engAgents: null, latest: false, check: true, verbose: false, restart: false });
  assert.ok(parseUpdateArgs(['--check', '--tag', 'v1.0.0']).error);
  assert.match(parseUpdateArgs(['--pull']).error, /--pull is gone/, 'update never pulls main: release tags only');
  assert.match(parseUpdateArgs(['--latest']).error, /plain "workshop update"/, 'plain update already means the newest releases');
  assert.deepEqual(parseUpdateArgs(['--help']), { help: true });
  assert.deepEqual(parseUpdateArgs(['--tag', 'v1.0.0', '-h']), { help: true }, 'help wins over other options');
  assert.equal(parseUpdateArgs(['--receipts-tag', 'v3.0.0']).opts.receiptsTag, 'v3.0.0');
  assert.deepEqual(parseUpdateArgs(['--tag', 'v1.0.0', '--docket-tag', 'v4.7.0', '--receipts-tag', 'v0.3.0']).opts, { tag: 'v1.0.0', docketTag: 'v4.7.0', receiptsTag: 'v0.3.0', notesTag: null, engAgentsTag: null, engAgents: null, latest: false, check: false, verbose: false, restart: false });
  assert.ok(parseUpdateArgs(['--tag']).error);
  assert.ok(parseUpdateArgs(['--tag', '--check']).error);
  assert.ok(parseUpdateArgs(['--bogus']).error);
  assert.equal(parsePinArgs(['--no-docket']).opts.noDocket, true);
  assert.equal(parsePinArgs(['--docket', 'x']).opts.docket, path.resolve('x'));
  assert.ok(parsePinArgs(['--docket']).error);
  assert.ok(parsePinArgs(['--docket', 'x', '--no-docket']).error);
  assert.equal(parsePinArgs(['--no-receipts']).opts.noRapport, true);
  assert.equal(parsePinArgs(['--receipts', 'y']).opts.receipts, path.resolve('y'));
  assert.ok(parsePinArgs(['--receipts', 'y', '--no-receipts']).error);
  assert.equal(parseInstallArgs(['--work-mode']).opts.workMode, true);
  assert.ok(parseInstallArgs(['--work-mode', '--allow', 'https://x.example.org']).error, 'no site can pair in work mode');
});

test('install --work-mode turns work mode on and hosted mode off, keeping the allowed sites for later', async () => {
  const home = tempDir('workshop-wm-install-');
  const env = { WORKSHOP_HOME: home, WORKSHOP_LOGIN_DIR: tempDir('workshop-wm-login-') };
  const out = [];
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 4397, allowedOrigins: ['https://workshop.example.org'], features: { startAtLogin: false, hostedMode: true }, connectors: {} }));
    assert.equal(await main(['install', '--work-mode'], { out: s => out.push(s), env }), 0, out.join('\n'));
    const c = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
    assert.equal(c.features.workMode, true);
    assert.equal(c.features.hostedMode, false);
    assert.deepEqual(c.allowedOrigins, ['https://workshop.example.org']);
    assert.match(out.join('\n'), /builds its pinned copy when it starts/);
  } finally { rm(home); rm(env.WORKSHOP_LOGIN_DIR); }
});

test('pin builds a checked copy from this install, and doctor reports it', async () => {
  const home = tempDir('workshop-wm-pin-');
  const defaultDir = path.join(tempDir('workshop-wm-data-'), 'Workshop');
  try {
    const r = pin({ home, repo: REPO, opts: { noDocket: true, noRapport: true } });
    assert.equal(r.docketDir, null);
    assert.equal(r.build.docket, null);
    assert.equal(r.build.receipts, null);
    assert.ok(r.build.files['index.html']);
    assert.equal(verifyPinned(path.join(home, 'ui')).ok, true);

    // Pinning again keeps the previous copy beside it.
    pin({ home, repo: REPO, opts: { noDocket: true, noRapport: true } });
    assert.ok(fs.existsSync(path.join(home, 'ui.previous', 'build.json')));
    assert.ok(!fs.existsSync(path.join(home, 'ui.next')));

    const cfg = on => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 4396, allowedOrigins: ['https://w.example.org'], features: { startAtLogin: false, hostedMode: true, workMode: on }, connectors: {} }));
    cfg(true);
    let d = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir });
    let text = d.lines.join('\n');
    assert.equal(d.code, 0, text);
    assert.match(text, /Work mode: on\. Pinned copy: Workshop .*no Docket, no Rapport.*all \d+ files match build\.json/);
    assert.match(text, /Hosted mode: on \(not used: work mode is on/);

    // A changed file fails doctor.
    fs.appendFileSync(path.join(home, 'ui', 'index.html'), '<!-- changed -->');
    d = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir });
    assert.equal(d.code, 1);
    assert.match(d.lines.join('\n'), /Work mode: on, but there is a problem.*index\.html changed after/);

    cfg(false);
    d = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir });
    assert.match(d.lines.join('\n'), /Work mode: off\./);
  } finally { rm(home); rm(path.dirname(defaultDir)); }
});

test('pin includes an app from its own checkout (Rapport), so work mode shows it', () => {
  const home = tempDir('workshop-wm-pin3-');
  const runway = tempDir('workshop-wm-receipts-');
  try {
    fs.writeFileSync(path.join(runway, 'app.json'), JSON.stringify({ manifestVersion: 1, id: 'receipts', name: 'Rapport', version: '0.1.0', icon: 'icon.svg', entry: 'index.html', order: 30, modes: ['local', 'hosted', 'browser'] }));
    fs.writeFileSync(path.join(runway, 'index.html'), '<!doctype html><title>Rapport</title>');
    fs.writeFileSync(path.join(runway, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.mkdirSync(path.join(runway, 'scripts'));
    fs.writeFileSync(path.join(runway, 'scripts', 'build.mjs'), '');
    fs.writeFileSync(path.join(runway, '.assetsignore'), 'scripts\n');
    const r = pin({ home, repo: REPO, opts: { noDocket: true, receipts: runway } });
    assert.equal(r.dirs.receipts, runway);
    assert.equal(r.build.receipts.version, '0.1.0');
    assert.ok(r.build.files['apps/receipts/index.html']);
    assert.ok(!r.build.files['apps/receipts/scripts/build.mjs'], '.assetsignore is honored');
    const reg = JSON.parse(fs.readFileSync(path.join(home, 'ui', 'apps', 'registry.json'), 'utf8'));
    assert.ok(reg.apps.some(a => a.manifest.id === 'receipts'), 'Rapport is in the rail');
    assert.equal(verifyPinned(path.join(home, 'ui')).ok, true);
    assert.throws(() => pin({ home, repo: REPO, opts: { noDocket: true, receipts: home } }), /not a Rapport checkout/);
  } finally { rm(home); rm(runway); }
});

test('pin refuses a folder that is not a Docket checkout', () => {
  const home = tempDir('workshop-wm-pin2-');
  try {
    assert.throws(() => pin({ home, repo: REPO, opts: { docket: home } }), /not a Docket checkout/);
    assert.ok(!fs.existsSync(path.join(home, 'ui')), 'nothing is built');
  } finally { rm(home); }
});

/** A git repo with a remote ("origin") holding tags v1.0.0 and v1.1.0, and a clone of it. */
function repos() {
  const root = tempDir('workshop-wm-git-');
  const g = (dir, ...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const origin = path.join(root, 'origin');
  fs.mkdirSync(origin);
  g(origin, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(origin, 'f.txt'), 'one');
  g(origin, 'add', '.'); g(origin, 'commit', '-qm', 'one'); g(origin, 'tag', 'v1.0.0');
  fs.writeFileSync(path.join(origin, 'f.txt'), 'two');
  g(origin, 'commit', '-qam', 'two'); g(origin, 'tag', 'v1.1.0'); g(origin, 'tag', 'docket-android');
  fs.writeFileSync(path.join(origin, 'f.txt'), 'three');
  g(origin, 'commit', '-qam', 'three');
  const clone = path.join(root, 'clone');
  const c = spawnSync('git', ['clone', '-q', origin, clone], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  return { root, origin, clone, g };
}

test('update moves a checkout to a release tag, lists tags newest first, and refuses local changes or unknown tags', { skip: !hasGit && 'git is not installed' }, () => {
  const { root, origin, clone, g } = repos();
  try {
    assert.deepEqual(listTags(clone), ['v1.1.0', 'v1.0.0'], 'only release tags, not docket-android');
    const out = [];
    assert.equal(checkoutTag(clone, 'v1.0.0', s => out.push(s)), true, out.join('\n'));
    assert.equal(fs.readFileSync(path.join(clone, 'f.txt'), 'utf8'), 'one');
    assert.equal(gitInfo(clone).ref, 'v1.0.0');

    assert.equal(checkoutTag(clone, 'v9.9.9', s => out.push(s)), false);
    assert.match(out.at(-1), /There is no tag v9\.9\.9/);

    fs.writeFileSync(path.join(clone, 'f.txt'), 'edited');
    assert.equal(checkoutTag(clone, 'v1.1.0', s => out.push(s)), false);
    assert.match(out.at(-1), /has local changes/);
    g(clone, 'checkout', '-q', '--', 'f.txt');

    // A tag moved on the remote is not taken: git refuses to replace a tag it already has.
    g(origin, 'tag', '-f', 'v1.1.0', 'HEAD');
    assert.equal(checkoutTag(clone, 'v1.1.0', s => out.push(s)), true);
    assert.equal(fs.readFileSync(path.join(clone, 'f.txt'), 'utf8'), 'two', 'still the tag as first seen');
  } finally { rm(root); }
});

test('doctor checks opencode\'s providers against the connector\'s approved list', async () => {
  const home = tempDir('workshop-wm-prov-');
  const userHome = tempDir('workshop-wm-user-');
  const defaultDir = path.join(tempDir('workshop-wm-data-'), 'Workshop');
  try {
    fs.mkdirSync(path.join(userHome, '.config', 'opencode'), { recursive: true });
    const write = cfg => fs.writeFileSync(path.join(userHome, '.config', 'opencode', 'opencode.json'), JSON.stringify(cfg));
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 4395, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: { opencode: { enabled: true, config: { workspace: path.join(userHome, 'work'), approvedProviders: ['acme'] } } } }));
    const run = () => doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir, userHome });
    write({ model: 'acme/x' });
    let d = await run();
    assert.equal(d.code, 1);
    assert.match(d.lines.join('\n'), /opencode providers: approved acme\.\n\s+enabled_providers is not set/);
    write({ enabled_providers: ['acme'], model: 'acme/x' });
    d = await run();
    assert.equal(d.code, 0, d.lines.join('\n'));
  } finally { rm(home); rm(userHome); rm(path.dirname(defaultDir)); }
});

test('a plain update picks the newest release tag of each checkout found, Tandem included', { skip: !hasGit && 'git is not installed' }, () => {
  const { root, origin, g } = repos();
  try {
    const clone = (name, at) => {
      const dir = path.join(root, name);
      const c = spawnSync('git', ['clone', '-q', origin, dir], { encoding: 'utf8' });
      assert.equal(c.status, 0, c.stderr);
      if (at) g(dir, 'checkout', '-q', '--detach', at);
      return dir;
    };
    const ws = clone('workshop', 'v1.0.0');
    const docket = clone('docket', 'v1.1.0');
    fs.writeFileSync(path.join(docket, 'app.json'), '{}');
    g(origin, 'tag', 'core-v9', 'v1.1.0');
    g(origin, 'tag', 'core-v2.0.0', 'v1.0.0');
    g(origin, 'tag', 'core-v2.1.0', 'v1.1.0');
    const ea = clone('eng-agents', 'core-v2.0.0');
    fs.writeFileSync(path.join(ea, 'update.ps1'), '');

    assert.equal(latestTag(ws), 'v1.1.0', 'not docket-android, not a core- tag');
    assert.equal(latestTag(ea, 'core-v'), 'core-v2.1.0', 'not an old short tag like core-v9');
    const userHome = path.join(root, 'home');
    const plan = planLatest(ws, () => {}, { userHome });
    assert.deepEqual(plan.tags, { tag: 'v1.1.0', engAgentsTag: 'core-v2.1.0' }, 'Docket is already newest; Rapport and Folio have no clone; Tandem is behind');
    assert.ok(plan.lines.some(l => /Docket: already at v1\.1\.0/.test(l)), plan.lines.join('\n'));
    assert.ok(plan.lines.some(l => /Rapport: not downloaded, so skipped\. To add it: workshop apps on receipts/.test(l)), plan.lines.join('\n'));
    assert.ok(plan.lines.some(l => /Tandem \(eng-agents\): not installed in opencode -> core-v2\.1\.0/.test(l)), plan.lines.join('\n'));
    assert.ok(parseUpdateArgs(['--eng-agents-tag', 'core-v2.1.0']).opts.engAgentsTag === 'core-v2.1.0');
    assert.equal(fs.readFileSync(path.join(ws, 'f.txt'), 'utf8'), 'one', 'planning changes nothing');
  } finally { rm(root); }
});

test('a plain update never moves a checkout back to an older release, and versionAt reads both kinds of repo', { skip: !hasGit && 'git is not installed' }, () => {
  const root = tempDir('workshop-wm-nodown-');
  const g = (dir, ...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  // An origin with releases 1.0.0 and 1.1.0 and unreleased 1.2.0 on main. write(v) puts the version where that repo keeps it.
  const origin = (name, write) => {
    const dir = path.join(root, `${name}-origin`);
    fs.mkdirSync(dir);
    g(dir, 'init', '-q', '-b', 'main');
    for (const v of ['1.0.0', '1.1.0', '1.2.0']) {
      write(dir, v);
      g(dir, 'add', '.'); g(dir, 'commit', '-qm', v);
      if (v !== '1.2.0') g(dir, 'tag', `v${v}`);
    }
    return dir;
  };
  const clone = (from, name, at) => {
    const dir = path.join(root, name);
    const c = spawnSync('git', ['clone', '-q', from, dir], { encoding: 'utf8' });
    assert.equal(c.status, 0, c.stderr);
    if (at) g(dir, 'checkout', '-q', '--detach', at);
    return dir;
  };
  try {
    const wsOrigin = origin('workshop', (d, v) => { fs.mkdirSync(path.join(d, 'agent'), { recursive: true }); fs.writeFileSync(path.join(d, 'agent', 'version.mjs'), `export const VERSION = '${v}';\n`); });
    const appOrigin = origin('docket', (d, v) => fs.writeFileSync(path.join(d, 'app.json'), JSON.stringify({ id: 'prioritizer', version: v })));
    const ws = clone(wsOrigin, 'workshop');           // main: 1.2.0, newer than any release
    const docket = clone(appOrigin, 'docket', 'v1.0.0'); // an old release: moves forward
    const receipts = clone(appOrigin, 'receipts');    // main: 1.2.0, newer than any release

    assert.equal(versionAt(ws), '1.2.0');
    assert.equal(versionAt(ws, 'refs/tags/v1.1.0'), '1.1.0');
    assert.equal(versionAt(docket), '1.0.0');
    assert.equal(versionAt(path.join(root, 'nowhere')), null);

    const plan = planLatest(ws, () => {}, { userHome: path.join(root, 'home'), dispatchOn: false });
    assert.deepEqual(plan.tags, { docketTag: 'v1.1.0' }, plan.lines.join('\n'));
    assert.ok(plan.lines.some(l => /Workshop: 1\.2\.0 here is newer than the newest release \(v1\.1\.0\)\. Left as it is/.test(l)), plan.lines.join('\n'));
    assert.ok(plan.lines.some(l => /Rapport: 1\.2\.0 here is newer than the newest release \(v1\.1\.0\)/.test(l)), plan.lines.join('\n'));
    assert.ok(plan.lines.some(l => /Docket: v1\.0\.0 -> v1\.1\.0/.test(l)), plan.lines.join('\n'));
    assert.equal(versionAt(ws), '1.2.0', 'planning changes nothing');
  } finally { rm(root); }
});
