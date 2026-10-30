// functions/_middleware.js: dispatch.alexisdavidson.org serves Dispatch (apps/agents/) as the whole site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchPath, DISPATCH_HOST, onRequest } from '../../../functions/_middleware.js';

test('Dispatch paths map under apps/agents/; shared files are served as they are', () => {
  assert.equal(dispatchPath('/'), '/apps/agents/');
  assert.equal(dispatchPath('/agents.css'), '/apps/agents/agents.css');
  assert.equal(dispatchPath('/js/main.js'), '/apps/agents/js/main.js');
  for (const p of ['/shared/theme.js', '/shared/fonts/fonts.css', '/icons/favicon.svg', '/apps/agents/js/view.js', '/sw.js']) assert.equal(dispatchPath(p), null, p);
  assert.ok(DISPATCH_HOST.test('dispatch.alexisdavidson.org'));
  assert.ok(!DISPATCH_HOST.test('workshop.alexisdavidson.org'));
});

test('only the Dispatch host is rewritten', async () => {
  const seen = [];
  const ctx = host => ({ request: new Request(`https://${host}/js/main.js?x=1`), next: async () => 'next', env: { ASSETS: { fetch: async r => { seen.push(r.url); return 'asset'; } } } });
  assert.equal(await onRequest(ctx('workshop.alexisdavidson.org')), 'next');
  assert.equal(await onRequest(ctx('dispatch.alexisdavidson.org')), 'asset');
  assert.deepEqual(seen, ['https://dispatch.alexisdavidson.org/apps/agents/js/main.js?x=1']);
});
