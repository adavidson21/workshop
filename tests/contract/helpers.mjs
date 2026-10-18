// Shared helpers for the contract suite. The agent under test comes from WORKSHOP_TARGET (a module path
// relative to the repo root), default tests/contract/targets/mock.mjs. See tests/contract/README.md.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SchemaSet } from '../lib/schema.mjs';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(REPO, 'tests', 'fixtures');
export const schemas = SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));
export const SECRET = 'echo-secret-value-7f3a9c';
export const HOSTED = 'https://work.example.org';

/** Start the agent under test with the fixtures and the given config. */
export async function startAgent(config = {}, extra = {}) {
  const target = process.env.WORKSHOP_TARGET || 'tests/contract/targets/mock.mjs';
  const { start } = await import(pathToFileURL(path.resolve(REPO, target)).href);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-contract-'));
  const agent = await start({
    home,
    appsDir: path.join(FIXTURES, 'apps'),
    connectorsDir: path.join(FIXTURES, 'connectors'),
    env: { ECHO_TOKEN: SECRET },
    config: { configVersion: 1, ...config },
    ...extra
  });
  const stop = agent.stop;
  agent.stop = async () => { await stop(); fs.rmSync(home, { recursive: true, force: true }); };
  return agent;
}

/**
 * One HTTP request. auth: 'header' (default), 'cookie', 'both' or 'none'.
 * Returns {status, headers, text, json}.
 */
export function request(agent, method, pathname, { body, auth = 'header', origin, host, headers = {}, rawBody } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: host ?? `127.0.0.1:${agent.port}`, ...headers };
    if (origin) h.Origin = origin;
    if (auth === 'header' || auth === 'both') h['X-Workshop-Token'] = agent.token;
    if (auth === 'cookie' || auth === 'both') h.Cookie = `workshop_token=${agent.token}`;
    let data = rawBody;
    if (body !== undefined) { data = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    if (data !== undefined) h['Content-Length'] = Buffer.byteLength(data);
    const req = http.request({ host: '127.0.0.1', port: agent.port, method, path: pathname, headers: h, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

export const get = (agent, p, o) => request(agent, 'GET', p, o);
export const put = (agent, p, body, o) => request(agent, 'PUT', p, { ...o, body });
export const post = (agent, p, body, o) => request(agent, 'POST', p, { ...o, body });

/** Assert a JSON response: status, schema, and the standard API headers. */
export function expectJson(res, status, schema) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${res.text.slice(0, 300)}`);
  assert.match(res.headers['content-type'] || '', /^application\/json/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  if (schema) schemas.assert(schema, res.json, `${res.status} body`);
  return res.json;
}

/** Assert an error response with the given status and code. */
export function expectError(res, status, code) {
  const body = expectJson(res, status, 'error');
  assert.equal(body.code, code, `expected code ${code}, got ${body.code}: ${body.error}`);
  return body;
}

/** Open the event stream. Returns {events, next(name, predicate, ms), close(), headers}. */
export function openEvents(agent, { query = '', auth = 'header', origin } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: `127.0.0.1:${agent.port}`, Accept: 'text/event-stream' };
    if (auth === 'header') h['X-Workshop-Token'] = agent.token;
    if (auth === 'cookie') h.Cookie = `workshop_token=${agent.token}`;
    if (origin) h.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port: agent.port, method: 'GET', path: `/api/events${query}`, headers: h, agent: false }, res => {
      const events = [];
      const waiters = [];
      const taken = new WeakSet();
      const take = e => (taken.has(e) ? false : (taken.add(e), true));
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let event = 'message', data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          const e = { event, data: JSON.parse(data) };
          events.push(e);
          for (const w of [...waiters]) if (w.match(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
        }
      });
      resolve({
        status: res.statusCode,
        headers: res.headers,
        events,
        next(name, pred = () => true, ms = 3000) {
          const hit = events.find(e => e.event === name && pred(e.data) && !taken.has(e));
          if (hit) { take(hit); return Promise.resolve(hit); }
          return new Promise((ok, no) => {
            const w = { match: e => e.event === name && pred(e.data) && take(e), resolve: ok };
            waiters.push(w);
            setTimeout(() => no(new Error(`No "${name}" event within ${ms} ms. Got: ${events.map(e => e.event).join(', ')}`)), ms).unref();
          });
        },
        close() { req.destroy(); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export const envelope = (app, collection, items = [], extra = {}) => ({ schema: `${app}.${collection}`, version: 1, rev: 0, items, ...extra });
