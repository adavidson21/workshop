// The SDK's data.merge and data.stamp (docs/sdk.md) must give the same results as the reference
// implementation in tests/lib/data-merge.mjs, checked against the documented cases in docs/examples/.
// This runs the SDK's own copy of the rules (shared/workshop-sdk.js) against those same cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { data as sdkData } from '../workshop-sdk.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(REPO, 'docs', 'examples');
const canonical = (v) => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  : JSON.stringify(v);
const cases = prefix => fs.readdirSync(dir).filter(f => f.startsWith(prefix)).map(f => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]);

for (const [file, c] of cases('data-merge-case.')) {
  test(`sdk merge: ${file}`, () => {
    const local = structuredClone(c.local), remote = structuredClone(c.remote);
    assert.equal(canonical(sdkData.merge(local, remote)), canonical(c.expected));
    assert.deepEqual(local, c.local, 'merge must not change its inputs');
    assert.deepEqual(remote, c.remote, 'merge must not change its inputs');
  });
}

for (const [file, c] of cases('data-stamp-case.')) {
  test(`sdk stamp: ${file}`, () => {
    assert.equal(canonical(sdkData.stamp(structuredClone(c.before), structuredClone(c.after), c.now)), canonical(c.expected));
  });
}

test('sdk merge refuses different schema versions', () => {
  const a = { schema: 'notes.pages', version: 1, rev: 1, items: [] };
  assert.throws(() => sdkData.merge(a, { ...a, version: 2 }), /Migrate first/);
});

test('there are cases to check', () => {
  assert.ok(cases('data-merge-case.').length >= 3);
  assert.ok(cases('data-stamp-case.').length >= 2);
});
