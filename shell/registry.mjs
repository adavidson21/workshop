#!/usr/bin/env node
// Writes apps/registry.json: the app list for static sites (hosted and browser modes), in the same shape as
// GET /api/apps (docs/agent-api.md, schema apps-response). The agent never reads it; it lists apps/*/app.json
// itself. The shell and the service worker read it when no agent serves the page.
//
//   node shell/registry.mjs           write apps/registry.json
//   node shell/registry.mjs --check   exit 1 if it is missing or out of date (CI)
//
// A folder whose app.json fails the schema, or whose id does not match the folder, is skipped with a warning,
// the same rule the agent applies. Node 22, no dependencies.
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
  apps.sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
  const registry = { apps };
  const errors = schemas.validate('apps-response', registry);
  if (errors.length) throw new Error(`apps/registry.json would not match the apps-response schema: ${errors[0]}`);
  return registry;
}

export const serialize = (registry) => JSON.stringify(registry, null, 2) + '\n';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, 'apps', 'registry.json');
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
