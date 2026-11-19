// Start over (docs/agent-api.md, Reset; docs/data-format.md, Starting over): delete some or all apps' data after
// saving it to a zip beside the data folder. The one place Workshop deletes content, and only after:
//   - the person picked the apps and typed a phrase that names what goes (expectedPhrase),
//   - a ticket from GET /api/reset at least RESET_WAIT_MS old (so the button waits, and a script cannot rush it),
//   - a zip of everything that goes, written and read back (verifyZip) before anything is deleted.
// Node standard library only: the zip is written here (no Zip64, so under 4 GB and 65,535 files).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const RESET_WAIT_MS = 10_000;
export const TICKET_MS = 15 * 60_000;
const MAX_ZIP = 0xFFFFFFFF;
const MAX_ENTRIES = 0xFFFF;

/** What the person types. Everything: "delete everything". Some apps: "delete 2 apps". Only Tandem: "delete work items". */
export function expectedPhrase({ everything, count, tandem }) {
  if (everything) return 'delete everything';
  if (count > 0) return `delete ${count} app${count === 1 ? '' : 's'}`;
  return tandem ? 'delete work items' : null;
}

/** One ticket at a time, from GET /api/reset. Usable once, RESET_WAIT_MS after it was made, for TICKET_MS. */
export class ResetTickets {
  #ticket = null; #at = 0; #now; #wait;
  /** `waitMs` is for tests only; Workshop always waits RESET_WAIT_MS. */
  constructor({ now = () => Date.now(), waitMs = RESET_WAIT_MS } = {}) { this.#now = now; this.#wait = waitMs; }
  issue() { this.#ticket = crypto.randomBytes(16).toString('hex'); this.#at = this.#now(); return { ticket: this.#ticket, waitMs: this.#wait }; }
  /** null when it may be used (and uses it up), else why not. */
  take(t) {
    if (!this.#ticket || typeof t !== 'string' || t.length !== this.#ticket.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(this.#ticket))) return 'Open Start over again: this confirmation is no longer valid.';
    const age = this.#now() - this.#at;
    if (age > TICKET_MS) { this.#ticket = null; return 'This confirmation expired. Open Start over again.'; }
    if (age < this.#wait) return `Wait ${Math.ceil((this.#wait - age) / 1000)} more seconds, then confirm again.`;
    this.#ticket = null;
    return null;
  }
}

const inside = (root, p) => { const r = path.relative(root, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
const exists = p => { try { fs.lstatSync(p); return true; } catch { return false; } };

/**
 * The paths that go, each a file or folder inside the data folder, with the name it gets in the zip. `apps`: [{id, name, folder}] picked; `everything`: every app, plus the trash, backups,
 * working files and readable copy as a whole. Missing paths are left out.
 */
export function resetTargets({ dataDir, apps, everything = false }) {
  const out = [];
  const add = (abs, zipName) => { if (exists(abs) && !out.some(t => t.abs === abs)) out.push({ abs, zip: zipName }); };
  const whole = everything ? ['.trash', '.backups', '.scratch', 'Readable copy'] : [];
  for (const a of apps) {
    add(path.join(dataDir, a.folder), `Workshop data/${a.folder}`);
    if (a.id !== a.folder) add(path.join(dataDir, a.id), `Workshop data/${a.id}`); // still under its old name
    if (everything) continue;
    add(path.join(dataDir, '.trash', a.folder), `Workshop data/.trash/${a.folder}`);
    let days = [];
    try { days = fs.readdirSync(path.join(dataDir, '.backups'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { /* none */ }
    for (const d of days) add(path.join(dataDir, '.backups', d, a.folder), `Workshop data/.backups/${d}/${a.folder}`);
    if (a.name) add(path.join(dataDir, 'Readable copy', a.name), `Workshop data/Readable copy/${a.name}`);
  }
  for (const w of whole) add(path.join(dataDir, w), `Workshop data/${w}`);
  for (const t of out) if (!inside(dataDir, t.abs)) throw new Error(`${t.abs} is not inside the data folder.`);
  return out;
}

/** Every file under the targets, as {abs, name, size, mtime}. Links are not followed and not included. */
export function listFiles(targets) {
  const files = [];
  const walk = (abs, name) => {
    let st;
    try { st = fs.lstatSync(abs); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(abs); } catch { return; }
      for (const e of entries.sort()) walk(path.join(abs, e), `${name}/${e}`);
    } else if (st.isFile()) files.push({ abs, name, size: st.size, mtime: st.mtime });
  };
  for (const t of targets) walk(t.abs, t.zip);
  return files;
}

// CRC-32 (zlib.crc32 is Node 22.2 and later; Workshop runs on 22.0 too).
let TABLE = null;
export function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/**
 * Write a zip of `files` ([{name, abs?, data?, mtime?}]) to `zipPath`, private to this user (600). Written to a
 * .tmp file first and renamed into place, so a failure leaves no half zip under the real name.
 */
export function writeZip(zipPath, files) {
  if (files.length > MAX_ENTRIES) throw new Error(`Too many files for one zip (${files.length}).`);
  const tmp = `${zipPath}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  const central = [];
  let offset = 0;
  const write = buf => { fs.writeSync(fd, buf); offset += buf.length; if (offset > MAX_ZIP) throw new Error('The backup would be over 4 GB, too big for one zip.'); };
  try {
    for (const f of files) {
      const raw = f.data ?? fs.readFileSync(f.abs);
      const deflated = zlib.deflateRawSync(raw);
      const store = deflated.length >= raw.length;
      const body = store ? raw : deflated;
      const name = Buffer.from(f.name, 'utf8');
      const crc = crc32(raw);
      const { time, date } = dosTime(f.mtime || new Date());
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
      const at = offset;
      write(local); write(name); write(body);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(store ? 0 : 8, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24);
      c.writeUInt16LE(name.length, 28); c.writeUInt32LE(at, 42);
      central.push(Buffer.concat([c, name]));
    }
    const cdAt = offset;
    for (const c of central) write(c);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdAt, 12); end.writeUInt32LE(cdAt, 16);
    write(end);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, zipPath);
  return { bytes: offset, files: files.length };
}

/**
 * Read a zip back: every entry's data must inflate to its size and CRC. Returns [{name, size}].
 * Throws if anything does not match, so nothing is deleted on a bad backup.
 */
export function readZip(zipPath, { contents = false } = {}) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tail = Buffer.alloc(Math.min(size, 22 + 0xFFFF));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('The backup zip has no end record.');
    const count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdAt = tail.readUInt32LE(e + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdAt);
    const out = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('The backup zip has a damaged directory.');
      const method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), at = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nlen);
      p += 46 + nlen + xlen + clen;
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, at);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`The backup zip is damaged at ${name}.`);
      const body = Buffer.alloc(csize);
      fs.readSync(fd, body, 0, csize, at + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28));
      const raw = method === 8 ? zlib.inflateRawSync(body) : body;
      if (raw.length !== usize || crc32(raw) !== crc) throw new Error(`The backup zip does not match ${name}.`);
      out.push(contents ? { name, size: usize, data: raw } : { name, size: usize });
    }
    return out;
  } finally { fs.closeSync(fd); }
}

/** A name for the backup that is not taken: "<folder>/Workshop backup 2026-11-19 1600.zip", then " (2)" and so on. */
export function backupPath(dir, now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
  for (let i = 1; i < 1000; i++) {
    const p = path.join(dir, `Workshop backup ${stamp}${i === 1 ? '' : ` (${i})`}.zip`);
    if (!exists(p) && !exists(`${p}.tmp`)) return p;
  }
  throw new Error(`Too many backups named for ${stamp} in ${dir}.`);
}

/** The README.txt at the top of the zip: what is in it and how to put it back. */
export function readmeText({ dataDir, workspace, apps, everything, when = new Date() }) {
  return [
    `Workshop backup, made ${when.toString()} before Start over deleted it.`,
    '',
    `Apps: ${everything ? 'everything' : apps.length ? apps.map(a => a.name).join(', ') : 'none'}.`,
    `Data folder: ${dataDir}`,
    ...(workspace ? [`Tandem's work items came from: ${path.join(workspace, '.work')}`] : []),
    '',
    'To put it back:',
    '1. Stop Workshop (workshop stop).',
    '2. Copy the folders inside "Workshop data" into your data folder. Replace what is there.',
    ...(workspace ? ['3. Copy the .work folder inside "Tandem work items" into your workspace folder.', '4. Start Workshop (workshop up).'] : ['3. Start Workshop (workshop up).']),
    '',
    'Workshop never reads or deletes this file. Delete it when you no longer need it.',
    ''
  ].join('\r\n');
}

/** Delete the targets, deepest last. Returns the paths it could not delete, each with why. */
export function deleteTargets(targets) {
  const failed = [];
  for (const t of targets) {
    try { fs.rmSync(t.abs, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (e) { failed.push(`${t.abs}: ${e.code || e.message}`); }
  }
  return failed;
}
