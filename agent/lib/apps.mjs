// Turning apps on and off (docs/apps.md). Which apps are off is kept in <home>/apps.json, a file of its own
// rather than config.json, so the `workshop apps` command and the running agent can both change it without
// either overwriting the other's copy of config.json. It is read fresh every time it is needed.
//
//   {"off": ["runway", "notes"]}
//
// Home and Settings are always on (Settings is where apps are turned back on).
//
// Pure file system work, like lib/pinned.mjs: no network and no child processes. Downloading an app that
// lives in its own repo is `workshop apps on <app>`, which runs git; the agent never does that.
import fs from 'node:fs';
import path from 'node:path';
import { VERSION } from '../version.mjs';
import { writeJsonAtomic } from './fsutil.mjs';
import { BUILD_FILE, pinInto, uiDirOf } from './pinned.mjs';

export const APPS_FILE = 'apps.json';
export const ALWAYS_ON = new Set(['home', 'settings']);
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const SHA = /^[0-9a-f]{40}$/;

/** The ids of the apps turned off, as a Set. Missing or unreadable file: none are off. */
export function readOff(home) {
  let v;
  try { v = JSON.parse(fs.readFileSync(path.join(home, APPS_FILE), 'utf8')); } catch { return new Set(); }
  const list = v && Array.isArray(v.off) ? v.off : [];
  return new Set(list.filter(id => typeof id === 'string' && ID.test(id) && !ALWAYS_ON.has(id)));
}

/** Save the ids of the apps turned off. */
export async function writeOff(home, off) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  await writeJsonAtomic(path.join(home, APPS_FILE), { off: [...off].filter(id => ID.test(id) && !ALWAYS_ON.has(id)).sort() });
}

/** The apps/registry.json contents (same shape as GET /api/apps), built from appsDir, leaving out `off`. */
export function buildRegistry(appsDir, schemas, off = new Set(), skipped = null) {
  let dirs = [];
  try { dirs = fs.readdirSync(appsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { return { apps: [] }; }
  const apps = [];
  for (const dir of dirs) {
    if (off.has(dir)) continue;
    if (!fs.existsSync(path.join(appsDir, dir, 'app.json'))) continue;
    const { manifest, problem } = readManifest(path.join(appsDir, dir), dir, schemas);
    // An app with a bad app.json is left out; `skipped` (when given) collects why, so callers can say so.
    if (problem) { if (skipped) skipped.push({ id: dir, problem }); continue; }
    apps.push({ base: `/apps/${dir}/`, manifest });
  }
  apps.sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
  return { apps };
}

/** Read and check an app folder's app.json against the app schema and the id it must have.
 *  Returns {manifest} when it is usable, else {problem} in plain words (the first few schema errors). */
export function readManifest(dir, id, schemas) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (e) {
    return { problem: e.code === 'ENOENT' ? 'it has no app.json' : `its app.json is not valid JSON (${e.message})` };
  }
  const errors = schemas.validate('app', manifest);
  if (errors.length) return { problem: `its app.json is not a valid app manifest (${errors.slice(0, 3).join('; ')}${errors.length > 3 ? `; and ${errors.length - 3} more` : ''})` };
  if (manifest.id !== id) return { problem: `its app.json says id "${manifest.id}", not "${id}"` };
  return { manifest };
}

/** Find an app by what a person types: its id (prioritizer), its key or its name (Docket). */
export function findApp(word, apps) {
  const w = String(word || '').trim().toLowerCase();
  return apps.find(a => a.id === w || a.key === w || a.name.toLowerCase() === w) || null;
}

// ---------------------------------------------------------------- git, read from files

const readText = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

/** The .git folder of a checkout (a worktree's .git file points at it), or null. */
function gitDir(dir) {
  const dotgit = path.join(dir, '.git');
  let st;
  try { st = fs.statSync(dotgit); } catch { return null; }
  if (st.isDirectory()) return dotgit;
  const m = /^gitdir:\s*(.+)$/m.exec(readText(dotgit) || '');
  return m ? path.resolve(dir, m[1].trim()) : null;
}

/** {name -> sha} from packed-refs, with peeled tags (^sha lines) resolved to their commit. */
function packedRefs(gd) {
  const refs = {};
  let last = null;
  for (const line of (readText(path.join(gd, 'packed-refs')) || '').split(/\r?\n/)) {
    const peel = /^\^([0-9a-f]{40})$/.exec(line);
    if (peel && last) { refs[last] = peel[1]; continue; }
    const m = /^([0-9a-f]{40}) (refs\/\S+)$/.exec(line);
    if (m) { refs[m[2]] = m[1]; last = m[2]; } else last = null;
  }
  return refs;
}

/**
 * {commit, ref} for a checkout, read from its .git files (no git program), in the same words `workshop`
 * uses: ref is the release tag at HEAD, else "<branch> (not a release tag)". A tag kept only as a loose
 * annotated tag object cannot be read without git, so `prev` (an earlier record of the same commit, from
 * build.json) supplies the tag when it has one. Null when dir is not a checkout.
 */
export function gitHead(dir, prev = null) {
  const gd = dir && gitDir(dir);
  if (!gd) return null;
  const packed = packedRefs(gd);
  const resolve = name => { const loose = (readText(path.join(gd, ...name.split('/'))) || '').trim(); return SHA.test(loose) ? loose : packed[name] || null; };
  const head = (readText(path.join(gd, 'HEAD')) || '').trim();
  const sym = /^ref:\s*(refs\/\S+)$/.exec(head);
  const commit = sym ? resolve(sym[1]) : SHA.test(head) ? head : null;
  if (!commit) return null;
  const tags = Object.entries(packed).filter(([n, sha]) => n.startsWith('refs/tags/') && sha === commit).map(([n]) => n.slice(10));
  try {
    for (const t of fs.readdirSync(path.join(gd, 'refs', 'tags'))) if (resolve(`refs/tags/${t}`) === commit) tags.push(t);
  } catch { /* no loose tags */ }
  const release = tags.filter(t => /^(core-)?v\d+(\.\d+)*$/.test(t)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (release) return { commit, ref: release };
  if (prev && prev.commit === commit && prev.ref && !/not a release tag/.test(prev.ref)) return { commit, ref: prev.ref };
  const branch = sym && sym[1].startsWith('refs/heads/') ? sym[1].slice(11) : null;
  return { commit, ref: branch ? `${branch} (not a release tag)` : 'not a release tag' };
}

// ---------------------------------------------------------------- the pinned copy

/** The pinned copy's build.json, or null. Not checked: for reading what was built, not for serving. */
export function readBuild(uiDir) {
  try { return JSON.parse(fs.readFileSync(path.join(uiDir, BUILD_FILE), 'utf8')); } catch { return null; }
}

/**
 * Build work mode's pinned copy, leaving out the apps turned off. `gitInfo(dir, prev)` gives {commit, ref}
 * (gitHead by default; the `workshop` command passes one that runs git). Returns {build, off, skipped}.
 */
export function pinApps({ home, repo, schemas, uiDir = uiDirOf(home), gitInfo = gitHead, version = VERSION }) {
  const off = readOff(home);
  const prev = readBuild(uiDir) || {};
  const info = { workshop: { version, ...(gitInfo(repo, prev.workshop) || {}) } };
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  // Apps whose app.json is not valid are left out of the registry, so not in the rail; `skipped` says which and why.
  let skipped = [];
  const build = pinInto(uiDir, { repo, registry: d => { skipped = []; return buildRegistry(d, schemas, off, skipped); }, info, skip: [...off] });
  return { build, off, skipped };
}

// ---------------------------------------------------------------- the list Settings and `workshop apps` show

/**
 * Every app with its switch (docs/apps.md, GET /api/app-switches), from apps/. Every app is part of Workshop, so
 * `separate` is always false. In work mode, `inWorkshop` says whether the pinned copy has the app; otherwise it
 * is the same as `on`, since the site serves every app.
 */
export function appSwitches({ home, repo, schemas, workMode, uiDir = uiDirOf(home) }) {
  const off = readOff(home);
  const build = workMode ? readBuild(uiDir) : null;
  let pinnedIds = null;
  if (workMode) {
    try { pinnedIds = new Set((JSON.parse(fs.readFileSync(path.join(uiDir, 'apps', 'registry.json'), 'utf8')).apps || []).map(a => a.manifest.id)); } catch { pinnedIds = new Set(); }
  }
  const builtIn = buildRegistry(path.join(repo, 'apps'), schemas).apps.map(a => a.manifest);
  const list = builtIn.map(m => ({ id: m.id, key: m.id, name: m.name, description: m.description || '', order: m.order ?? null }));
  list.sort((x, y) => (x.order ?? Infinity) - (y.order ?? Infinity) || x.name.localeCompare(y.name));
  return {
    workMode: workMode === true,
    pinned: workMode ? build !== null : null,
    apps: list.map(a => {
      const on = !off.has(a.id);
      const out = { id: a.id, name: a.name, description: a.description, on, canTurnOff: !ALWAYS_ON.has(a.id), separate: false, inWorkshop: workMode ? pinnedIds.has(a.id) : on };
      return out;
    })
  };
}
