// The workshop command (workshop.mjs): config inspection, the doctor report, and building the static site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectConfig, doctorReport, buildRegistry, publish, loadSchemas, main, manualUpdateLines, releaseSource } from '../../workshop.mjs';
import { APPS } from './helpers.mjs';

const tempDir = pfx => fs.mkdtempSync(path.join(os.tmpdir(), pfx));
const rm = d => fs.rmSync(d, { recursive: true, force: true });
const schemas = loadSchemas();
const noAgent = async () => null;

test('inspectConfig tells apart missing, bad JSON, bad schema and ok', () => {
  const dir = tempDir('workshop-cli-cfg-');
  try {
    const file = path.join(dir, 'config.json');
    assert.equal(inspectConfig(file, schemas).state, 'missing');
    fs.writeFileSync(file, '{ not json');
    assert.equal(inspectConfig(file, schemas).state, 'badjson');
    fs.writeFileSync(file, JSON.stringify({ configVersion: 1, port: 10 }));
    assert.equal(inspectConfig(file, schemas).state, 'badschema');
    fs.writeFileSync(file, JSON.stringify({ configVersion: 1, port: 4380, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} }));
    assert.equal(inspectConfig(file, schemas).state, 'ok');
  } finally { rm(dir); }
});

// Never the real ~/Workshop: every doctor test passes a default data folder under the temp folder.
const tempDefault = () => path.join(tempDir('workshop-cli-data-'), 'Workshop');

test('doctor is all good on a fresh home and reports config problems otherwise', async () => {
  const home = tempDir('workshop-cli-home-');
  const defaultDir = tempDefault();
  try {
    const fresh = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir });
    assert.equal(fresh.code, 0);
    const text = fresh.lines.join('\n');
    assert.match(text, /config\.json: not created yet/);
    assert.match(text, /no agent is running/);
    assert.match(text, /Start at login: off in config/);

    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 1 }));
    const bad = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir });
    assert.equal(bad.code, 1);
    assert.match(bad.lines.join('\n'), /config\.json: there is a problem/);
  } finally { rm(home); rm(path.dirname(defaultDir)); }
});

const okConfig = extra => JSON.stringify(Object.assign({ configVersion: 1, port: 4399, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} }, extra));
const doctor = (home, defaultDir) => doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent, defaultDir });

test('doctor reports the data folder: default and missing is a note, not a failure, and nothing is created', async () => {
  const home = tempDir('workshop-cli-dd-');
  const defaultDir = tempDefault();
  try {
    const r = await doctor(home, defaultDir);
    assert.equal(r.code, 0);
    const text = r.lines.join('\n');
    assert.ok(text.includes(`Data folder: ${defaultDir} (the default): not created yet. The agent creates it when it starts.`), text);
    assert.match(text, /Old data in .*: none, nothing to copy\./);
    assert.ok(!fs.existsSync(defaultDir), 'doctor does not create the data folder');

    fs.mkdirSync(defaultDir);
    const ok = await doctor(home, defaultDir);
    assert.equal(ok.code, 0);
    assert.ok(ok.lines.join('\n').includes(`Data folder: ${defaultDir} (the default): ok, exists and is writable.`));
    assert.deepEqual(fs.readdirSync(defaultDir), [], 'the write check leaves nothing behind');
  } finally { rm(home); rm(path.dirname(defaultDir)); }
});

test('doctor reads dataDir from config.json and flags one inside the Workshop home', async () => {
  const home = tempDir('workshop-cli-ddc-');
  const other = tempDir('workshop-cli-ddo-');
  const defaultDir = tempDefault();
  try {
    fs.writeFileSync(path.join(home, 'config.json'), okConfig({ dataDir: other }));
    const r = await doctor(home, defaultDir);
    assert.equal(r.code, 0);
    assert.ok(r.lines.join('\n').includes(`Data folder: ${other}: ok, exists and is writable.`));

    fs.writeFileSync(path.join(home, 'config.json'), okConfig({ dataDir: path.join(home, 'data') }));
    const bad = await doctor(home, defaultDir);
    assert.equal(bad.code, 1);
    const text = bad.lines.join('\n');
    assert.match(text, /Data folder: .*: there is a problem/);
    assert.match(text, /may not be the Workshop home folder/, 'the agent\'s own rule, from dataDirProblem');

    const file = path.join(other, 'a-file');
    fs.writeFileSync(file, 'x');
    fs.writeFileSync(path.join(home, 'config.json'), okConfig({ dataDir: file }));
    const notDir = await doctor(home, defaultDir);
    assert.equal(notDir.code, 1);
    assert.match(notDir.lines.join('\n'), /is a file, not a folder/);
  } finally { rm(home); rm(other); rm(path.dirname(defaultDir)); }
});

test('doctor says whether the one-time copy from ~/.workshop/data has run', async () => {
  const home = tempDir('workshop-cli-moved-');
  const defaultDir = tempDefault();
  try {
    fs.mkdirSync(path.join(home, 'data', 'prioritizer'), { recursive: true });
    const pending = await doctor(home, defaultDir);
    assert.equal(pending.code, 0);
    assert.match(pending.lines.join('\n'), /Old data in .*: not copied yet\. The agent copies it once, on start/);

    fs.writeFileSync(path.join(home, 'data', 'moved.json'), JSON.stringify({ movedTo: defaultDir, movedAt: '2026-10-25T12:00:00.000Z', collections: 4 }));
    const done = await doctor(home, defaultDir);
    assert.ok(done.lines.join('\n').includes(`: copied to the data folder (${defaultDir}) on 2026-10-25T12:00:00.000Z. The old files are kept.`));
  } finally { rm(home); rm(path.dirname(defaultDir)); }
});

test('doctor flags an old Node', async () => {
  const home = tempDir('workshop-cli-old-');
  const defaultDir = tempDefault();
  try {
    const r = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v20.11.0', probe: noAgent, defaultDir });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /too old/);
  } finally { rm(home); rm(path.dirname(defaultDir)); }
});

test('buildRegistry lists valid apps in order and skips invalid ones', () => {
  const r = buildRegistry(APPS, schemas);
  assert.deepEqual(r.apps.map(a => a.manifest.id), ['board', 'notes']);
  assert.deepEqual(r.apps.map(a => a.base), ['/apps/board/', '/apps/notes/']);
});

test('buildRegistry is empty when there is no apps folder', () => {
  assert.deepEqual(buildRegistry(path.join(os.tmpdir(), 'no-such-apps-' + Date.now()), schemas), { apps: [] });
});

test('publish copies the served files and writes apps/registry.json', () => {
  const repo = tempDir('workshop-cli-repo-');
  const out = tempDir('workshop-cli-out-');
  try {
    fs.writeFileSync(path.join(repo, 'index.html'), '<!doctype html><title>x</title>');
    fs.mkdirSync(path.join(repo, 'shared'));
    fs.writeFileSync(path.join(repo, 'shared', 'ui.css'), 'body{}');
    fs.mkdirSync(path.join(repo, 'apps', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'apps', 'demo', 'app.json'), JSON.stringify({ manifestVersion: 1, id: 'demo', name: 'Demo', version: '1.0.0', icon: 'icon.svg', entry: 'index.html' }));

    const r = publish({ repo, outDir: out, schemas });
    assert.equal(r.apps, 1);
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
    assert.ok(fs.existsSync(path.join(out, 'shared', 'ui.css')));
    const reg = JSON.parse(fs.readFileSync(path.join(out, 'apps', 'registry.json'), 'utf8'));
    assert.deepEqual(reg.apps.map(a => a.base), ['/apps/demo/']);
  } finally { rm(repo); rm(out); }
});

test('install leaves start at login off unless --login is passed', async () => {
  const home = tempDir('workshop-cli-install-');
  const loginDir = tempDir('workshop-cli-login-');
  // A port nothing listens on, so install never sees a running agent.
  const env = { WORKSHOP_HOME: home, WORKSHOP_LOGIN_DIR: loginDir };
  const out = [];
  const io = { out: s => out.push(s), env };
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 4399, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} }));
    assert.equal(await main(['install'], io), 0);
    assert.deepEqual(fs.readdirSync(loginDir), [], 'no launcher without --login');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).features.startAtLogin, false);
    assert.match(out.join('\n'), /Start at login is off/);

    assert.equal(await main(['install', '--login'], io), 0);
    assert.equal(fs.readdirSync(loginDir).length, 1, 'launcher written with --login');
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).features.startAtLogin, true);
  } finally { rm(home); rm(loginDir); }
});

test('uninstall says it leaves the data folder and the Workshop home in place', async () => {
  const home = tempDir('workshop-cli-uninstall-');
  const loginDir = tempDir('workshop-cli-login-');
  const data = tempDir('workshop-cli-udata-');
  const out = [];
  const io = { out: s => out.push(s), env: { WORKSHOP_HOME: home, WORKSHOP_LOGIN_DIR: loginDir } };
  try {
    fs.writeFileSync(path.join(home, 'config.json'), okConfig({ dataDir: data }));
    assert.equal(await main(['uninstall'], io), 0);
    const text = out.join('\n');
    assert.ok(text.includes(`left your data folder (${data}) and the Workshop home folder (${home}) in place`), text);
    assert.ok(!text.includes('Your data is still in'));
    assert.ok(fs.existsSync(data) && fs.existsSync(path.join(home, 'config.json')));

    out.length = 0;
    assert.equal(await main(['help'], io), 0);
    assert.match(out.join('\n'), /uninstall .*Leaves your data folder \(dataDir, default ~\/Workshop\)\s+and ~\/\.workshop in place/);
    assert.ok(!out.join('\n').includes('Your data stays in ~/.workshop'));
  } finally { rm(home); rm(loginDir); rm(data); }
});

test('update for a non-git install names no repo unless package.json gives one', () => {
  const dir = tempDir('workshop-cli-update-');
  try {
    const plain = manualUpdateLines(dir);
    assert.match(plain[0], /^This is not a git checkout\. Download the latest release of Workshop and replace this folder with it\.$/);
    assert.ok(!plain.join('\n').includes('github.com'));
    assert.equal(releaseSource(dir), null);

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ repository: { url: 'git+https://example.com/team/workshop.git' } }));
    assert.equal(releaseSource(dir), 'https://example.com/team/workshop.git');
    assert.match(manualUpdateLines(dir)[0], /Workshop \(https:\/\/example\.com\/team\/workshop\.git\) and replace/);

    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ repository: 'file:../x' }));
    assert.equal(releaseSource(dir), null, 'only http(s) addresses are shown');
  } finally { rm(dir); }
});
