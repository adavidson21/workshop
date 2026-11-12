// shared/save-file.js: a browser download of the file, under a safe name only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveFile } from '../save-file.js';

test('saveFile: names with folders or odd characters are refused before anything is made', async () => {
  for (const name of ['../x.json', 'a/b.json', '', '.hidden', 'a b.json']) await assert.rejects(saveFile(name, '', 'text/plain'), /not a file name/);
});

test('saveFile: a download link for the file, clicked once', async () => {
  const clicked = [];
  const made = [];
  globalThis.URL.createObjectURL = (b) => { made.push(b); return 'blob:x'; };
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ click() { clicked.push([this.href, this.download]); }, remove() {} }), body: { appendChild() {} } };
  try {
    assert.equal(await saveFile('board.xlsx', new Uint8Array([80, 75]).buffer, 'application/octet-stream'), 'downloaded');
    assert.deepEqual(clicked, [['blob:x', 'board.xlsx']]);
    assert.equal(made[0].type, 'application/octet-stream');
  } finally { delete globalThis.document; }
});
