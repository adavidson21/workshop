// Work mode's pinned copy (docs/run-modes.md, Work mode). `workshop pin` builds a frozen copy of the site
// (Workshop, its apps and optionally Docket) into <home>/ui/ with build.json, which lists every file and its
// SHA-256. With features.workMode on, the agent serves the hub and every app from that copy only: a file
// that is not listed is 404, and a file whose bytes no longer match build.json is refused (500), so nothing
// changed after the build ever reaches the browser. Code changes only when the user runs `workshop pin`
// again, normally after `workshop update --tag <tag>`.
//
// Pure file system work: no network, no child processes. Git details (tag, commit) are passed in by the
// `workshop` command.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fail } from './http.mjs';
import { SECURITY_HEADERS, contentType } from './static.mjs';

export const BUILD_FILE = 'build.json';
export const BUILD_FORMAT = 1;
// Workshop's files that make up the site (the same set `workshop publish` copies).
export const SITE_DIRS = ['shell', 'shared', 'icons', 'apps'];
export const SITE_FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];
// The app id Docket uses inside Workshop (apps/remote.json).
export const DOCKET_ID = 'prioritizer';
// Folders inside an app that are never part of the site.
const SKIP_DIRS = new Set(['test', 'node_modules']);
const REL = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/;

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** Where the pinned copy lives for a Workshop home. */
export const uiDirOf = home => path.join(home, 'ui');

/** A relative path inside the copy that is safe to serve: name segments only, no dot files, no "..". */
export function safeRel(rel) {
  if (typeof rel !== 'string' || !REL.test(rel)) return false;
  return rel.split('/').every(s => s !== '..' && s !== '.' && !s.startsWith('.'));
}

/** Read an .assetsignore (one name per line, # comments): top-level names that are not part of a site. */
export function readIgnore(dir) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, '.assetsignore'), 'utf8'); } catch { return new Set(); }
  return new Set(text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.replace(/^\/+|\/+$/g, '')));
}

/** Every file under dir as a relative path with "/" separators. Skips dot files, symbolic links and SKIP_DIRS. */
function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(dir, r, out); } else if (e.isFile()) out.push(r);
  }
  return out;
}

function copyInto(srcRoot, rel, outRoot, outRel, files) {
  if (!safeRel(outRel)) throw new Error(`${outRel} is not a name the pinned copy can serve. Rename it, then pin again.`);
  const buf = fs.readFileSync(path.join(srcRoot, rel));
  const dest = path.join(outRoot, ...outRel.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  files[outRel] = sha256(buf);
}

/**
 * Build the pinned copy into outDir (replaced). `repo` is Workshop's folder; `docketDir` (optional) is a
 * Docket checkout whose site files go to apps/prioritizer/. `registry` builds apps/registry.json from the
 * finished apps folder (workshop.mjs passes buildRegistry). `info` is recorded as is: {workshop: {version,
 * ref, commit}, docket: {ref, commit}}. Returns the build.json object.
 */
export function buildPinned({ repo, docketDir = null, outDir, registry, info = {}, now = new Date() }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const files = {};
  for (const name of SITE_FILES) {
    if (fs.existsSync(path.join(repo, name))) copyInto(repo, name, outDir, name, files);
  }
  for (const dir of SITE_DIRS) {
    if (!fs.statSync(path.join(repo, dir), { throwIfNoEntry: false })?.isDirectory()) continue;
    for (const rel of walk(repo, dir)) {
      // The registry is rebuilt below, and remote.json describes apps the Worker serves from other sites.
      if (rel === 'apps/registry.json' || rel === 'apps/remote.json') continue;
      // Docket's folder comes from the Docket checkout, never from a stray copy in this repo.
      if (rel.startsWith(`apps/${DOCKET_ID}/`)) continue;
      copyInto(repo, rel, outDir, rel, files);
    }
  }
  let docket = null;
  if (docketDir) {
    if (!fs.existsSync(path.join(docketDir, 'app.json'))) throw new Error(`${docketDir} is not a Docket checkout (no app.json).`);
    const ignore = readIgnore(docketDir);
    for (const rel of walk(docketDir)) {
      if (ignore.has(rel.split('/')[0])) continue;
      copyInto(docketDir, rel, outDir, `apps/${DOCKET_ID}/${rel}`, files);
    }
    docket = { ...(info.docket || {}) };
  }
  if (registry) {
    const buf = Buffer.from(`${JSON.stringify(registry(path.join(outDir, 'apps')), null, 2)}\n`);
    fs.mkdirSync(path.join(outDir, 'apps'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'apps', 'registry.json'), buf);
    files['apps/registry.json'] = sha256(buf);
  }
  const sorted = Object.fromEntries(Object.keys(files).sort().map(k => [k, files[k]]));
  const build = { format: BUILD_FORMAT, builtAt: now.toISOString(), workshop: { ...(info.workshop || {}) }, docket, files: sorted };
  fs.writeFileSync(path.join(outDir, BUILD_FILE), `${JSON.stringify(build, null, 2)}\n`);
  return build;
}

/**
 * Build next to the live copy, then swap it in: <ui>.next is built, the current copy moves to <ui>.previous
 * (kept for going back by hand), and <ui>.next becomes <ui>. A failed build leaves the live copy alone.
 */
export function pinInto(uiDir, opts) {
  const next = `${uiDir}.next`;
  const prev = `${uiDir}.previous`;
  let build;
  try { build = buildPinned({ ...opts, outDir: next }); } catch (e) { fs.rmSync(next, { recursive: true, force: true }); throw e; }
  fs.rmSync(prev, { recursive: true, force: true });
  if (fs.existsSync(uiDir)) fs.renameSync(uiDir, prev);
  fs.renameSync(next, uiDir);
  return build;
}

/**
 * Read build.json and check every file it lists. Returns {ok: true, build, files: Map(rel -> sha256)} or
 * {ok: false, problem, build?}. `problem` is plain words.
 */
export function verifyPinned(uiDir) {
  const file = path.join(uiDir, BUILD_FILE);
  let build;
  try { build = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, problem: 'There is no pinned copy yet. Run "workshop pin".' };
    return { ok: false, problem: `${file} could not be read (${e.code || e.message}). Run "workshop pin" again.` };
  }
  if (!build || build.format !== BUILD_FORMAT || !build.files || typeof build.files !== 'object') {
    return { ok: false, problem: `${file} is not a pinned copy this version of Workshop understands. Run "workshop pin" again.` };
  }
  const files = new Map();
  for (const [rel, hash] of Object.entries(build.files)) {
    if (!safeRel(rel) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, build, problem: `build.json lists ${rel}, which is not allowed. Run "workshop pin" again.` };
    let buf;
    try { buf = fs.readFileSync(path.join(uiDir, ...rel.split('/'))); } catch { return { ok: false, build, problem: `${rel} is missing from the pinned copy. Run "workshop pin" again.` }; }
    if (sha256(buf) !== hash) return { ok: false, build, problem: `${rel} changed after the pinned copy was built. Run "workshop pin" again.` };
    files.set(rel, hash);
  }
  if (!files.has('index.html')) return { ok: false, build, problem: 'The pinned copy has no index.html. Run "workshop pin" again.' };
  return { ok: true, build, files };
}

/** A one-line summary of a build for logs and `workshop doctor`. */
export function describeBuild(build) {
  if (!build) return 'no pinned copy';
  const w = build.workshop || {};
  const d = build.docket;
  const one = (name, x) => `${name} ${x.ref || x.version || 'unknown version'}${x.commit ? ` (${String(x.commit).slice(0, 12)})` : ''}`;
  return `${one('Workshop', w)}${d ? `, ${one('Docket', d)}` : ', no Docket'}, built ${build.builtAt}`;
}

/**
 * The pinned copy the agent serves. Checks every file when first used and again whenever build.json
 * changes (a `workshop pin` while the agent runs), and checks each file's bytes again as it serves them.
 */
export class PinnedSite {
  constructor(uiDir, log) {
    this.uiDir = uiDir;
    this.log = log;
    this.state = null;
    this.stamp = null;
  }

  /** {ok, build, files} or {ok: false, problem}, checked again if build.json changed. */
  current() {
    let st = null;
    try { st = fs.statSync(path.join(this.uiDir, BUILD_FILE)); } catch { /* no build */ }
    const stamp = st ? `${st.mtimeMs}:${st.size}:${st.ino}` : 'none';
    if (this.state && stamp === this.stamp) return this.state;
    this.stamp = stamp;
    this.state = verifyPinned(this.uiDir);
    if (this.state.ok) this.log?.info(`Work mode: serving the pinned copy, ${describeBuild(this.state.build)}; ${this.state.files.size} files checked.`);
    else this.log?.warn(`Work mode: ${this.state.problem}`);
    return this.state;
  }

  /** Serve one URL path from the copy. Throws not_found for anything build.json does not list. */
  serve(req, res, pathname) {
    const s = this.current();
    if (!s.ok) fail('not_found', 'Not found.');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { fail('not_found', 'Not found.'); }
    if (rel.includes('\0') || rel.includes('\\')) fail('not_found', 'Not found.');
    rel = rel.replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    let buf, hash;
    if (rel === BUILD_FILE) buf = fs.readFileSync(path.join(this.uiDir, BUILD_FILE));
    else {
      if (!safeRel(rel)) fail('not_found', 'Not found.');
      hash = s.files.get(rel);
      if (!hash && s.files.has(`${rel}/index.html`)) {
        res.writeHead(301, { Location: `${pathname}/`, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (!hash) fail('not_found', 'Not found.');
      try { buf = fs.readFileSync(path.join(this.uiDir, ...rel.split('/'))); } catch { buf = null; }
      if (!buf || sha256(buf) !== hash) {
        this.state = null; // check the whole copy again next time
        this.log?.error(`Work mode: ${rel} changed after the pinned copy was built, so it was not served.`);
        fail('internal', 'This file in the pinned copy changed after it was built, so Workshop will not serve it. Run "workshop pin" again.');
      }
    }
    res.writeHead(200, {
      'Content-Type': contentType(rel),
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  }
}
