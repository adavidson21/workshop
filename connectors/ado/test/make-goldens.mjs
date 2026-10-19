// Regenerates test/goldens/*.json by running apps/prioritizer/ado-helper/ado_helper.py against the fake ADO
// server and the synthetic fixtures. Run after changing fixtures or the helper:
//   node connectors/ado/test/make-goldens.mjs
import fs from 'node:fs';
import path from 'node:path';
import { cases } from './fixtures/team.mjs';
import { GOLDENS, comparable, comparableRequests, findPython, runPythonCase, withServer } from './harness.mjs';

const python = findPython();
if (!python) {
  console.error('Python 3 was not found. It is needed to run the helper that produces the goldens.');
  process.exit(1);
}
fs.mkdirSync(GOLDENS, { recursive: true });
for (const c of cases) {
  await withServer(async srv => {
    const result = await runPythonCase(python, c, srv);
    const golden = { case: c.name, result: comparable(result, srv.url), requests: comparableRequests(srv.requests, srv.url) };
    fs.writeFileSync(path.join(GOLDENS, `${c.name}.json`), JSON.stringify(golden, null, 2) + '\n');
    console.log(`${c.name}: ${result.error ? 'error' : 'ok'}, ${srv.requests.length} requests`);
  });
}
