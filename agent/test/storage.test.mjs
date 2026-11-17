// Storage hardening (docs/data-format.md, Disk rules and Where things are kept): permissions of what the agent
// writes, and the read-only storage report that doctor and Settings show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, tempHome, rmHome, put, envelope, dataDirOf } from './helpers.mjs';
import { syncedProvider, storageReport, storageLines, largestFiles, humanBytes } from '../lib/storage.mjs';
import { looseDataDir } from '../lib/datadir.mjs';

const posix = process.platform !== 'win32';

test('a new data folder, its app folders and the files in it are for this user only', { skip: !posix }, async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [{ id: 'a', updatedAt: 1792330000000 }]));
    await put(agent, '/api/files/notes/deep/one.md', { content: '# One\n', create: true });
    const dd = dataDirOf(home);
    assert.equal(fs.statSync(dd).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(dd, 'notes')).mode & 0o077, 0);
    assert.equal(fs.statSync(path.join(dd, 'notes', 'pages.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dd, 'notes', 'deep', 'one.md')).mode & 0o777, 0o600);
    assert.equal(looseDataDir(dd), false);
  } finally { await agent.stop(); rmHome(home); }
});

test('an existing data folder keeps its permissions, and the report says others can read it', { skip: !posix }, async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  fs.mkdirSync(dd, { mode: 0o755 });
  fs.chmodSync(dd, 0o755);
  const agent = await start(home);
  try {
    assert.equal(fs.statSync(dd).mode & 0o777, 0o755);
    const r = storageReport({ home, dataDir: dd });
    assert.equal(r.loose, '755');
    assert.match(storageLines(r).join('\n'), /other users on this computer can read it\. Run: chmod 700/);
  } finally { await agent.stop(); rmHome(home); }
});

test('sync tools are found by folder name', () => {
  assert.equal(syncedProvider('C:\\Users\\a\\OneDrive - Contoso\\Workshop'), 'OneDrive');
  assert.equal(syncedProvider('/Users/a/Library/CloudStorage/OneDrive-Contoso/Workshop'), 'OneDrive');
  assert.equal(syncedProvider('/Users/a/Library/Mobile Documents/com~apple~CloudDocs/Workshop'), 'iCloud Drive');
  assert.equal(syncedProvider('/Users/a/Dropbox/Workshop'), 'Dropbox');
  assert.equal(syncedProvider('/Users/a/Library/CloudStorage/GoogleDrive-a@b.c/My Drive/W'), 'Google Drive');
  assert.equal(syncedProvider('/Users/a/Workshop'), null);
  assert.equal(syncedProvider('/Users/a/OneDriveNotes/Workshop'), null);
});

test('the report lists trash, backups, old copies and connector content without reading or changing them', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, '.trash', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(dd, '.trash', 'notes', 'a.20261025T140500123Z.md'), 'x'.repeat(2048));
    fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'notes', 'big.md'), 'y'.repeat(5000));
    fs.writeFileSync(path.join(dd, 'notes', 'small.md'), 'z');
    const data = path.join(home, 'data');
    fs.mkdirSync(path.join(data, 'prioritizer'), { recursive: true });
    fs.writeFileSync(path.join(data, 'prioritizer', 'tasks.json'), '{}');
    fs.writeFileSync(path.join(data, 'moved.json'), '{}');
    fs.mkdirSync(path.join(data, '_connectors', 'opencode', 'hub', 'h1'), { recursive: true });
    fs.writeFileSync(path.join(data, '_connectors', 'opencode', 'hub', 'h1', 'request.md'), 'q');
    const r = storageReport({ home, dataDir: dd });
    assert.equal(r.trash.files, 1);
    assert.equal(r.backups, null);
    assert.deepEqual(r.leftovers.map(l => l.id), ['old-prioritizer', 'opencode-hub']);
    const text = storageLines(r, { sizes: true }).join('\n');
    assert.match(text, /Trash: 1 file, 2 KB/);
    assert.match(text, /Old copy: Old hub requests sent to opencode/);
    assert.deepEqual(largestFiles(dd).map(f => f.path), ['notes/big.md', 'notes/small.md']);
    assert.ok(fs.existsSync(path.join(data, 'prioritizer', 'tasks.json')), 'nothing removed');
  } finally { rmHome(home); }
});

test('bytes read as short text', () => {
  assert.equal(humanBytes(12), '12 B');
  assert.equal(humanBytes(2048), '2 KB');
  assert.equal(humanBytes(3.5 * 1024 * 1024), '3.5 MB');
});

test('working files in .scratch are removed 7 days after they last changed, and nothing else is touched', async () => {
  const { cleanScratch } = await import('../lib/datadir.mjs');
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    const old = path.join(dd, '.scratch', 'opencode', 'hub', 'hub_old');
    const fresh = path.join(dd, '.scratch', 'opencode', 'oneonones', 'p_a-2026-11-15');
    const mixed = path.join(dd, '.scratch', 'opencode', 'hub', 'hub_mixed');
    for (const d of [old, fresh, mixed]) fs.mkdirSync(d, { recursive: true });
    fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
    const now = Date.now();
    const age = (p, days) => { const t = new Date(now - days * 86400000); fs.utimesSync(p, t, t); };
    fs.writeFileSync(path.join(old, 'request.md'), 'q'); age(path.join(old, 'request.md'), 9); age(old, 9);
    fs.writeFileSync(path.join(fresh, 'packet.md'), 'p'); age(path.join(fresh, 'packet.md'), 2); age(fresh, 2);
    fs.writeFileSync(path.join(mixed, 'request.md'), 'q'); age(path.join(mixed, 'request.md'), 10);
    fs.writeFileSync(path.join(mixed, 'answer.md'), 'a'); age(path.join(mixed, 'answer.md'), 1); age(mixed, 10);
    fs.writeFileSync(path.join(dd, 'notes', 'old.md'), 'keep'); age(path.join(dd, 'notes', 'old.md'), 400);
    assert.deepEqual(cleanScratch(dd, now), ['opencode/hub/hub_old']);
    assert.ok(fs.existsSync(fresh) && fs.existsSync(mixed) && fs.existsSync(path.join(dd, 'notes', 'old.md')));
    assert.deepEqual(cleanScratch(path.join(dd, 'missing'), now), []);
  } finally { rmHome(home); }
});

test('connectors get the data folder and their own working folder in ctx', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    assert.ok(agent.dataDir);
  } finally { await agent.stop(); rmHome(home); }
  const src = fs.readFileSync(new URL('../lib/connectors.mjs', import.meta.url), 'utf8');
  assert.match(src, /dataDir: this\.#dataDir/);
  assert.match(src, /scratch: this\.#dataDir \? path\.join\(this\.#dataDir, '\.scratch', entry\.id\)/);
});

test('the report names app folders still under their old names', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, 'prioritizer'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'folio'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'notes', 'a.md'), 'x');
    const r = storageReport({ home, dataDir: dd });
    const text = storageLines(r).join('\n');
    assert.match(text, /prioritizer\/ is renamed to docket\/ the next time Workshop starts/);
    assert.match(text, /Old copy: The notes\/ folder, its old name \(Workshop uses folio\/\)/);
  } finally { rmHome(home); }
});

test('Settings can delete only what the report lists, only from this computer', async () => {
  const { post, get: getReq } = await import('./helpers.mjs');
  const home = tempHome();
  const data = path.join(home, 'data');
  fs.mkdirSync(path.join(data, '_connectors', 'opencode', 'oneonones', 'p-2026'), { recursive: true });
  fs.writeFileSync(path.join(data, '_connectors', 'opencode', 'oneonones', 'p-2026', 'packet.md'), 'people data');
  const agent = await start(home);
  try {
    const st = (await getReq(agent, '/api/storage')).json;
    assert.deepEqual(st.leftovers.map(l => l.id), ['opencode-oneonones']);
    assert.equal((await post(agent, '/api/storage/delete', { id: '../../etc' })).status, 400);
    assert.equal((await post(agent, '/api/storage/delete', { id: 'opencode-oneonones' }, { origin: 'https://workshop.alexisdavidson.org' })).status >= 400, true);
    const r = await post(agent, '/api/storage/delete', { id: 'opencode-oneonones' });
    assert.equal(r.status, 200, r.text);
    assert.ok(!fs.existsSync(path.join(data, '_connectors', 'opencode', 'oneonones')));
    assert.deepEqual((await getReq(agent, '/api/storage')).json.leftovers, []);
  } finally { await agent.stop(); rmHome(home); }
});
