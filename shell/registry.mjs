#!/usr/bin/env node
// Writes apps/registry.json: the app list for static sites (hosted and browser modes), in the same shape as
// GET /api/apps (docs/agent-api.md, schema apps-response). The agent never reads it; it lists apps/*/app.json
// itself. The shell and the service worker read it when no agent serves the page.
//
//   node shell/registry.mjs           write apps/registry.json
//   node shell/registry.mjs --check   exit 1 if it is missing or out of date (CI)
//
// A folder whose app.json fails the schema, or whose id does not match the folder, is skipped with a warning,
// the same rule the agent applies.
//
// Apps from another site (apps/remote.json, docs/app-manifest.md "Apps from another site") are listed too, at
// /apps/<id>/, with the manifest snapshot kept in that file. The Worker serves their files from their own site
// and swaps in their live app.json when it serves this registry, so the snapshot only matters if that site is
// down. To refresh the snapshots from the live sites:
//
//   node shell/registry.mjs --refresh-remote
//
// Node 22, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from '../tests/lib/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildRegistry(root = ROOT, warn = (m) => console.warn(m)) {
  const schemas = SchemaSet.fromDir(path.join(root, 'docs', 'schemas'));
  const appsDir = path.join(root, 'apps');
  const apps = [];
  for (const d of fs.readdirSync(appsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const file = path.join(appsDir, d.name, 'app.json');
    if (!fs.existsSync(file)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { warn(`Skipped apps/${d.name}: app.json is not valid JSON.`); continue; }
    const errors = schemas.validate('app', manifest);
    if (errors.length) { warn(`Skipped apps/${d.name}: ${errors[0]}`); continue; }
    if (manifest.id !== d.name) { warn(`Skipped apps/${d.name}: id "${manifest.id}" does not match the folder.`); continue; }
    apps.push({ base: `/apps/${d.name}/`, manifest });
  }
  for (const r of readRemote(root)) {
    const errors = schemas.validate('app', r.manifest);
    if (errors.length) { warn(`Skipped remote app ${r.id}: ${errors[0]}`); continue; }
    if (r.manifest.id !== r.id) { warn(`Skipped remote app ${r.id}: its manifest id is "${r.manifest.id}".`); continue; }
    if (apps.some(a => a.manifest.id === r.id)) { warn(`Skipped remote app ${r.id}: apps/${r.id}/ is already an app here.`); continue; }
    apps.push({ base: `/apps/${r.id}/`, manifest: r.manifest });
  }
  apps.sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
  const registry = { apps };
  const errors = schemas.validate('apps-response', registry);
  if (errors.length) throw new Error(`apps/registry.json would not match the apps-response schema: ${errors[0]}`);
  return registry;
}

/** apps/remote.json: [{id, site, repo, binding, manifest}], or [] when there is none. */
export function readRemote(root = ROOT) {
  const file = path.join(root, 'apps', 'remote.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).apps || [];
}

/** Replace each remote app's manifest snapshot with the live <site>/app.json. Returns the ids that changed. */
export async function refreshRemote(root = ROOT) {
  const file = path.join(root, 'apps', 'remote.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const changed = [];
  for (const r of doc.apps) {
    const res = await fetch(new URL('app.json', r.site.replace(/\/?$/, '/')), { cache: 'no-store' });
    if (!res.ok) throw new Error(`${r.site}/app.json: HTTP ${res.status}`);
    const live = await res.json();
    if (JSON.stringify(live) !== JSON.stringify(r.manifest)) { r.manifest = live; changed.push(r.id); }
  }
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  return changed;
}

export const serialize = (registry) => JSON.stringify(registry, null, 2) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, 'apps', 'registry.json');
  if (process.argv.includes('--refresh-remote')) {
    const changed = await refreshRemote();
    console.log(changed.length ? `Updated the snapshot for: ${changed.join(', ')}.` : 'Remote app snapshots are current.');
  }
  const text = serialize(buildRegistry());
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (have !== text) { console.error('apps/registry.json is out of date. Run: node shell/registry.mjs'); process.exit(1); }
    console.log(`registry ok: ${JSON.parse(text).apps.length} apps`);
  } else {
    fs.writeFileSync(out, text);
    console.log(`Wrote apps/registry.json (${JSON.parse(text).apps.length} apps).`);
  }
}
