// Static files from this repo (docs/agent-api.md, Static files).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAgent } from '../server.mjs';
import { tempHome, rmHome, get, request, REPO } from './helpers.mjs';

let agent, home;
before(async () => { home = tempHome(); agent = await createAgent({ home, port: 0 }); });
after(async () => { await agent?.stop(); rmHome(home); });

test('serves the shell, shared files, icons and root files of the repo', async () => {
  const cases = [
    ['/', /^text\/html/], ['/index.html', /^text\/html/], ['/sw.js', /^text\/javascript/], ['/manifest.webmanifest', /^application\/manifest\+json/],
    ['/shell/shell.js', /^text\/javascript/], ['/shared/themes.css', /^text\/css/], ['/icons/favicon.svg', /^image\/svg\+xml/],
    ['/shared/fonts/fonts.css', /^text\/css/]
  ];
  for (const [p, type] of cases) {
    const res = await get(agent, p, { auth: 'none' });
    assert.equal(res.status, 200, p);
    assert.match(res.headers['content-type'], type, p);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
  const index = await get(agent, '/', { auth: 'none' });
  assert.equal(index.text, fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'));
});

test('HEAD answers without a body', async () => {
  const res = await request(agent, 'HEAD', '/index.html', { auth: 'none' });
  assert.equal(res.status, 200);
  assert.equal(res.text, '');
  assert.ok(Number(res.headers['content-length']) > 0);
});

test('never serves the agent, connectors, tests, docs, dot files or anything else at the root', async () => {
  const paths = ['/agent/server.mjs', '/agent/start.mjs', '/connectors/', '/tests/mock-agent.mjs', '/docs/agent-api.md', '/README.md', '/LICENSE',
    '/.git/HEAD', '/.github/workflows/checks.yml', '/shared/.hidden', '/shell/%2e%2e/agent/server.mjs', '/shell/..%2fagent/server.mjs',
    '/shell%5c..%5cagent%5cserver.mjs', '/shared/%00', '/shell/shell.js::$DATA', '/icons', '/prioritizer/index.html', '/apps/', '/apps/../agent/server.mjs'];
  for (const p of paths) {
    const res = await get(agent, p, { auth: 'none' });
    assert.equal(res.status, 404, `${p} gave ${res.status}`);
  }
});

test('static files get the same Host and Origin checks', async () => {
  assert.equal((await get(agent, '/index.html', { auth: 'none', host: 'evil.example' })).status, 403);
  assert.equal((await get(agent, '/index.html', { auth: 'none', origin: 'https://evil.example' })).status, 403);
});

test('a symbolic link cannot lead out of an app folder', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, async () => {
  const apps = fs.mkdtempSync(path.join(home, 'apps-'));
  fs.mkdirSync(path.join(apps, 'demo'));
  fs.symlinkSync(path.join(REPO, 'agent', 'server.mjs'), path.join(apps, 'demo', 'escape.mjs'));
  fs.writeFileSync(path.join(apps, 'demo', 'ok.txt'), 'ok');
  const h2 = tempHome();
  const a2 = await createAgent({ home: h2, port: 0, appsDir: apps });
  try {
    assert.equal((await get(a2, '/apps/demo/ok.txt', { auth: 'none' })).status, 200);
    assert.equal((await get(a2, '/apps/demo/escape.mjs', { auth: 'none' })).status, 404);
  } finally { await a2.stop(); rmHome(h2); }
});
