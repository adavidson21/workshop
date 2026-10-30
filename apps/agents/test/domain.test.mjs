// worker/index.js: dispatch.alexisdavidson.org serves Dispatch (apps/agents/) as the whole site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { dispatchPath, DISPATCH_HOST } from '../../../worker/index.js';

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
  const env = { ASSETS: { fetch: async r => { seen.push(new URL(r.url ?? r).href); return 'asset'; } } };
  await worker.fetch(new Request('https://workshop.alexisdavidson.org/js/main.js?x=1'), env);
  await worker.fetch(new Request('https://dispatch.alexisdavidson.org/js/main.js?x=1'), env);
  await worker.fetch(new Request('https://dispatch.alexisdavidson.org/shared/theme.js'), env);
  assert.deepEqual(seen, ['https://workshop.alexisdavidson.org/js/main.js?x=1', 'https://dispatch.alexisdavidson.org/apps/agents/js/main.js?x=1', 'https://dispatch.alexisdavidson.org/shared/theme.js']);
});
