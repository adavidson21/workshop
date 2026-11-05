#!/usr/bin/env node
// The platform bundle (docs/bundle.md): bundle.json lists every shared file apps in their own repos copy
// (shared/, icons/, docs/schemas/, tests/lib/schema.mjs) with its SHA-256, under one version. Apps pin that
// version in their workshop-files.json (their scripts/sync-workshop.mjs).
//
//   node scripts/bundle.mjs           write bundle.json; raises the patch version when any file changed
//   node scripts/bundle.mjs --check   exit 1 when bundle.json is stale (CI)
//
// Raise the minor or major version by hand (edit bundle.json, then run this) for a new file or a breaking
// change. Node 22, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLE_FILE = 'bundle.json';
const DIRS = ['shared', 'icons', 'docs/schemas'];
const FILES = ['tests/lib/schema.mjs'];
const SKIP = new Set(['shared/test', 'shared/screenshots']);

const sha = buf => createHash('sha256').update(buf).digest('hex');

function walk(root, dir, out) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.name.startsWith('.') || SKIP.has(rel)) continue;
    if (e.isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/** {path: sha256} for every file in the bundle, sorted by path. */
export function hashes(root = ROOT) {
  const list = [...DIRS.flatMap(d => walk(root, d, [])), ...FILES.filter(f => fs.existsSync(path.join(root, f)))].sort();
  return Object.fromEntries(list.map(f => [f, sha(fs.readFileSync(path.join(root, f)))]));
}

export function readBundle(root = ROOT) {
  const p = path.join(root, BUNDLE_FILE);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bumpPatch = v => { const [M, m, p] = v.split('.').map(Number); return `${M}.${m}.${p + 1}`; };

/** The bundle as it should be: the stored version when nothing changed, else the patch raised. */
export function build(root = ROOT) {
  const files = hashes(root);
  const old = readBundle(root);
  if (!old) return { bundle: 1, version: '1.0.0', files };
  return { bundle: 1, version: same(old.files, files) ? old.version : bumpPatch(old.version), files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const want = build();
  const have = readBundle();
  if (process.argv.includes('--check')) {
    if (!have || !same(have.files, want.files)) {
      console.error(`${BUNDLE_FILE} is stale: shared files changed. Run: node scripts/bundle.mjs, and commit it.`);
      process.exit(1);
    }
    console.log(`bundle ok: ${have.version}, ${Object.keys(have.files).length} files`);
  } else {
    fs.writeFileSync(path.join(ROOT, BUNDLE_FILE), JSON.stringify(want, null, 2) + '\n');
    console.log(`${BUNDLE_FILE}: ${want.version}, ${Object.keys(want.files).length} files${have && have.version !== want.version ? ` (was ${have.version})` : ''}`);
  }
}
