#!/usr/bin/env node
// The boundaries inside this repo (docs/shared.md, "Boundaries"). Every app, the shell, the shared files, the
// agent and the connectors live here, so nothing but this check stops one part from reaching into another.
// It reads every import, export ... from, import(), <script src> and <link href> in the code that ships, and
// fails on:
//   B1  an app (apps/<a>/) using another app's files (apps/<b>/)
//   B2  an app or shared/ using shell/, agent/, connectors/ or worker/; the shell using an app's files
//   B3  agent/ or connectors/<id>/ using anything outside its own folder except shared/site.js
//   B4  an app or the shell using a shared/ file that docs/shared.md does not list as public, or a file in
//       shared/ that docs/shared.md does not list at all (public or internal), or a listed file that is gone
// Tests (test/ folders, tests/) may also use tests/lib/ and docs/; they still may not use another app's files.
// Exit 1 on a problem. Node 22, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = f => path.relative(root, f).split(path.sep).join('/');
const problems = [];

const SKIP_DIR = new Set(['node_modules', 'vendor', 'fonts', 'screenshots', 'out', 'examples']);
const CODE = /\.(m?js|html)$/;
const AREAS = ['apps', 'shell', 'shared', 'agent', 'connectors', 'worker'];
// Apps whose tests may read connectors' files as fixtures: Settings builds its forms from each connector's configSchema.
const CONNECTOR_FIXTURES = { 'apps/settings': true };

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); }
    else if (CODE.test(e.name)) out.push(p);
  }
  return out;
}

// Comments out, so a path named in a comment is not an import.
function stripComments(text, html) {
  if (html) return text.replace(/<!--[\s\S]*?-->/g, '');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const PATTERNS = [
  /\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /<script\b[^>]*\bsrc=["']([^"']+)["']/g,
  /<link\b[^>]*\bhref=["']([^"']+)["']/g
];

/** Every local path a file uses, relative to the repo root (null for one outside the repo). */
function usesOf(file, text) {
  const html = file.endsWith('.html');
  const code = stripComments(text, html);
  const out = [];
  for (const re of PATTERNS) {
    for (const m of code.matchAll(re)) {
      const spec = m[1].split(/[?#]/)[0];
      if (!spec || /^(https?:|data:|blob:|node:|#)/.test(spec)) continue;
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // a bare name: node built-ins and the like
      const abs = spec.startsWith('/') ? path.join(root, spec) : path.resolve(path.dirname(file), spec);
      const r = rel(abs);
      out.push(r.startsWith('..') ? null : r);
    }
  }
  return out;
}

/** Which part of the repo a path is in: apps/<id>, shell, shared, agent, connectors/<id>, worker, or the top folder. */
function areaOf(r) {
  const s = r.split('/');
  if ((s[0] === 'apps' || s[0] === 'connectors') && s.length > 2) return `${s[0]}/${s[1]}`;
  return s.length > 1 ? s[0] : '(root)';
}
const isTest = r => /(^|\/)test\//.test(r) || r.startsWith('tests/');

/* ---------- docs/shared.md: the public and internal shared files ---------- */
function readSharedDoc() {
  const doc = path.join(root, 'docs', 'shared.md');
  if (!fs.existsSync(doc)) { problems.push('docs/shared.md is missing: it lists which shared/ files apps may use.'); return { pub: new Set(), internal: new Set() }; }
  const pub = new Set(), internal = new Set();
  let section = null;
  for (const line of fs.readFileSync(doc, 'utf8').split('\n')) {
    if (/^##\s+Public/i.test(line)) section = pub;
    else if (/^##\s+Internal/i.test(line)) section = internal;
    else if (/^##\s/.test(line)) section = null;
    else if (section) {
      const m = line.match(/^\|\s*`(shared\/[^`]+)`/);
      if (m) section.add(m[1]);
    }
  }
  return { pub, internal };
}

const { pub, internal } = readSharedDoc();
// A listed folder (shared/fonts/) covers everything in it.
const listed = (set, r) => set.has(r) || [...set].some(x => x.endsWith('/') && r.startsWith(x));

for (const f of walk(path.join(root, 'shared'), [])) {
  const r = rel(f);
  if (isTest(r)) continue;
  if (!listed(pub, r) && !listed(internal, r)) problems.push(`B4 ${r} is not in docs/shared.md. Add it under Public (apps may use it) or Internal (the shell and the SDK only).`);
}
for (const r of [...pub, ...internal]) {
  if (!fs.existsSync(path.join(root, r))) problems.push(`B4 docs/shared.md lists ${r}, which does not exist.`);
}

/* ---------- the rules ---------- */
const files = AREAS.flatMap(a => walk(path.join(root, a), []));
let uses = 0;
for (const f of files) {
  const from = rel(f);
  const area = areaOf(from);
  const test = isTest(from);
  // Node tools in shell/ (registry.mjs) are build scripts, not the shell page.
  const tool = from.startsWith('shell/') && from.endsWith('.mjs');
  for (const to of usesOf(f, fs.readFileSync(f, 'utf8'))) {
    uses++;
    if (to === null) { problems.push(`${from} uses a file outside the repo.`); continue; }
    const toArea = areaOf(to);
    const say = (rule, why) => problems.push(`${rule} ${from} uses ${to}: ${why}`);

    if (area.startsWith('apps/')) {
      if (toArea.startsWith('apps/') && toArea !== area) { say('B1', 'apps never use another app\'s files. Put shared code in shared/ (docs/shared.md) or offer it through a contract (docs/summaries.md, docs/handoffs.md).'); continue; }
      if (['shell', 'agent', 'worker'].includes(toArea) || toArea.startsWith('connectors/')) {
        if (test && CONNECTOR_FIXTURES[area] && toArea.startsWith('connectors/')) continue;
        say('B2', 'apps reach the shell, the agent and connectors only through the SDK.'); continue;
      }
      if (toArea === 'shared' && !test && !listed(pub, to)) { say('B4', 'not a public shared file in docs/shared.md.'); continue; }
    } else if (area === 'shared') {
      if (['shell', 'agent', 'worker'].includes(toArea) || toArea.startsWith('apps/') || toArea.startsWith('connectors/')) say('B2', 'shared files are used by the shell and apps, and use nothing of theirs.');
    } else if (area === 'shell' && !tool) {
      if (toArea.startsWith('apps/')) say('B2', 'the shell frames apps and never imports their code.');
      else if (['agent', 'worker'].includes(toArea) || toArea.startsWith('connectors/')) say('B2', 'the shell reaches the agent only over its API.');
    } else if (area === 'agent' || area.startsWith('connectors/')) {
      if (to === 'shared/site.js' || toArea === area) continue;
      if (test && (toArea === 'tests' || toArea === 'agent' || toArea === 'docs' || toArea === 'scripts' || to === 'workshop.mjs')) continue;
      say('B3', `${area} uses only its own files and shared/site.js.`);
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(`\n${problems.length} boundary problem${problems.length === 1 ? '' : 's'} (docs/shared.md, Boundaries).`);
  process.exit(1);
}
console.log(`boundaries ok: ${files.length} files, ${uses} local uses, ${pub.size} public and ${internal.size} internal shared entries`);
