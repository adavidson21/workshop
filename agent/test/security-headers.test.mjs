// Page security headers the agent sends (docs/security.md, Page security headers; docs/agent-api.md, Static files).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../server.mjs';
import { tempHome, rmHome, get, dataDirOf } from './helpers.mjs';

let agent, home;
before(async () => { home = tempHome(); agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home) }); });
after(async () => { await agent?.stop(); rmHome(home); });

test('every served page carries the security headers', async () => {
  for (const p of ['/', '/index.html', '/shell/shell.js', '/shared/themes.css']) {
    const res = await get(agent, p, { auth: 'none' });
    assert.equal(res.status, 200, p);
    const csp = res.headers['content-security-policy'];
    assert.ok(csp, `${p} has no CSP`);
    assert.match(csp, /default-src 'self'/, p);
    assert.match(csp, /connect-src 'self' http:\/\/127\.0\.0\.1:\*/, p);
    assert.match(csp, /frame-ancestors 'self'/, p);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', p);
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN', p);
    assert.equal(res.headers['referrer-policy'], 'no-referrer', p);
    assert.match(res.headers['permissions-policy'], /camera=\(\)/, p);
  }
});

test('the served CSP matches the meta tag the page also carries', async () => {
  const res = await get(agent, '/index.html', { auth: 'none' });
  const meta = res.text.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  // The agent adds frame-ancestors; otherwise the two policies are the same.
  assert.equal(res.headers['content-security-policy'], `${meta}; frame-ancestors 'self'`);
});
