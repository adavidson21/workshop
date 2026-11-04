// worker/index.js: the one-line installers. /install.* and /install-work.* serve the same scripts; the work
// ones turn work mode on through {{WORK}}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installer, INSTALLERS } from '../index.js';

const SITE = 'https://workshop.alexisdavidson.org';
const read = f => fs.readFileSync(new URL(`../..${f}`, import.meta.url), 'utf8');
const env = { ASSETS: { fetch: async req => new Response(read(new URL(req.url).pathname)) } };
const get = async p => { const u = new URL(p, SITE); return installer(u, new Request(u), env); };

test('every installer path fills in the site and the work flag', async () => {
  for (const [p, e] of Object.entries(INSTALLERS)) {
    const text = await (await get(p)).text();
    assert.ok(!text.includes('{{SITE}}') && !text.includes('{{WORK}}'), p);
    assert.ok(text.includes(SITE), p);
    const ps = e.file.endsWith('.ps1');
    const flag = ps ? `('${e.work ? 1 : 0}' -eq '1')` : `[ '${e.work ? 1 : 0}' = '1' ]`;
    assert.ok(text.includes(flag), `${p} has ${flag}`);
  }
});

test('the scripts themselves have the placeholder, so running a downloaded copy is not work mode', () => {
  assert.match(read('/scripts/bootstrap.ps1'), /'\{\{WORK\}\}' -eq '1'/);
  assert.match(read('/scripts/bootstrap.sh'), /\[ '\{\{WORK\}\}' = '1' \]/);
});

test('other paths are not installers', async () => {
  assert.equal(await get('/install.txt'), null);
  assert.equal(await get('/scripts/bootstrap.ps1'), null);
});
