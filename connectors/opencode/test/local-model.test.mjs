// Local and self-hosted models (lib/local-model.mjs, connector 1.33.0, docs/local-models.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BASE_TOKENS, checkLocalModels, commandSizes, fitMessage, isLocal, localSetting, privateUrl, promptFit } from '../lib/local-model.mjs';
import { configure, opt, shutdown } from '../lib/context.mjs';
import { chatSuggest } from '../lib/chat-more.mjs';

test('localSetting: only on and off are kept, anything else is auto', () => {
  assert.equal(localSetting('on'), 'on');
  assert.equal(localSetting('off'), 'off');
  assert.equal(localSetting(undefined), 'auto');
  assert.equal(localSetting('yes'), 'auto');
});

test('isLocal: on and off decide; auto knows Ollama and friends, not hosted providers', () => {
  assert.equal(isLocal('on', null), true);
  assert.equal(isLocal('off', { provider: 'ollama', id: 'qwen' }), false);
  assert.equal(isLocal('auto', { provider: 'ollama', id: 'qwen' }), true);
  assert.equal(isLocal('auto', { provider: 'LMStudio', id: 'x' }), true);
  assert.equal(isLocal('auto', { provider: 'anthropic', id: 'x' }), false);
  assert.equal(isLocal(undefined, null), false);
});

test('promptFit: ok, tight and over against the window; unknown without sizes or a window', () => {
  assert.equal(promptFit({ tokens: 5000, readTokens: 500, context: 128000 }).state, 'ok');
  // 7.5K up front + base 6K = 13.5K, plus 4.5K read = 18K: over 60% of 16K but the up-front part fits.
  const tight = promptFit({ tokens: 7500, readTokens: 4500, context: 16384 });
  assert.equal(tight.state, 'tight');
  assert.equal(tight.need, 7500 + BASE_TOKENS + 4500);
  assert.equal(promptFit({ tokens: 5000, readTokens: 0, context: 4096 }).state, 'over');
  assert.equal(promptFit({ tokens: 5000, context: null }).state, 'unknown');
  assert.equal(promptFit({ tokens: null, context: 8000 }).state, 'unknown');
});

test('fitMessage: words for tight and over, nothing for ok or unknown', () => {
  assert.match(fitMessage('start', promptFit({ tokens: 7500, readTokens: 0, context: 4096 })), /\/start needs about 14K tokens, but the model's context window is 4K/);
  assert.match(fitMessage('review', promptFit({ tokens: 6400, readTokens: 4000, context: 20000 })), /leaves little room/);
  assert.equal(fitMessage('x', promptFit({ tokens: 1000, context: 200000 })), null);
  assert.equal(fitMessage('x', null), null);
});

test('commandSizes: a map from commands.json rows', () => {
  const m = commandSizes([{ command: 'start', tokens: 7522, readTokens: 4473 }, null, { tokens: 1 }]);
  assert.deepEqual(m.get('start'), { tokens: 7522, readTokens: 4473 });
  assert.equal(m.size, 1);
});

test('privateUrl: this computer and private networks, not public names', () => {
  for (const u of ['http://localhost:11434/v1', 'http://127.0.0.1:1234', 'http://10.2.3.4/v1', 'http://172.20.0.1', 'http://192.168.1.9', 'http://gpu.internal/v1', 'http://box.local']) assert.equal(privateUrl(u), true, u);
  for (const u of ['https://api.example.com/v1', 'http://172.32.0.1', 'not a url', '', null]) assert.equal(privateUrl(u), false, String(u));
});

/** A fake home whose global opencode config is `cfg`. */
function home(cfg) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-local-'));
  fs.mkdirSync(path.join(h, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(h, '.config', 'opencode', 'opencode.json'), JSON.stringify(cfg));
  return h;
}
const check = (h, setting) => checkLocalModels({ workspace: path.join(h, 'none'), setting, env: {}, platform: 'linux', home: h });

test('checkLocalModels: skipped with only hosted providers', () => {
  const h = home({ provider: { anthropic: { models: { big: { limit: { context: 200000 } } } } } });
  try { assert.equal(check(h).state, 'skipped'); } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('checkLocalModels: a small Ollama window is bad, a missing one a warning, a big one ok with a reminder', () => {
  const h = home({ provider: {
    ollama: { options: { baseURL: 'http://127.0.0.1:11434/v1' }, models: { small: { limit: { context: 4096 } }, unknown: {}, big: { limit: { context: 32768 } } } },
  } });
  try {
    const r = check(h);
    assert.equal(r.state, 'bad');
    const text = r.lines.join('\n');
    assert.match(text, /ollama\/small: a 4096-token window is too small/);
    assert.match(text, /ollama\/unknown: no limit\.context/);
    assert.match(text, /ollama\/big: 32768-token window\. Make sure Ollama really serves that size/);
    assert.doesNotMatch(text, /127\.0\.0\.1/, 'never prints the address');
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('checkLocalModels: a company server on a public name counts only with Local model on', () => {
  const h = home({ provider: { corp: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://llm.example.com/v1' }, models: { coder: { limit: { context: 65536 } } } } } });
  try {
    assert.equal(check(h, 'auto').state, 'skipped');
    const r = check(h, 'on');
    assert.equal(r.state, 'ok');
    assert.match(r.lines.join('\n'), /corp\/coder: 65536-token window\./);
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('checkLocalModels: Local model on with no provider address says so', () => {
  const h = home({ provider: { anthropic: {} } });
  try {
    const r = check(h, 'on');
    assert.equal(r.state, 'warn');
    assert.match(r.lines[0], /no provider in opencode's config has its own address/);
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

test('configure: Local model caps builds at once to 1; off keeps the setting', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-local-ws-'));
  const base = { workspace: ws, opencode: { startServer: false }, autopilot: { maxRuns: 4 } };
  const ctx = (config) => ({ config, log() {}, emit() {}, env() {} });
  try {
    configure(ctx({ ...base, localModel: 'on' }));
    assert.equal(opt.local, true);
    assert.equal(opt.autoMaxRuns, 1);
    shutdown();
    configure(ctx({ ...base, runModel: 'ollama/qwen' }));
    assert.equal(opt.local, true, 'automatic: Ollama is local');
    assert.equal(opt.autoMaxRuns, 1);
    shutdown();
    configure(ctx({ ...base, localModel: 'off', runModel: 'ollama/qwen' }));
    assert.equal(opt.local, false);
    assert.equal(opt.autoMaxRuns, 4);
    shutdown();
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
});

test('chat.suggest is off for a local model, without asking opencode', async () => {
  assert.deepEqual(await chatSuggest({ session: 's1' }, { config: {}, local: true }), { text: null, off: true });
});

test('commandFit: a command whose prompt cannot fit the model for agent runs is over; unknown model or sizes give no check', async () => {
  const { oc } = await import('../lib/opencode-state.mjs');
  const { commandFit, resetFit } = await import('../lib/actions.mjs');
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-fit-'));
  const src = path.join(h, 'eng-agents');
  fs.mkdirSync(path.join(src, 'evals'), { recursive: true });
  fs.writeFileSync(path.join(src, 'evals', 'Invoke-Evals.ps1'), '');
  fs.writeFileSync(path.join(src, 'evals', 'commands.json'), JSON.stringify({ version: 1, commands: [{ command: 'start', agent: 'planner', tokens: 7522, readTokens: 4473 }] }));
  fs.mkdirSync(path.join(h, '.config', 'opencode', 'eng-agents'), { recursive: true });
  fs.writeFileSync(path.join(h, '.config', 'opencode', 'eng-agents', 'manifest.json'), JSON.stringify({ source: src, components: { core: { version: '4.17.0' } } }));
  const ws = path.join(h, 'ws');
  fs.mkdirSync(ws);
  const was = { home: process.env.HOME, api: oc.api };
  process.env.HOME = h;
  const ctx = (config) => ({ config, log() {}, emit() {}, env() {} });
  try {
    oc.api = { modelList: async () => ({ models: [{ provider: 'ollama', id: 'small', context: 4096 }, { provider: 'ollama', id: 'big', context: 131072 }], defaults: {} }) };
    configure(ctx({ workspace: ws, opencode: { startServer: false }, runModel: 'ollama/small' }));
    resetFit();
    assert.equal((await commandFit('start')).state, 'over');
    assert.equal(await commandFit('nope'), null, 'a command commands.json does not list');
    shutdown();
    configure(ctx({ workspace: ws, opencode: { startServer: false }, runModel: 'ollama/big' }));
    resetFit();
    assert.equal((await commandFit('start')).state, 'ok');
    shutdown();
    configure(ctx({ workspace: ws, opencode: { startServer: false } }));
    resetFit();
    assert.equal(await commandFit('start'), null, 'no model for agent runs and two models: the agent picks, so no check');
    shutdown();
  } finally {
    process.env.HOME = was.home;
    oc.api = was.api;
    fs.rmSync(h, { recursive: true, force: true });
  }
});
