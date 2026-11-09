// Checks on the agent's source: zero npm dependencies, no outbound requests, copies of tests/lib in sync,
// no em dashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { HERE, REPO } from './helpers.mjs';

const AGENT = path.resolve(HERE, '..');
const SITE_JS = path.join(REPO, 'shared', 'site.js');
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
        // One exception: shared/site.js, the site addresses (docs/site.md). Plain data with no imports (checked below).
        if (target === SITE_JS) continue;
        assert.ok(target.startsWith(AGENT + path.sep), `${rel(f)} imports ${spec}, outside agent/`);
        continue;
      }
      assert.ok(spec.startsWith('node:') && builtins.has(spec.slice(5)), `${rel(f)} imports ${spec}`);
    }
  }
  assert.equal(fs.existsSync(path.join(REPO, 'package.json')), false, 'no package.json, so no npm dependencies');
});

test('shared/site.js, the one file outside agent/ the agent imports, is plain data with no imports', () => {
  const text = fs.readFileSync(SITE_JS, 'utf8');
  assert.doesNotMatch(text, /^\s*import\s|import\(|require\(|\bfetch\s*\(/m);
});

test('the agent itself makes no outbound requests', () => {
  const banned = [/\bfetch\s*\(/, /node:https/, /\bhttp\.(request|get)\s*\(/, /node:net/, /node:tls/, /node:dns/, /node:dgram/, /node:child_process/, /\bWebSocket\b/, /\bEventSource\b/];
  for (const f of runtime) {
    const text = fs.readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    // Two exceptions (docs/security.md): lib/userenv.mjs reads saved user variables with "reg query", and
    // lib/terminal.mjs opens a visible terminal for Settings' Update button (checked below).
    const mayRun = ['agent/lib/userenv.mjs', 'agent/lib/terminal.mjs'];
    for (const re of banned) if (!(re.source === 'node:child_process' && mayRun.includes(rel(f)))) assert.ok(!re.test(text), `${rel(f)} matches ${re}`);
  }
});

test('the agent runs no program except "reg query HKCU\\Environment"', () => {
  const text = fs.readFileSync(path.join(AGENT, 'lib', 'userenv.mjs'), 'utf8');
  const calls = [...text.matchAll(/exec\('([^']+)', \[([^\]]*)\]/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(calls, [['reg', "'query', 'HKCU\\\\Environment', '/v', name"]]);
  assert.equal((text.match(/spawnSync\(/g) || []).length, 1);
  assert.ok(!/\bspawn\(|\bexec(File)?Sync?\s*\(\s*['"`](?!reg)/.test(text.replace(/exec\('reg'/g, '')));
});

test('the only other program is a visible terminal running the fixed "workshop update --restart"', async () => {
  const text = fs.readFileSync(path.join(AGENT, 'lib', 'terminal.mjs'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal((text.match(/\brun\(/g) || []).length, 1, 'one launch');
  assert.doesNotMatch(text, /spawnSync|execSync|exec\(|execFile|shell:\s*true|EncodedCommand/);
  const { openUpdateTerminal, updateArgv } = await import('../lib/terminal.mjs');
  assert.deepEqual(updateArgv({ execPath: 'node', repo: '/w' }).slice(2), ['update', '--restart']);
  const seen = [];
  const run = (exe, args) => { seen.push([exe, args]); return { once(ev, f) { if (ev === 'spawn') setImmediate(f); }, unref() {} }; };
  for (const platform of ['win32', 'darwin']) await openUpdateTerminal({ execPath: 'node', repo: '/w', platform, run });
  assert.equal(seen[0][0], 'powershell.exe');
  assert.match(seen[0][1].at(-1), /^& 'node' '.*workshop\.mjs' 'update' '--restart'$/);
  assert.equal(seen[1][0], 'osascript');
  assert.match(seen[1][1][1], /workshop\.mjs.*'update' '--restart'/);
  await assert.rejects(openUpdateTerminal({ execPath: 'node', repo: '/w', platform: 'linux', run }), e => e.status === 501);
  assert.equal(seen.length, 2, 'nothing runs on other platforms');
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
