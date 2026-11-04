// worker/index.js: apps from another site (apps/remote.json). Docket's code lives at docket.alexisdavidson.org;
// here it is served under /apps/prioritizer/ so the shell can frame it, and its live app.json goes into the registry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker, { remoteMatch } from '../index.js';

const REMOTE = JSON.parse(fs.readFileSync(new URL('../../apps/remote.json', import.meta.url), 'utf8'));
const REGISTRY = fs.readFileSync(new URL('../../apps/registry.json', import.meta.url), 'utf8');
const SITE = 'https://workshop.alexisdavidson.org';

// A fake site for the remote app, reachable through the service binding, and this site's assets.
function makeEnv({ binding = true, live = null, down = false } = {}) {
  const calls = { binding: [], assets: [] };
  const docket = {
    fetch: async (req) => {
      calls.binding.push(new URL(req.url).pathname + new URL(req.url).search);
      if (down) throw new Error('down');
      const p = new URL(req.url).pathname;
      if (p === '/app.json') return Response.json(live ?? REMOTE.apps[0].manifest);
      if (p === '/js') return new Response(null, { status: 307, headers: { Location: 'https://docket.alexisdavidson.org/js/' } });
      return new Response(`docket ${p}`, { headers: { 'Content-Type': 'text/plain', 'Set-Cookie': 'a=b' } });
    }
  };
  const assets = {
    fetch: async (req) => {
      const p = new URL(req.url ?? req).pathname;
      calls.assets.push(p);
      if (p === '/apps/remote.json') return Response.json(REMOTE);
      if (p === '/apps/registry.json') return new Response(REGISTRY, { headers: { 'Content-Type': 'application/json' } });
      return new Response(`asset ${p}`);
    }
  };
  return { env: binding ? { ASSETS: assets, DOCKET: docket } : { ASSETS: assets }, calls };
}

const get = (env, path, headers = {}) => worker.fetch(new Request(SITE + path, { headers }), env);

test('remote.json lists Docket at docket.alexisdavidson.org, with the DOCKET binding', () => {
  const d = REMOTE.apps.find(a => a.id === 'prioritizer');
  assert.equal(d.site, 'https://docket.alexisdavidson.org');
  assert.equal(d.binding, 'DOCKET');
  assert.equal(d.manifest.id, 'prioritizer');
  const wrangler = fs.readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"binding":\s*"DOCKET"/, 'wrangler.jsonc binds DOCKET');
  assert.match(wrangler, /"service":\s*"docket"/, 'to the docket Worker');
});

test('remote.json lists Runway at runway.alexisdavidson.org, with the RUNWAY binding', () => {
  const r = REMOTE.apps.find(a => a.id === 'runway');
  assert.equal(r.site, 'https://runway.alexisdavidson.org');
  assert.equal(r.binding, 'RUNWAY');
  assert.equal(r.manifest.id, 'runway');
  assert.ok(!(r.manifest.connectors || []).some(c => c.required), 'Runway needs no connector');
  const wrangler = fs.readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"binding":\s*"RUNWAY"/, 'wrangler.jsonc binds RUNWAY');
  assert.match(wrangler, /"service":\s*"runway"/, 'to the runway Worker');
  const m = remoteMatch(REMOTE.apps, '/apps/runway/js/ado/index.js');
  assert.equal(m.app.id, 'runway');
  assert.equal(m.path, '/js/ado/index.js');
});

test('paths under /apps/prioritizer/ map to the root of Docket\'s site', () => {
  const apps = REMOTE.apps;
  assert.deepEqual(remoteMatch(apps, '/apps/prioritizer/'), { app: apps[0], path: '/' });
  assert.deepEqual(remoteMatch(apps, '/apps/prioritizer/js/main.js'), { app: apps[0], path: '/js/main.js' });
  assert.deepEqual(remoteMatch(apps, '/apps/prioritizer'), { app: apps[0], path: '/', bare: true });
  assert.equal(remoteMatch(apps, '/apps/prioritizerx/a.js'), null);
  assert.equal(remoteMatch(apps, '/apps/agents/js/main.js'), null);
});

test('files in the shell\'s frame come from Docket through the binding, cookies dropped', async () => {
  const { env, calls } = makeEnv();
  const res = await get(env, '/apps/prioritizer/js/main.js?v=2', { 'Sec-Fetch-Dest': 'script' });
  assert.equal(await res.text(), 'docket /js/main.js');
  assert.equal(res.headers.get('set-cookie'), null);
  const page = await get(env, '/apps/prioritizer/', { 'Sec-Fetch-Dest': 'iframe' });
  assert.equal(await page.text(), 'docket /');
  assert.deepEqual(calls.binding, ['/js/main.js?v=2', '/']);
});

test('without the binding it fetches the site over the internet', async () => {
  const { env } = makeEnv({ binding: false });
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response('net'); };
  try { assert.equal(await (await get(env, '/apps/prioritizer/app.css')).text(), 'net'); }
  finally { globalThis.fetch = real; }
  assert.deepEqual(seen, ['https://docket.alexisdavidson.org/app.css']);
});

test('opened at the top level, Docket goes to its own address', async () => {
  const { env, calls } = makeEnv();
  const res = await get(env, '/apps/prioritizer/?x=1', { 'Sec-Fetch-Dest': 'document' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://docket.alexisdavidson.org/?x=1');
  const bare = await get(env, '/apps/prioritizer');
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('location'), SITE + '/apps/prioritizer/');
  assert.deepEqual(calls.binding, []);
});

test('a redirect on Docket\'s site stays under /apps/prioritizer/', async () => {
  const { env } = makeEnv();
  const res = await get(env, '/apps/prioritizer/js', { 'Sec-Fetch-Dest': 'script' });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), '/apps/prioritizer/js/');
});

test('only GET and HEAD are passed on', async () => {
  const { env, calls } = makeEnv();
  const res = await worker.fetch(new Request(SITE + '/apps/prioritizer/x', { method: 'POST', body: 'x' }), env);
  assert.equal(res.status, 405);
  assert.deepEqual(calls.binding, []);
});

test('Docket\'s site down: 502 with a plain message', async () => {
  const { env } = makeEnv({ down: true });
  const res = await get(env, '/apps/prioritizer/js/main.js', { 'Sec-Fetch-Dest': 'script' });
  assert.equal(res.status, 502);
  assert.match(await res.text(), /Docket is not reachable/);
});

test('the registry gets Docket\'s live app.json', async () => {
  const live = { ...REMOTE.apps[0].manifest, version: '9.9.9', files: ['app.css', 'js/new.js'] };
  const { env } = makeEnv({ live });
  const res = await get(env, '/apps/registry.json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const reg = await res.json();
  const d = reg.apps.find(a => a.base === '/apps/prioritizer/');
  assert.equal(d.manifest.version, '9.9.9');
  assert.deepEqual(d.manifest.files, ['app.css', 'js/new.js']);
  assert.ok(reg.apps.find(a => a.base === '/apps/agents/'), 'local apps are untouched');
});

test('the registry keeps the snapshot when Docket is down or answers with something else', async () => {
  const snapshot = REMOTE.apps[0].manifest.version;
  for (const opts of [{ down: true }, { live: { id: 'other', name: 'x', entry: 'index.html' } }, { live: { nope: true } }]) {
    const { env } = makeEnv(opts);
    const reg = await (await get(env, '/apps/registry.json')).json();
    assert.equal(reg.apps.find(a => a.base === '/apps/prioritizer/').manifest.version, snapshot, JSON.stringify(opts));
  }
});

test('local apps and other files are served from this site as before', async () => {
  const { env, calls } = makeEnv();
  assert.equal(await (await get(env, '/apps/agents/js/main.js')).text(), 'asset /apps/agents/js/main.js');
  assert.equal(await (await get(env, '/shared/theme.js')).text(), 'asset /shared/theme.js');
  assert.deepEqual(calls.binding, []);
});

test('there is no debug route: /__debug is served as an ordinary asset path, echoing nothing', async () => {
  const { env, calls } = makeEnv();
  const res = await get(env, '/__debug?x=1', { host: 'example.test' });
  assert.equal(await res.text(), 'asset /__debug');
  assert.deepEqual(calls.assets, ['/__debug']);
});
