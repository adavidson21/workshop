import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, onCrumbsDomain, hostOf } from '../site.js';

test('site.js: every address is https and the crumbs domain covers the sites', () => {
  for (const url of [SITE.workshop, ...Object.values(SITE.apps), ...SITE.allowedSites]) {
    assert.match(url, /^https:\/\/[a-z0-9.-]+$/);
    assert.ok(onCrumbsDomain(hostOf(url)), url);
  }
  assert.ok(SITE.allowedSites.includes(SITE.workshop));
  assert.equal(SITE.dispatch, undefined, 'Dispatch has no site of its own (apps.slate is its retired domain, Dispatch being part of Loom)');
});

test('site.js: onCrumbsDomain matches the domain and subdomains only', () => {
  const d = SITE.crumbs.domain;
  assert.equal(onCrumbsDomain(d), true);
  assert.equal(onCrumbsDomain('tools.' + d), true);
  assert.equal(onCrumbsDomain('not' + d), false);
  assert.equal(onCrumbsDomain('127.0.0.1'), false);
  assert.equal(onCrumbsDomain(undefined), false);
});

test('site.js: frozen, so no page can change it for another', () => {
  assert.throws(() => { 'use strict'; SITE.workshop = 'https://x.example'; });
  assert.throws(() => { 'use strict'; SITE.allowedSites.push('https://x.example'); });
});
