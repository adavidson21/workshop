// `workshop secret`: saves and removes secrets in the operating system's own store (docs/security.md, Secrets).
// Runs in the workshop command, in front of the person, never in the agent (which only reads,
// agent/lib/secrets.mjs). The value never goes on a command line, in shell history, in a file Workshop writes
// or in a log:
//
//   macOS    `security -i` with the add command on stdin, the value hex-encoded (-X)
//   Windows  powershell.exe with CredWrite, the value on stdin
//   Linux    secret-tool store, the value on stdin
//
// <home>/secrets.json records the name, when it was saved, its expiry and a note. Never the value.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SECRET_NAME, SERVICE, indexFile, readIndex, readSecret, storeName } from '../../agent/lib/secrets.mjs';

const runWithInput = (cmd, args, input, env = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 30000, input, env: { ...process.env, ...env } });

/** Plain-words problem with a pasted secret, or null. Never repeats the value. */
export function secretProblem(value) {
  const v = String(value ?? '');
  if (!v) return 'Nothing was entered.';
  if (/\s/.test(v)) return 'It has spaces or line breaks in it. Copy only the token.';
  if (!/^[\x21-\x7e]+$/.test(v)) return 'It has characters a token never has. Copy only the token.';
  if (v.length < 16) return `That is ${v.length} characters; a token is longer. Copy the whole token.`;
  if (v.length > 1000) return 'That is too long to be a token.';
  return null;
}

// Windows: write and delete one generic credential (CRED_TYPE_GENERIC, kept on this computer only).
const WIN_TYPE = [
  "Add-Type -TypeDefinition @'",
  'using System; using System.Runtime.InteropServices;',
  'public static class WorkshopCredWrite {',
  '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
  '  struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;',
  '    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;',
  '    public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }',
  '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWrite(ref CREDENTIAL cred, UInt32 flags);',
  '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDelete(string target, UInt32 type, UInt32 flags);',
  '  public static bool Write(string target, string secret) {',
  '    byte[] b = System.Text.Encoding.Unicode.GetBytes(secret);',
  '    CREDENTIAL c = new CREDENTIAL(); c.Type = 1; c.TargetName = target; c.UserName = "workshop"; c.Comment = "Saved by workshop secret";',
  '    c.Persist = 2; c.CredentialBlobSize = (UInt32)b.Length; c.CredentialBlob = Marshal.AllocHGlobal(b.Length);',
  '    try { Marshal.Copy(b, 0, c.CredentialBlob, b.Length); return CredWrite(ref c, 0); }',
  '    finally { Marshal.FreeHGlobal(c.CredentialBlob); }',
  '  }',
  '  public static bool Delete(string target) { return CredDelete(target, 1, 0); }',
  '}',
  "'@"
].join('\n');
const WIN_SAVE = `$ErrorActionPreference = 'Stop'\n${WIN_TYPE}\n$v = [Console]::In.ReadToEnd().Trim()\nif (-not $v) { exit 3 }\nif (-not [WorkshopCredWrite]::Write($env:WORKSHOP_SECRET_TARGET, $v)) { exit 4 }`;
const WIN_REMOVE = `$ErrorActionPreference = 'Stop'\n${WIN_TYPE}\nif (-not [WorkshopCredWrite]::Delete($env:WORKSHOP_SECRET_TARGET)) { exit 2 }`;
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

/** The program that saves a value, with what goes on its stdin: {cmd, args, input, env}. Exported for tests. */
export function saveCommand(name, value, platform = process.platform) {
  if (!SECRET_NAME.test(String(name))) throw new Error(`"${name}" is not a valid secret name.`);
  if (platform === 'darwin') {
    const hex = Buffer.from(String(value), 'utf8').toString('hex');
    // -U updates an existing item. The whole command is read from stdin, so the value is never an argument.
    return { cmd: 'security', args: ['-i'], input: `add-generic-password -U -s ${SERVICE} -a ${name} -l Workshop-${name} -X ${hex}\n`, env: {} };
  }
  if (platform === 'win32') return { cmd: 'powershell.exe', args: [...PS, WIN_SAVE], input: `${value}\n`, env: { WORKSHOP_SECRET_TARGET: `${SERVICE}:${name}` } };
  if (platform === 'linux') return { cmd: 'secret-tool', args: ['store', '--label', `Workshop: ${name}`, 'service', SERVICE, 'account', name], input: String(value), env: {} };
  return null;
}

/** The program that removes a value: {cmd, args, input, env}. Exported for tests. */
export function removeCommand(name, platform = process.platform) {
  if (!SECRET_NAME.test(String(name))) throw new Error(`"${name}" is not a valid secret name.`);
  if (platform === 'darwin') return { cmd: 'security', args: ['delete-generic-password', '-s', SERVICE, '-a', name], input: '', env: {} };
  if (platform === 'win32') return { cmd: 'powershell.exe', args: [...PS, WIN_REMOVE], input: '', env: { WORKSHOP_SECRET_TARGET: `${SERVICE}:${name}` } };
  if (platform === 'linux') return { cmd: 'secret-tool', args: ['clear', 'service', SERVICE, 'account', name], input: '', env: {} };
  return null;
}

/** Writes <home>/secrets.json with one entry changed (null removes it). Atomic, readable by this user only. */
export function writeIndexEntry(home, name, entry) {
  const all = readIndex(home);
  if (entry === null) delete all[name]; else all[name] = entry;
  const file = indexFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, note: 'Names and dates only. The values are in your operating system\'s secret store.', secrets: all }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Saves a value. Returns {ok, message}. Checks it can be read back (and that it matches) before recording it,
 * so secrets.json never lists a secret the store does not have.
 */
export async function saveSecret(home, name, value, { platform = process.platform, exec = runWithInput, read = readSecret, expires = null, note = '', now = () => new Date() } = {}) {
  const c = saveCommand(name, value, platform);
  if (!c) return { ok: false, message: `Workshop has no secret store on ${platform}.` };
  const r = exec(c.cmd, c.args, c.input, c.env);
  if (r?.error) return { ok: false, message: `Could not run ${c.cmd}. ${platform === 'linux' ? 'Install it with your package manager (libsecret-tools on Debian and Ubuntu).' : ''}`.trim() };
  if (r?.status !== 0) return { ok: false, message: `${storeName(platform)} did not save it (exit code ${r?.status}).` };
  const back = await read(name, { platform });
  if (back !== value) return { ok: false, message: `${storeName(platform)} did not keep it. Nothing was recorded.` };
  writeIndexEntry(home, name, { store: storeName(platform), saved: now().toISOString(), expires: expires || null, note: String(note || '').slice(0, 200) });
  return { ok: true, message: '' };
}

/** Removes a value and its entry. Returns {ok, message}. A value that was already gone still clears the entry. */
export function removeSecret(home, name, { platform = process.platform, exec = runWithInput } = {}) {
  const c = removeCommand(name, platform);
  if (!c) return { ok: false, message: `Workshop has no secret store on ${platform}.` };
  const r = exec(c.cmd, c.args, c.input, c.env);
  if (r?.error) return { ok: false, message: `Could not run ${c.cmd}.` };
  writeIndexEntry(home, name, null);
  return { ok: true, message: r?.status === 0 ? '' : 'It was not in the store; removed it from the list.' };
}
