// Toggling features.startAtLogin through PUT /api/config creates and removes the launcher, and a start
// reconciles it with the flag (agent/server.mjs; docs/config.md, features.startAtLogin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgent } from '../server.mjs';
import { loginItem } from '../lib/login.mjs';
import { tempHome, rmHome, get, put, dataDirOf } from './helpers.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-login-wire-'));
const launcher = dir => loginItem({ platform: process.platform, dir }).path;

test('PUT /api/config startAtLogin on then off creates then removes the launcher', async () => {
  const home = tempHome();
  const loginDir = tempDir();
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home), loginDir });
  try {
    assert.equal(fs.existsSync(launcher(loginDir)), false, 'off to begin with');

    await put(agent, '/api/config', { features: { startAtLogin: true } });
    assert.equal((await get(agent, '/api/config')).json.features.startAtLogin, true);
    const file = launcher(loginDir);
    assert.ok(fs.existsSync(file), 'launcher created');
    const body = fs.readFileSync(file, 'utf8');
    assert.ok(body.includes(path.join('agent', 'start.mjs')) || body.includes('agent/start.mjs'), 'launcher runs start.mjs');

    await put(agent, '/api/config', { features: { startAtLogin: false } });
    assert.equal(fs.existsSync(file), false, 'launcher removed');
  } finally { await agent.stop(); rmHome(home); fs.rmSync(loginDir, { recursive: true, force: true }); }
});

test('a start reconciles a launcher that disagrees with the flag', async () => {
  const home = tempHome();
  const loginDir = tempDir();
  // config says start at login is on, but no launcher exists yet.
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    configVersion: 1, port: 4380, allowedOrigins: [], features: { startAtLogin: true, hostedMode: false }, connectors: {}
  }));
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home), loginDir });
  try {
    assert.ok(fs.existsSync(launcher(loginDir)), 'start created the missing launcher');
  } finally { await agent.stop(); rmHome(home); fs.rmSync(loginDir, { recursive: true, force: true }); }
});

test('a normal start with the default config writes no launcher', async () => {
  const home = tempHome();
  const loginDir = tempDir();
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home), loginDir });
  try {
    assert.equal(fs.existsSync(launcher(loginDir)), false);
    assert.deepEqual(fs.readdirSync(loginDir), [], 'nothing written when start at login is off');
  } finally { await agent.stop(); rmHome(home); fs.rmSync(loginDir, { recursive: true, force: true }); }
});
