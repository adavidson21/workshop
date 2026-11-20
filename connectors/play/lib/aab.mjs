// What is inside an Android App Bundle (.aab) on this computer, without any Android tools: its package name,
// version code and version name, read from base/manifest/AndroidManifest.xml (aapt2's protobuf XML), plus its size
// and SHA-256. Node standard library only. Reads the zip's central directory and one entry, never the whole file.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const MANIFEST = 'base/manifest/AndroidManifest.xml';
const MAX_MANIFEST = 2 * 1024 * 1024;

/** A problem reading a bundle, in plain words. */
export class BundleError extends Error {
  constructor(message) { super(message); this.name = 'BundleError'; this.status = 400; this.code = 'bad_request'; }
}

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (!n) break;
    got += n;
  }
  return got === len ? b : b.subarray(0, got);
}

/** One entry's bytes from a zip file, or null when it is not there. Stored and deflated entries only. */
export function zipEntry(file, name) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) throw new BundleError('This is not an app bundle: the file is too small to be a zip.');
    const tailLen = Math.min(size, 22 + 65535);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new BundleError('This is not an app bundle: no zip directory found.');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new BundleError('This bundle uses large-zip (Zip64) records, which Workshop cannot read yet.');
    if (cdOffset + cdSize > size) throw new BundleError('This is not an app bundle: its zip directory is cut off.');
    const cd = readAt(fd, cdOffset, cdSize);
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i += 1) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new BundleError('This is not an app bundle: its zip directory is damaged.');
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const rawSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const entry = cd.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (entry !== name) continue;
      if (rawSize > MAX_MANIFEST || compSize > MAX_MANIFEST) throw new BundleError(`${name} in this bundle is too large to be a manifest.`);
      const head = readAt(fd, local, 30);
      if (head.length < 30 || head.readUInt32LE(0) !== 0x04034b50) throw new BundleError('This is not an app bundle: a zip entry is damaged.');
      const data = readAt(fd, local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28), compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_MANIFEST });
      throw new BundleError(`${name} is compressed in a way Workshop cannot read (method ${method}).`);
    }
    return null;
  } finally { fs.closeSync(fd); }
}

// ---- protobuf, just enough to read aapt2's XmlNode (frameworks/base/tools/aapt2/Resources.proto)

function varint(buf, pos) {
  let v = 0n, shift = 0n, b;
  do {
    if (pos >= buf.length) throw new BundleError('The bundle\'s manifest is damaged.');
    b = buf[pos++];
    v |= BigInt(b & 0x7f) << shift;
    shift += 7n;
  } while (b & 0x80 && shift < 70n);
  return [v, pos];
}

/** The fields of one message: [{n, type, v}] where v is a Buffer (length-delimited) or a BigInt (varint). */
export function fields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = varint(buf, pos);
    const n = Number(key >> 3n), type = Number(key & 7n);
    if (type === 0) { let v; [v, pos] = varint(buf, pos); out.push({ n, type, v }); }
    else if (type === 2) {
      let len; [len, pos] = varint(buf, pos);
      const end = pos + Number(len);
      if (end > buf.length) throw new BundleError('The bundle\'s manifest is damaged.');
      out.push({ n, type, v: buf.subarray(pos, end) });
      pos = end;
    } else if (type === 1) pos += 8;
    else if (type === 5) pos += 4;
    else throw new BundleError('The bundle\'s manifest is not in the format Workshop expects.');
  }
  return out;
}

const str = f => (f ? f.v.toString('utf8') : '');
const first = (fs_, n) => fs_.find(f => f.n === n && f.type === 2);

/** An attribute's value: its text when aapt2 kept it, else a compiled whole number or string. */
function attrValue(attr) {
  const text = str(first(attr, 3));
  if (text) return text;
  const item = first(attr, 6);
  if (!item) return '';
  const itemFields = fields(item.v);
  const prim = first(itemFields, 7);
  if (prim) {
    const p = fields(prim.v).find(f => f.type === 0 && (f.n === 6 || f.n === 7));
    if (p) return String(BigInt.asIntN(32, p.v));
  }
  for (const n of [2, 3]) { const s = first(itemFields, n); if (s) return str(first(fields(s.v), 1)); }
  return '';
}

/** {packageName, versionCode, versionName} from aapt2's protobuf AndroidManifest.xml. */
export function readManifest(buf) {
  const root = first(fields(buf), 1);
  if (!root) throw new BundleError('The bundle\'s manifest has no root element.');
  const el = fields(root.v);
  if (str(first(el, 3)) !== 'manifest') throw new BundleError('The bundle\'s manifest does not start with <manifest>.');
  const out = { packageName: null, versionCode: null, versionName: null };
  for (const a of el.filter(f => f.n === 4 && f.type === 2)) {
    const attr = fields(a.v);
    const name = str(first(attr, 2));
    if (name === 'package') out.packageName = attrValue(attr) || null;
    else if (name === 'versionCode') { const v = Number(attrValue(attr)); out.versionCode = Number.isSafeInteger(v) && v > 0 ? v : null; }
    else if (name === 'versionName') out.versionName = attrValue(attr) || null;
  }
  return out;
}

/** The file's SHA-256, read in pieces. */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * What a bundle on disk is: {size, modified, sha256, packageName, versionCode, versionName}. The manifest fields are
 * null with `problem` set when they cannot be read; size and SHA-256 are always there for a readable file.
 */
export async function inspectBundle(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new BundleError(`${file} is not a file.`);
  const out = { size: st.size, modified: new Date(st.mtimeMs).toISOString(), sha256: await sha256File(file), packageName: null, versionCode: null, versionName: null };
  try {
    const m = zipEntry(file, MANIFEST);
    if (!m) return { ...out, problem: `No ${MANIFEST} in it: this does not look like an app bundle.` };
    return { ...out, ...readManifest(m) };
  } catch (e) {
    return { ...out, problem: e instanceof BundleError ? e.message : 'Could not read the bundle\'s manifest.' };
  }
}
