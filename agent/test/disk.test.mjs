// What the agent keeps on disk: config.json, the token, data files and connector storage
// (docs/config.md, docs/data-format.md Disk rules, docs/connector.md ctx.storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, tempHome, rmHome, readJson, get, put, post, envelope } from './helpers.mjs';
import { createAgent } from '../server.mjs';

const item = (id, text, updatedAt = 1792330000000) => ({ id, updatedAt, text });

test('first run creates config.json with everything off, and a private token', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    const cfg = readJson(path.join(home, 'config.json'));
    assert.deepEqual(cfg, { configVersion: 1, port: 4380, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} });
    const token = fs.readFileSync(path.join(home, 'token'), 'utf8').trim();
    assert.equal(token, agent.token);
    assert.match(token, /^[0-9a-f]{64}$/);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, 'token')).mode & 0o777, 0o600);
  } finally { await agent.stop(); rmHome(home); }
});

test('the token survives a restart', async () => {
  const home = tempHome();
  try {
    const a = await start(home); const t = a.token; await a.stop();
    const b = await start(home); assert.equal(b.token, t); await b.stop();
  } finally { rmHome(home); }
});

test('data is one pretty-printed file per collection and survives a restart', async () => {
  const home = tempHome();
  try {
    let agent = await start(home);
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [item('a', 'one')]));
    await agent.stop();
    const file = path.join(home, 'data', 'notes', 'pages.json');
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^\{\n {2}"schema": "notes.pages",/);
    assert.equal(readJson(file).rev, 1);

    agent = await start(home);
    const body = (await get(agent, '/api/data/notes/pages')).json;
    assert.equal(body.rev, 1);
    assert.deepEqual(body.items, [item('a', 'one')]);
    assert.equal((await put(agent, '/api/data/notes/pages', { ...body, items: [] })).json.rev, 2);
    await agent.stop();
  } finally { rmHome(home); }
});

test('a leftover temp file from an interrupted write is removed and the main file is used', async () => {
  const home = tempHome();
  try {
    let agent = await start(home);
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [item('a', 'kept')]));
    await agent.stop();
    const tmp = path.join(home, 'data', 'notes', 'pages.json.tmp');
    fs.writeFileSync(tmp, '{"half written');
    agent = await start(home);
    assert.equal(fs.existsSync(tmp), false);
    assert.deepEqual((await get(agent, '/api/data/notes/pages')).json.items, [item('a', 'kept')]);
    await agent.stop();
  } finally { rmHome(home); }
});

test('a damaged data file is reported and never overwritten', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    const dir = path.join(home, 'data', 'notes');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
    fs.writeFileSync(path.join(dir, 'wrong.json'), JSON.stringify({ ...envelope('other', 'wrong'), rev: 1 }));
    for (const c of ['broken', 'wrong']) {
      const r = await get(agent, `/api/data/notes/${c}`);
      assert.equal(r.status, 500);
      assert.equal(r.json.code, 'internal');
      const w = await put(agent, `/api/data/notes/${c}`, envelope('notes', c));
      assert.equal(w.status, 500);
    }
    assert.equal(fs.readFileSync(path.join(dir, 'broken.json'), 'utf8'), '{not json');
    await put(agent, '/api/data/notes/fine', envelope('notes', 'fine'));
    const list = (await get(agent, '/api/data/notes')).json;
    assert.deepEqual(list.collections.map(c => c.collection), ['fine']);
  } finally { await agent.stop(); rmHome(home); }
});

test('a version bump keeps a copy of the old file', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    await put(agent, '/api/data/notes/pages', { ...envelope('notes', 'pages', [item('a', 'v1')]), version: 1 });
    await put(agent, '/api/data/notes/pages', { ...envelope('notes', 'pages', [item('a', 'v2')]), version: 2, rev: 1 });
    const backup = path.join(home, 'data', 'notes', 'pages.v1.json');
    assert.equal(readJson(backup).items[0].text, 'v1');
    assert.equal(readJson(path.join(home, 'data', 'notes', 'pages.json')).version, 2);
    const list = (await get(agent, '/api/data/notes')).json;
    assert.deepEqual(list.collections.map(c => c.collection), ['pages'], 'backups are not collections');
  } finally { await agent.stop(); rmHome(home); }
});

test('parallel writes from the same rev: exactly one wins', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    await put(agent, '/api/data/notes/race', envelope('notes', 'race'));
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => put(agent, '/api/data/notes/race', { ...envelope('notes', 'race', [item(`i${i}`, 'x')]), rev: 1 })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal(results.filter(r => r.status === 409).length, 7);
    assert.equal(readJson(path.join(home, 'data', 'notes', 'race.json')).rev, 2);
  } finally { await agent.stop(); rmHome(home); }
});

test('config changes are saved, and unknown top-level keys are kept', async () => {
  const home = tempHome();
  try {
    let agent = await start(home, { fromANewerVersion: { keep: true } });
    await put(agent, '/api/config', { features: { hostedMode: true }, allowedOrigins: ['https://work.example.org'], connectors: { probe: { enabled: true } } });
    await put(agent, '/api/connectors/probe/config', { config: { secretEnv: 'OTHER' } });
    await agent.stop();
    const cfg = readJson(path.join(home, 'config.json'));
    assert.deepEqual(cfg.fromANewerVersion, { keep: true });
    assert.equal(cfg.features.hostedMode, true);
    assert.deepEqual(cfg.allowedOrigins, ['https://work.example.org']);
    assert.deepEqual(cfg.connectors.probe, { enabled: true, config: { secretEnv: 'OTHER' } });
    agent = await start(home);
    assert.equal((await get(agent, '/api/connectors/probe')).json.status.state, 'ready', 'enabled connectors start at agent start');
    await agent.stop();
  } finally { rmHome(home); }
});

test('a config.json that is not valid is never overwritten, and the agent says what to fix', async () => {
  const home = tempHome();
  try {
    for (const text of ['{oops', JSON.stringify({ configVersion: 1, features: { telemetry: true } })]) {
      fs.writeFileSync(path.join(home, 'config.json'), text);
      await assert.rejects(createAgent({ home, port: 0 }), /config/);
      assert.equal(fs.readFileSync(path.join(home, 'config.json'), 'utf8'), text);
    }
  } finally { rmHome(home); }
});

test('connector storage is a private file per key', async () => {
  const home = tempHome();
  const agent = await start(home, { connectors: { probe: { enabled: true } } });
  try {
    const r = await post(agent, '/api/connectors/probe/save', { args: { value: { n: 1 } } });
    assert.deepEqual(r.json.result.read, { n: 1 });
    assert.deepEqual(readJson(path.join(home, 'data', '_connectors', 'probe', 'saved.json')), { n: 1 });
    assert.equal((await post(agent, '/api/connectors/probe/badKey', {})).json.result.threw, true);
    assert.equal((await post(agent, '/api/connectors/probe/badEmit', {})).json.result.threw, true);
    const sig = (await post(agent, '/api/connectors/probe/signal', {})).json.result;
    assert.deepEqual(sig, { aborted: false, home });
  } finally { await agent.stop(); rmHome(home); }
});
