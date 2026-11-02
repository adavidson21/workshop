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

// Android's resource compiler rejects XML a browser would forgive (for example "--" inside a comment).
test('android: every resource and the manifest are well-formed XML', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const root = join(import.meta.dirname, '..', 'android', 'app', 'src', 'main');
  const walk = (d) => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const xml = walk(root).filter(p => p.endsWith('.xml') && !p.includes(`${join('assets', 'public')}`));
  assert.ok(xml.length >= 5);
  for (const f of xml) {
    const text = readFileSync(f, 'utf8');
    for (const [, c] of text.matchAll(/<!--([\s\S]*?)-->/g)) assert.ok(!c.includes('--'), `${f}: "--" inside a comment`);
    // A real XML parser where one is available (python3 ships one); otherwise the comment check above.
    try { execFileSync('python3', ['-c', 'import sys, xml.dom.minidom as m; m.parse(sys.argv[1])', f], { stdio: 'pipe' }); }
    catch (e) { if (e.code !== 'ENOENT') assert.fail(`${f}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); }
  }
});
