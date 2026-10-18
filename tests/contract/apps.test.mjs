// docs/agent-api.md (GET /api/apps) and docs/app-manifest.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startAgent, get, post, expectJson, expectError, FIXTURES } from './helpers.mjs';

let agent;
before(async () => { agent = await startAgent(); });
after(async () => { await agent?.stop(); });

test('lists valid apps in order, with their manifests', async () => {
  const body = expectJson(await get(agent, '/api/apps'), 200, 'apps-response');
  assert.deepEqual(body.apps.map(a => a.manifest.id), ['board', 'notes']);
  for (const a of body.apps) {
    assert.equal(a.base, `/apps/${a.manifest.id}/`);
    const file = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'apps', a.manifest.id, 'app.json'), 'utf8'));
    assert.deepEqual(a.manifest, file);
  }
});

test('skips an app whose id does not match its folder', async () => {
  const body = await get(agent, '/api/apps');
  assert.ok(!body.json.apps.some(a => a.base === '/apps/broken/' || a.manifest.id === 'not-broken'));
});

test('serves an app\'s files at its base', async () => {
  const res = await get(agent, '/apps/notes/index.html', { auth: 'none' });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  const icon = await get(agent, '/apps/board/icon.svg', { auth: 'none' });
  assert.equal(icon.status, 200);
  assert.match(icon.headers['content-type'], /^image\/svg\+xml/);
});

test('wrong method and unknown routes', async () => {
  expectError(await post(agent, '/api/apps', {}), 405, 'method_not_allowed');
  expectError(await get(agent, '/api/nothing-here'), 404, 'not_found');
});
