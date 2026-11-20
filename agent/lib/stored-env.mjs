// Environment-variable tokens saved from Settings (docs/security.md, Secrets). A connector field marked
// x-workshop-env names a variable, like ADO_PAT. Settings, Tokens & sign-ins can save that token in this
// computer's secret store instead of a shell profile or setx, under the secret name envSecretName(ADO_PAT),
// "env-ado-pat". Connectors still ask for ADO_PAT with ctx.env; this wraps the environment so the saved one is
// found first, then the variable itself.
//
// ctx.env is synchronous, so the values are read ahead: at start, after Settings saves or removes one, and once a
// minute. Only names listed in <home>/secrets.json that start with "env-" are read. Values are never logged here.
import { SECRET_NAME, readIndex } from './secrets.mjs';
import { ENV_NAME } from './userenv.mjs';

/** The secret name a variable's token is saved under from Settings, or null when it cannot have one. */
export function envSecretName(envName) {
  if (!ENV_NAME.test(String(envName))) return null;
  const n = `env-${String(envName).toLowerCase().replace(/_/g, '-')}`;
  return SECRET_NAME.test(n) ? n : null;
}

/**
 * {env, refresh(), has(envName)}: `env` is `base` with saved tokens found first. `read` is the secret reader
 * (lib/secrets.mjs secretReader, with forget). `onValue` is told each value read, for the log's redaction list.
 */
export function storedEnv(base, { home, read, onValue = () => {}, everyMs = 60000 } = {}) {
  let values = new Map(); // secret name -> value
  const refresh = async () => {
    const next = new Map();
    for (const name of Object.keys(readIndex(home))) {
      if (!name.startsWith('env-')) continue;
      if (read.forget) read.forget(name);
      let v;
      try { v = await read(name); } catch { v = undefined; }
      if (typeof v === 'string' && v !== '') { next.set(name, v); onValue(v); }
    }
    values = next;
  };
  const timer = everyMs ? setInterval(() => { refresh().catch(() => {}); }, everyMs) : null;
  if (timer && timer.unref) timer.unref();
  const env = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string') {
        const n = envSecretName(prop);
        if (n && values.has(n)) return values.get(n);
      }
      return Reflect.get(target, prop);
    }
  });
  return { env, refresh, has: envName => { const n = envSecretName(envName); return !!n && values.has(n); }, stop: () => timer && clearInterval(timer) };
}
