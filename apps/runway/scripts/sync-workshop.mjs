#!/usr/bin/env node
// Docket's copies of Workshop files (workshop-files.json): the SDK, themes, fonts, icons, and the data contract
// schemas its tests check against. Workshop is where these are edited; Docket keeps exact copies so it runs on
// its own, and so Docket inside Workshop reads and writes the same data the same way.
//
//   node scripts/sync-workshop.mjs --check            exit 1 if any copy differs from the pinned commit (CI)
//   node scripts/sync-workshop.mjs --update [ref]     copy the files at ref (default main) and pin that commit
//   add --from <path to a workshop checkout> to either, to read files from disk instead of GitHub
//
// Never edit a copied file here: change it in Workshop, then run --update. Node 22, no dependencies.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

/** The copies that differ from the pinned commit: [{local, upstream, reason}]. */
export async function check({ root = ROOT, from } = {}) {
  const list = readList(root);
  const get = source({ from, repo: list.repo, commit: list.commit });
  const bad = [];
  for (const [local, upstream] of Object.entries(list.files)) {
    const file = join(root, local);
    if (!existsSync(file)) { bad.push({ local, upstream, reason: 'missing here' }); continue; }
    let want;
    try { want = await get(upstream); } catch (e) { bad.push({ local, upstream, reason: `not in workshop at ${list.commit.slice(0, 7)}` }); continue; }
    if (sha(readFileSync(file)) !== sha(want)) bad.push({ local, upstream, reason: 'differs' });
  }
  return bad;
}

export async function update({ root = ROOT, from, ref = 'main' } = {}) {
  const list = readList(root);
  const commit = resolveRef(from, list.repo, ref);
  const get = source({ from, repo: list.repo, commit });
  for (const [local, upstream] of Object.entries(list.files)) {
    const file = join(root, local);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await get(upstream));
  }
  list.commit = commit;
  writeFileSync(join(root, 'workshop-files.json'), JSON.stringify(list, null, 2) + '\n');
  return commit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--from');
  const from = at >= 0 ? resolve(args[at + 1]) : undefined;
  if (args.includes('--update')) {
    const i = args.indexOf('--update');
    const ref = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'main';
    const commit = await update({ from, ref });
    console.log(`Copied ${Object.keys(readList().files).length} files from workshop at ${commit.slice(0, 7)}. Run the tests, then commit.`);
  } else if (args.includes('--check')) {
    const bad = await check({ from });
    const list = readList();
    if (bad.length) {
      console.error(`These copies differ from workshop at ${list.commit.slice(0, 7)} (edit them in Workshop, then run --update):`);
      for (const b of bad) console.error(`  ${b.local} (${b.reason})`);
      process.exit(1);
    }
    console.log(`workshop files ok: ${Object.keys(list.files).length} files match ${list.commit.slice(0, 7)}`);
  } else {
    console.log('Usage: node scripts/sync-workshop.mjs --check | --update [ref]  [--from <workshop checkout>]');
  }
}
