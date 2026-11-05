import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REMOTE_APPS, remoteAppsOf } from '../lib/pinned.mjs';

test('work mode takes its remote apps from apps/remote.json', () => {
  const remote = JSON.parse(fs.readFileSync(new URL('../../apps/remote.json', import.meta.url), 'utf8')).apps;
  assert.deepEqual(REMOTE_APPS.map(a => a.id), remote.map(a => a.id));
  assert.deepEqual(REMOTE_APPS.find(a => a.id === 'prioritizer'), { key: 'docket', id: 'prioritizer', name: 'Docket' });
});

test('remoteAppsOf: a new entry joins; bad or missing entries are skipped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-remote-'));
  try {
    assert.deepEqual(remoteAppsOf(dir), []);
    fs.mkdirSync(path.join(dir, 'apps'));
    fs.writeFileSync(path.join(dir, 'apps', 'remote.json'), JSON.stringify({ apps: [
      { id: 'receipts', repo: 'owner/receipts', manifest: { name: 'Rapport' } },
      { id: 'Bad', repo: 'owner/bad' },
      { id: 'nameless', repo: 'owner/nameless' },
      { id: 'norepo' }
    ] }));
    assert.deepEqual(remoteAppsOf(dir), [{ key: 'receipts', id: 'receipts', name: 'Rapport' }, { key: 'nameless', id: 'nameless', name: 'nameless' }]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
