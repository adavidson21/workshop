// npm test  (Node 22, no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appPath } from '../worker/index.js';

test('worker: app is the whole site, shared files as they are', () => {
  assert.equal(appPath('/'), '/apps/receipts/');
  assert.equal(appPath('/js/main.js'), '/apps/receipts/js/main.js');
  assert.equal(appPath('/shared/themes.css'), null);
  assert.equal(appPath('/sw.js'), null);
});
