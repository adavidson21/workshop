// Helpers for the workshop command (workshop pat, stop, restart): read a secret without echoing it, save it
// as a user environment variable on Windows, and stop or start the agent in the background. These run in the
// command, never in the agent. Node standard library only.
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ENV_NAME } from '../../agent/lib/userenv.mjs';

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 10000 });
const delay = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------------------------ secrets

/** Plain-words problem with a pasted token, or null. Never repeats the value. */
export function patProblem(value) {
  const v = String(value ?? '');
  if (!v) return 'Nothing was entered.';
  if (/\s/.test(v)) return 'The token has spaces or line breaks in it. Copy only the token.';
  if (!/^[\x21-\x7e]+$/.test(v)) return 'The token has characters a PAT never has. Copy only the token.';
  if (v.length < 20) return `That is ${v.length} characters; a PAT is longer. Copy the whole token.`;
  if (v.length > 400) return 'That is too long to be a PAT.';
  return null;
}

/**
 * Reads one line without showing it. In a terminal, keys are read raw and nothing is echoed; piped input
 * (tests, scripts) is read whole. Resolves with the trimmed text; rejects with code 'cancelled' on Ctrl+C.
 */
export function readSecret({ stdin = process.stdin, stdout = process.stdout, prompt = '' } = {}) {
  if (prompt) stdout.write(prompt);
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return new Promise((resolve, reject) => {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', d => { buf += d; });
      stdin.on('end', () => resolve(buf.trim()));
      stdin.on('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    let buf = '';
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    const done = (err, value) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };
    const onData = chunk => {
      // A terminal in bracketed paste mode wraps pasted text in these markers.
      const text = chunk.replace(/\x1b\[20[01]~/g, '');
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') { done(null, buf.trim()); return; }
        if (ch === '\u0003') { const e = new Error('Cancelled.'); e.code = 'cancelled'; done(e); return; }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        if (ch >= ' ') buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const runWithInput = (cmd, args, input) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, input });

/**
 * Saves (or, with value null, removes) a user environment variable on Windows, the way the Windows
 * settings dialog does: new terminals and programs see it, and Windows is told it changed. The value
 * goes on stdin. Returns {ok, message}.
 */
export function writeWindowsUserEnv(name, value, { exec = runWithInput, powershell = 'powershell.exe' } = {}) {
  if (!ENV_NAME.test(String(name))) return { ok: false, message: `"${name}" is not a valid environment variable name.` };
  const script = value === null
    ? `[Environment]::SetEnvironmentVariable('${name}', $null, 'User')`
    : `$v = [Console]::In.ReadToEnd().Trim(); if (-not $v) { exit 3 }; [Environment]::SetEnvironmentVariable('${name}', $v, 'User')`;
  const r = exec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], value === null ? '' : `${value}\n`);
  if (r?.error) return { ok: false, message: `Could not run ${powershell}.` };
  if (r?.status !== 0) return { ok: false, message: `Windows did not save ${name} (exit code ${r?.status}).` };
  return { ok: true, message: '' };
}

// ------------------------------------------------------------------------------------ stop and start

/** Process ids listening on 127.0.0.1:<port>, using the same tools as the installers. */
export function listenerPids(port, { platform = process.platform, exec = run } = {}) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return [];
  let r = platform === 'win32'
    ? exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`])
    : exec('lsof', ['-nP', '-ti', `tcp:${p}`, '-sTCP:LISTEN']);
  // Some Linux systems have no lsof; fuser prints the ids on stdout.
  if (platform === 'linux' && (!r || r.error)) r = exec('fuser', ['-n', 'tcp', String(p)]);
  if (!r || r.error || typeof r.stdout !== 'string') return [];
  return [...new Set(r.stdout.split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0 && n !== process.pid))];
}

async function waitFor(check, { timeoutMs, sleep, every = 250 }) {
  for (let waited = 0; waited <= timeoutMs; waited += every) {
    if (await check()) return true;
    await sleep(every);
  }
  return false;
}

/**
 * Stops the agent on `port`. Only acts when /api/health says the Workshop agent is there, then ends the
 * process that owns the port (as the installers do). Returns {ok, wasRunning, message}.
 */
export async function stopAgent({ port, probe, platform = process.platform, exec = run, kill = process.kill.bind(process), sleep = delay, timeoutMs = 8000 }) {
  if (!(await probe(port))) return { ok: true, wasRunning: false, message: `Workshop is not running on port ${port}.` };
  const pids = listenerPids(port, { platform, exec });
  if (!pids.length) {
    return { ok: false, wasRunning: true, message: `Workshop is running on port ${port}, but Workshop could not tell which process it is. Close its window, or sign out and back in.` };
  }
  for (const pid of pids) { try { kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  const gone = await waitFor(async () => !(await probe(port)), { timeoutMs, sleep });
  return gone
    ? { ok: true, wasRunning: true, message: 'Workshop stopped.' }
    : { ok: false, wasRunning: true, message: `Workshop is still running on port ${port}. Close its window, or sign out and back in.` };
}

/**
 * Starts the agent in the background (no window) and waits until it answers. Returns {ok, message}.
 * The new process gets `env`, so it sees variables saved in this terminal's environment.
 */
export async function startBackground({ repo, port, probe, execPath = process.execPath, env = process.env, spawnFn = spawn, sleep = delay, timeoutMs = 20000 }) {
  try {
    const child = spawnFn(execPath, [path.join(repo, 'agent', 'start.mjs'), '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true, env });
    child.on?.('error', () => {});
    child.unref?.();
  } catch {
    return { ok: false, message: 'Could not start Workshop. Run "workshop start" to see why.' };
  }
  const up = await waitFor(async () => Boolean(await probe(port)), { timeoutMs, sleep });
  return up
    ? { ok: true, message: `Workshop is running in the background on port ${port}. Stop it with "workshop stop".` }
    : { ok: false, message: 'Workshop did not start. Run "workshop start" to see why.' };
}
