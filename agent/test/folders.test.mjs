// App folders are the app ids (shared/app-folders.js, docs/data-format.md App folders). Folders an app used
// before are renamed once on start, and old app ids in what they hold are rewritten, keeping a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, tempHome, rmHome, get, put, envelope, dataDirOf, readJson } from './helpers.mjs';
import { OLD_FOLDERS, RENAMED_IDS, APP_FOLDERS } from '../../shared/app-folders.js';
import { moveOldFolders, renameSavedIds } from '../lib/datadir.mjs';
import { DataRoot } from '../lib/datapath.mjs';

const OLD = { notes: ['folio'] }; // the fixture apps include "notes"
const item = (id, text) => ({ id, updatedAt: 1792330000000, text });
const quiet = { info() {}, warn() {} };

test('every app is in the folder named by its id; old folders and ids are listed once, for apps that exist', () => {
  assert.deepEqual(APP_FOLDERS, {});
  const olds = Object.values(OLD_FOLDERS).flat();
  assert.equal(new Set(olds).size, olds.length, 'no old folder belongs to two apps');
  for (const [id, list] of Object.entries(OLD_FOLDERS)) {
    assert.ok(fs.existsSync(new URL(`../../apps/${id}/app.json`, import.meta.url)), `${id} is an app in apps/`);
    for (const f of list) assert.ok(!fs.existsSync(new URL(`../../apps/${f}/app.json`, import.meta.url)), `${f} is not an app id now`);
  }
  for (const [old, now] of Object.entries(RENAMED_IDS)) assert.ok(OLD_FOLDERS[now].includes(old), `${old}/ moves to ${now}/`);
});

test('collections, files and the trash go in the app\'s folder', async () => {
  const home = tempHome();
  const agent = await start(home);
  const dd = dataDirOf(home);
  try {
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [item('a', 'one')]));
    assert.equal(readJson(path.join(dd, 'notes', 'pages.json')).schema, 'notes.pages');
    await put(agent, '/api/files/notes/deep/one.md', { content: '# One\n', create: true });
    assert.ok(fs.existsSync(path.join(dd, 'notes', 'deep', 'one.md')));
    const list = await get(agent, '/api/files/notes');
    assert.deepEqual(list.json.files.map(x => x.path), ['deep/one.md']);
  } finally { await agent.stop(); rmHome(home); }
});

test('an old folder is renamed once on start, keeping every file byte for byte, and recorded', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  fs.mkdirSync(path.join(dd, 'folio', 'sub'), { recursive: true });
  const env = `${JSON.stringify(envelope('notes', 'pages', [item('a', 'kept')]), null, 2)}\n`;
  fs.writeFileSync(path.join(dd, 'folio', 'pages.json'), env.replace('"rev": 0', '"rev": 4'));
  fs.writeFileSync(path.join(dd, 'folio', 'sub', 'x.md'), 'hand written\n');
  fs.mkdirSync(path.join(dd, '.trash', 'folio'), { recursive: true });
  fs.writeFileSync(path.join(dd, '.trash', 'folio', 'gone.20261025T140500123Z.md'), 'gone\n');
  const agent = await start(home, undefined, { oldFolders: OLD });
  try {
    assert.ok(!fs.existsSync(path.join(dd, 'folio')));
    assert.equal(fs.readFileSync(path.join(dd, 'notes', 'sub', 'x.md'), 'utf8'), 'hand written\n');
    assert.ok(fs.existsSync(path.join(dd, '.trash', 'notes', 'gone.20261025T140500123Z.md')), 'its trash moved too');
    const r = await get(agent, '/api/data/notes/pages');
    assert.equal(r.json.items[0].text, 'kept');
    const day = fs.readdirSync(path.join(dd, '.backups'))[0];
    assert.deepEqual(readJson(path.join(dd, '.backups', day, 'renamed.json')).renamed, ['folio -> notes', '.trash/folio -> .trash/notes']);
  } finally { await agent.stop(); rmHome(home); }
});

test('an app saved under its old id reads and writes under the new one, from old addresses too', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  // The fixture app "notes" stands in for a renamed app: its data says "runway" (now "roadmaps") in a handoff.
  fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
  const hand = { schema: 'notes.handoffs', version: 1, rev: 2, updatedAt: '2026-11-01T00:00:00.000Z',
    items: [{ id: 'h1', to: 'prioritizer', source: { app: 'slate', id: 'x' }, updatedAt: 1792330000000 }] };
  fs.writeFileSync(path.join(dd, 'notes', 'handoffs.json'), `${JSON.stringify(hand, null, 2)}\n`);
  const agent = await start(home);
  try {
    const saved = readJson(path.join(dd, 'notes', 'handoffs.json'));
    assert.deepEqual([saved.items[0].to, saved.items[0].source.app, saved.rev], ['tasks', 'builds', 2], 'rewritten on start, rev kept');
    const day = fs.readdirSync(path.join(dd, '.backups'))[0];
    assert.equal(readJson(path.join(dd, '.backups', day, 'renamed-ids', 'notes', 'handoffs.json')).items[0].to, 'prioritizer', 'the old copy is kept');
    const r = await get(agent, '/api/data/notes/handoffs');
    assert.equal(r.json.items[0].to, 'tasks');
  } finally { await agent.stop(); rmHome(home); }
});

test('renameSavedIds rewrites the schema of a renamed app\'s collections, nested ones too, and nothing else', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'people', 'oneonones'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'settings'), { recursive: true });
    const w = (rel, v) => fs.writeFileSync(path.join(dd, rel), `${JSON.stringify(v, null, 2)}\n`);
    w('tasks/tasks.json', { schema: 'prioritizer.tasks', version: 3, rev: 9, items: [{ id: 't1', title: 'Keep "prioritizer" in text' }] });
    w('people/oneonones/people.json', { schema: 'receipts.oneonones/people', version: 1, rev: 1, items: [] });
    w('settings/app-settings.json', { schema: 'settings.app-settings', version: 1, rev: 1, items: [{ id: 'slate', values: {} }], deleted: { runway: 1 } });
    w('settings/people.json', { schema: 'settings.people', version: 2, rev: 1, items: [] });
    const done = renameSavedIds(dd, id => id, quiet);
    assert.deepEqual(done.sort(), ['people/oneonones/people.json', 'settings/app-settings.json', 'tasks/tasks.json']);
    const t = readJson(path.join(dd, 'tasks', 'tasks.json'));
    assert.deepEqual([t.schema, t.rev, t.items[0].title], ['tasks.tasks', 9, 'Keep "prioritizer" in text']);
    assert.equal(readJson(path.join(dd, 'people', 'oneonones', 'people.json')).schema, 'people.oneonones/people');
    const s = readJson(path.join(dd, 'settings', 'app-settings.json'));
    assert.deepEqual([s.items[0].id, Object.keys(s.deleted)], ['builds', ['roadmaps']]);
    assert.deepEqual(renameSavedIds(dd, id => id, quiet), [], 'once');
  } finally { rmHome(home); }
});

test('when both folders hold files the app\'s folder is used and the old one is left alone, unlisted', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, 'folio'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'folio', 'a.md'), 'old');
    fs.writeFileSync(path.join(dd, 'notes', 'b.md'), 'new');
    const warned = [];
    const r = moveOldFolders(dd, OLD, { info() {}, warn: m => warned.push(m) });
    assert.deepEqual(r, { folders: {}, renamed: [], left: ['folio'] });
    assert.match(warned[0], /Both folio\/ and notes\/ are in the data folder/);
    assert.equal(fs.readFileSync(path.join(dd, 'folio', 'a.md'), 'utf8'), 'old');
    const root = new DataRoot(dd, r.folders, OLD);
    assert.deepEqual(root.apps(), ['notes'], 'the leftover old folder is not listed as an app');
    assert.equal(root.idRel('folio/a.md'), null);
    assert.equal(root.idRel('notes/b.md'), 'notes/b.md');
  } finally { rmHome(home); }
});

test('the newest old folder wins; an empty app folder is replaced; with no old folder nothing happens', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, 'docket'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'prioritizer'), { recursive: true });
    fs.mkdirSync(path.join(dd, 'tasks', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'docket', 'a.md'), 'newer');
    fs.writeFileSync(path.join(dd, 'prioritizer', 'a.md'), 'older');
    const r = moveOldFolders(dd, { tasks: ['docket', 'prioritizer'] }, quiet);
    assert.deepEqual([r.renamed, r.left], [['docket -> tasks'], ['prioritizer']]);
    assert.equal(fs.readFileSync(path.join(dd, 'tasks', 'a.md'), 'utf8'), 'newer');
    assert.deepEqual(moveOldFolders(dd, { tasks: ['docket'] }, quiet).renamed, []);
  } finally { rmHome(home); }
});

test('a rename that fails keeps using the old folder, so nothing goes missing', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  const real = fs.renameSync;
  try {
    fs.mkdirSync(path.join(dd, 'folio'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'folio', 'a.md'), 'old');
    fs.renameSync = () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
    const r = moveOldFolders(dd, OLD, quiet);
    fs.renameSync = real;
    assert.deepEqual(r.folders, { notes: 'folio' });
    const root = new DataRoot(dd, r.folders, OLD);
    assert.equal(root.abs('notes/a.md'), path.join(dd, 'folio', 'a.md'));
    assert.deepEqual(root.apps(), ['notes'], 'and it is still listed, under its id');
    assert.deepEqual(root.diskParts('.trash/notes/x.20261025T140500123Z.md'), ['.trash', 'folio', 'x.20261025T140500123Z.md']);
  } finally { fs.renameSync = real; rmHome(home); }
});

test('the API takes an old app id for the app it became', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    // "runway" is now "roadmaps"; the fixture apps do not include it, but the address is still read as roadmaps.
    const r = await get(agent, '/api/data/runway');
    assert.equal(r.json.app, 'roadmaps');
  } finally { await agent.stop(); rmHome(home); }
});
