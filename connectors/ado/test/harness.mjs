// Runs one golden case through the Python helper or the Node connector against the fake ADO server.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeAdo } from './fake-ado.mjs';
import { NOW, PAT, scenario } from './fixtures/team.mjs';
import { normalize } from '../lib/config.mjs';
import { importConfig } from '../lib/import.mjs';
import { dataset } from '../lib/dataset.mjs';
import { cleanKnown, cleanKnownPrs, sync } from '../lib/sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..', '..');
export const HELPER = path.join(REPO, 'prioritizer', 'ado-helper', 'ado_helper.py');
export const HARNESS = path.join(HERE, '..', 'lib', 'helper_harness.py');
export const GOLDENS = path.join(HERE, 'goldens');
const PLACEHOLDER = '{{ADO}}';

/** Deep copy with "{{ADO}}" replaced by the server URL (or back again). */
export function swap(value, from, to) {
  return JSON.parse(JSON.stringify(value).split(from).join(to));
}

export async function withServer(fn) {
  const srv = await startFakeAdo(scenario);
  try {
    return await fn(srv);
  } finally {
    await srv.close();
  }
}

/** Finds a Python 3 interpreter, or null. */
export function findPython() {
  for (const [cmd, args] of [['python3', []], ['python', []], ['py', ['-3']]]) {
    const r = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return { cmd, args };
  }
  return null;
}

/**
 * Runs the helper harness. `request` is the harness request; resolves to its results array.
 * Async on purpose: the fake ADO server runs in this same process and must keep answering.
 */
export function runHarness(python, request, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(python.cmd, [...python.args, '-B', HARNESS], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const last = Buffer.concat(err).toString('utf8').split('\n').filter(Boolean).pop();
        return reject(new Error(`The Python helper failed to run: ${last || code}`));
      }
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8')).results); } catch (e) { reject(e); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** Environment for local test calls: the fake PAT, and no proxy for 127.0.0.1. */
export function testEnv() {
  const env = { ...process.env, TEST_ADO_PAT: PAT, no_proxy: '127.0.0.1,localhost', NO_PROXY: '127.0.0.1,localhost' };
  for (const k of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) delete env[k];
  return env;
}

export async function runPythonCase(python, c, srv) {
  const filled = swap(c, PLACEHOLDER, srv.url);
  const [res] = await runHarness(python, { helper: HELPER, config: filled.config, now: NOW, calls: [filled.call] }, testEnv());
  return res;
}

/** The Node connector on the same case: the helper config goes through the importer first. */
export async function runNodeCase(c, srv) {
  const filled = swap(c, PLACEHOLDER, srv.url);
  const { config } = importConfig({ helper: filled.config });
  const { config: cfg } = normalize(config);
  const env = testEnv();
  const d = { cfg, env: name => env[name], now: new Date(NOW) };
  try {
    if (filled.call.fn === 'sync') return { ok: await sync(d, cleanKnown(filled.call.known), cleanKnownPrs(filled.call.knownPrs)) };
    return { ok: await dataset(d, filled.call.req) };
  } catch (e) {
    if (e.name === 'AdoError' || e.name === 'SettingsError') return { error: e.message };
    throw e;
  }
}

/**
 * What the goldens compare: volatile timestamps removed, PR "gone" sorted by key (the helper walks a
 * Python set there, so its order is not stable), and fields the connector adds on top of the helper removed.
 */
export function comparable(result, url) {
  const r = swap(result, url, PLACEHOLDER);
  if (r.ok) {
    delete r.ok.syncedAt;
    delete r.ok.generatedAt;
    delete r.ok.connection;
    if (r.ok.prs) r.ok.prs.gone.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  return r;
}

export function comparableRequests(requests, url) {
  return swap([...requests].sort(), url, PLACEHOLDER);
}
