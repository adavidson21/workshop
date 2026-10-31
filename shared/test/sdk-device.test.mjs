// The Android app's device storage (shared/device-fs.js, docs/run-modes.md, Device store): every folder
// store test again, with the device folder under the store instead of a folder picked in Chrome, then the
// device-only rules: atomic writes, recovery of a stopped write, and when the app counts as native.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals } from '../workshop-sdk.js';
import { FakeFolder } from './fake-dir.mjs';
import { capacitorOver } from './fake-capacitor.mjs';
import { deviceAvailable, deviceRoot, openDeviceRoot } from '../device-fs.js';

globalThis.__workshopDeviceStore = true;
await import('./sdk-folder.test.mjs?device');

const { makeFolderStore, openBrowserStore } = _internals;
const envelope = (items, extra = {}) => Object.assign({ schema: 'notes.pages', version: 1, rev: 0, items }, extra);
const device = (fs, o = {}) => deviceRoot(Object.assign({ call: capacitorOver(fs, o), base: '', now: () => fs.time + 60_000 }, o));
const store = (root) => makeFolderStore({ clientId: 'w-a' }, root, { timers: false, channel: null, storage: 'device' });

test('device: the folder is made under workshop/ in the app data folder, and opening again keeps it', async () => {
  const fs = new FakeFolder('data');
  const call = capacitorOver(fs);
  const root = await openDeviceRoot({ call });
  await store(root).put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }]));
  assert.ok(fs.read('workshop/notes/pages.json').includes('"a"'));
  const again = await openDeviceRoot({ call });
  assert.equal((await store(again).get('notes', 'pages')).rev, 1);
});

test('device: openBrowserStore uses the device store, which needs no permission and has no folder to choose', async () => {
  const fs = new FakeFolder('data');
  const s = await openBrowserStore({ clientId: 'w-x' }, { device: device(fs), folder: { timers: false, channel: null } });
  assert.equal(s.storage, 'device');
  assert.equal(s.kind, 'browser');
  assert.equal(s.permission, 'granted');
  assert.equal(s.online, true);
});

test('device: writes go through a hidden temporary file, which lists never show', async () => {
  const fs = new FakeFolder('data');
  const log = [];
  const s = store(device(fs, { log }));
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }]));
  await s.files.write('notes', 'today.md', '# Today\n', { create: true });
  assert.ok(log.some(([m, p]) => m === 'writeFile' && p === 'notes/.pages.json.workshop-tmp'), 'collection written to the temporary file');
  assert.ok(log.some(([m, p]) => m === 'rename' && p === 'notes/.today.md.workshop-tmp'), 'file swapped into place');
  assert.deepEqual(fs.paths(), ['notes/pages.json', 'notes/today.md'], 'no temporary file left behind');
  assert.deepEqual((await s.files.list('notes')).map(f => f.path), ['today.md']);
});

test('device: a file system that will not rename over a file still replaces it', async () => {
  const fs = new FakeFolder('data');
  const s = store(device(fs, { renameOverwrites: false }));
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }]));
  await s.put('notes', 'pages', envelope([{ id: 'b', updatedAt: 2 }], { rev: 1 }));
  assert.deepEqual((await s.get('notes', 'pages')).items.map(i => i.id), ['b']);
  assert.deepEqual(fs.paths(), ['notes/pages.json']);
});

test('device: a write that stopped after removing the old file is finished on the next read', async () => {
  const fs = new FakeFolder('data');
  const s = store(device(fs));
  await s.put('notes', 'pages', envelope([{ id: 'a', updatedAt: 1 }]));
  // The app stopped between removing pages.json and renaming the temporary file.
  const next = fs.read('notes/pages.json').replace('"rev": 1', '"rev": 2');
  fs.write('notes/.pages.json.workshop-tmp', next);
  fs.delete('notes/pages.json');
  assert.equal((await s.get('notes', 'pages')).rev, 2);
  assert.deepEqual(fs.paths(), ['notes/pages.json']);
});

test('device: a temporary file from a write still in progress is left alone', async () => {
  const fs = new FakeFolder('data');
  const root = deviceRoot({ call: capacitorOver(fs), base: '', now: () => fs.time }); // the temporary file is brand new
  fs.write('notes/.pages.json.workshop-tmp', '{}');
  assert.equal(await store(root).get('notes', 'pages'), null);
  assert.ok(fs.exists('notes/.pages.json.workshop-tmp'));
});

test('device: only the native app counts, and only with the Filesystem plugin', () => {
  const cap = (o) => ({ Capacitor: Object.assign({ nativePromise: () => {}, isNativePlatform: () => true }, o) });
  assert.equal(deviceAvailable(null), false);
  assert.equal(deviceAvailable({}), false, 'a browser');
  assert.equal(deviceAvailable(cap({ isNativePlatform: () => false })), false, 'Capacitor on the web');
  assert.equal(deviceAvailable(cap({ PluginHeaders: [{ name: 'Share' }] })), false, 'no Filesystem plugin');
  assert.equal(deviceAvailable(cap({ PluginHeaders: [{ name: 'Filesystem' }] })), true);
  assert.equal(deviceAvailable(cap({})), true, 'headers not exposed: trust the bridge');
});
