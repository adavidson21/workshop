// worker/index.js: dispatch.alexisdavidson.org serves Dispatch (apps/agents/) as the whole site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { dispatchPath, DISPATCH_HOST } from '../../../worker/index.js';
import fs from 'node:fs';

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

test('/install.ps1 and /install.sh serve the bootstrap scripts with this site filled in', async () => {
  const files = { '/scripts/bootstrap.ps1': fs.readFileSync(new URL('../../../scripts/bootstrap.ps1', import.meta.url), 'utf8'), '/scripts/bootstrap.sh': fs.readFileSync(new URL('../../../scripts/bootstrap.sh', import.meta.url), 'utf8') };
  const env = { ASSETS: { fetch: async r => { const p = new URL(r.url).pathname; return files[p] ? new Response(files[p]) : new Response('nope', { status: 404 }); } } };
  for (const [path, marker] of [['/install.ps1', "$Site = 'https://dispatch.alexisdavidson.org'"], ['/install.sh', "SITE='https://dispatch.alexisdavidson.org'"]]) {
    const res = await worker.fetch(new Request('https://dispatch.alexisdavidson.org' + path), env);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /^text\/plain/);
    const text = await res.text();
    assert.ok(text.includes(marker), path);
    assert.ok(!text.includes('{{SITE}}'), path);
  }
  const ws = await (await worker.fetch(new Request('https://workshop.alexisdavidson.org/install.sh'), env)).text();
  assert.ok(ws.includes("SITE='https://workshop.alexisdavidson.org'"), 'each site allows itself');
});
