// The data folder as the agent keeps it (docs/config.md, Data folder; docs/data-format.md, Data folder, Moving
// from ~/.workshop/data and Disk rules; docs/agent-api.md, Changes made outside Workshop). The contract suite checks
// the API; these tests check what it cannot: the copy from ~/.workshop/data byte for byte, start-up checks,
// cleanup, watch details and file-level links. Every test uses a temp home and a temp data folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../server.mjs';
import { start, tempHome, rmHome, dataDirOf, readJson, get, put, request, envelope, logText } from './helpers.mjs';
import { openEvents, schemas, sleep } from '../../tests/contract/helpers.mjs';

const item = (id, text, updatedAt = 1792330000000) => ({ id, updatedAt, text });
const del = (agent, p) => request(agent, 'DELETE', p);
const sha = file => fs.readFileSync(file).toString('base64');

/** Write an old-style collection file to <home>/data/<app>/<name>.json, as the agent before WS11 did. */
function writeOld(home, app, name, env) {
  const dir = path.join(home, 'data', app);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(env, null, 2)}\n`);
  return file;
}
const oldEnv = (app, name, rev, text = 'old') => ({ ...envelope(app, name, [item('a', text)]), rev, updatedAt: '2026-10-20T10:00:00.000Z' });

/** Try to make a symbolic link; returns false (and the test skips) where this user may not. */
function link(t, target, at, type) {
  try { fs.symlinkSync(target, at, type); return true; } catch (e) { t.skip(`cannot create a link here: ${e.code}`); return false; }
}

// ---------- the one-time copy from ~/.workshop/data

test('old app data is copied byte for byte, the old files are kept unchanged, and it happens once', async () => {
  const home = tempHome();
  const data = dataDirOf(home);
  try {
    const pages = writeOld(home, 'notes', 'pages', oldEnv('notes', 'pages', 7));
    const tasks = writeOld(home, 'prioritizer', 'tasks', oldEnv('prioritizer', 'tasks', 3));
    const version = writeOld(home, 'notes', 'pages.v1', { not: 'a collection' });
    fs.mkdirSync(path.join(home, 'data', '_backup'), { recursive: true });
    fs.writeFileSync(path.join(home, 'data', '_backup', 'x.json'), '{}');
    const before = { pages: sha(pages), tasks: sha(tasks), version: sha(version), pagesTime: fs.statSync(pages).mtimeMs };

    let agent = await start(home);
    try {
      assert.equal(sha(path.join(data, 'notes', 'pages.json')), before.pages, 'copied byte for byte');
      assert.equal(sha(path.join(data, 'prioritizer', 'tasks.json')), before.tasks);
      assert.equal((await get(agent, '/api/data/notes/pages')).json.rev, 7, 'same rev');
      assert.equal(sha(pages), before.pages, 'old file unchanged');
      assert.equal(fs.statSync(pages).mtimeMs, before.pagesTime, 'old file not even touched');
      assert.equal(sha(version), before.version, 'version copy kept where it was');
      assert.ok(!fs.existsSync(path.join(data, 'notes', 'pages.v1.json')), 'version copies are not copied');
      assert.ok(!fs.existsSync(path.join(data, '_backup')), '_backup is not copied');
      const marker = readJson(path.join(home, 'data', 'moved.json'));
      schemas.assert('data-moved', marker, 'moved.json');
      assert.equal(marker.collections, 2);
      assert.equal(marker.movedTo, data);
      assert.match(logText(agent), /Copied 2 collections from .* The old files are kept\./);
    } finally { await agent.stop(); }

    // Emptying the data folder later does not bring the old data back: moved.json says it was done.
    fs.rmSync(data, { recursive: true, force: true });
    agent = await start(home);
    try {
      assert.equal((await get(agent, '/api/data/notes/pages')).status, 404);
      assert.equal(sha(pages), before.pages, 'old file still there');
    } finally { await agent.stop(); }
  } finally { rmHome(home); }
});

test('a data folder that already holds app data is left untouched and nothing is copied', async () => {
  const home = tempHome();
  const data = dataDirOf(home);
  try {
    writeOld(home, 'notes', 'pages', oldEnv('notes', 'pages', 7, 'old'));
    fs.mkdirSync(path.join(data, 'notes'), { recursive: true });
    const mine = path.join(data, 'notes', 'pages.json');
    fs.writeFileSync(mine, `${JSON.stringify(oldEnv('notes', 'pages', 2, 'new'), null, 2)}\n`);
    const nested = path.join(data, 'receipts', 'summaries', 'one.md');
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, '# One\n');
    const before = { mine: sha(mine), nested: sha(nested) };
    const agent = await start(home);
    try {
      assert.equal(sha(mine), before.mine, 'existing collection untouched');
      assert.equal(sha(nested), before.nested, 'existing file untouched');
      assert.deepEqual((await get(agent, '/api/data/notes/pages')).json.items, [item('a', 'new')]);
      assert.ok(!fs.existsSync(path.join(home, 'data', 'moved.json')), 'no marker when nothing was copied');
      assert.ok(fs.existsSync(path.join(home, 'data', 'notes', 'pages.json')), 'old data kept');
    } finally { await agent.stop(); }
  } finally { rmHome(home); }
});

test('a data folder holding only things Workshop ignores still gets the copy, and those things are left alone', async () => {
  const home = tempHome();
  const data = dataDirOf(home);
  try {
    writeOld(home, 'notes', 'pages', oldEnv('notes', 'pages', 4));
    fs.mkdirSync(path.join(data, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(data, '.obsidian', 'app.json'), '{}');
    fs.writeFileSync(path.join(data, 'readme.md'), 'mine');
    fs.mkdirSync(path.join(data, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(data, 'notes', 'Draft.txt'), 'mine too');
    const agent = await start(home);
    try {
      assert.equal((await get(agent, '/api/data/notes/pages')).json.rev, 4);
      assert.equal(fs.readFileSync(path.join(data, 'readme.md'), 'utf8'), 'mine');
      assert.equal(fs.readFileSync(path.join(data, '.obsidian', 'app.json'), 'utf8'), '{}');
      assert.equal(fs.readFileSync(path.join(data, 'notes', 'Draft.txt'), 'utf8'), 'mine too');
    } finally { await agent.stop(); }
  } finally { rmHome(home); }
});

test('the copy does not cause outside-change events', async () => {
  const home = tempHome();
  try {
    writeOld(home, 'notes', 'pages', oldEnv('notes', 'pages', 1));
    const agent = await start(home);
    const es = await openEvents(agent);
    try {
      await es.next('hello');
      await sleep(1000);
      assert.deepEqual(es.events.filter(e => e.event === 'data' || e.event === 'file'), []);
    } finally { es.close(); await agent.stop(); }
  } finally { rmHome(home); }
});

// ---------- which folder, and checks on start

test('the default data folder is ~/Workshop and is never written into config.json', async () => {
  const home = tempHome();
  try {
    const agent = await start(home);
    try {
      assert.ok(!('dataDir' in readJson(path.join(home, 'config.json'))), 'a run-only folder is not saved');
      assert.equal((await get(agent, '/api/config')).json.dataDir, dataDirOf(home), 'the folder in use is reported');
      assert.equal(agent.dataDir, dataDirOf(home));
    } finally { await agent.stop(); }
    const { defaultDataDir } = await import('../lib/datadir.mjs');
    const os = await import('node:os');
    assert.equal(defaultDataDir(), path.join(os.homedir(), 'Workshop'));
  } finally { rmHome(home); }
});

test('dataDir from config.json is used, and a saved change applies only after a restart', async () => {
  const home = tempHome();
  const first = path.join(path.dirname(home), 'First');
  const second = path.join(path.dirname(home), 'Second');
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, dataDir: first }));
    let agent = await createAgent({ home, port: 0 });
    try {
      assert.equal(agent.dataDir, first);
      await put(agent, '/api/data/notes/pages', envelope('notes', 'pages'));
      assert.ok(fs.existsSync(path.join(first, 'notes', 'pages.json')));
      const r = (await put(agent, '/api/config', { dataDir: second })).json;
      assert.equal(r.restartRequired, true);
      assert.equal(readJson(path.join(home, 'config.json')).dataDir, second);
    } finally { await agent.stop(); }
    agent = await createAgent({ home, port: 0 });
    try {
      assert.equal(agent.dataDir, second);
      assert.equal((await get(agent, '/api/data/notes/pages')).status, 404, 'nothing is copied between data folders');
      assert.ok(fs.existsSync(path.join(first, 'notes', 'pages.json')), 'the old folder is left as it was');
    } finally { await agent.stop(); }
  } finally { rmHome(home); }
});

test('a data folder that cannot be used stops the agent with a message, and config.json is never changed', async () => {
  const home = tempHome();
  try {
    const notAFolder = path.join(path.dirname(home), 'a-file');
    fs.writeFileSync(notAFolder, 'x');
    const cases = [
      [path.join(home, 'data'), /may not be the Workshop home folder/],
      [home, /may not be the Workshop home folder/],
      [notAFolder, /is a file, not a folder/]
    ];
    // A Windows path passes the schema everywhere but is not absolute on macOS and Linux, and the reverse.
    if (process.platform !== 'win32') cases.push(['C:\\Users\\alex\\Workshop', /absolute path on this computer/]);
    for (const [dataDir, why] of cases) {
      const text = JSON.stringify({ configVersion: 1, dataDir });
      fs.writeFileSync(path.join(home, 'config.json'), text);
      await assert.rejects(createAgent({ home, port: 0 }), why, dataDir);
      assert.equal(fs.readFileSync(path.join(home, 'config.json'), 'utf8'), text);
    }
  } finally { rmHome(home); }
});

test('a data folder inside the home through a link is refused too', async (t) => {
  const home = tempHome();
  try {
    const sneaky = path.join(path.dirname(home), 'sneaky');
    fs.mkdirSync(path.join(home, 'inside'));
    if (!link(t, path.join(home, 'inside'), sneaky, 'junction')) return;
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, dataDir: sneaky }));
    await assert.rejects(createAgent({ home, port: 0 }), /may not be the Workshop home folder/);
    const agent = await start(home);
    try {
      const r = await put(agent, '/api/config', { dataDir: sneaky });
      assert.equal(r.status, 400);
      assert.equal(r.json.code, 'invalid_config');
    } finally { await agent.stop(); }
  } finally { rmHome(home); }
});

test('leftover temp files next to collections and files are removed on start; nothing else is', async () => {
  const home = tempHome();
  const data = dataDirOf(home);
  try {
    const leftovers = ['notes/pages.json.tmp', 'notes/entries/one/2026.json.tmp', 'receipts/summary.md.tmp'];
    const kept = ['notes/.git/index.tmp', 'notes/Notes.md.tmp', 'notes/other.tmp', 'top.json.tmp', '.trash/notes/x.md.tmp'];
    for (const rel of [...leftovers, ...kept]) {
      const abs = path.join(data, ...rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'half written');
    }
    const agent = await start(home);
    try {
      for (const rel of leftovers) assert.ok(!fs.existsSync(path.join(data, ...rel.split('/'))), `removed ${rel}`);
      for (const rel of kept) assert.ok(fs.existsSync(path.join(data, ...rel.split('/'))), `kept ${rel}`);
    } finally { await agent.stop(); }
  } finally { rmHome(home); }
});

test('data and files paths are checked before the URL is normalized', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages'));
    for (const p of ['/api/x/../data/notes/pages', '/api/data/notes/x/../pages', '/api/files/notes/x/%2e%2e/a.md', '/api/x/%2e%2e/files/notes']) {
      const r = await get(agent, p);
      assert.equal(r.status, 400, p);
      assert.equal(r.json.code, 'bad_request', p);
    }
  } finally { await agent.stop(); rmHome(home); }
});

// ---------- links: file-level links, the trash, dangling links

test('file links that leave the data folder are refused; links inside it work', async (t) => {
  const home = tempHome();
  const data = dataDirOf(home);
  const outside = path.join(path.dirname(home), 'outside');
  const agent = await start(home);
  try {
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(data, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.md'), 'outside');
    fs.writeFileSync(path.join(outside, 'col.json'), JSON.stringify({ ...envelope('notes', 'escape'), rev: 1, updatedAt: '2026-10-25T00:00:00.000Z' }));
    if (!link(t, path.join(outside, 'secret.md'), path.join(data, 'notes', 'secret.md'), 'file')) return;
    link(t, path.join(outside, 'col.json'), path.join(data, 'notes', 'escape.json'), 'file');
    link(t, path.join(outside, 'gone.md'), path.join(data, 'notes', 'dangling.md'), 'file');

    for (const p of ['secret.md', 'dangling.md']) {
      assert.equal((await get(agent, `/api/files/notes/${p}`)).status, 400, `read ${p}`);
      assert.equal((await put(agent, `/api/files/notes/${p}`, { content: 'x', mtime: 1 })).status, 400, `replace ${p}`);
      assert.equal((await put(agent, `/api/files/notes/${p}`, { content: 'x', create: true })).status, 400, `create ${p}`);
      assert.equal((await del(agent, `/api/files/notes/${p}`)).status, 400, `delete ${p}`);
    }
    assert.equal(fs.readFileSync(path.join(outside, 'secret.md'), 'utf8'), 'outside', 'never written');
    assert.ok(!fs.existsSync(path.join(outside, 'gone.md')), 'nothing created through a dangling link');
    assert.equal((await get(agent, '/api/data/notes/escape')).status, 400);
    assert.equal((await put(agent, '/api/data/notes/escape', { ...envelope('notes', 'escape'), rev: 1 })).status, 400);
    const files = (await get(agent, '/api/files/notes')).json.files.map(f => f.path);
    assert.ok(!files.includes('secret.md') && !files.includes('dangling.md'));
    assert.deepEqual((await get(agent, '/api/data/notes')).json.collections, []);

    // A link that stays inside the data folder is just another way to the same file.
    fs.writeFileSync(path.join(data, 'notes', 'real.md'), 'inside');
    fs.symlinkSync(path.join(data, 'notes', 'real.md'), path.join(data, 'notes', 'alias.md'), 'file');
    assert.equal((await get(agent, '/api/files/notes/alias.md')).json.content, 'inside');
  } finally { await agent.stop(); rmHome(home); }
});

test('a trash folder that leads outside the data folder is never written to', async (t) => {
  const home = tempHome();
  const data = dataDirOf(home);
  const outside = path.join(path.dirname(home), 'outside-trash');
  const agent = await start(home);
  try {
    fs.mkdirSync(outside);
    if (!link(t, outside, path.join(data, '.trash'), 'junction')) return;
    const made = (await put(agent, '/api/files/notes/keep.md', { content: 'keep', create: true })).json;
    const r = await del(agent, `/api/files/notes/keep.md?mtime=${made.mtime}`);
    assert.equal(r.status, 500);
    assert.equal(r.json.code, 'internal');
    assert.equal(fs.readFileSync(path.join(data, 'notes', 'keep.md'), 'utf8'), 'keep', 'the file stays');
    assert.deepEqual(fs.readdirSync(outside), [], 'nothing moved outside');
  } finally { await agent.stop(); rmHome(home); }
});

// ---------- watching

test('a collection removed by hand before the agent ever read it is reported as a collection', async () => {
  const home = tempHome();
  const data = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(data, 'notes', 'entries'), { recursive: true });
    const file = path.join(data, 'notes', 'entries', 'old.json');
    fs.writeFileSync(file, JSON.stringify({ ...envelope('notes', 'entries/old'), rev: 3, updatedAt: '2026-10-25T00:00:00.000Z' }));
    const agent = await start(home);
    const es = await openEvents(agent);
    try {
      await es.next('hello');
      await sleep(500); // the agent learns what each file is in the background
      fs.rmSync(file);
      const e = await es.next('data', d => d.collection === 'entries/old', 5000);
      assert.deepEqual(e.data, { app: 'notes', collection: 'entries/old', rev: null, updatedAt: null, client: null });
    } finally { es.close(); await agent.stop(); }
  } finally { rmHome(home); }
});

test('outside changes in nested folders are named in full', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    await put(agent, '/api/files/notes/summaries/one/2026-h2.md', { content: 'one', create: true });
    await sleep(700);
    const es = await openEvents(agent);
    try {
      await es.next('hello');
      const file = path.join(agent.dataDir, 'notes', 'summaries', 'one', '2026-h2.md');
      fs.writeFileSync(file, 'two, by hand');
      fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
      const e = await es.next('file', d => d.path === 'summaries/one/2026-h2.md', 5000);
      assert.equal(e.data.client, null);
      assert.equal(e.data.mtime, Math.floor(fs.statSync(file).mtimeMs));
    } finally { es.close(); }
  } finally { await agent.stop(); rmHome(home); }
});

test('watching works when the data folder is itself a link', async (t) => {
  const home = tempHome();
  const real = path.join(path.dirname(home), 'real-data');
  const linked = path.join(path.dirname(home), 'linked-data');
  fs.mkdirSync(real);
  if (!link(t, real, linked, 'junction')) { rmHome(home); return; }
  const agent = await start(home, undefined, { dataDir: linked });
  try {
    await put(agent, '/api/files/notes/a.md', { content: 'one', create: true });
    await sleep(700);
    const es = await openEvents(agent);
    try {
      await es.next('hello');
      fs.writeFileSync(path.join(real, 'notes', 'b.md'), 'by hand');
      await es.next('file', d => d.path === 'b.md' && d.client === null, 5000);
    } finally { es.close(); }
  } finally { await agent.stop(); rmHome(home); }
});
