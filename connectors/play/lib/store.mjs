// Where release sets wait and what was done, in the data folder (README.md, Data):
//
//   <dataDir>/play/releases/<id>.json   one release set: what was asked, why, its steps, and what happened
//   <dataDir>/play/log.md               every change Workshop made on Google Play, newest last, plain words
//
// Plain files a person can read without Workshop. Written atomically, readable by this user only. Nothing here
// is ever deleted by Workshop.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ID = /^gp-\d{8}-[0-9a-f]{6}$/;
export const STATUSES = ['waiting', 'applied', 'failed', 'rejected'];

export function folder(dataDir) {
  if (!dataDir) throw Object.assign(new Error('Workshop has no data folder, so release sets cannot be kept.'), { status: 503, code: 'unavailable' });
  return path.join(dataDir, 'play');
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function newId(now = new Date()) {
  return `gp-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
}

export function save(dataDir, set) {
  if (!ID.test(set.id)) throw new Error('Bad release set id.');
  writeAtomic(path.join(folder(dataDir), 'releases', `${set.id}.json`), JSON.stringify(set, null, 2) + '\n');
  return set;
}

/** One release set, or null. */
export function load(dataDir, id) {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(folder(dataDir), 'releases', `${id}.json`), 'utf8')); }
  catch { return null; }
}

/** Every release set, newest first. Unreadable files are skipped. */
export function list(dataDir) {
  let names = [];
  try { names = fs.readdirSync(path.join(folder(dataDir), 'releases')).filter(n => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) { const s = load(dataDir, n.slice(0, -5)); if (s && STATUSES.includes(s.status)) out.push(s); }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

/** Adds what happened to log.md: one heading per set, one line per step. */
export function appendLog(dataDir, set) {
  const file = path.join(folder(dataDir), 'log.md');
  const head = fs.existsSync(file) ? '' : '# Google Play releases\n\nEvery change Workshop made on Google Play, newest last. Written by the Google Play connector.\n';
  const lines = [`\n## ${String(set.decided || '').slice(0, 16).replace('T', ' ')} ${set.title} (${set.status})\n`, `Release set ${set.id} for ${set.app}${set.item ? `, for ${set.item}` : ''}.${set.why ? ` ${set.why}` : ''}\n`];
  for (const r of set.results || []) lines.push(`- ${r.ok ? 'Done' : r.skipped ? 'Not done' : 'Failed'}: ${r.summary}${r.error ? `. ${r.error}` : ''}${r.note ? ` ${r.note}` : ''}`);
  if (set.status === 'rejected') lines.push(`- Rejected${set.note ? `: ${set.note}` : ''}. Nothing was changed.`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, head + lines.join('\n') + '\n', { mode: 0o600 });
}

/**
 * A fingerprint of a set's app and changes (an upload's changes include the bundle's SHA-256). Approve sends this
 * back; if the file changed in between (by anything), Apply refuses, so what runs is exactly what you read.
 */
export const digest = set => crypto.createHash('sha256').update(JSON.stringify({ app: set.app ?? null, changes: set.changes ?? null })).digest('hex');

/** What a list shows: no change details, just enough to pick one. */
export const brief = s => ({ id: s.id, title: s.title, app: s.app, status: s.status, item: s.item || null, from: s.from, created: s.created, decided: s.decided || null, steps: (s.steps || []).length });
