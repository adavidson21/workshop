// Start at login (agent/lib/login.mjs): one per-user launcher file, created and removed, no process started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loginItem, loginContent, enableStartAtLogin, disableStartAtLogin, startAtLoginStatus, applyStartAtLogin } from '../lib/login.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-login-'));
const rm = d => fs.rmSync(d, { recursive: true, force: true });
const REPO = '/opt/workshop';
const SCRIPT = path.join(REPO, 'agent', 'start.mjs');
const opts = dir => ({ repo: REPO, execPath: '/usr/bin/node', dir });

test('each platform puts the launcher in the expected place', () => {
  assert.equal(loginItem({ platform: 'win32', dir: 'D:/start' }).path, path.join('D:/start', 'Workshop.cmd'));
  assert.equal(loginItem({ platform: 'darwin', dir: '/la' }).path, path.join('/la', 'org.workshop.agent.plist'));
  assert.equal(loginItem({ platform: 'linux', dir: '/auto' }).path, path.join('/auto', 'workshop.desktop'));
  assert.equal(loginItem({ platform: 'sunos' }).kind, 'unsupported');
});

test('without a dir override, the launcher is under the OS home, not the Workshop data home', () => {
  // loginItem builds paths with path.join, so normalize to forward slashes before comparing: on Windows
  // the separator is a backslash, and these cases only check which folder each platform picks.
  const slash = p => p.split(path.sep).join('/');
  const win = loginItem({ platform: 'win32', env: { APPDATA: 'C:/Users/alex/AppData/Roaming' } });
  assert.match(slash(win.path), /AppData\/Roaming\/Microsoft\/Windows\/Start Menu\/Programs\/Startup\/Workshop\.cmd$/);
  const lin = loginItem({ platform: 'linux', env: { XDG_CONFIG_HOME: '/home/alex/.config' } });
  assert.equal(slash(lin.path), '/home/alex/.config/autostart/workshop.desktop');
  const mac = loginItem({ platform: 'darwin', home: '/Users/alex' });
  assert.equal(slash(mac.path), '/Users/alex/Library/LaunchAgents/org.workshop.agent.plist');
});

test('the launcher content runs this Node on start.mjs, quietly', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const it = loginItem({ platform, dir: '/x' });
    const text = loginContent({ kind: it.kind, execPath: '/usr/bin/node', startScript: SCRIPT });
    assert.ok(text.includes('/usr/bin/node'), platform);
    assert.ok(text.includes(SCRIPT), platform);
    assert.ok(text.includes('--quiet'), platform);
  }
});

test('enable writes the launcher, status sees it, disable removes it', async () => {
  const dir = tempDir();
  try {
    assert.equal(startAtLoginStatus({ dir }).installed, false);
    const r = await enableStartAtLogin(opts(dir));
    assert.ok(fs.existsSync(r.path));
    assert.equal(startAtLoginStatus({ dir }).installed, true);
    const body = fs.readFileSync(r.path, 'utf8');
    assert.ok(body.includes(SCRIPT) && body.includes('/usr/bin/node'));

    const d1 = await disableStartAtLogin({ dir });
    assert.equal(d1.removed, true);
    assert.equal(startAtLoginStatus({ dir }).installed, false);
    const d2 = await disableStartAtLogin({ dir });
    assert.equal(d2.removed, false, 'removing an absent launcher is a no-op');
  } finally { rm(dir); }
});

test('applyStartAtLogin turns it on and off and never throws', async () => {
  const dir = tempDir();
  try {
    const on = await applyStartAtLogin(true, opts(dir));
    assert.deepEqual([on.ok, on.action], [true, 'enabled']);
    assert.equal(startAtLoginStatus({ dir }).installed, true);
    const off = await applyStartAtLogin(false, opts(dir));
    assert.deepEqual([off.ok, off.action], [true, 'removed']);
    assert.equal(startAtLoginStatus({ dir }).installed, false);
    const absent = await applyStartAtLogin(false, opts(dir));
    assert.equal(absent.action, 'absent');
  } finally { rm(dir); }
});

test('an unsupported platform is reported, not crashed', async () => {
  await assert.rejects(enableStartAtLogin({ ...opts('/x'), platform: 'sunos' }), /not supported/);
  const r = await applyStartAtLogin(true, { ...opts('/x'), platform: 'sunos' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not supported/);
  assert.equal(startAtLoginStatus({ platform: 'sunos' }).installed, false);
});
