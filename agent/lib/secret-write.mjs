// Saving and removing a secret in the operating system's own store (docs/security.md, Secrets). Two callers:
// Settings, Tokens & sign-ins (POST and DELETE /api/secrets, from Workshop on this computer only), and
// `workshop secret` in a terminal (scripts/lib/secrets-store.mjs re-exports this). Write only: nothing here hands a
// value back to a caller. The check after saving reads it back to compare, and returns only whether it matched.
//
// The value never goes on a command line, in a file Workshop writes or in a log. One fixed program per computer,
// never through a shell, the value on stdin:
//
//   macOS    `security -i` with the add command on stdin, the value hex-encoded (-X); delete-generic-password
//   Windows  powershell.exe with CredWrite (the value on stdin) or CredDelete
//   Linux    secret-tool store (the value on stdin) or secret-tool clear
//
// <home>/secrets.json records the name, when it was saved, its expiry and a note. Never the value.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { SECRET_NAME, SERVICE, indexFile, readIndex, readSecret, storeName } from './secrets.mjs';

/** Runs one program with `input` on stdin: Promise<{status, error?}>. Output is never read or kept. */
const runWithInput = (cmd, args, input, env = {}) => new Promise(resolve => {
  let child;
  try { child = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, ...env } }); }
  catch (error) { resolve({ status: null, error }); return; }
  const timer = setTimeout(() => child.kill(), 30000);
  child.on('error', error => { clearTimeout(timer); resolve({ status: null, error }); });
  child.on('close', status => { clearTimeout(timer); resolve({ status }); });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
});

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

/** Whether a value typed where a secret's name goes is the token itself (so it can be moved into the store). */
export const looksLikeToken = value => typeof value === 'string' && !SECRET_NAME.test(value) && secretProblem(value) === null;

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
  '    CREDENTIAL c = new CREDENTIAL(); c.Type = 1; c.TargetName = target; c.UserName = "workshop"; c.Comment = "Saved by Workshop";',
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
 * so secrets.json never lists a secret the store does not have. `exec` may return a result or a promise of one.
 */
export async function saveSecret(home, name, value, { platform = process.platform, exec = runWithInput, read = readSecret, expires = null, note = '', now = () => new Date() } = {}) {
  const c = saveCommand(name, value, platform);
  if (!c) return { ok: false, message: `Workshop has no secret store on ${platform}.` };
  let r;
  try { r = await exec(c.cmd, c.args, c.input, c.env); } catch (error) { r = { error }; }
  if (r?.error) return { ok: false, message: `Could not run ${c.cmd}. ${platform === 'linux' ? 'Install it with your package manager (libsecret-tools on Debian and Ubuntu).' : ''}`.trim() };
  if (r?.status !== 0) return { ok: false, message: `${storeName(platform)} did not save it (exit code ${r?.status}).` };
  const back = await read(name, { platform });
  if (back !== value) return { ok: false, message: `${storeName(platform)} did not keep it. Nothing was recorded.` };
  writeIndexEntry(home, name, { store: storeName(platform), saved: now().toISOString(), expires: expires || null, note: String(note || '').slice(0, 200) });
  return { ok: true, message: '' };
}

/** Removes a value and its entry. Returns {ok, message}. A value that was already gone still clears the entry. */
export async function removeSecret(home, name, { platform = process.platform, exec = runWithInput } = {}) {
  const c = removeCommand(name, platform);
  if (!c) return { ok: false, message: `Workshop has no secret store on ${platform}.` };
  let r;
  try { r = await exec(c.cmd, c.args, c.input, c.env); } catch (error) { r = { error }; }
  if (r?.error) return { ok: false, message: `Could not run ${c.cmd}.` };
  writeIndexEntry(home, name, null);
  return { ok: true, message: r?.status === 0 ? '' : 'It was not in the store; removed it from the list.' };
}

// A Google service account key file, cut down to the stored form the Google Play connector reads
// (connectors/play/lib/key.mjs, compactKey: gsa1.<email>.<PKCS#8 DER>, base64url). Kept in step by
// agent/test/secret-write.test.mjs, which compares the two.
const KEY_PREFIX = 'gsa1';
const KEY_EMAIL = /^[a-z0-9][a-z0-9._-]{0,99}@[a-z0-9][a-z0-9.-]{0,199}\.[a-z]{2,}$/i;
const b64u = buf => Buffer.from(buf).toString('base64url');

/** {value, email} from a key file's text. Throws plain words; never includes any part of the key. */
export function compactKeyFile(fileText) {
  let j;
  try { j = JSON.parse(String(fileText).replace(/^\uFEFF/, '')); } catch { throw new Error('That file is not JSON. Use the key file Google Cloud downloaded (Service accounts, Keys, Add key, JSON).'); }
  if (!j || typeof j !== 'object') throw new Error('That file is not a service account key.');
  if (j.type !== 'service_account') throw new Error(`That file is not a service account key (its type is "${String(j.type || 'missing').slice(0, 40)}").`);
  const email = String(j.client_email || '');
  if (!KEY_EMAIL.test(email)) throw new Error('The key file has no service account email (client_email).');
  let der;
  try { der = crypto.createPrivateKey({ key: String(j.private_key || ''), format: 'pem' }).export({ type: 'pkcs8', format: 'der' }); }
  catch { throw new Error('The key file\'s private key cannot be read. Download a new JSON key.'); }
  return { value: `${KEY_PREFIX}.${b64u(email)}.${b64u(der)}`, email };
}

/** Plain-words problem with a typed password (an Android keystore needs 6 characters or more), or null. */
export function passwordProblem(value) {
  const v = String(value ?? '');
  if (!v) return 'Nothing was entered.';
  if (v.length < 6) return 'That is shorter than 6 characters; an Android keystore password is at least 6.';
  if (v.length > 1000) return 'That is too long.';
  if (/[\x00-\x1f\x7f]/.test(v)) return 'It has a control character in it.';
  return null;
}
