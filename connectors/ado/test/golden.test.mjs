// Golden tests: the connector must produce the same JSON as prioritizer/ado-helper/ado_helper.py, and make
// the same ADO calls, for the synthetic fixtures. Goldens come from the helper (make-goldens.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { cases } from './fixtures/team.mjs';
import { GOLDENS, comparable, comparableRequests, findPython, runNodeCase, runPythonCase, withServer } from './harness.mjs';

const golden = name => JSON.parse(fs.readFileSync(path.join(GOLDENS, `${name}.json`), 'utf8'));

for (const c of cases) {
  test(`connector matches the helper: ${c.name}`, async () => {
    const g = golden(c.name);
    await withServer(async srv => {
      const result = await runNodeCase(c, srv);
      assert.deepStrictEqual(comparable(result, srv.url), g.result);
      assert.deepStrictEqual(comparableRequests(srv.requests, srv.url), g.requests);
    });
  });
}

const python = findPython();
for (const c of cases) {
  test(`goldens are current with the helper: ${c.name}`, { skip: python ? false : 'Python 3 not found' }, async () => {
    const g = golden(c.name);
    await withServer(async srv => {
      const result = await runPythonCase(python, c, srv);
      assert.deepStrictEqual(comparable(result, srv.url), g.result, 'Run node connectors/ado/test/make-goldens.mjs after changing fixtures.');
      assert.deepStrictEqual(comparableRequests(srv.requests, srv.url), g.requests);
    });
  });
}
