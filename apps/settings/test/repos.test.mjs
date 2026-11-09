import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as R from '../js/repos.js';

const CFG = {
  connections: [
    { name: 'work', serverUrl: 'https://ado.example.com/tfs', collection: 'Main', project: 'Platform', patEnv: 'ADO_PAT' },
    { name: 'cloud', serverUrl: 'https://dev.azure.com', collection: 'acme', patEnv: 'ADO_PAT' }
  ],
  paths: [{ path: 'C:/src/legacy/*', connection: 'work', project: 'Old' }],
  prSources: [{ connection: 'work', project: 'Platform', repos: ['api'] }],
  types: ['Bug']
};
const STATE = {
  workspace: 'C:/source/repos',
  repos: [
    { folder: 'Platform/api', git: { web: 'https://ado.example.com/tfs/Main/Platform/_git/api' } },
    { folder: 'Platform/web', git: { web: 'https://ado.example.com/tfs/Main/Platform/_git/web-app' } },
    { folder: 'tools', git: { web: 'https://github.com/someone/tools' } },
    { folder: 'Other/thing', git: { web: 'https://ado.other.com/Coll/Proj/_git/thing' } }
  ]
};

test('repos: ADO parts from web and clone URLs', () => {
  assert.deepEqual(R.adoParts('https://ado.example.com/tfs/Main/Platform/_git/api'), { base: 'https://ado.example.com/tfs/Main', project: 'Platform', repo: 'api' });
  assert.deepEqual(R.adoParts('https://acme@dev.azure.com/acme/My%20Project/_git/web.git'), { base: 'https://dev.azure.com/acme', project: 'My Project', repo: 'web' });
  assert.deepEqual(R.adoParts('https://acme.visualstudio.com/DefaultCollection/P/_git/r'), { base: 'https://dev.azure.com/acme', project: 'P', repo: 'r' });
  assert.deepEqual(R.adoParts('git@ssh.dev.azure.com:v3/acme/P/r'), { base: 'https://dev.azure.com/acme', project: 'P', repo: 'r' });
  assert.equal(R.adoParts('https://github.com/a/b.git'), null);
  assert.equal(R.adoParts(''), null);
});

test('repos: rows read the mapping, then the remote', () => {
  const list = R.rows(STATE, CFG);
  assert.deepEqual(list.map(r => r.folder), ['Platform/api', 'Platform/web', 'tools', 'Other/thing']);
  const [api, web, tools, other] = list;
  assert.equal(api.path, 'C:/source/repos/Platform/api');
  assert.deepEqual(api.ado, { connection: 'work', project: 'Platform', repo: 'api', from: 'remote' });
  assert.equal(api.watch, 'repo');
  assert.equal(web.name, 'web-app', 'the ADO repo name comes from the remote, not the folder');
  assert.equal(web.watch, 'no');
  assert.equal(tools.ado, null);
  assert.equal(tools.remote, null);
  assert.equal(other.ado, null, 'a server that is not a connection is not guessed');
  assert.equal(other.remote.connection, null);
  assert.equal(R.unmapped(list).length, 2);
  assert.deepEqual(R.otherMappings(CFG, list).map(m => m.index), [0]);
});

test('repos: saving a repo writes its mapping and PR watch', () => {
  let cfg = R.saveRepo(CFG, { path: 'C:/source/repos/Platform/web', connection: 'work', project: 'Platform', repo: 'web-app', watch: true });
  assert.deepEqual(cfg.paths.at(-1), { path: 'C:/source/repos/Platform/web', connection: 'work' }, 'the connection\'s own project is left off');
  assert.deepEqual(cfg.prSources, [{ connection: 'work', project: 'Platform', repos: ['api', 'web-app'] }]);
  assert.equal(cfg.types[0], 'Bug', 'other settings are kept');
  assert.deepEqual(CFG.prSources[0].repos, ['api'], 'the input is not changed');
  // Moving to another project stops watching it in the old one.
  cfg = R.saveRepo(cfg, { path: 'C:/source/repos/Platform/web', connection: 'work', project: 'Apps', repo: 'web-app', watch: true,
    was: { connection: 'work', project: 'Platform', repo: 'web-app' } });
  assert.deepEqual(cfg.paths.at(-1), { path: 'C:/source/repos/Platform/web', connection: 'work', project: 'Apps' });
  assert.deepEqual(cfg.prSources, [{ connection: 'work', project: 'Platform', repos: ['api'] }, { connection: 'work', project: 'Apps', repos: ['web-app'] }]);
  // The last named repo out removes the source, since an empty list means every repo.
  cfg = R.saveRepo(cfg, { path: 'C:/source/repos/Platform/api', connection: 'work', project: 'Platform', repo: 'api', watch: false });
  assert.deepEqual(cfg.prSources, [{ connection: 'work', project: 'Apps', repos: ['web-app'] }]);
  // No connection removes the mapping.
  cfg = R.saveRepo(cfg, { path: 'c:\\source\\repos\\platform\\web\\', connection: '', repo: 'web-app', watch: false });
  assert.equal(cfg.paths.some(p => /Platform\/web/.test(p.path)), false);
});

test('repos: a whole-project source is not narrowed by one repo', () => {
  const cfg = { ...CFG, prSources: [{ connection: 'work', project: 'Platform', repos: [] }] };
  assert.equal(R.watchOf(cfg, 'work', 'platform', 'anything'), 'project');
  const out = R.saveRepo(cfg, { path: 'x', connection: 'work', project: 'Platform', repo: 'api', watch: false });
  assert.deepEqual(out.prSources, [{ connection: 'work', project: 'Platform', repos: [] }]);
});

test('repos: map every repo found by its remote', () => {
  const out = R.mapAll(CFG, R.rows(STATE, CFG));
  assert.deepEqual(out.paths.map(p => p.path), ['C:/src/legacy/*', 'C:/source/repos/Platform/api', 'C:/source/repos/Platform/web']);
  assert.deepEqual(out.prSources[0].repos, ['api'], 'watching stays as it was');
});

test('repos: PR sources and other mappings', () => {
  let cfg = R.addSource(CFG, 'cloud', 'Web');
  assert.deepEqual(cfg.prSources.at(-1), { connection: 'cloud', project: 'Web', repos: [] });
  cfg = R.setSourceScope(cfg, 0, true);
  assert.deepEqual(cfg.prSources[0].repos, []);
  cfg = R.setSourceScope(cfg, 0, false, ['api', 'api', 'web']);
  assert.deepEqual(cfg.prSources[0].repos, ['api', 'web']);
  cfg = R.setSourceScope(cfg, 1, false, []);
  assert.equal(cfg.prSources.length, 1, 'only some repos, with none, removes the source');
  cfg = R.removeSource(cfg, 0);
  assert.deepEqual(cfg.prSources, []);
  cfg = R.saveMapping(cfg, { path: ' D:/elsewhere/* ', connection: 'cloud', project: '' });
  assert.deepEqual(cfg.paths.at(-1), { path: 'D:/elsewhere/*', connection: 'cloud' });
  cfg = R.saveMapping(cfg, { index: 0, path: 'C:/src/legacy/*', connection: 'cloud', project: 'P' });
  assert.deepEqual(cfg.paths[0], { path: 'C:/src/legacy/*', connection: 'cloud', project: 'P' });
  cfg = R.saveMapping(cfg, { index: 0, path: 'C:/src/legacy/*', connection: '' });
  assert.equal(cfg.paths.length, 1);
});

test('repos: clone URL matched to a connection', () => {
  assert.deepEqual(R.fromCloneUrl(CFG, 'https://me@ado.example.com/tfs/Main/Platform/_git/new-svc'),
    { base: 'https://ado.example.com/tfs/Main', project: 'Platform', repo: 'new-svc', connection: 'work' });
  assert.equal(R.fromCloneUrl(CFG, 'https://other.example.com/C/P/_git/r').connection, null);
  assert.equal(R.fromCloneUrl(CFG, 'https://github.com/a/b.git'), null);
});

test('repos: the ADO connector puts paths on Repos and prSources on Pull requests, both editable from a paired site', async () => {
  const { configSchema } = await import('../../../connectors/ado/index.mjs');
  assert.equal(configSchema.properties.paths['x-workshop-page'], 'repos');
  assert.equal(configSchema.properties.prSources['x-workshop-page'], 'pull-requests');
  for (const k of R.KEYS) assert.equal(configSchema.properties[k]['x-workshop-hosted'], true, k);
});

test('hidden folders: clean entries, hide, unhide, and what a category covers', () => {
  assert.equal(R.hideEntry(' Tools/ '), 'Tools');
  assert.equal(R.hideEntry('Tools\\workshop'), 'Tools/workshop');
  for (const bad of ['', '/', 'a/b/c/d/e', '../x', 'a/./b']) assert.equal(R.hideEntry(bad), '');
  assert.equal(R.hideEntry('Platform/Lighthouse Edge/api'), 'Platform/Lighthouse Edge/api');
  assert.deepEqual(R.hiddenOf({ hiddenRepos: ['Tools', 'a/b/c/d/e', 'Platform\\web'] }), ['Tools', 'Platform/web']);
  assert.ok(R.isHidden(['Platform/Lighthouse'], 'Platform/Lighthouse/api'));
  assert.deepEqual(R.hiddenOf(null), []);

  assert.ok(R.isHidden(['Tools'], 'tools/workshop'));
  assert.ok(R.isHidden(['Tools/workshop'], 'Tools/workshop'));
  assert.ok(!R.isHidden(['Tools/workshop'], 'Tools/docket'));
  assert.ok(!R.isHidden(['Tool'], 'Tools/workshop'));

  let list = R.hide([], 'Tools/workshop');
  assert.deepEqual(list, ['Tools/workshop']);
  assert.deepEqual(R.hide(list, 'tools/workshop'), list); // already hidden
  list = R.hide(list, 'Tools'); // the category takes over its repo
  assert.deepEqual(list, ['Tools']);
  assert.deepEqual(R.hide(list, 'Tools/docket'), ['Tools']); // covered by the category
  assert.throws(() => R.hide(list, 'a/b/c/d/e'), /like Tools or Tools\/workshop/);
  assert.deepEqual(R.unhide(['Tools', 'gh-repo'], 'tools'), ['gh-repo']);
});
