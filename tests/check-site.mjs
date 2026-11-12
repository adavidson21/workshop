#!/usr/bin/env node
// Site addresses live in one place, shared/site.js (docs/site.md). This fails when code that runs (the agent,
// shell, shared files, apps, connectors, Worker, installers) names a site of the owner's domain or a GitHub repo
// anywhere else, outside comments. Checked exceptions: scripts/bootstrap.* and scripts/install.* (plain shell,
// so every address in them must be one in site.js) and wrangler.jsonc (its routes must be site.js hosts, and it
// binds no other Worker: every app is part of this site).
// Exit 1 on a problem. Node 22, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, hostOf } from '../shared/site.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = f => path.relative(root, f).split(path.sep).join('/');
const problems = [];

const owner = SITE.repos.workshop.split('/')[0];
const domain = SITE.crumbs.domain.replace(/\./g, '\\.');
const ADDRESS = new RegExp(`https?://[a-z0-9.-]*${domain}[^\\s'"\`)<>]*|https://github\\.com/${owner}/[A-Za-z0-9._-]+|\\b${owner}/[A-Za-z0-9._-]+|[a-z0-9.-]*\\b${domain}\\b`, 'g');

const allowed = new Set([SITE.workshop, ...Object.values(SITE.apps), ...SITE.allowedSites, ...SITE.crumbs.links.map(l => l.href)]);
for (const r of Object.values(SITE.repos)) { allowed.add(`https://github.com/${r}`); allowed.add(r); }
const hostsOk = new Set([...allowed].filter(a => a.startsWith('https://')).map(a => hostOf(a)));
const okAddress = a => allowed.has(a) || allowed.has(a.replace(/\/+$/, '')) || [...allowed].some(x => x.startsWith('https://') && a.startsWith(x + '/'))
  || hostsOk.has(a) || a === SITE.crumbs.domain;

const RUNTIME = ['agent', 'shell', 'shared', 'apps', 'connectors', 'worker', 'scripts'];
const FILES = ['workshop.mjs', 'sw.js', 'index.html', 'manifest.webmanifest'];
const SKIP_DIR = new Set(['test', 'vendor', 'fonts', 'screenshots', 'node_modules', 'parser', 'examples']);
const EXT = /\.(m?js|css|html|ps1|sh|json|webmanifest|py)$/;
const SITE_FILE = 'shared/site.js';
// Public tools the installers download from or link to.
const THIRD_PARTY = new Set(['nodejs.org', 'github.com', 'api.github.com', 'git-scm.com', 'opencode.ai', 'console.anthropic.com', 'registry.npmjs.org', 'www.npmjs.com']);
const CHECKED = /^scripts\/(bootstrap|install)\.(ps1|sh)$/;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name) && !e.name.startsWith('.')) walk(p, out); }
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}
const files = [...RUNTIME.flatMap(d => fs.existsSync(path.join(root, d)) ? walk(path.join(root, d), []) : []), ...FILES.map(f => path.join(root, f)).filter(f => fs.existsSync(f))];

// The code part of each line, with comments removed (a line-based approximation that is enough for this repo).
function codeLines(text, file) {
  const hash = /\.(ps1|sh|py)$/.test(file);
  const out = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    let line = raw;
    if (hash) { const t = line.trim(); out.push(t.startsWith('#') || t.startsWith('<#') ? '' : line); continue; }
    if (inBlock) { const end = line.indexOf('*/'); if (end < 0) { out.push(''); continue; } line = line.slice(end + 2); inBlock = false; }
    line = line.replace(/\/\*.*?\*\//g, '').replace(/<!--.*?-->/g, '');
    const t = line.trim();
    if (t.startsWith('/*')) { inBlock = !t.includes('*/'); out.push(''); continue; }
    if (t.startsWith('//') || t.startsWith('*')) { out.push(''); continue; }
    // A trailing // comment after code: cut it when the code before it has no open quote.
    const cut = line.search(/\s\/\/\s/);
    if (cut >= 0) { const before = line.slice(0, cut); if (((before.match(/'/g) || []).length % 2 === 0) && ((before.match(/"/g) || []).length % 2 === 0) && ((before.match(/`/g) || []).length % 2 === 0)) line = before; }
    if (/\.css$/.test(file) && t.startsWith('/*')) { out.push(''); continue; }
    out.push(line);
  }
  return out;
}

for (const f of files) {
  const r = rel(f);
  if (r === SITE_FILE || r === 'apps/registry.json') continue;
  const lines = codeLines(fs.readFileSync(f, 'utf8'), r);
  lines.forEach((line, i) => {
    for (const m of line.match(ADDRESS) || []) {
      if (CHECKED.test(r)) { if (!okAddress(m.replace(/[.,;]$/, ''))) problems.push(`${r}:${i + 1}: ${m} is not an address in ${SITE_FILE}`); }
      else problems.push(`${r}:${i + 1}: names ${m}. Read it from ${SITE_FILE} instead (docs/site.md).`);
    }
    // In the installers, every https site that is not a public tool's must be one in site.js, so changing the
    // domain in site.js flags the old one here.
    if (CHECKED.test(r)) for (const m of line.match(/https:\/\/[A-Za-z0-9.-]+/g) || []) {
      const host = m.slice(8);
      if (!THIRD_PARTY.has(host) && !hostsOk.has(host)) problems.push(`${r}:${i + 1}: ${m} is not a site in ${SITE_FILE} (or a known tool's site)`);
    }
  });
}

// wrangler.jsonc: routes are site.js hosts, and no service bindings (every app is served from this site).
const wrangler = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n'));
// Workshop's host must be routed; any other route must be a retired app domain (it only redirects).
const workshopHost = hostOf(SITE.workshop);
const retiredHosts = new Set(Object.values(SITE.apps).map(hostOf));
for (const r of wrangler.routes || []) if (r.pattern !== workshopHost && !retiredHosts.has(r.pattern)) problems.push(`wrangler.jsonc: route ${r.pattern} is not Workshop's host or a retired app domain in ${SITE_FILE}`);
if (!(wrangler.routes || []).some(r => r.pattern === workshopHost)) problems.push(`wrangler.jsonc: no route for ${workshopHost} (${SITE_FILE})`);
if ((wrangler.services || []).length) problems.push('wrangler.jsonc: no service bindings: every app is served from this site (docs/site.md).');

if (problems.length) { console.error('Site address checks failed:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log(`site ok: ${files.length} runtime files, addresses only in ${SITE_FILE}`);
