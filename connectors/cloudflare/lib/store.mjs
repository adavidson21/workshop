// Where change sets wait and what was done, in the data folder (README.md, Data):
//
//   <dataDir>/cloudflare/changes/<id>.json   one change set: what was asked, why, its steps, and what happened
//   <dataDir>/cloudflare/log.md              every change Workshop made on Cloudflare, newest last, plain words
//
// Plain files a person can read without Workshop. Written atomically, readable by this user only. Nothing here
// is ever deleted by Workshop.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ID = /^cf-\d{8}-[0-9a-f]{6}$/;
export const STATUSES = ['waiting', 'applied', 'failed', 'rejected'];

export function folder(dataDir) {
  if (!dataDir) throw Object.assign(new Error('Workshop has no data folder, so change sets cannot be kept.'), { status: 503, code: 'unavailable' });
  return path.join(dataDir, 'cloudflare');
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function newId(now = new Date()) {
  return `cf-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
}

export function save(dataDir, set) {
  if (!ID.test(set.id)) throw new Error('Bad change set id.');
  writeAtomic(path.join(folder(dataDir), 'changes', `${set.id}.json`), JSON.stringify(set, null, 2) + '\n');
  return set;
}

/** One change set, or null. */
export function load(dataDir, id) {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(folder(dataDir), 'changes', `${id}.json`), 'utf8')); }
  catch { return null; }
}

/** Every change set, newest first. Unreadable files are skipped. */
export function list(dataDir) {
  let names = [];
  try { names = fs.readdirSync(path.join(folder(dataDir), 'changes')).filter(n => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) { const s = load(dataDir, n.slice(0, -5)); if (s && STATUSES.includes(s.status)) out.push(s); }
  return out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

/** Adds what happened to log.md: one heading per set, one line per step. */
export function appendLog(dataDir, set) {
  const file = path.join(folder(dataDir), 'log.md');
  const head = fs.existsSync(file) ? '' : '# Cloudflare changes\n\nEvery change Workshop made on Cloudflare, newest last. Written by the Cloudflare connector.\n';
  const lines = [`\n## ${String(set.decided || '').slice(0, 16).replace('T', ' ')} ${set.title} (${set.status})\n`, `Change set ${set.id}${set.item ? `, for ${set.item}` : ''}.${set.why ? ` ${set.why}` : ''}\n`];
  for (const r of set.results || []) lines.push(`- ${r.ok ? 'Done' : r.skipped ? 'Skipped' : 'Failed'}: ${r.summary}${r.error ? `. ${r.error}` : ''}`);
  if (set.status === 'rejected') lines.push(`- Rejected${set.note ? `: ${set.note}` : ''}. Nothing was changed.`);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, head + lines.join('\n') + '\n', { mode: 0o600 });
}

/**
 * A fingerprint of a set's changes. Settings shows the steps worked out from these changes and sends this back with
 * Apply; if the file changed in between (by anything), Apply refuses, so what runs is exactly what you read.
 */
export const digest = changes => crypto.createHash('sha256').update(JSON.stringify(changes ?? null)).digest('hex');

/** What a list shows: no change details, just enough to pick one. */
export const brief = s => ({ id: s.id, title: s.title, status: s.status, item: s.item || null, from: s.from, created: s.created, decided: s.decided || null, steps: (s.steps || []).length });
