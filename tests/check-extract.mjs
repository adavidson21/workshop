#!/usr/bin/env node
// B8 (docs/shared.md): every app can be pulled out. For each app with unit tests, copy only what an app may
// depend on (apps/<id>/, shared/, icons/, tests/lib/, docs/, the web manifest) into an empty folder, with the same layout, and run
// that app's tests there. A hidden dependency on anything else (another app, the shell, the agent) fails here
// even if the boundary check missed it. Settings' tests also get connectors/, because Settings builds its
// forms from each connector's configSchema.
//
//   node tests/check-extract.mjs [app id ...]
//
// Exit 1 if any app's tests fail when pulled out. Node 22, no dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALWAYS = ['shared', 'icons', 'tests/lib', 'docs', 'manifest.webmanifest'];
const EXTRA = { settings: ['connectors'] };
const SKIP = new Set(['node_modules', '.git']);

function copy(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from)) if (!SKIP.has(e)) copy(path.join(from, e), path.join(to, e));
  } else fs.copyFileSync(from, to);
}

const want = process.argv.slice(2);
const apps = fs.readdirSync(path.join(root, 'apps'), { withFileTypes: true })
  .filter(e => e.isDirectory() && (!want.length || want.includes(e.name)))
  .map(e => e.name)
  .filter(id => fs.existsSync(path.join(root, 'apps', id, 'test')) && fs.readdirSync(path.join(root, 'apps', id, 'test')).some(f => f.endsWith('.test.mjs')));

const failed = [];
for (const id of apps) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `extract-${id}-`));
  try {
    for (const p of [`apps/${id}`, ...ALWAYS, ...(EXTRA[id] || [])]) {
      const src = path.join(root, p);
      if (fs.existsSync(src)) copy(src, path.join(tmp, p));
    }
    const tests = fs.readdirSync(path.join(tmp, 'apps', id, 'test')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('apps', id, 'test', f));
    const r = spawnSync(process.execPath, ['--test', ...tests], { cwd: tmp, encoding: 'utf8', env: { ...process.env, HOME: tmp, USERPROFILE: tmp } });
    const summary = (r.stdout.match(/^# (pass|fail) \d+$/gm) || []).join(', ');
    if (r.status === 0) console.log(`extract ok: ${id} (${summary})`);
    else {
      failed.push(id);
      console.error(`extract FAILED: ${id} (${summary || 'did not run'}). Its tests need something outside apps/${id}/ and the shared folders:`);
      console.error((r.stdout + r.stderr).split('\n').filter(l => /Cannot find|ERR_MODULE_NOT_FOUND|not ok|Error:/.test(l)).slice(0, 15).join('\n'));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
if (failed.length) { console.error(`\n${failed.length} app(s) cannot be pulled out: ${failed.join(', ')} (docs/shared.md, B8).`); process.exit(1); }
console.log(`extract ok: ${apps.length} apps`);
