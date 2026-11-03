// Saved user environment variables, read live (docs/connector.md, ctx.env).
//
// A process copies its environment when it starts, so a PAT saved after Workshop started (with setx,
// "workshop pat", or the Windows settings dialog) used to need a restart. On Windows the saved user
// variables live in the registry under HKCU\Environment, so the agent reads them from there when a
// connector asks, and falls back to its own environment. macOS and Linux have no such store: there the
// value comes from the environment Workshop started in, as before.
//
// Values are never logged or printed here. This is the agent's one use of child_process, and it only ever
// runs "reg query HKCU\Environment /v <name>" (agent/test/source.test.mjs checks that). Saving a variable is
// the workshop command's job (scripts/lib/control.mjs), never the agent's.
import { spawnSync } from 'node:child_process';

/** Environment variable names Workshop reads or writes. Also keeps names safe to put inside a script. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 });

/**
 * The value of a saved user variable on Windows (HKCU\Environment), or undefined if it is not set or
 * cannot be read. REG_EXPAND_SZ values have %NAME% expanded from `env`.
 */
export function readWindowsUserEnv(name, { exec = run, env = process.env } = {}) {
  if (!ENV_NAME.test(String(name))) return undefined;
  const r = exec('reg', ['query', 'HKCU\\Environment', '/v', name]);
  if (!r || r.status !== 0 || typeof r.stdout !== 'string') return undefined;
  return parseRegQuery(r.stdout, name, env);
}

/** Pulls one value out of `reg query` output. Exported for tests. */
export function parseRegQuery(text, name, env = {}) {
  const want = String(name).toLowerCase();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+(REG_SZ|REG_EXPAND_SZ)(?:\s{4}(.*))?$/.exec(line);
    if (!m || m[1].toLowerCase() !== want) continue;
    const value = m[3] ?? '';
    if (m[2] === 'REG_EXPAND_SZ') return value.replace(/%([^%]+)%/g, (all, v) => (typeof env[v] === 'string' ? env[v] : all));
    return value;
  }
  return undefined;
}

/**
 * The environment handed to connectors. On Windows, each name is looked up in the saved user variables
 * first (cached for `ttlMs`), then in `base`; elsewhere this is `base` itself.
 */
export function liveEnv(base, { platform = process.platform, read = readWindowsUserEnv, ttlMs = 5000, now = Date.now } = {}) {
  if (platform !== 'win32') return base;
  const cache = new Map();
  const saved = name => {
    const t = now();
    const hit = cache.get(name);
    if (hit && t - hit.at < ttlMs) return hit.value;
    let value;
    try { value = read(name); } catch { value = undefined; }
    cache.set(name, { value, at: t });
    return value;
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop !== 'string' || !ENV_NAME.test(prop)) return Reflect.get(target, prop);
      const v = saved(prop);
      return typeof v === 'string' && v !== '' ? v : Reflect.get(target, prop);
    }
  });
}
