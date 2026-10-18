// The Workshop home folder (docs/config.md, Location): config.json, the token, data/ and logs/.
// Default ~/.workshop, or WORKSHOP_HOME.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJsonAtomic, writeFileAtomic } from './fsutil.mjs';

export const DEFAULT_PORT = 4380;

/** The home folder: WORKSHOP_HOME if set, else ~/.workshop. Always absolute. */
export function resolveHome(env = process.env) {
  const fromEnv = env.WORKSHOP_HOME;
  return path.resolve(fromEnv && fromEnv.trim() ? fromEnv : path.join(os.homedir(), '.workshop'));
}

export function homePaths(home) {
  return {
    home,
    config: path.join(home, 'config.json'),
    token: path.join(home, 'token'),
    data: path.join(home, 'data'),
    logs: path.join(home, 'logs')
  };
}

export const defaultConfig = () => ({
  configVersion: 1,
  port: DEFAULT_PORT,
  allowedOrigins: [],
  features: { startAtLogin: false, hostedMode: false },
  connectors: {}
});

export class ConfigError extends Error {}

/**
 * Read config.json, creating it with defaults if it does not exist. A file that is not valid JSON or fails
 * the config schema is never overwritten: this throws ConfigError with plain words saying what to fix.
 * Returns the stored object with defaults filled in. Unknown top-level keys are kept as they are.
 */
export async function loadConfig(file, schemas) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code !== 'ENOENT') throw new ConfigError(`Could not read ${file}: ${e.code || e.message}`);
    const fresh = defaultConfig();
    await writeJsonAtomic(file, fresh);
    return fresh;
  }
  let value;
  try { value = JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    throw new ConfigError(`${file} is not valid JSON (${e.message}). Fix it or move it away, then start Workshop again.`);
  }
  const errs = schemas.validate('config', value);
  if (errs.length) throw new ConfigError(`${file} is not a valid Workshop config: ${errs[0]}. Fix it, then start Workshop again.`);
  const d = defaultConfig();
  return {
    ...value,
    port: value.port ?? d.port,
    allowedOrigins: value.allowedOrigins ?? d.allowedOrigins,
    features: { ...d.features, ...(value.features || {}) },
    connectors: value.connectors ?? {}
  };
}

/** Save config.json atomically. Keys the agent does not know stay in the object, so they are kept. */
export const saveConfig = (file, config) => writeJsonAtomic(file, config);

const TOKEN = /^[0-9a-f]{64}$/;

/**
 * Read the per-install token, or create one (32 random bytes, hex) readable by this user only.
 * A token file that does not look like a token is replaced.
 */
export async function loadToken(file) {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (TOKEN.test(t)) return t;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const token = crypto.randomBytes(32).toString('hex');
  await writeFileAtomic(file, `${token}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  return token;
}
