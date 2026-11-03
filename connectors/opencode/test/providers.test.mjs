// Approved AI providers (lib/providers.mjs): what `workshop doctor` says about opencode's providers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProviders, stripJsonc } from '../lib/providers.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'oc-providers-'));
const rm = d => fs.rmSync(d, { recursive: true, force: true });

/** A fake user home with opencode's global config, saved logins and a workspace. */
function setup({ global, project, auth } = {}) {
  const home = tempDir();
  const cfgDir = path.join(home, '.config', 'opencode');
  const dataDir = path.join(home, '.local', 'share', 'opencode');
  const workspace = path.join(home, 'work');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  if (global !== undefined) fs.writeFileSync(path.join(cfgDir, 'opencode.json'), typeof global === 'string' ? global : JSON.stringify(global));
  if (project !== undefined) fs.writeFileSync(path.join(workspace, 'opencode.json'), JSON.stringify(project));
  if (auth !== undefined) fs.writeFileSync(path.join(dataDir, 'auth.json'), JSON.stringify(auth));
  return { home, workspace };
}
const run = (s, approved = ['softheon'], env = {}) => checkProviders({ approved, workspace: s.workspace, env, platform: 'linux', home: s.home });

test('stripJsonc removes comments and trailing commas but not text inside strings', () => {
  const text = '{\n // a comment\n "url": "http://x//y", /* block */ "a": [1, 2,],\n "s": "say \\"hi\\" // not a comment",\n}';
  assert.deepEqual(JSON.parse(stripJsonc(text)), { url: 'http://x//y', a: [1, 2], s: 'say "hi" // not a comment' });
});

test('no approved list: skipped, never a failure', () => {
  const s = setup();
  try { assert.equal(run(s, []).state, 'skipped'); } finally { rm(s.home); }
});

test('enabled_providers limited to approved ones, with approved models: ok', () => {
  const s = setup({ global: '{ // jsonc\n "enabled_providers": ["softheon"], "model": "softheon/big", "small_model": "softheon/small", }', auth: { softheon: { type: 'api' } } });
  try {
    const r = run(s);
    assert.equal(r.state, 'ok', r.lines.join('\n'));
    assert.match(r.lines.join('\n'), /lists only approved providers/);
  } finally { rm(s.home); }
});

test('without enabled_providers opencode can use anything, so it fails and says what to add', () => {
  const s = setup({ global: { model: 'softheon/big' } });
  try {
    const r = run(s);
    assert.equal(r.state, 'bad');
    assert.match(r.lines.join('\n'), /enabled_providers is not set.*"enabled_providers": \["softheon"\]/);
  } finally { rm(s.home); }
});

test('an unapproved provider in enabled_providers, a model or an agent fails', () => {
  const s = setup({ global: { enabled_providers: ['softheon', 'anthropic'], model: 'anthropic/claude', agent: { build: { model: 'openai/gpt' } } } });
  try {
    const r = run(s);
    const text = r.lines.join('\n');
    assert.equal(r.state, 'bad');
    assert.match(text, /not approved: anthropic/);
    assert.match(text, /model in .* uses anthropic/);
    assert.match(text, /agent build in .* uses openai/);
  } finally { rm(s.home); }
});

test('the workspace config overrides the global one, as opencode merges them', () => {
  const s = setup({ global: { enabled_providers: ['softheon'] }, project: { enabled_providers: ['openai'] } });
  try {
    const r = run(s);
    assert.equal(r.state, 'bad');
    assert.match(r.lines.join('\n'), /work.opencode\.json\) lists providers that are not approved: openai/);
  } finally { rm(s.home); }
});

test('stray logins are a note when enabled_providers blocks them, a failure when it does not', () => {
  const blocked = setup({ global: { enabled_providers: ['softheon'] }, auth: { softheon: {}, anthropic: {} } });
  const open = setup({ global: {}, auth: { anthropic: {} } });
  try {
    const a = run(blocked);
    assert.equal(a.state, 'ok', a.lines.join('\n'));
    assert.match(a.lines.join('\n'), /Saved logins for providers that are not approved: anthropic \(blocked by enabled_providers\)/);
    assert.equal(run(open).state, 'bad');
  } finally { rm(blocked.home); rm(open.home); }
});

test('OPENCODE_CONFIG_CONTENT wins over files, and an unreadable config fails', () => {
  const s = setup({ global: { enabled_providers: ['openai'] } });
  const bad = setup({ global: '{ not json' });
  try {
    assert.equal(run(s, ['softheon'], { OPENCODE_CONFIG_CONTENT: '{"enabled_providers":["softheon"]}' }).state, 'ok');
    const r = run(bad);
    assert.equal(r.state, 'bad');
    assert.match(r.lines.join('\n'), /Could not read/);
  } finally { rm(s.home); rm(bad.home); }
});

test('prints provider ids only, never keys or URLs from the files', () => {
  const s = setup({ global: { enabled_providers: ['softheon'], provider: { softheon: { options: { apiKey: 'sk-secret-123', baseURL: 'https://ai.internal.example' } } } }, auth: { softheon: { key: 'sk-secret-456' } } });
  try {
    const text = run(s).lines.join('\n');
    assert.ok(!text.includes('sk-secret') && !text.includes('ai.internal.example'), text);
  } finally { rm(s.home); }
});
