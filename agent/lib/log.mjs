// Agent logs in <home>/logs/agent.log, one line per entry. When the file passes 5 MB it moves to
// agent.1.log (replacing the older one), so logs never take more than about 10 MB.
//
// Logs never contain the token, PATs or data contents (docs/config.md). Callers must not pass them, and as
// a backstop every line is redacted: `token=` query values, the install token, and every environment
// variable value handed to a connector through ctx.env are replaced with [redacted].
import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const LEVELS = new Set(['info', 'warn', 'error']);

/** Remove `token` from a request URL (path and query) before it is logged. */
export function stripToken(url) {
  return String(url).replace(/([?&])token=[^&#]*(&?)/gi, (m, sep, amp) => (sep === '?' && amp ? '?' : amp ? sep : '')).replace(/\?$/, '');
}

export function createLogger({ dir, echo = false, secrets = [] } = {}) {
  const redactions = new Set(secrets.filter(s => typeof s === 'string' && s.length >= 4));
  const file = dir ? path.join(dir, 'agent.log') : null;
  if (dir) fs.mkdirSync(dir, { recursive: true });

  function redact(text) {
    let out = stripToken(text);
    for (const s of redactions) if (out.includes(s)) out = out.split(s).join('[redacted]');
    return out;
  }

  function write(level, who, msg, data) {
    if (!LEVELS.has(level)) level = 'info';
    let extra = '';
    if (data !== undefined) { try { extra = ` ${JSON.stringify(data)}`; } catch { extra = ' [unserializable data]'; } }
    const line = redact(`${new Date().toISOString()} ${level.toUpperCase()} [${who}] ${String(msg)}${extra}`).replace(/[\r\n]+/g, ' ');
    if (echo) (level === 'info' ? console.log : console.error)(line);
    if (!file) return;
    try {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* new file */ }
      if (size > MAX_BYTES) fs.renameSync(file, path.join(dir, 'agent.1.log'));
      fs.appendFileSync(file, `${line}\n`, 'utf8');
    } catch { /* logging must never break the agent */ }
  }

  const forWho = who => ({
    info: (m, d) => write('info', who, m, d),
    warn: (m, d) => write('warn', who, m, d),
    error: (m, d) => write('error', who, m, d)
  });

  return {
    file,
    /** Add a value that must never appear in the log (the token, a connector's env values). */
    addSecret(s) { if (typeof s === 'string' && s.length >= 4) redactions.add(s); },
    redact,
    for: forWho,
    ...forWho('agent')
  };
}
