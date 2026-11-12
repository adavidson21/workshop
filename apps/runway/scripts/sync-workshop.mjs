#!/usr/bin/env node
// The source of every app's scripts/sync-workshop.mjs: it is in the platform bundle (docs/bundle.md), so an
// app's --update also updates this script. Workshop itself does not run it.
//
// This app's copies of Workshop files (workshop-files.json): the SDK, site config, themes, fonts, icons, and the
// data contract schemas its tests check against. Workshop is where these are edited; the app keeps exact copies
// so it runs on its own, and so inside Workshop it reads and writes the same data the same way. The copies are
// pinned to a release of Workshop's platform bundle (bundle.json in workshop, docs/bundle.md).
//
//   node scripts/sync-workshop.mjs --check            exit 1 if a copy differs from its pinned hash, or the pin
//                                                     from the bundle at the pinned commit (CI)
//   node scripts/sync-workshop.mjs --update [ref]     copy the files at ref (default main) and pin that commit
//                                                     and its bundle version
//   add --from <path to a workshop checkout> to either, to read files from disk instead of GitHub
//
// Never edit a copied file here: change it in Workshop, then run --update. Node 22, no dependencies.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = join(ROOT, 'workshop-files.json');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

export function readList(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'workshop-files.json'), 'utf8'));
}

// A function (path in workshop) -> Buffer, from a local checkout (git show at the commit) or GitHub.
function source({ from, repo, commit }) {
  if (from) return async (p) => execFileSync('git', ['-C', from, 'show', `${commit}:${p}`], { maxBuffer: 64 << 20 });
  return async (p) => {
    const url = `https://raw.githubusercontent.com/${repo}/${commit}/${p}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
}

function resolveRef(from, repo, ref) {
  if (from) return execFileSync('git', ['-C', from, 'rev-parse', ref], { encoding: 'utf8' }).trim();
  const out = execFileSync('git', ['ls-remote', `https://github.com/${repo}.git`, ref], { encoding: 'utf8' }).trim();
  if (!out) throw new Error(`No ${ref} in ${repo}`);
  return out.split(/\s+/)[0];
}

/** Copies whose bytes differ from the hash pinned in workshop-files.json. No network. [{local, upstream, reason}] */
export function checkLocal({ root = ROOT } = {}) {
  const list = readList(root);
  const bad = [];
  if (!list.bundle || !list.sha256) return [{ local: 'workshop-files.json', upstream: 'bundle.json', reason: 'no bundle pin: run --update' }];
  for (const [local, upstream] of Object.entries(list.files)) {
    const file = join(root, local);
    if (!existsSync(file)) { bad.push({ local, upstream, reason: 'missing here' }); continue; }
    if (list.sha256[local] !== sha(readFileSync(file))) bad.push({ local, upstream, reason: 'differs from its pinned hash' });
  }
  return bad;
}

/** The copies that differ from the pinned commit, or whose pin differs from the bundle there: [{local, upstream, reason}]. */
export async function check({ root = ROOT, from } = {}) {
  const bad = checkLocal({ root });
  if (bad.length) return bad;
  const list = readList(root);
  const get = source({ from, repo: list.repo, commit: list.commit });
  let bundle;
  try { bundle = JSON.parse((await get('bundle.json')).toString('utf8')); } catch (e) { return [{ local: 'workshop-files.json', upstream: 'bundle.json', reason: `no bundle.json in workshop at ${list.commit.slice(0, 7)}` }]; }
  if (bundle.version !== list.bundle) bad.push({ local: 'workshop-files.json', upstream: 'bundle.json', reason: `pins bundle ${list.bundle}, workshop at ${list.commit.slice(0, 7)} is ${bundle.version}` });
  for (const [local, upstream] of Object.entries(list.files)) {
    const want = bundle.files[upstream];
    if (want) { if (want !== list.sha256[local]) bad.push({ local, upstream, reason: 'differs from the bundle' }); continue; }
    let buf;
    try { buf = await get(upstream); } catch (e) { bad.push({ local, upstream, reason: `not in workshop at ${list.commit.slice(0, 7)}` }); continue; }
    if (sha(buf) !== list.sha256[local]) bad.push({ local, upstream, reason: 'differs' });
  }
  return bad;
}

export async function update({ root = ROOT, from, ref = 'main' } = {}) {
  const list = readList(root);
  const commit = resolveRef(from, list.repo, ref);
  const get = source({ from, repo: list.repo, commit });
  const bundle = JSON.parse((await get('bundle.json')).toString('utf8'));
  const hashes = {};
  const added = [];
  const queue = Object.entries(list.files);
  while (queue.length) {
    const [local, upstream] = queue.shift();
    const file = join(root, local);
    const buf = await get(upstream);
    if (bundle.files[upstream] && bundle.files[upstream] !== sha(buf)) throw new Error(`${upstream} at ${commit.slice(0, 7)} does not match workshop's bundle.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    hashes[local] = sha(buf);
    // A copied module that imports another bundle file this app does not list yet: copy that one too.
    for (const dep of importsOf(upstream, buf)) {
      if (!bundle.files[dep] || Object.values(list.files).includes(dep)) continue;
      const depLocal = join(dirname(local), relative(dirname(upstream), dep)).replace(/\\/g, '/');
      list.files[depLocal] = dep;
      queue.push([depLocal, dep]);
      added.push(depLocal);
    }
  }
  if (added.length) addToAppJson(root, added);
  list.files = Object.fromEntries(Object.entries(list.files).sort(([a], [b]) => a.localeCompare(b)));
  list.added = added;
  list.commit = commit;
  list.bundle = bundle.version;
  list.sha256 = hashes;
  delete list.added;
  writeFileSync(join(root, 'workshop-files.json'), JSON.stringify(list, null, 2) + '\n');
  return { commit, added };
}

/** Bundle paths a JS module imports by relative path (static and dynamic imports). */
export function importsOf(path, buf) {
  if (!/\.m?js$/.test(path)) return [];
  const out = new Set();
  const re = /(?:\bimport\s*\(\s*|\bfrom\s*|^\s*import\s*)['"](\.{1,2}\/[^'"]+)['"]/gm;
  for (const m of buf.toString('utf8').matchAll(re)) out.add(posix.normalize(posix.join(posix.dirname(path), m[1])));
  return [...out];
}

// Files the sync added are app files too, so the service worker caches them: add them to app.json's files list.
function addToAppJson(root, paths) {
  const file = join(root, 'app.json');
  if (!existsSync(file)) return;
  const app = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(app.files)) return;
  const more = paths.filter(p => !app.files.includes(p));
  if (!more.length) return;
  app.files = [...app.files, ...more].sort();
  writeFileSync(file, JSON.stringify(app, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--from');
  const from = at >= 0 ? resolve(args[at + 1]) : undefined;
  if (args.includes('--update')) {
    const i = args.indexOf('--update');
    const ref = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'main';
    const { commit, added } = await update({ from, ref });
    console.log(`Copied ${Object.keys(readList().files).length} files from workshop at ${commit.slice(0, 7)} (bundle ${readList().bundle}). Run the tests, then commit.`);
    if (added.length) console.log(`Added because a copied file imports them (also listed in app.json): ${added.join(', ')}`);
  } else if (args.includes('--check')) {
    const bad = await check({ from });
    const list = readList();
    if (bad.length) {
      console.error(`These copies do not match workshop at ${list.commit.slice(0, 7)}, bundle ${list.bundle || 'none'} (edit them in Workshop, then run --update):`);
      for (const b of bad) console.error(`  ${b.local} (${b.reason})`);
      process.exit(1);
    }
    console.log(`workshop files ok: ${Object.keys(list.files).length} files match ${list.commit.slice(0, 7)}, bundle ${list.bundle}`);
  } else {
    console.log('Usage: node scripts/sync-workshop.mjs --check | --update [ref]  [--from <workshop checkout>]');
  }
}
