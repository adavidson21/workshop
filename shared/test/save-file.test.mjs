// shared/save-file.js in the Android app: text is written as UTF-8 and binary as base64 to the app's cache,
// then handed to the share sheet; closing the sheet is not an error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveFile } from '../save-file.js';

const fakeNative = (shareError) => {
  const calls = [];
  const native = async (plugin, method, options) => {
    calls.push([plugin, method, options]);
    if (plugin === 'Filesystem') return { uri: `file:///cache/${options.path}` };
    if (shareError) throw new Error(shareError);
    return {};
  };
  return { calls, native };
};

test('saveFile: text goes to the cache as UTF-8, then to the share sheet', async () => {
  const { calls, native } = fakeNative();
  assert.equal(await saveFile('workshop-2026-10-31.json', '{"a":1}\n', 'application/json', { native }), 'shared');
  assert.deepEqual(calls[0], ['Filesystem', 'writeFile', { path: 'workshop-2026-10-31.json', directory: 'CACHE', data: '{"a":1}\n', encoding: 'utf8' }]);
  assert.deepEqual(calls[1][2].files, ['file:///cache/workshop-2026-10-31.json']);
});

test('saveFile: binary goes as base64; a closed share sheet is "canceled"', async () => {
  const { calls, native } = fakeNative('Share canceled');
  const bytes = new Uint8Array([80, 75, 3, 4, 255]);
  assert.equal(await saveFile('board.xlsx', bytes.buffer, 'application/octet-stream', { native }), 'canceled');
  assert.equal(calls[0][2].data, Buffer.from(bytes).toString('base64'));
  assert.equal(calls[0][2].encoding, undefined);
});

test('saveFile: names with folders or odd characters are refused', async () => {
  const { native } = fakeNative();
  await assert.rejects(saveFile('../x.json', '', 'text/plain', { native }));
  await assert.rejects(saveFile('a/b.json', '', 'text/plain', { native }));
});
