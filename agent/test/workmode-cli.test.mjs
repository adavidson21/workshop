// The workshop command's work mode parts: pin, install --work-mode, update by release tag, and what doctor
// says about the pinned copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, doctorReport, parseUpdateArgs, parsePinArgs, parseInstallArgs, validTag, checkoutTag, listTags, gitInfo, pin, planLatest, latestTag } from '../../workshop.mjs';
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
  assert.deepEqual(parseUpdateArgs([]).opts, { tag: null, docketTag: null, runwayTag: null, pull: false, latest: false });
  assert.equal(parseUpdateArgs(['--latest']).opts.latest, true);
  assert.ok(parseUpdateArgs(['--latest', '--tag', 'v1.0.0']).error);
  assert.ok(parseUpdateArgs(['--latest', '--pull']).error);
  assert.deepEqual(parseUpdateArgs(['--tag', 'v1.0.0', '--docket-tag', 'v4.7.0', '--runway-tag', 'v0.3.0']).opts, { tag: 'v1.0.0', docketTag: 'v4.7.0', runwayTag: 'v0.3.0', pull: false, latest: false });
  assert.ok(parseUpdateArgs(['--pull', '--runway-tag', 'v1']).error);
  assert.ok(parseUpdateArgs(['--tag']).error);
  assert.ok(parseUpdateArgs(['--tag', '--pull']).error);
  assert.ok(parseUpdateArgs(['--pull', '--tag', 'v1']).error);
  assert.ok(parseUpdateArgs(['--bogus']).error);
  assert.equal(parsePinArgs(['--no-docket']).opts.noDocket, true);
  assert.equal(parsePinArgs(['--docket', 'x']).opts.docket, path.resolve('x'));
  assert.ok(parsePinArgs(['--docket']).error);
  assert.ok(parsePinArgs(['--docket', 'x', '--no-docket']).error);
  assert.equal(parsePinArgs(['--no-runway']).opts.noRunway, true);
  assert.equal(parsePinArgs(['--runway', 'y']).opts.runway, path.resolve('y'));
  assert.ok(parsePinArgs(['--runway', 'y', '--no-runway']).error);
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
    assert.match(out.join('\n'), /workshop pin/);
  } finally { rm(home); rm(env.WORKSHOP_LOGIN_DIR); }
});

test('pin builds a checked copy from this install, and doctor reports it', async () => {
  const home = tempDir('workshop-wm-pin-');
  const defaultDir = path.join(tempDir('workshop-wm-data-'), 'Workshop');
  try {
    const r = pin({ home, repo: REPO, opts: { noDocket: true, noRunway: true } });
    assert.equal(r.docketDir, null);
    assert.equal(r.build.docket, null);
    assert.equal(r.build.runway, null);
    assert.ok(r.build.files['index.html']);
    assert.equal(verifyPinned(path.join(home, 'ui')).ok, true);

    // Pinning again keeps the previous copy beside it.
    pin({ home, repo: REPO, opts: { noDocket: true, noRunway: true } });
    assert.ok(fs.existsSync(path.join(home, 'ui.previous', 'build.json')));
    assert.ok(!fs.existsSync(path.join(home, 'ui.next')));

    const cfg = on => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 4396, allowedOrigins: ['https://w.example.org'], features: { startAtLogin: false, hostedMode: true, workMode: on }, connectors: {} }));
    cfg(true);
    let d = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir });
    let text = d.lines.join('\n');
    assert.equal(d.code, 0, text);
    assert.match(text, /Work mode: on\. Pinned copy: Workshop .*no Docket, no Runway.*all \d+ files match build\.json/);
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

test('pin includes Runway from its own checkout, so work mode shows roadmaps', () => {
  const home = tempDir('workshop-wm-pin3-');
  const runway = tempDir('workshop-wm-runway-');
  try {
    fs.writeFileSync(path.join(runway, 'app.json'), JSON.stringify({ manifestVersion: 1, id: 'runway', name: 'Runway', version: '0.1.0', icon: 'icon.svg', entry: 'index.html', order: 30, modes: ['local', 'hosted', 'browser'] }));
    fs.writeFileSync(path.join(runway, 'index.html'), '<!doctype html><title>Runway</title>');
    fs.writeFileSync(path.join(runway, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.mkdirSync(path.join(runway, 'scripts'));
    fs.writeFileSync(path.join(runway, 'scripts', 'build.mjs'), '');
    fs.writeFileSync(path.join(runway, '.assetsignore'), 'scripts\n');
    const r = pin({ home, repo: REPO, opts: { noDocket: true, runway } });
    assert.equal(r.dirs.runway, runway);
    assert.equal(r.build.runway.version, '0.1.0');
    assert.ok(r.build.files['apps/runway/index.html']);
    assert.ok(!r.build.files['apps/runway/scripts/build.mjs'], '.assetsignore is honored');
    const reg = JSON.parse(fs.readFileSync(path.join(home, 'ui', 'apps', 'registry.json'), 'utf8'));
    assert.ok(reg.apps.some(a => a.manifest.id === 'runway'), 'Runway is in the rail');
    assert.equal(verifyPinned(path.join(home, 'ui')).ok, true);
    assert.throws(() => pin({ home, repo: REPO, opts: { noDocket: true, runway: home } }), /not a Runway checkout/);
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

test('update --latest picks the newest release tag of each checkout found, and only says how to update eng-agents', { skip: !hasGit && 'git is not installed' }, () => {
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
    const plan = planLatest(ws);
    assert.deepEqual(plan.tags, { tag: 'v1.1.0' }, 'Docket is already newest; Runway has no clone');
    assert.ok(plan.lines.some(l => /Docket: already at v1\.1\.0/.test(l)), plan.lines.join('\n'));
    assert.ok(plan.lines.some(l => /Runway: no git clone found/.test(l)), plan.lines.join('\n'));
    assert.match(plan.engAgents, /update\.ps1 -Tag core-v2\.1\.0/);
    assert.equal(fs.readFileSync(path.join(ws, 'f.txt'), 'utf8'), 'one', 'planning changes nothing');
  } finally { rm(root); }
});
