// Secrets kept in the operating system's own store (docs/security.md, Secrets), read for connectors through
// ctx.secret (docs/connector.md).
//
// The agent only ever reads. Saving and removing a secret is the workshop command's job (`workshop secret`,
// scripts/lib/secrets-store.mjs), run by a person in a terminal. Each read runs one fixed program with the
// secret's name as its own argument (or, on Windows, in an environment variable), never through a shell:
//
//   macOS    security find-generic-password -s workshop -a <name> -w        (the login Keychain)
//   Windows  powershell.exe reading Credential Manager target workshop:<name> with CredRead
//   Linux    secret-tool lookup service workshop account <name>             (the Secret Service)
//
// Values are never logged, printed, stored or returned to a page. Names, dates and which store is used live in
// <home>/secrets.json (no values), so Settings can say whether a secret is saved without reading it.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

/** A secret's name: lowercase letters, digits and dashes, like a connector id. */
export const SECRET_NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** The service (macOS, Linux) and target prefix (Windows) every Workshop secret is filed under. */
export const SERVICE = 'workshop';

/** The store's name in plain words, or null where Workshop has none. */
export function storeName(platform = process.platform) {
  if (platform === 'darwin') return 'macOS Keychain';
  if (platform === 'win32') return 'Windows Credential Manager';
  if (platform === 'linux') return 'Secret Service (secret-tool)';
  return null;
}

// Windows: read one generic credential. Only CredRead and CredFree, so this file can never change the store.
// The target comes from the WORKSHOP_SECRET_TARGET environment variable, never from the script text.
export const WIN_READ = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System; using System.Runtime.InteropServices;',
  'public static class WorkshopCredRead {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '  struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;',
  '    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;',
  '    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }',
  '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr cred);',
  '  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);',
  '  public static string Read(string target) {',
  '    IntPtr p; if (!CredRead(target, 1, 0, out p)) return null;',
  '    try { CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));',
  '      if (c.CredentialBlobSize == 0) return ""; return Marshal.PtrToStringUni(c.CredentialBlob, (int)(c.CredentialBlobSize / 2)); }',
  '    finally { CredFree(p); }',
  '  }',
  '}',
  "'@",
  '$v = [WorkshopCredRead]::Read($env:WORKSHOP_SECRET_TARGET)',
  'if ($null -eq $v) { exit 2 }',
  '[Console]::Out.Write($v)'
].join('\n');

/** The one program a read runs: {cmd, args, env}. `env` holds only extra variables. Throws for a bad name. */
export function readCommand(name, platform = process.platform) {
  if (!SECRET_NAME.test(String(name))) throw new Error(`"${name}" is not a valid secret name.`);
  if (platform === 'darwin') return { cmd: 'security', args: ['find-generic-password', '-s', SERVICE, '-a', name, '-w'], env: {} };
  if (platform === 'win32') return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_READ], env: { WORKSHOP_SECRET_TARGET: `${SERVICE}:${name}` } };
  if (platform === 'linux') return { cmd: 'secret-tool', args: ['lookup', 'service', SERVICE, 'account', name], env: {} };
  return null;
}

const run = (cmd, args, env) => new Promise(resolve => {
  execFile(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 64 * 1024, env: { ...process.env, ...env } },
    (err, stdout) => resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: typeof stdout === 'string' ? stdout : '' }));
});

/** The secret's value, or undefined when it is not saved (or the store cannot be reached). */
export async function readSecret(name, { platform = process.platform, exec: launch = run } = {}) {
  const c = readCommand(name, platform);
  if (!c) return undefined;
  let r;
  try { r = await launch(c.cmd, c.args, c.env); } catch { return undefined; }
  if (!r || r.status !== 0 || typeof r.stdout !== 'string') return undefined;
  // security prints one trailing newline; secret-tool and the Windows script print none.
  const v = r.stdout.replace(/\r?\n$/, '');
  return v === '' ? undefined : v;
}

/**
 * A reader for the connector host: name => Promise<value | undefined>, cached for `ttlMs` so a connector that
 * calls ctx.secret on every request does not start a program each time. `forget(name)` drops one cached value.
 */
export function secretReader({ platform = process.platform, exec = run, ttlMs = 60000, now = Date.now } = {}) {
  const cache = new Map();
  const read = async name => {
    const hit = cache.get(name);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = await readSecret(name, { platform, exec });
    cache.set(name, { value, at: now() });
    return value;
  };
  read.forget = name => { if (name === undefined) cache.clear(); else cache.delete(name); };
  return read;
}

// ------------------------------------------------------------------------------- <home>/secrets.json (no values)

/** Where the list of saved secrets is kept: names and dates, never values. */
export const indexFile = home => path.join(home, 'secrets.json');

/** {name: {store, saved, expires, note}} from <home>/secrets.json, or {} when there is none or it is unreadable. */
export function readIndex(home) {
  try {
    const j = JSON.parse(fs.readFileSync(indexFile(home), 'utf8'));
    const out = {};
    if (j && j.secrets && typeof j.secrets === 'object') {
      for (const [n, s] of Object.entries(j.secrets)) {
        if (!SECRET_NAME.test(n) || !s || typeof s !== 'object') continue;
        out[n] = {
          store: typeof s.store === 'string' ? s.store : null,
          saved: typeof s.saved === 'string' ? s.saved : null,
          expires: typeof s.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.expires) ? s.expires : null,
          note: typeof s.note === 'string' ? s.note.slice(0, 200) : ''
        };
      }
    }
    return out;
  } catch { return {}; }
}

/** Days from `today` (YYYY-MM-DD) to `expires`, or null. Negative once it has passed. */
export function daysLeft(expires, today) {
  if (!expires) return null;
  const a = Date.parse(`${today}T00:00:00Z`), b = Date.parse(`${expires}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
}

/** What Settings shows for one name: {set, expires, daysLeft, store}. Never the value. */
export function secretStatus(index, name, today = new Date().toISOString().slice(0, 10)) {
  const s = index[name];
  return { set: !!s, store: s ? s.store : null, expires: s ? s.expires : null, daysLeft: s ? daysLeft(s.expires, today) : null };
}
