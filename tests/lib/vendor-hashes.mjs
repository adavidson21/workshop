// Pinned SHA-256 hashes for vendored third-party code (shared/vendor/README.md, Hashes). Each vendor folder
// has a SHA256SUMS file listing every file in it except our own notes (.md) ("<sha256>  <path>", the format sha256sum writes, so
// `sha256sum -c SHA256SUMS` works there too). tests/check-vendor.mjs fails if a file changed, appeared or
// went missing without SHA256SUMS changing with it, so any change to vendored code shows up in review.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SUMS = 'SHA256SUMS';
// The vendor folders, relative to the repo root.
export const VENDOR_DIRS = ['shared/vendor', 'apps/agents/vendor'];

const files = (dir, rel = '', out = []) => {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) files(dir, r, out);
    // Notes (.md) are ours, not the library's, so they can change without a new hash.
    else if (r !== SUMS && !r.endsWith('.md')) out.push(r);
  }
  return out;
};
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** The SHA256SUMS text for a folder as it is now. */
export function sumsFor(dir) {
  return files(dir).sort().map(r => `${hash(path.join(dir, r))}  ${r}`).join('\n') + '\n';
}

/** Write SHA256SUMS for a folder. */
export const writeSums = dir => fs.writeFileSync(path.join(dir, SUMS), sumsFor(dir));

/** Problems (plain words) between a folder and its SHA256SUMS. Empty means it matches. */
export function checkSums(dir, label = dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, SUMS), 'utf8'); } catch { return [`${label}: there is no ${SUMS}. Run: node tests/check-vendor.mjs --write`]; }
  const want = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) return [`${label}/${SUMS}: cannot read the line "${line.slice(0, 80)}".`];
    want.set(m[2], m[1]);
  }
  const problems = [];
  const have = new Set(files(dir));
  for (const [rel, h] of want) {
    if (!have.has(rel)) problems.push(`${label}/${rel} is listed in ${SUMS} but missing.`);
    else if (hash(path.join(dir, rel)) !== h) problems.push(`${label}/${rel} does not match its SHA-256 in ${SUMS}.`);
  }
  for (const rel of have) if (!want.has(rel)) problems.push(`${label}/${rel} is not listed in ${SUMS}.`);
  return problems;
}
