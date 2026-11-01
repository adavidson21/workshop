// mobile/scripts/build-web.mjs: Docket's files with the site's layout, without the service worker, the web
// app manifest, tests or the desktop-only ADO helper, and every local reference resolves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, checkRefs } from '../scripts/build-web.mjs';

test('build-web: Docket and what it needs, nothing else', () => {
  const www = mkdtempSync(join(tmpdir(), 'docket-www-'));
  try {
    const { files } = build({ www });
    assert.ok(files > 20);
    for (const f of ['index.html', 'js/main.js', 'shared/workshop-sdk.js', 'shared/device-fs.js', 'shared/save-file.js', 'shared/vendor/xlsx.full.min.js', 'icons/favicon.svg'])
      assert.ok(existsSync(join(www, f)), f);
    for (const f of ['sw.js', 'manifest.webmanifest', 'test', 'ado-helper', 'mobile', 'README.md', 'app.json', 'scripts', 'wrangler.jsonc'])
      assert.ok(!existsSync(join(www, f)), `${f} is left out`);
    assert.match(readFileSync(join(www, 'index.html'), 'utf8'), /<title>Docket<\/title>/);
    assert.doesNotMatch(readFileSync(join(www, 'index.html'), 'utf8'), /rel="manifest"/);
    assert.deepEqual(checkRefs(www), []);
  } finally { rmSync(www, { recursive: true, force: true }); }
});

test('build-web: a reference to a file the app does not have is reported', () => {
  const www = mkdtempSync(join(tmpdir(), 'docket-www-'));
  try {
    build({ www });
    writeFileSync(join(www, 'js/extra.js'), "import { x } from './missing.js';\n// import { y } from './in-a-comment.js';\n");
    assert.deepEqual(checkRefs(www), ['js/extra.js -> ./missing.js']);
  } finally { rmSync(www, { recursive: true, force: true }); }
});
