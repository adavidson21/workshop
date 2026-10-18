// Logs never contain the token, PATs or data contents (docs/config.md, docs/connector.md ctx.log).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, tempHome, rmHome, get, put, post, envelope, logText, SECRET } from './helpers.mjs';
import { stripToken, createLogger } from '../lib/log.mjs';
import http from 'node:http';

test('stripToken removes the token from request URLs and keeps the rest', () => {
  assert.equal(stripToken('/?token=abc'), '/');
  assert.equal(stripToken('/?token=abc&x=1'), '/?x=1');
  assert.equal(stripToken('/?x=1&token=abc'), '/?x=1');
  assert.equal(stripToken('/?x=1&token=abc&y=2'), '/?x=1&y=2');
  assert.equal(stripToken('/api/events?TOKEN=abc'), '/api/events');
  assert.equal(stripToken('/?access_token=keep'), '/?access_token=keep');
  assert.equal(stripToken('/apps/notes/'), '/apps/notes/');
});

test('the logger redacts secrets it was given', () => {
  const lines = [];
  const orig = console.log;
  console.log = l => lines.push(l);
  try {
    const log = createLogger({ echo: true, secrets: ['abcdef123456'] });
    log.addSecret('pat-value-xyz');
    log.info('a abcdef123456 b pat-value-xyz c', { nested: 'pat-value-xyz' });
  } finally { console.log = orig; }
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('abcdef123456'));
  assert.ok(!lines[0].includes('pat-value-xyz'));
  assert.match(lines[0], /\[redacted\]/);
});

const raw = (agent, p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: agent.port, path: p, headers: { Host: `127.0.0.1:${agent.port}` }, agent: false }, res => {
    res.resume(); resolve(res.statusCode); req.destroy();
  });
  req.on('error', reject);
  req.end();
});

test('a full session leaves no token, secret or data contents in the log', async () => {
  const home = tempHome();
  const agent = await start(home, { connectors: { probe: { enabled: true } } });
  try {
    const contents = 'private-task-title-4b1d';
    await get(agent, `/?token=${agent.token}`, { auth: 'none' });
    await get(agent, `/?token=wrong-guess-1234`, { auth: 'none' });
    await raw(agent, `/api/events?token=${agent.token}`);
    await get(agent, '/api/session', { auth: 'cookie' });
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [{ id: 'a', updatedAt: 1, title: contents }]));
    await get(agent, '/api/data/notes/pages');
    const leak = await post(agent, '/api/connectors/probe/leak', {});
    assert.equal(leak.json.result.logged, true);
    await get(agent, '/api/nope');
    await agent.stop();
    const text = logText(agent);
    assert.ok(text.length > 0, 'something was logged');
    assert.ok(!text.includes(agent.token), 'token in log');
    assert.ok(!text.includes(SECRET), 'connector secret in log');
    assert.ok(!text.includes('wrong-guess-1234'), 'launcher token guess in log');
    assert.ok(!text.includes(contents), 'data contents in log');
    assert.match(text, /GET \/api\/events 200/);
    assert.match(text, /\[connector:probe\] the secret is \[redacted\]/);
  } finally { await agent.stop(); rmHome(home); }
});
