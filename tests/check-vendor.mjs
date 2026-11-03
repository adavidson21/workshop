#!/usr/bin/env node
// Checks every vendored third-party file against its folder's SHA256SUMS (tests/lib/vendor-hashes.mjs).
//
//   node tests/check-vendor.mjs            check (CI runs this)
//   node tests/check-vendor.mjs --write    rewrite SHA256SUMS after deliberately updating a library
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VENDOR_DIRS, checkSums, writeSums } from './lib/vendor-hashes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = VENDOR_DIRS.filter(d => fs.existsSync(path.join(root, d)));

if (process.argv.includes('--write')) {
  for (const d of dirs) writeSums(path.join(root, d));
  console.log(`Wrote SHA256SUMS in ${dirs.join(', ')}. Review the diff: every changed line is a changed third-party file.`);
  process.exit(0);
}

const problems = dirs.flatMap(d => checkSums(path.join(root, d), d));
if (problems.length) {
  console.error(`Vendored files do not match their hashes (${problems.length}):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('If you updated a library on purpose, run: node tests/check-vendor.mjs --write');
  process.exit(1);
}
console.log(`vendor ok: ${dirs.join(', ')} match SHA256SUMS.`);
