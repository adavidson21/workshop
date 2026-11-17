// App folders use the names people see (shared/app-folders.js, docs/data-format.md App folders): the API keeps
// app ids, the disk uses folder names, and old folders are renamed once on start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, tempHome, rmHome, get, put, envelope, dataDirOf, readJson } from './helpers.mjs';
import { APP_FOLDERS } from '../../shared/app-folders.js';
import { renameAppFolders } from '../lib/datadir.mjs';
import { DataRoot } from '../lib/datapath.mjs';

const FOLDERS = { notes: 'folio' }; // the fixture apps include "notes"
const item = (id, text) => ({ id, updatedAt: 1792330000000, text });
const quiet = { info() {}, warn() {} };

test('the folder names are app ids that are not another app\'s id or folder', () => {
  const ids = Object.keys(APP_FOLDERS), folders = Object.values(APP_FOLDERS);
  assert.deepEqual(APP_FOLDERS, { prioritizer: 'docket', receipts: 'rapport', slate: 'loom', notes: 'folio' });
  assert.equal(new Set(folders).size, folders.length);
  for (const f of folders) {
    assert.match(f, /^[a-z][a-z0-9-]{0,39}$/);
    assert.ok(!ids.includes(f), `${f} is also an app id`);
    assert.ok(!fs.existsSync(new URL(`../../apps/${f}/app.json`, import.meta.url)), `${f} is the id of an app in apps/`);
  }
});

test('collections, files, trash and backups go in the app\'s folder; the API still says the app id', async () => {
  const home = tempHome();
  const agent = await start(home, undefined, { appFolders: FOLDERS });
  const dd = dataDirOf(home);
  try {
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [item('a', 'one')]));
    assert.equal(readJson(path.join(dd, 'folio', 'pages.json')).schema, 'notes.pages');
    assert.ok(!fs.existsSync(path.join(dd, 'notes')));
    await put(agent, '/api/files/notes/deep/one.md', { content: '# One\n', create: true });
    assert.ok(fs.existsSync(path.join(dd, 'folio', 'deep', 'one.md')));
    const list = await get(agent, '/api/files/notes');
    assert.deepEqual(list.json.files.map(x => x.path), ['deep/one.md']);
    assert.equal(list.json.app, 'notes');
    const cols = await get(agent, '/api/data/notes');
    assert.deepEqual(cols.json.collections.map(c => c.collection), ['pages']);
  } finally { await agent.stop(); rmHome(home); }
});

test('an old folder is renamed once on start, keeping every file byte for byte, and recorded', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  fs.mkdirSync(path.join(dd, 'notes', 'sub'), { recursive: true });
  const env = `${JSON.stringify(envelope('notes', 'pages', [item('a', 'kept')]), null, 2)}\n`;
  fs.writeFileSync(path.join(dd, 'notes', 'pages.json'), env.replace('"rev": 0', '"rev": 4'));
  fs.writeFileSync(path.join(dd, 'notes', 'sub', 'x.md'), 'hand written\n');
  const agent = await start(home, undefined, { appFolders: FOLDERS });
  try {
    assert.ok(!fs.existsSync(path.join(dd, 'notes')));
    assert.equal(fs.readFileSync(path.join(dd, 'folio', 'sub', 'x.md'), 'utf8'), 'hand written\n');
    const r = await get(agent, '/api/data/notes/pages');
    assert.equal(r.json.items[0].text, 'kept');
    const day = fs.readdirSync(path.join(dd, '.backups'))[0];
    assert.deepEqual(readJson(path.join(dd, '.backups', day, 'renamed.json')).renamed, ['notes -> folio']);
  } finally { await agent.stop(); rmHome(home); }
});

test('when both folders hold files the new one is used and the old one is left alone', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'folio'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'notes', 'a.md'), 'old');
    fs.writeFileSync(path.join(dd, 'folio', 'b.md'), 'new');
    const warned = [];
    const r = renameAppFolders(dd, FOLDERS, { info() {}, warn: m => warned.push(m) });
    assert.deepEqual(r, { folders: FOLDERS, renamed: [], left: ['notes'] });
    assert.match(warned[0], /Both notes\/ and folio\/ are in the data folder/);
    assert.equal(fs.readFileSync(path.join(dd, 'notes', 'a.md'), 'utf8'), 'old');
    const root = new DataRoot(dd, r.folders);
    assert.deepEqual(root.apps(), ['notes'], 'the leftover old folder is not listed as an app');
    assert.equal(root.idRel('notes/a.md'), null);
    assert.equal(root.idRel('folio/b.md'), 'notes/b.md');
  } finally { rmHome(home); }
});

test('an empty new folder is replaced by the rename; with no old folder nothing happens', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'folio', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'notes', 'a.md'), 'old');
    assert.deepEqual(renameAppFolders(dd, FOLDERS, quiet).renamed, ['notes -> folio']);
    assert.equal(fs.readFileSync(path.join(dd, 'folio', 'a.md'), 'utf8'), 'old');
    assert.deepEqual(renameAppFolders(dd, FOLDERS, quiet).renamed, []);
  } finally { rmHome(home); }
});

test('a rename that fails keeps using the old folder, so nothing goes missing', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  const real = fs.renameSync;
  try {
    fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'notes', 'a.md'), 'old');
    fs.renameSync = () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
    const r = renameAppFolders(dd, FOLDERS, quiet);
    fs.renameSync = real;
    assert.deepEqual(r.folders, { notes: 'notes' });
    assert.equal(new DataRoot(dd, r.folders).abs('notes/a.md'), path.join(dd, 'notes', 'a.md'));
  } finally { fs.renameSync = real; rmHome(home); }
});

test('paths map app ids to folders in app folders, the trash and backups', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  fs.mkdirSync(dd, { recursive: true });
  try {
    const root = new DataRoot(dd, APP_FOLDERS);
    assert.deepEqual(root.diskParts('prioritizer/tasks.json'), ['docket', 'tasks.json']);
    assert.deepEqual(root.diskParts('.trash/receipts/x.20261025T140500123Z.md'), ['.trash', 'rapport', 'x.20261025T140500123Z.md']);
    assert.deepEqual(root.diskParts('.backups/2026-11-16/slate/board.v2.json'), ['.backups', '2026-11-16', 'loom', 'board.v2.json']);
    assert.deepEqual(root.diskParts('settings/people.json'), ['settings', 'people.json']);
    assert.equal(root.idRel('docket/tasks.json'), 'prioritizer/tasks.json');
    assert.equal(root.idRel('settings/people.json'), 'settings/people.json');
  } finally { rmHome(home); }
});
