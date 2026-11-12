// Turning apps on and off (docs/apps.md): <home>/apps.json, the registry and pinned copy that leave off apps
// out, git details read from files, and GET/PUT /api/app-switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAgent } from '../server.mjs';
import { readOff, writeOff, buildRegistry, gitHead, pinApps, appSwitches, readManifest, APPS_FILE } from '../lib/apps.mjs';
import { verifyPinned } from '../lib/pinned.mjs';
import { loadSchemas, skippedLines } from '../../workshop.mjs';
import { tempHome, rmHome, get, put, post, REPO, dataDirOf } from './helpers.mjs';
import { schemas as contractSchemas } from '../../tests/contract/helpers.mjs';

const schemas = loadSchemas();
const hasGit = spawnSync('git', ['--version']).status === 0;
const ids = reg => reg.apps.map(a => a.manifest.id);

test('apps.json keeps the apps turned off, and never Home or Settings', async () => {
  const home = tempHome();
  try {
    assert.deepEqual([...readOff(home)], [], 'no file: every app is on');
    await writeOff(home, new Set(['notes', 'home', 'settings', 'runway']));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, APPS_FILE), 'utf8')), { off: ['notes', 'runway'] });
    fs.writeFileSync(path.join(home, APPS_FILE), JSON.stringify({ off: ['notes', 'settings', 'Bad Name', 7] }));
    assert.deepEqual([...readOff(home)], ['notes']);
    fs.writeFileSync(path.join(home, APPS_FILE), 'not json');
    assert.deepEqual([...readOff(home)], [], 'an unreadable file turns nothing off');
  } finally { rmHome(home); }
});

test('the registry leaves out apps turned off', () => {
  const all = ids(buildRegistry(path.join(REPO, 'apps'), schemas));
  assert.ok(all.includes('slate') && all.includes('home'));
  const some = ids(buildRegistry(path.join(REPO, 'apps'), schemas, new Set(['slate'])));
  assert.deepEqual(some, all.filter(id => id !== 'slate'));
});

test('gitHead reads the commit and release tag from .git files, without running git', { skip: !hasGit && 'git is not installed' }, () => {
  const root = fs.mkdtempSync(path.join(path.dirname(tempHome()), 'githead-'));
  const g = (...a) => { const r = spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  try {
    g('init', '-q', '-b', 'main');
    g('-c', 'user.email=t@example.org', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one');
    const commit = g('rev-parse', 'HEAD');
    assert.deepEqual(gitHead(root), { commit, ref: 'main (not a release tag)' });
    g('tag', 'v1.2.0');
    assert.deepEqual(gitHead(root), { commit, ref: 'v1.2.0' });
    g('pack-refs', '--all');
    g('checkout', '-q', '--detach', 'v1.2.0');
    assert.deepEqual(gitHead(root), { commit, ref: 'v1.2.0' }, 'packed refs and a detached HEAD');
    g('tag', '-d', 'v1.2.0');
    assert.deepEqual(gitHead(root, { commit, ref: 'v1.1.0' }), { commit, ref: 'v1.1.0' }, 'an earlier record of the same commit supplies the tag');
    assert.equal(gitHead(path.join(root, 'nope')), null);
  } finally { fs.rmSync(path.dirname(root), { recursive: true, force: true }); }
});

test('pinApps leaves apps turned off out of the pinned copy, files and registry', async () => {
  const home = tempHome();
  try {
    await writeOff(home, new Set(['notes', 'receipts']));
    const { build, off } = pinApps({ home, repo: REPO, schemas, remotes: { docket: null } });
    assert.deepEqual([...off].sort(), ['notes', 'receipts']);
    assert.ok(!Object.keys(build.files).some(f => f.startsWith('apps/receipts/')), 'no Rapport files');
    assert.ok(!Object.keys(build.files).some(f => f.startsWith('apps/notes/')), 'no Notes files');
    assert.ok(build.files['apps/home/index.html'], 'Home is still there');
    const reg = JSON.parse(fs.readFileSync(path.join(home, 'ui', 'apps', 'registry.json'), 'utf8'));
    assert.ok(!ids(reg).includes('notes'));
    assert.equal(verifyPinned(path.join(home, 'ui')).ok, true);
    const view = appSwitches({ home, repo: REPO, schemas, workMode: true });
    contractSchemas.assert('app-switches', view, 'appSwitches');
    assert.equal(view.apps.find(a => a.id === 'notes').inWorkshop, false);
    assert.equal(view.apps.find(a => a.id === 'home').canTurnOff, false);
    assert.equal(view.apps.find(a => a.id === 'prioritizer').separate, true);
    assert.equal(view.apps.find(a => a.id === 'receipts').inWorkshop, false);
  } finally { rmHome(home); }
});

// Slate (built in) is the app switched here: Notes and the other remote apps depend on their checkouts.
test('GET and PUT /api/app-switches: changes come from this computer only, and work mode rebuilds the pinned copy', async () => {
  const home = tempHome();
  const uiDir = path.join(home, 'ui');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, allowedOrigins: ['https://workshop.example.org'], features: { hostedMode: false, workMode: true } }));
  pinApps({ home, repo: REPO, schemas, uiDir, remotes: { docket: null } });
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home), uiDir });
  try {
    let r = await get(agent, '/api/app-switches');
    assert.equal(r.status, 200, r.text);
    contractSchemas.assert('app-switches', r.json, 'GET');
    assert.equal(r.json.workMode, true);
    assert.equal(r.json.apps.find(a => a.id === 'slate').inWorkshop, true);

    r = await put(agent, '/api/app-switches/slate', { on: false });
    assert.equal(r.status, 200, r.text);
    contractSchemas.assert('app-switches', r.json, 'PUT');
    assert.equal(r.json.changed, 'slate');
    assert.equal(r.json.apps.find(a => a.id === 'slate').inWorkshop, false);
    assert.ok(!ids(JSON.parse(fs.readFileSync(path.join(uiDir, 'apps', 'registry.json'), 'utf8'))).includes('slate'), 'rebuilt without Slate');
    assert.equal((await get(agent, '/apps/slate/index.html', { auth: 'cookie' })).status, 404, 'Slate is no longer served');

    r = await put(agent, '/api/app-switches/slate', { on: true });
    assert.equal(r.status, 200, r.text);
    assert.equal((await get(agent, '/apps/slate/index.html', { auth: 'cookie' })).status, 200, 'Slate is back');

    assert.equal((await put(agent, '/api/app-switches/home', { on: false })).status, 400, 'Home is always on');
    assert.equal((await put(agent, '/api/app-switches/nope', { on: false })).status, 404);
    assert.equal((await put(agent, '/api/app-switches/slate', { on: 'yes' })).status, 400);
    assert.equal((await put(agent, '/api/app-switches/slate', { on: false }, { auth: 'cookie' })).status, 401, 'writes need the header token');

    // Turning on an app that is not downloaded saves the switch and says what to run; nothing is downloaded.
    r = await put(agent, '/api/app-switches/prioritizer', { on: false });
    r = await put(agent, '/api/app-switches/prioritizer', { on: true });
    assert.equal(r.status, 200, r.text);
    const docket = r.json.apps.find(a => a.id === 'prioritizer');
    if (!docket.downloaded) assert.equal(r.json.download, 'workshop apps on docket');
  } finally { await agent.stop(); rmHome(home); }
});

test('a paired site can read the switches but not change them', async () => {
  const home = tempHome();
  const site = 'https://workshop.example.org';
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, allowedOrigins: [site], features: { hostedMode: true } }));
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home) });
  try {
    const r = await get(agent, '/api/app-switches', { origin: site });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.workMode, false);
    assert.equal(r.json.pinned, null);
    const w = await put(agent, '/api/app-switches/notes', { on: false }, { origin: site });
    assert.equal(w.status, 403);
    assert.equal(w.json.code, 'local_only');
    assert.equal(fs.existsSync(path.join(home, APPS_FILE)), false, 'nothing was saved');
  } finally { await agent.stop(); rmHome(home); }
});

test('GET /api/doctor: the health check for Settings, from this computer only', async () => {
  const home = tempHome();
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, allowedOrigins: ['https://workshop.example.org'], features: { hostedMode: true } }));
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home) });
  try {
    const r = await get(agent, '/api/doctor');
    assert.equal(r.status, 200, r.text);
    assert.equal(typeof r.json.ok, 'boolean');
    assert.ok(r.json.lines.some(l => /^Workshop \d/.test(l)) && r.json.lines.some(l => /^Node v/.test(l)));
    const far = await get(agent, '/api/doctor', { origin: 'https://workshop.example.org' });
    assert.equal(far.status, 403, far.text);
    assert.equal(far.json.code, 'local_only');
  } finally { await agent.stop(); rmHome(home); }
});

test('pinApps leaves out an app whose app.json is not valid and says why', () => {
  const home = tempHome();
  const uiDir = path.join(home, 'ui');
  const appDir = path.join(home, 'docket-checkout');
  try {
    // Notes v2.6.1 listed a file twice; the app schema wants unique files. Docket is the app still from another repo.
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'apps', 'remote.json'), 'utf8')).apps.find(a => a.id === 'prioritizer').manifest;
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'app.json'), JSON.stringify({ ...manifest, files: [...manifest.files, manifest.files[0]] }));
    fs.writeFileSync(path.join(appDir, 'index.html'), '<!doctype html>');
    const { skipped } = pinApps({ home, repo: REPO, schemas, uiDir, remotes: { docket: appDir } });
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].id, 'prioritizer');
    assert.match(skipped[0].problem, /not a valid app manifest .*duplicate item/);
    assert.ok(!ids(JSON.parse(fs.readFileSync(path.join(uiDir, 'apps', 'registry.json'), 'utf8'))).includes('prioritizer'));
    assert.match(skippedLines(skipped)[0], /^Docket is not included: its app\.json is not a valid app manifest .*workshop update\).*workshop pin/);

    // The same manifest without the duplicate is pinned.
    fs.writeFileSync(path.join(appDir, 'app.json'), JSON.stringify(manifest));
    const again = pinApps({ home, repo: REPO, schemas, uiDir, remotes: { docket: appDir } });
    assert.deepEqual(again.skipped, []);
    assert.ok(ids(JSON.parse(fs.readFileSync(path.join(uiDir, 'apps', 'registry.json'), 'utf8'))).includes('prioritizer'));
  } finally { rmHome(home); }
});

test('readManifest explains a bad app.json in plain words', () => {
  const dir = tempHome();
  try {
    assert.match(readManifest(dir, 'x', schemas).problem, /no app\.json/);
    fs.writeFileSync(path.join(dir, 'app.json'), '{');
    assert.match(readManifest(dir, 'x', schemas).problem, /not valid JSON/);
    const ok = JSON.parse(fs.readFileSync(path.join(REPO, 'apps', 'slate', 'app.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify(ok));
    assert.equal(readManifest(dir, 'slate', schemas).problem, undefined);
    assert.match(readManifest(dir, 'notes', schemas).problem, /says id "slate", not "notes"/);
  } finally { rmHome(dir); }
});

test('POST /api/update-terminal: opens the Update terminal, from this computer only, with the header token', async () => {
  const home = tempHome();
  const site = 'https://workshop.example.org';
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, allowedOrigins: [site], features: { hostedMode: true } }));
  const opened = [];
  let fails = null;
  const openUpdateTerminal = async o => { if (fails) throw fails; opened.push(o); return { ok: true }; };
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home), openUpdateTerminal });
  try {
    const r = await post(agent, '/api/update-terminal');
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.command, /workshop\.mjs update --restart$/);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].repo, REPO);
    assert.equal((await get(agent, '/api/update-terminal')).status, 405);
    const far = await post(agent, '/api/update-terminal', undefined, { origin: site });
    assert.equal(far.status, 403, far.text);
    assert.equal(far.json.code, 'local_only');
    const cookieOnly = await post(agent, '/api/update-terminal', undefined, { auth: 'cookie' });
    assert.equal(cookieOnly.status, 401, 'a write needs the header token');
    fails = { status: 501, message: 'Opening a terminal works on Windows and macOS. Copy the command instead.' };
    const none = await post(agent, '/api/update-terminal');
    assert.equal(none.status, 503);
    assert.match(none.json.error, /Copy the command/);
    assert.equal(opened.length, 1);
  } finally { await agent.stop(); rmHome(home); }
});
