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

export const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-agent-'));
export const rmHome = home => fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Write config.json into home (merged over a valid base), then start an agent on a free port. */
export async function start(home, config, extra = {}) {
  if (config) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, ...config }, null, 2));
  return createAgent({ home, port: 0, appsDir: APPS, connectorsDir: CONNECTORS, env: { PROBE_SECRET: SECRET }, ...extra });
}

export const logText = agent => { try { return fs.readFileSync(agent.logFile, 'utf8'); } catch { return ''; } };
