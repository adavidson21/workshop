// worker/index.js: no standalone sites. Old app domains and an app page opened on its own go to a pop-out window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { RETIRED_HOSTS, retiredRedirect, topLevelApp } from '../index.js';
import { SITE, hostOf } from '../../shared/site.js';

const env = { ASSETS: { fetch: async () => new Response('asset') } };

test('every app site in site.js is a retired host, mapped to its app id', () => {
  for (const [id, url] of Object.entries(SITE.apps)) assert.equal(RETIRED_HOSTS[hostOf(url)], id);
  assert.equal(RETIRED_HOSTS[hostOf(SITE.workshop)], undefined);
  assert.equal(RETIRED_HOSTS['dispatch.alexisdavidson.org'], 'slate');
});

test('a retired app domain redirects any path to the app in a pop-out window', async () => {
  for (const [id, url] of Object.entries(SITE.apps)) {
    const res = await worker.fetch(new Request(`${url}/some/page?x=1`), env);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${SITE.workshop}/?solo=${id}#/${id}`);
  }
  assert.equal(retiredRedirect(new URL(`${SITE.workshop}/`)), null);
});

test('an app start page opened at the top level opens in a pop-out; frames and other pages are left alone', async () => {
  const doc = p => new Request(SITE.workshop + p, { headers: { 'Sec-Fetch-Dest': 'document' } });
  const frame = p => new Request(SITE.workshop + p, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  for (const p of ['/apps/slate/', '/apps/slate/index.html']) {
    const r = topLevelApp(new URL(SITE.workshop + p), doc(p));
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), `${SITE.workshop}/?solo=slate#/slate`);
  }
  assert.equal(topLevelApp(new URL(SITE.workshop + '/apps/slate/'), frame('/apps/slate/')), null);
  assert.equal(topLevelApp(new URL(SITE.workshop + '/apps/slate/review.html'), doc('/apps/slate/review.html')), null);
  assert.equal(topLevelApp(new URL(SITE.workshop + '/apps/slate/js/main.js'), doc('/apps/slate/js/main.js')), null);
  const res = await worker.fetch(frame('/apps/slate/'), env);
  assert.equal(await res.text(), 'asset');
});

test('Dispatch\'s old domain redirects to Loom in a pop-out; its installer addresses go to Workshop\'s installers', async () => {
  const res = await worker.fetch(new Request('https://dispatch.alexisdavidson.org/'), env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), `${SITE.workshop}/?solo=slate#/slate`);
  for (const p of ['/install.ps1', '/install.sh', '/install-work.ps1', '/install-work.sh']) {
    const r = await worker.fetch(new Request('https://dispatch.alexisdavidson.org' + p), env);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), SITE.workshop + p, p);
  }
});
