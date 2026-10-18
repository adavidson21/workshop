// docs/data-format.md (Change stamps): the reference merge and stamp against the documented cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './helpers.mjs';
import { merge, stamp } from '../lib/data-merge.mjs';
import { canonical } from '../lib/schema.mjs';

const dir = path.join(REPO, 'docs', 'examples');
const cases = prefix => fs.readdirSync(dir).filter(f => f.startsWith(prefix)).map(f => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]);

for (const [file, c] of cases('data-merge-case.')) {
  test(`merge: ${file}`, () => {
    const local = structuredClone(c.local), remote = structuredClone(c.remote);
    assert.equal(canonical(merge(local, remote)), canonical(c.expected));
    assert.deepEqual(local, c.local, 'merge must not change its inputs');
    assert.deepEqual(remote, c.remote, 'merge must not change its inputs');
  });
}

for (const [file, c] of cases('data-stamp-case.')) {
  test(`stamp: ${file}`, () => {
    assert.equal(canonical(stamp(structuredClone(c.before), structuredClone(c.after), c.now)), canonical(c.expected));
  });
}

test('merge refuses different schema versions', () => {
  const a = { schema: 'notes.pages', version: 1, rev: 1, items: [] };
  assert.throws(() => merge(a, { ...a, version: 2 }), /Migrate first/);
});

test('there are merge and stamp cases to check', () => {
  assert.ok(cases('data-merge-case.').length >= 3);
  assert.ok(cases('data-stamp-case.').length >= 2);
});
