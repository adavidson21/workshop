// Static checks for the contracts in docs/. Run: node tests/check-contracts.mjs
//  1. Schemas use only the supported keywords, and every $ref resolves.
//  2. Every example in docs/examples/ matches its schema; every example in docs/examples/invalid/ does not.
//  3. Every schema with a shape of its own has at least one example.
//  4. JSON blocks in the docs parse, and relative links in the docs point at files that exist.
//  5. Every connector (connectors/*/index.mjs) and app manifest (apps/*/app.json) in the repo, and the
//     test fixtures, follow docs/connector.md and docs/app-manifest.md.
//  6. No em dashes in docs/ or tests/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SchemaSet } from './lib/schema.mjs';
import { checkConnectorModule } from './lib/connector-check.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(REPO, 'docs');
const problems = [];
const problem = msg => problems.push(msg);
const rel = p => path.relative(REPO, p).split(path.sep).join('/');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const schemas = SchemaSet.fromDir(path.join(DOCS, 'schemas'));

// 1. Keywords and refs
const SCHEMA_KEYS = new Set(['$schema', '$id', '$ref', '$defs', 'type', 'properties', 'required', 'additionalProperties', 'patternProperties',
  'propertyNames', 'items', 'enum', 'const', 'pattern', 'format', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'uniqueItems', 'oneOf', 'anyOf', 'allOf', 'not', 'title', 'description', 'default', 'examples']);
function walk(node, where, file, refs) {
  if (typeof node === 'boolean') return;
  if (!node || typeof node !== 'object' || Array.isArray(node)) { problem(`${file}: ${where} is not a schema`); return; }
  for (const k of Object.keys(node)) if (!SCHEMA_KEYS.has(k) && !k.startsWith('x-workshop-')) problem(`${file}: unsupported keyword "${k}" at ${where}`);
  if (node.$ref) refs.push([node.$ref, where]);
  for (const k of ['properties', 'patternProperties', '$defs']) for (const [n, s] of Object.entries(node[k] || {})) walk(s, `${where}/${k}/${n}`, file, refs);
  for (const k of ['items', 'additionalProperties', 'propertyNames', 'not']) if (node[k] !== undefined && typeof node[k] !== 'boolean') walk(node[k], `${where}/${k}`, file, refs);
  for (const k of ['oneOf', 'anyOf', 'allOf']) (node[k] || []).forEach((s, i) => walk(s, `${where}/${k}/${i}`, file, refs));
  if (node.pattern) { try { new RegExp(node.pattern, 'u'); } catch (e) { problem(`${file}: bad pattern at ${where}: ${e.message}`); } }
}
for (const [file, schema] of Object.entries(schemas.schemas)) {
  const refs = [];
  walk(schema, '#', file, refs);
  for (const [ref, where] of refs) {
    const [f, pointer = ''] = ref.split('#');
    let node = f ? schemas.schemas[f] : schema;
    for (const part of pointer.split('/').filter(Boolean)) node = node?.[part];
    if (node === undefined) problem(`${file}: $ref ${ref} at ${where} does not resolve`);
  }
}

// 2 and 3. Examples
const EX = path.join(DOCS, 'examples');
const covered = new Set();
const schemaFor = f => f.split('.')[0];
for (const f of fs.readdirSync(EX).filter(f => f.endsWith('.json'))) {
  const name = schemaFor(f);
  if (!schemas.schemas[`${name}.schema.json`]) { problem(`docs/examples/${f}: no schema named ${name}`); continue; }
  let value;
  try { value = readJson(path.join(EX, f)); } catch (e) { problem(`docs/examples/${f}: not valid JSON (${e.message})`); continue; }
  const errs = schemas.validate(name, value);
  if (errs.length) problem(`docs/examples/${f} does not match ${name}: ${errs.slice(0, 3).join('; ')}`);
  covered.add(name);
}
for (const f of fs.readdirSync(path.join(EX, 'invalid')).filter(f => f.endsWith('.json'))) {
  const name = schemaFor(f);
  if (!schemas.schemas[`${name}.schema.json`]) { problem(`docs/examples/invalid/${f}: no schema named ${name}`); continue; }
  if (!schemas.validate(name, readJson(path.join(EX, 'invalid', f))).length) problem(`docs/examples/invalid/${f} should fail ${name} but passes`);
}
for (const file of Object.keys(schemas.schemas)) {
  const name = file.replace('.schema.json', '');
  if (name !== 'common' && !covered.has(name)) problem(`docs/schemas/${file} has no example in docs/examples/`);
}

// 4. Docs: JSON blocks and links
function textFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...textFiles(p));
    else if (/\.(md|json|mjs|js|html|svg|txt|yml)$/.test(e.name)) out.push(p);
  }
  return out;
}
for (const file of textFiles(DOCS).filter(f => f.endsWith('.md'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/```json\n([\s\S]*?)```/g)) {
    const block = m[1].trim();
    try { JSON.parse(block); } catch {
      const bad = block.split('\n').filter(l => { try { JSON.parse(l); return false; } catch { return true; } });
      if (bad.length) problem(`${rel(file)}: a json block is neither one JSON value nor one value per line: ${bad[0].slice(0, 80)}`);
    }
  }
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    const p = path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0]));
    if (!fs.existsSync(p)) problem(`${rel(file)}: link to ${target} points at nothing`);
  }
}

// 5. Connectors and apps in the repo, plus the fixtures
async function checkConnectors(dir, skip = []) {
  if (!fs.existsSync(dir)) return;
  for (const id of fs.readdirSync(dir).filter(n => !skip.includes(n))) {
    const file = path.join(dir, id, 'index.mjs');
    if (!fs.existsSync(file)) continue;
    try {
      const mod = (await import(pathToFileURL(file).href)).default;
      const p = checkConnectorModule(mod, id, schemas);
      if (p) problem(`${rel(file)}: ${p}`);
    } catch (e) { problem(`${rel(file)}: could not load (${e.message})`); }
  }
}
function checkApps(dir, skip = []) {
  if (!fs.existsSync(dir)) return;
  for (const id of fs.readdirSync(dir).filter(n => !skip.includes(n))) {
    const file = path.join(dir, id, 'app.json');
    if (!fs.existsSync(file)) continue;
    let m;
    try { m = readJson(file); } catch (e) { problem(`${rel(file)}: not valid JSON`); continue; }
    const errs = schemas.validate('app', m);
    if (errs.length) problem(`${rel(file)}: ${errs.slice(0, 3).join('; ')}`);
    if (m.id !== id) problem(`${rel(file)}: id "${m.id}" does not match its folder "${id}"`);
    for (const f of [m.entry, m.icon, ...(m.files || [])].filter(Boolean)) if (!fs.existsSync(path.join(dir, id, f))) problem(`${rel(file)}: ${f} does not exist`);
    const cmds = new Set((m.commands || []).map(c => c.id));
    for (const s of m.shortcuts || []) if (!cmds.has(s.command)) problem(`${rel(file)}: shortcut ${s.keys} names unknown command ${s.command}`);
  }
}
await checkConnectors(path.join(REPO, 'connectors'));
await checkConnectors(path.join(REPO, 'tests', 'fixtures', 'connectors'));
checkApps(path.join(REPO, 'apps'));
checkApps(path.join(REPO, 'tests', 'fixtures', 'apps'), ['broken']);

// 6. No em dashes
const EM = String.fromCharCode(0x2014);
for (const file of [...textFiles(DOCS), ...textFiles(path.join(REPO, 'tests'))]) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => { if (line.includes(EM)) problem(`${rel(file)}:${i + 1}: em dash`); });
}

if (problems.length) {
  console.error(`Contract checks failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Contract checks passed: ${Object.keys(schemas.schemas).length} schemas, ${covered.size} with examples.`);
