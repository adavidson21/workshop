// The workshop command (workshop.mjs): config inspection, the doctor report, and building the static site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectConfig, doctorReport, buildRegistry, publish, loadSchemas, main } from '../../workshop.mjs';
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

test('doctor is all good on a fresh home and reports config problems otherwise', async () => {
  const home = tempDir('workshop-cli-home-');
  try {
    const fresh = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent });
    assert.equal(fresh.code, 0);
    const text = fresh.lines.join('\n');
    assert.match(text, /config\.json: not created yet/);
    assert.match(text, /no agent is running/);
    assert.match(text, /Start at login: off in config/);

    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 1 }));
    const bad = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v22.22.0', probe: noAgent });
    assert.equal(bad.code, 1);
    assert.match(bad.lines.join('\n'), /config\.json: there is a problem/);
  } finally { rm(home); }
});

test('doctor flags an old Node', async () => {
  const home = tempDir('workshop-cli-old-');
  try {
    const r = await doctorReport({ home, env: {}, platform: 'linux', nodeVersion: 'v20.11.0', probe: noAgent });
    assert.equal(r.code, 1);
    assert.match(r.lines.join('\n'), /too old/);
  } finally { rm(home); }
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

test('install --allow and --workspace set up hosted mode and the opencode connector, and never undo later changes', async () => {
  const home = tempDir('workshop-cli-setup-');
  const env = { WORKSHOP_HOME: home, WORKSHOP_LOGIN_DIR: tempDir('workshop-cli-login-') };
  const out = [];
  const io = { out: s => out.push(s), env };
  const read = () => JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 4398, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} }));
    const args = ['install', '--allow', 'https://dispatch.example.org/', '--workspace', '~/work', '--opencode', '/opt/oc/bin/opencode'];
    assert.equal(await main(args, io), 0, out.join('\n'));
    let c = read();
    assert.equal(c.features.hostedMode, true);
    assert.deepEqual(c.allowedOrigins, ['https://dispatch.example.org']);
    assert.deepEqual(c.connectors.opencode, { enabled: true, config: { workspace: '~/work', opencode: { command: '/opt/oc/bin/opencode' } } });

    // The user changes things in Settings; running the installer again keeps them.
    c.connectors.opencode = { enabled: false, config: { workspace: '~/code', opencode: { command: 'opencode' } } };
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(c));
    assert.equal(await main(args, io), 0);
    c = read();
    assert.deepEqual(c.connectors.opencode, { enabled: false, config: { workspace: '~/code', opencode: { command: 'opencode' } } });
    assert.deepEqual(c.allowedOrigins, ['https://dispatch.example.org']);

    assert.equal(await main(['install', '--allow', 'not a site'], io), 1);
    assert.equal(await main(['install', '--workspace'], io), 1);
    assert.equal(await main(['install', '--bogus'], io), 1);
  } finally { rm(home); rm(env.WORKSHOP_LOGIN_DIR); }
});
