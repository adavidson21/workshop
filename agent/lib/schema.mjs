// Copied from tests/lib/schema.mjs (C0, commit a8a78db) so the agent does not load code from tests/ at run time.
// agent/test/source.test.mjs fails if the copy drifts from tests/lib. Change tests/lib first, then copy.
// A small JSON Schema validator for the subset listed in docs/README.md. No dependencies, so the
// agent (WS1) can copy it. Unknown keywords throw, so a schema can never silently pass something.
import fs from 'node:fs';
import path from 'node:path';

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples', '$defs']);
const KEYWORDS = new Set(['$ref', 'type', 'properties', 'required', 'additionalProperties', 'patternProperties',
  'propertyNames', 'items', 'enum', 'const', 'pattern', 'format', 'minimum', 'maximum', 'minLength', 'maxLength',
  'minItems', 'maxItems', 'uniqueItems', 'oneOf', 'anyOf', 'allOf', 'not']);

/** Stable JSON with sorted keys, for equality checks. */
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const FORMATS = {
  'date-time': s => ISO.test(s) && !Number.isNaN(Date.parse(s)),
  uri: s => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } }
};

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
const typeMatches = (v, t) => t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t;

export class SchemaSet {
  /** @param {Record<string, object>} schemas file name (like "health.schema.json") to schema */
  constructor(schemas) { this.schemas = schemas; }

  static fromDir(dir) {
    const map = {};
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.schema.json')) map[f] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return new SchemaSet(map);
  }

  /** Validate value against "name" (file "<name>.schema.json") or an inline schema. Returns a list of error strings. */
  validate(nameOrSchema, value) {
    const errors = [];
    if (typeof nameOrSchema === 'string') {
      const file = nameOrSchema.endsWith('.json') ? nameOrSchema : `${nameOrSchema}.schema.json`;
      const root = this.schemas[file];
      if (!root) throw new Error(`No schema ${file}`);
      this.#check(root, value, '$', { file, root }, errors);
    } else {
      this.#check(nameOrSchema, value, '$', { file: null, root: nameOrSchema }, errors);
    }
    return errors;
  }

  /** Like validate, but throws with all errors. */
  assert(nameOrSchema, value, label = 'value') {
    const e = this.validate(nameOrSchema, value);
    if (e.length) throw new Error(`${label} does not match ${typeof nameOrSchema === 'string' ? nameOrSchema : 'schema'}:\n  ${e.slice(0, 20).join('\n  ')}`);
  }

  #resolve(ref, ctx) {
    const [filePart, pointer = ''] = ref.split('#');
    let file = ctx.file, root = ctx.root;
    if (filePart) {
      file = filePart;
      root = this.schemas[filePart];
      if (!root) throw new Error(`Unresolved $ref ${ref}: no schema file ${filePart}`);
    }
    let node = root;
    for (const part of pointer.split('/').filter(Boolean)) {
      node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      if (node === undefined) throw new Error(`Unresolved $ref ${ref}`);
    }
    return { schema: node, ctx: { file, root } };
  }

  #check(schema, v, at, ctx, errors) {
    if (schema === true || (schema && typeof schema === 'object' && Object.keys(schema).length === 0)) return;
    if (schema === false) { errors.push(`${at}: not allowed`); return; }
    for (const k of Object.keys(schema)) {
      if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k) && !k.startsWith('x-workshop-')) throw new Error(`Unsupported schema keyword "${k}" at ${at}`);
    }
    if (schema.$ref) {
      const r = this.#resolve(schema.$ref, ctx);
      this.#check(r.schema, v, at, r.ctx, errors);
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some(t => typeMatches(v, t))) { errors.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(v)}`); return; }
    }
    if ('const' in schema && canonical(v) !== canonical(schema.const)) errors.push(`${at}: must be ${JSON.stringify(schema.const)}`);
    if (schema.enum && !schema.enum.some(e => canonical(e) === canonical(v))) errors.push(`${at}: must be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')}`);

    if (typeof v === 'string') {
      if (schema.minLength !== undefined && [...v].length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && [...v].length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(v)) errors.push(`${at}: does not match ${schema.pattern}`);
      if (schema.format !== undefined) {
        const f = FORMATS[schema.format];
        if (!f) throw new Error(`Unsupported format "${schema.format}" at ${at}`);
        if (!f(v)) errors.push(`${at}: not a valid ${schema.format}`);
      }
    }
    if (typeof v === 'number') {
      if (schema.minimum !== undefined && v < schema.minimum) errors.push(`${at}: less than ${schema.minimum}`);
      if (schema.maximum !== undefined && v > schema.maximum) errors.push(`${at}: more than ${schema.maximum}`);
    }
    if (Array.isArray(v)) {
      if (schema.minItems !== undefined && v.length < schema.minItems) errors.push(`${at}: fewer than ${schema.minItems} items`);
      if (schema.maxItems !== undefined && v.length > schema.maxItems) errors.push(`${at}: more than ${schema.maxItems} items`);
      if (schema.uniqueItems) {
        const seen = new Set();
        v.forEach((x, i) => { const c = canonical(x); if (seen.has(c)) errors.push(`${at}[${i}]: duplicate item`); seen.add(c); });
      }
      if (schema.items !== undefined) v.forEach((x, i) => this.#check(schema.items, x, `${at}[${i}]`, ctx, errors));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const r of schema.required || []) if (!(r in v)) errors.push(`${at}: missing "${r}"`);
      const props = schema.properties || {};
      const pats = Object.entries(schema.patternProperties || {}).map(([p, s]) => [new RegExp(p, 'u'), s]);
      for (const [k, x] of Object.entries(v)) {
        const where = `${at}.${k}`;
        if (schema.propertyNames !== undefined) {
          const sub = [];
          this.#check(schema.propertyNames, k, where, ctx, sub);
          if (sub.length) errors.push(`${where}: property name not allowed`);
        }
        let matched = false;
        if (Object.hasOwn(props, k)) { matched = true; this.#check(props[k], x, where, ctx, errors); }
        for (const [re, s] of pats) if (re.test(k)) { matched = true; this.#check(s, x, where, ctx, errors); }
        if (!matched && schema.additionalProperties !== undefined) {
          if (schema.additionalProperties === false) errors.push(`${where}: unknown property`);
          else this.#check(schema.additionalProperties, x, where, ctx, errors);
        }
      }
    }
    if (schema.allOf) for (const s of schema.allOf) this.#check(s, v, at, ctx, errors);
    if (schema.anyOf && !schema.anyOf.some(s => this.#passes(s, v, at, ctx))) errors.push(`${at}: matches none of anyOf`);
    if (schema.oneOf) {
      const n = schema.oneOf.filter(s => this.#passes(s, v, at, ctx)).length;
      if (n !== 1) errors.push(`${at}: matches ${n} of oneOf, expected exactly 1`);
    }
    if (schema.not !== undefined && this.#passes(schema.not, v, at, ctx)) errors.push(`${at}: matches a schema it must not match`);
  }

  #passes(schema, v, at, ctx) {
    const e = [];
    this.#check(schema, v, at, ctx, e);
    return e.length === 0;
  }
}
