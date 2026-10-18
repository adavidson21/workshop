// docs/run-modes.md (Service worker rules): the service worker never handles /api/*, /pair, or the
// event stream. Loads sw.js in a fake service worker scope and fires fetch events at it.
// Marked to-do until WS4 replaces sw.js; WS4 removes { todo } so the check blocks merges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO } from './helpers.mjs';

const ORIGIN = 'http://127.0.0.1:4380';

function loadWorker(source) {
  const listeners = {};
  const scope = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    caches: { open: async () => ({ put: async () => {}, match: async () => undefined, addAll: async () => {} }), match: async () => undefined, keys: async () => [] },
    fetch: async () => new Response(''),
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    Request, Response, URL, Promise, console
  };
  scope.self = scope;
  vm.runInNewContext(source, scope);
  return url => {
    let handled = false;
    const event = { request: { url, method: 'GET', mode: 'cors', headers: new Headers() }, respondWith: () => { handled = true; }, waitUntil: () => {} };
    for (const fn of listeners.fetch || []) fn(event);
    return handled;
  };
}

test('sw.js leaves agent API requests alone', { todo: 'WS4 replaces sw.js, then removes this todo' }, () => {
  const handles = loadWorker(fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8'));
  for (const p of ['/api/health', '/api/data/prioritizer/tasks', '/api/events', '/api/connectors/ado/sync', '/api/', '/pair?origin=https%3A%2F%2Fx.example']) {
    assert.equal(handles(`${ORIGIN}${p}`), false, `${p} must not be handled by the service worker`);
  }
});

test('the rule check itself works on a compliant worker', () => {
  const compliant = `self.addEventListener('fetch', e => {
    const u = new URL(e.request.url);
    if (u.origin === location.origin && (u.pathname.startsWith('/api/') || u.pathname === '/pair')) return;
    e.respondWith(fetch(e.request));
  });`;
  const handles = loadWorker(compliant);
  assert.equal(handles(`${ORIGIN}/api/events`), false);
  assert.equal(handles(`${ORIGIN}/pair`), false);
  assert.equal(handles(`${ORIGIN}/shell/shell.js`), true);
});
