// Helpers for the agent's own tests (agent/test/*.test.mjs). The contract suite in tests/contract/ checks the
// API; these tests check what it cannot see: files on disk, logs, static serving from the repo, lifecycle.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent } from '../server.mjs';

export { request, get, put, post, envelope } from '../../tests/contract/helpers.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const CONNECTORS = path.join(HERE, 'fixtures', 'connectors');
export const APPS = path.join(REPO, 'tests', 'fixtures', 'apps');
export const SECRET = 'probe-secret-value-91c2e7';

/**
 * A fresh temp folder holding `home/` (returned, used as the Workshop home) and, next to it, `Workshop/` for the
 * data folder (see dataDirOf). Tests always pass that data folder, so they never touch the real ~/Workshop.
 */
export function tempHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-agent-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  return home;
}
/** The data folder that belongs to a tempHome(): a sibling of the home folder, never inside it. */
export const dataDirOf = home => path.join(path.dirname(home), 'Workshop');
/** Remove a tempHome() with its data folder. */
export const rmHome = home => fs.rmSync(path.dirname(home), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Write config.json into home (merged over a valid base), then start an agent on a free port with its temp data folder. */
export async function start(home, config, extra = {}) {
  if (config) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, ...config }, null, 2));
  return createAgent({ home, port: 0, dataDir: dataDirOf(home), appsDir: APPS, connectorsDir: CONNECTORS, env: { PROBE_SECRET: SECRET }, ...extra });
}

export const logText = agent => { try { return fs.readFileSync(agent.logFile, 'utf8'); } catch { return ''; } };
