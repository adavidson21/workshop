// Checks on the agent's source: zero npm dependencies, no outbound requests, copies of tests/lib in sync,
// no em dashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { HERE, REPO } from './helpers.mjs';

const AGENT = path.resolve(HERE, '..');
const files = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out); else out.push(p);
  }
  return out;
};
const all = files(AGENT);
const runtime = all.filter(f => f.endsWith('.mjs') && !f.startsWith(path.join(AGENT, 'test') + path.sep) && path.basename(f) !== 'test-target.mjs');
const rel = f => path.relative(REPO, f).split(path.sep).join('/');

test('the agent imports only Node built-ins and its own files', () => {
  const builtins = new Set(builtinModules);
  for (const f of runtime) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const target = path.resolve(path.dirname(f), spec);
        assert.ok(target.startsWith(AGENT + path.sep), `${rel(f)} imports ${spec}, outside agent/`);
        continue;
      }
      assert.ok(spec.startsWith('node:') && builtins.has(spec.slice(5)), `${rel(f)} imports ${spec}`);
    }
  }
  assert.equal(fs.existsSync(path.join(REPO, 'package.json')), false, 'no package.json, so no npm dependencies');
});

test('the agent itself makes no outbound requests', () => {
  const banned = [/\bfetch\s*\(/, /node:https/, /\bhttp\.(request|get)\s*\(/, /node:net/, /node:tls/, /node:dns/, /node:dgram/, /node:child_process/, /\bWebSocket\b/, /\bEventSource\b/];
  for (const f of runtime) {
    const text = fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    for (const re of banned) assert.ok(!re.test(text), `${rel(f)} matches ${re}`);
  }
});

test('the agent binds 127.0.0.1 only', () => {
  const text = fs.readFileSync(path.join(AGENT, 'server.mjs'), 'utf8');
  const listens = [...text.matchAll(/\.listen\(([^)]*)\)/g)].map(m => m[1]);
  assert.ok(listens.length >= 1);
  for (const l of listens) assert.match(l, /'127\.0\.0\.1'/);
});

test('copies of tests/lib match their source', () => {
  for (const name of ['schema.mjs', 'connector-check.mjs']) {
    const copy = fs.readFileSync(path.join(AGENT, 'lib', name), 'utf8').split('\n');
    const header = copy.findIndex(l => !l.startsWith('// Copied from') && !l.startsWith('// agent/test/source.test.mjs'));
    assert.equal(copy.slice(header).join('\n'), fs.readFileSync(path.join(REPO, 'tests', 'lib', name), 'utf8'), `agent/lib/${name} drifted from tests/lib/${name}`);
  }
});

test('no em dashes in agent/', () => {
  const EM = String.fromCharCode(0x2014);
  for (const f of all.filter(f => /\.(mjs|js|md|json)$/.test(f))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => assert.ok(!line.includes(EM), `${rel(f)}:${i + 1} has an em dash`));
  }
});
