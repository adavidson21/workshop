// Agent start, stop and connector loading (docs/connector.md, Lifecycle), and the start.mjs command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createAgent } from '../server.mjs';
import { start, tempHome, rmHome, get, put, logText, HERE } from './helpers.mjs';

test('broken connectors are listed with an error and never stop the agent', async () => {
  const home = tempHome();
  const agent = await start(home, { connectors: { 'bad-api': { enabled: true }, throws: { enabled: true }, 'wrong-id': { enabled: true } } });
  try {
    const list = (await get(agent, '/api/connectors')).json.connectors;
    assert.deepEqual(list.map(c => c.id), ['bad-api', 'probe', 'throws', 'wrong-id']);
    for (const id of ['bad-api', 'throws', 'wrong-id']) {
      const c = list.find(x => x.id === id);
      assert.equal(c.status.state, 'error', id);
      assert.ok(c.status.message, id);
    }
    assert.match(list.find(c => c.id === 'throws').status.message, /broken on purpose/);
    assert.equal((await get(agent, '/api/connectors/throws/config')).json.code, 'unavailable');
    assert.equal(list.find(c => c.id === 'probe').status.state, 'disabled');
    assert.match(logText(agent), /Connector throws is not usable/);
  } finally { await agent.stop(); rmHome(home); }
});

test('a connector that takes too long to stop does not hold up shutdown past 5 seconds', { timeout: 20000 }, async () => {
  const home = tempHome();
  const agent = await start(home, { connectors: { probe: { enabled: true, config: { stopMs: 30000 } } } });
  const t = Date.now();
  await agent.stop();
  const took = Date.now() - t;
  assert.ok(took >= 4500 && took < 8000, `stop took ${took} ms`);
  assert.match(logText(agent), /did not stop cleanly/);
  rmHome(home);
});

test('disabling a connector stops it; stop() is safe to call twice', async () => {
  const home = tempHome();
  const agent = await start(home, { connectors: { probe: { enabled: true } } });
  try {
    await put(agent, '/api/config', { connectors: { probe: { enabled: false } } });
    assert.equal((await get(agent, '/api/connectors/probe')).json.status.state, 'disabled');
  } finally { await agent.stop(); await agent.stop(); rmHome(home); }
});

test('a port that is in use gives a plain message', async () => {
  const blocker = net.createServer();
  await new Promise(r => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  const home = tempHome();
  try {
    await assert.rejects(createAgent({ home, port }), e => e.code === 'EADDRINUSE' && /already in use/.test(e.message));
  } finally { blocker.close(); rmHome(home); }
});

const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('node agent/start.mjs starts the agent and prints the launcher address', { timeout: 20000 }, async () => {
  const home = tempHome();
  const port = await freePort();
  // WORKSHOP_LOGIN_DIR sends any start-at-login launcher into the temp home, so this test never writes to
  // the computer's real Startup folder, LaunchAgents or autostart.
  const child = spawn(process.execPath, [path.join(HERE, '..', 'start.mjs'), '--port', String(port), '--quiet'], {
    env: { ...process.env, WORKSHOP_HOME: home, WORKSHOP_LOGIN_DIR: path.join(home, 'login') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    let out = '';
    const url = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no address printed. Output: ${out}`)), 15000);
      child.stdout.on('data', d => {
        out += d;
        const m = out.match(/(http:\/\/127\.0\.0\.1:\d+)\/\?token=([0-9a-f]{64})/);
        if (m) { clearTimeout(t); resolve({ base: m[1], token: m[2] }); }
      });
      child.on('exit', code => reject(new Error(`exited with ${code}: ${out}`)));
    });
    assert.equal(url.base, `http://127.0.0.1:${port}`);
    const agent = { port, token: url.token };
    const health = await get(agent, '/api/health', { auth: 'none' });
    assert.equal(health.json.app, 'workshop-agent');
    assert.equal((await get(agent, '/api/config')).json.home, home);
  } finally {
    child.kill();
    await new Promise(r => (child.exitCode !== null ? r() : child.on('exit', r)));
    rmHome(home);
  }
});

test('start.mjs refuses unknown options', async () => {
  const child = spawn(process.execPath, [path.join(HERE, '..', 'start.mjs'), '--nope'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', d => { err += d; });
  const code = await new Promise(r => child.on('exit', r));
  assert.equal(code, 1);
  assert.match(err, /Unknown option/);
});

test('early errors on large uploads still reach the client', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    const big = { features: {}, pad: 'x'.repeat(2 * 1024 * 1024) };
    const tooLarge = await put(agent, '/api/config', big);
    assert.equal(tooLarge.status, 413);
    assert.equal(tooLarge.json.code, 'too_large');
    const noToken = await put(agent, '/api/data/notes/pages', big, { auth: 'none' });
    assert.equal(noToken.status, 401);
    assert.equal((await get(agent, '/api/health', { auth: 'none' })).status, 200, 'still answering');
  } finally { await agent.stop(); rmHome(home); }
});
