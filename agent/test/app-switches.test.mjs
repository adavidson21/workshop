// Turning apps on and off (docs/apps.md): <home>/apps.json, the registry and pinned copy that leave off apps
// out, git details read from files, and GET/PUT /api/app-switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAgent } from '../server.mjs';
import { readOff, writeOff, buildRegistry, gitHead, pinApps, appSwitches, APPS_FILE } from '../lib/apps.mjs';
import { verifyPinned } from '../lib/pinned.mjs';
import { loadSchemas } from '../../workshop.mjs';
import { tempHome, rmHome, get, put, REPO, dataDirOf } from './helpers.mjs';
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
  assert.ok(all.includes('notes') && all.includes('home'));
  const some = ids(buildRegistry(path.join(REPO, 'apps'), schemas, new Set(['notes'])));
  assert.deepEqual(some, all.filter(id => id !== 'notes'));
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
    await writeOff(home, new Set(['notes', 'runway']));
    const { build, off } = pinApps({ home, repo: REPO, schemas, remotes: { docket: null, runway: null } });
    assert.deepEqual([...off].sort(), ['notes', 'runway']);
    assert.ok(!Object.keys(build.files).some(f => f.startsWith('apps/notes/')), 'no Notes files');
    assert.ok(build.files['apps/home/index.html'], 'Home is still there');
    const reg = JSON.parse(fs.readFileSync(path.join(home, 'ui', 'apps', 'registry.json'), 'utf8'));
    assert.ok(!ids(reg).includes('notes'));
    assert.equal(verifyPinned(path.join(home, 'ui')).ok, true);
    const view = appSwitches({ home, repo: REPO, schemas, workMode: true });
    contractSchemas.assert('app-switches', view, 'appSwitches');
    assert.equal(view.apps.find(a => a.id === 'notes').inWorkshop, false);
    assert.equal(view.apps.find(a => a.id === 'home').canTurnOff, false);
    const runway = view.apps.find(a => a.id === 'runway');
    assert.equal(runway.separate, true);
    assert.equal(runway.on, false);
  } finally { rmHome(home); }
});

test('GET and PUT /api/app-switches: changes come from this computer only, and work mode rebuilds the pinned copy', async () => {
  const home = tempHome();
  const uiDir = path.join(home, 'ui');
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, allowedOrigins: ['https://workshop.example.org'], features: { hostedMode: false, workMode: true } }));
  pinApps({ home, repo: REPO, schemas, uiDir, remotes: { docket: null, runway: null } });
  const agent = await createAgent({ home, port: 0, dataDir: dataDirOf(home), uiDir });
  try {
    let r = await get(agent, '/api/app-switches');
    assert.equal(r.status, 200, r.text);
    contractSchemas.assert('app-switches', r.json, 'GET');
    assert.equal(r.json.workMode, true);
    assert.equal(r.json.apps.find(a => a.id === 'notes').inWorkshop, true);

    r = await put(agent, '/api/app-switches/notes', { on: false });
    assert.equal(r.status, 200, r.text);
    contractSchemas.assert('app-switches', r.json, 'PUT');
    assert.equal(r.json.changed, 'notes');
    assert.equal(r.json.apps.find(a => a.id === 'notes').inWorkshop, false);
    assert.ok(!ids(JSON.parse(fs.readFileSync(path.join(uiDir, 'apps', 'registry.json'), 'utf8'))).includes('notes'), 'rebuilt without Notes');
    assert.equal((await get(agent, '/apps/notes/index.html', { auth: 'cookie' })).status, 404, 'Notes is no longer served');

    r = await put(agent, '/api/app-switches/notes', { on: true });
    assert.equal(r.status, 200, r.text);
    assert.equal((await get(agent, '/apps/notes/index.html', { auth: 'cookie' })).status, 200, 'Notes is back');

    assert.equal((await put(agent, '/api/app-switches/home', { on: false })).status, 400, 'Home is always on');
    assert.equal((await put(agent, '/api/app-switches/nope', { on: false })).status, 404);
    assert.equal((await put(agent, '/api/app-switches/notes', { on: 'yes' })).status, 400);
    assert.equal((await put(agent, '/api/app-switches/notes', { on: false }, { auth: 'cookie' })).status, 401, 'writes need the header token');

    // Turning on an app that is not downloaded saves the switch and says what to run; nothing is downloaded.
    r = await put(agent, '/api/app-switches/runway', { on: false });
    r = await put(agent, '/api/app-switches/runway', { on: true });
    assert.equal(r.status, 200, r.text);
    const runway = r.json.apps.find(a => a.id === 'runway');
    if (!runway.downloaded) assert.equal(r.json.download, 'workshop apps on runway');
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
