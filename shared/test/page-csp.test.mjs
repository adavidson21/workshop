// Every page Workshop ships may talk only to its own site and Workshop on this computer (docs/security.md,
// No third-party requests; docs/data-format.md, Where data can go). A page that could send data anywhere else
// fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['test', 'node_modules', 'vendor', 'brand', 'screenshots', 'fonts']);

function pages(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) pages(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const directives = csp => Object.fromEntries(csp.split(';').map(s => s.trim()).filter(Boolean).map(s => {
  const [name, ...values] = s.split(/\s+/);
  return [name, values];
}));

test('every page carries a CSP that allows requests only to itself and 127.0.0.1', () => {
  const files = ['index.html', ...['apps', 'shell', 'shared'].flatMap(d => pages(path.join(REPO, d)).map(f => path.relative(REPO, f)))];
  assert.ok(files.length > 5, 'pages found');
  for (const rel of files) {
    const html = fs.readFileSync(path.join(REPO, rel), 'utf8');
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(m, `${rel} has no Content-Security-Policy meta tag`);
    const d = directives(m[1]);
    assert.deepEqual(d['default-src'], ["'self'"], `${rel}: default-src`);
    assert.deepEqual(d['connect-src'], ["'self'", 'http://127.0.0.1:*'], `${rel}: connect-src may name only the site and 127.0.0.1`);
    assert.deepEqual(d['form-action'], ["'self'"], `${rel}: form-action`);
    for (const [name, values] of Object.entries(d)) {
      for (const v of values) assert.ok(!/^https?:\/\/(?!127\.0\.0\.1)/.test(v) && v !== '*' && v !== 'https:', `${rel}: ${name} allows ${v}`);
    }
  }
});
