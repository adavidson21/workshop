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
    assert.match(text, /Old copy: Hub requests/);
    assert.deepEqual(largestFiles(dd).map(f => f.path), ['notes/big.md', 'notes/small.md']);
    assert.ok(fs.existsSync(path.join(data, 'prioritizer', 'tasks.json')), 'nothing removed');
  } finally { rmHome(home); }
});

test('bytes read as short text', () => {
  assert.equal(humanBytes(12), '12 B');
  assert.equal(humanBytes(2048), '2 KB');
  assert.equal(humanBytes(3.5 * 1024 * 1024), '3.5 MB');
});
