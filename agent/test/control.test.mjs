// workshop pat, stop and restart (lib/control.mjs and workshop.mjs). Processes, the registry and the agent
// are faked, except the last test, which really starts, stops and restarts an agent on a temp home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { listenerPids, patProblem, readSecret, startBackground, stopAgent } from '../../scripts/lib/control.mjs';
import { main, agentHealth } from '../../workshop.mjs';

const noSleep = async () => {};
const TOKEN = 'abcdefghij0123456789abcdefghij0123456789abcdefghij01';

test('patProblem accepts a token and names what is wrong otherwise, without repeating it', () => {
  assert.equal(patProblem(TOKEN), null);
  assert.equal(patProblem(''), 'Nothing was entered.');
  assert.match(patProblem('abc def ghi jkl mno pqr stu'), /spaces/);
  assert.match(patProblem('short'), /5 characters/);
  assert.match(patProblem('é'.repeat(30)), /characters a PAT never has/);
  assert.equal(patProblem('ab cd efgh ijkl mnop qrst').includes('mnop'), false);
});

test('readSecret reads piped input whole', async () => {
  const stdin = new PassThrough();
  const out = new PassThrough();
  const p = readSecret({ stdin, stdout: out, prompt: 'Token: ' });
  stdin.end(`  ${TOKEN}\r\n`);
  assert.equal(await p, TOKEN);
});

test('readSecret in a terminal echoes nothing, handles backspace and paste markers, and cancels on Ctrl+C', async () => {
  const fakeTty = () => {
    const s = new PassThrough();
    s.isTTY = true;
    s.raw = [];
    s.setRawMode = v => { s.raw.push(v); };
    return s;
  };
  const out = new PassThrough();
  let written = '';
  out.on('data', d => { written += d; });
  const a = fakeTty();
  const p = readSecret({ stdin: a, stdout: out, prompt: 'Token: ' });
  a.write('\x1b[200~abcX\x7f');
  a.write('def\x1b[201~\r');
  assert.equal(await p, 'abcdef');
  assert.deepEqual(a.raw, [true, false]);
  assert.equal(written.includes('abc'), false);

  const b = fakeTty();
  const q = readSecret({ stdin: b, stdout: out });
  b.write('abc\u0003');
  await assert.rejects(q, e => e.code === 'cancelled');
  assert.deepEqual(b.raw, [true, false]);
});

test('listenerPids uses Get-NetTCPConnection on Windows, lsof elsewhere, fuser when Linux has no lsof', () => {
  const calls = [];
  const exec = out => (cmd, args) => { calls.push([cmd, args.join(' ')]); return out(cmd); };
  assert.deepEqual(listenerPids(4380, { platform: 'win32', exec: exec(() => ({ stdout: '1234\r\n1234\r\n' })) }), [1234]);
  assert.match(calls[0][1], /Get-NetTCPConnection -LocalPort 4380 -State Listen/);
  assert.deepEqual(listenerPids(4380, { platform: 'darwin', exec: exec(() => ({ stdout: '55\n66\n' })) }), [55, 66]);
  assert.equal(calls[1][0], 'lsof');
  assert.deepEqual(listenerPids(4380, { platform: 'linux', exec: exec(c => (c === 'lsof' ? { error: new Error('ENOENT') } : { stdout: ' 77' })) }), [77]);
  assert.deepEqual(calls.slice(2).map(c => c[0]), ['lsof', 'fuser']);
  assert.deepEqual(listenerPids('4380; rm -rf /', { exec: exec(() => ({ stdout: '1' })) }), []);
  assert.deepEqual(listenerPids(4380, { platform: 'darwin', exec: () => ({ stdout: `${process.pid}\n` }) }), [], 'never this process');
});

test('stopAgent acts only when the agent answers, and waits until it is gone', async () => {
  let up = true;
  const killed = [];
  const probe = async () => (up ? { app: 'workshop-agent' } : null);
  const exec = () => ({ stdout: '4242' });
  const kill = pid => { killed.push(pid); up = false; };
  assert.deepEqual(await stopAgent({ port: 4380, probe, exec, kill, sleep: noSleep, platform: 'darwin' }), { ok: true, wasRunning: true, message: 'Workshop stopped.' });
  assert.deepEqual(killed, [4242]);

  const idle = await stopAgent({ port: 4380, probe, exec, kill, sleep: noSleep });
  assert.equal(idle.ok && !idle.wasRunning, true);
  assert.deepEqual(killed, [4242], 'nothing killed when nothing answers');

  up = true;
  const unknown = await stopAgent({ port: 4380, probe, exec: () => ({ stdout: '' }), kill, sleep: noSleep, platform: 'darwin' });
  assert.equal(unknown.ok, false);
  const stuck = await stopAgent({ port: 4380, probe, exec, kill: () => {}, sleep: noSleep, timeoutMs: 500, platform: 'darwin' });
  assert.match(stuck.message, /still running/);
});

test('startBackground starts the agent detached and waits for it', async () => {
  let spawned;
  let up = false;
  const spawnFn = (cmd, args, opts) => { spawned = { cmd, args, opts }; up = true; return { on() {}, unref() {} }; };
  const r = await startBackground({ repo: '/repo', port: 4381, probe: async () => (up ? {} : null), spawnFn, sleep: noSleep, env: { A: '1' } });
  assert.equal(r.ok, true);
  assert.match(r.message, /background on port 4381/);
  assert.deepEqual(spawned.args, [path.join('/repo', 'agent', 'start.mjs'), '--quiet']);
  assert.equal(spawned.opts.detached, true);
  assert.equal(spawned.opts.stdio, 'ignore');
  assert.deepEqual(spawned.opts.env, { A: '1' });
  const never = await startBackground({ repo: '/repo', port: 4381, probe: async () => null, spawnFn, sleep: noSleep, timeoutMs: 300 });
  assert.equal(never.ok, false);
});

function cli({ platform = 'win32', secret, saved = {}, running = false, writeOk = true } = {}) {
  const lines = [];
  const writes = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-pat-home-'));
  const io = {
    out: s => lines.push(s),
    env: { WORKSHOP_HOME: home },
    platform,
    secret: async () => { if (secret instanceof Error) throw secret; return secret; },
    probe: async () => (running ? { app: 'workshop-agent' } : null),
    userEnv: {
      read: n => saved[n],
      write: (n, v) => { writes.push([n, v]); if (!writeOk) return { ok: false, message: 'No.' }; if (v === null) delete saved[n]; else saved[n] = v; return { ok: true, message: '' }; }
    }
  };
  return { io, lines, writes, saved, text: () => lines.join('\n'), done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('workshop pat saves ADO_PAT by default, never prints it, and says no restart is needed', async () => {
  const c = cli({ secret: TOKEN, running: true });
  try {
    assert.equal(await main(['pat'], c.io), 0);
    assert.deepEqual(c.writes, [['ADO_PAT', TOKEN]]);
    assert.equal(c.text().includes(TOKEN), false);
    assert.match(c.text(), /Saved ADO_PAT \(52 characters\)/);
    assert.match(c.text(), /no restart needed/);
  } finally { c.done(); }
});

test('workshop pat with a name, a bad token, a cancel, a failed save, --remove, and a bad name', async () => {
  let c = cli({ secret: TOKEN });
  try {
    assert.equal(await main(['pat', 'OTHER_PAT'], c.io), 0);
    assert.deepEqual(c.writes, [['OTHER_PAT', TOKEN]]);
    assert.match(c.text(), /Start Workshop with: workshop start/);
  } finally { c.done(); }

  c = cli({ secret: 'short' });
  try { assert.equal(await main(['pat'], c.io), 1); assert.deepEqual(c.writes, []); assert.match(c.text(), /Nothing was saved/); } finally { c.done(); }

  c = cli({ secret: Object.assign(new Error('x'), { code: 'cancelled' }) });
  try { assert.equal(await main(['pat'], c.io), 1); assert.match(c.text(), /Cancelled/); } finally { c.done(); }

  c = cli({ secret: TOKEN, writeOk: false });
  try { assert.equal(await main(['pat'], c.io), 1); assert.match(c.text(), /No\. Nothing was saved/); } finally { c.done(); }

  c = cli({ saved: { ADO_PAT: TOKEN } });
  try { assert.equal(await main(['pat', '--remove'], c.io), 0); assert.deepEqual(c.writes, [['ADO_PAT', null]]); assert.equal(c.saved.ADO_PAT, undefined); } finally { c.done(); }

  c = cli({ secret: TOKEN });
  try {
    assert.equal(await main(['pat', 'BAD-NAME'], c.io), 1);
    assert.equal(await main(['pat', '--expires'], c.io), 1);
    assert.deepEqual(c.writes, []);
  } finally { c.done(); }
});

test('workshop pat on macOS and Linux explains the shell profile and saves nothing', async () => {
  const c = cli({ platform: 'darwin', secret: TOKEN });
  try {
    assert.equal(await main(['pat'], c.io), 0);
    assert.deepEqual(c.writes, []);
    assert.match(c.text(), /export ADO_PAT='\.\.\.'/);
    assert.match(c.text(), /workshop restart/);
  } finally { c.done(); }
});

test('stop and restart really end and start the agent', { skip: process.platform === 'linux' && !fs.existsSync('/usr/bin/lsof') && !fs.existsSync('/usr/bin/fuser') && !fs.existsSync('/bin/fuser') && 'needs lsof or fuser' }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-stop-home-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-stop-data-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port, dataDir: data, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} }));
  const lines = [];
  const io = { out: s => lines.push(s), env: { ...process.env, WORKSHOP_HOME: home } };
  try {
    assert.equal(await main(['stop'], io), 0);
    assert.match(lines.at(-1), /not running/);
    assert.equal(await main(['restart'], io), 0, lines.join('\n'));
    assert.ok(await agentHealth(port));
    assert.equal(await main(['restart'], io), 0, lines.join('\n'));
    assert.ok(lines.includes('Workshop stopped.'));
    assert.ok(await agentHealth(port));
    assert.equal(await main(['stop'], io), 0, lines.join('\n'));
    assert.equal(await agentHealth(port), null);
  } finally {
    await main(['stop'], { out: () => {}, env: io.env });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(data, { recursive: true, force: true });
  }
});
