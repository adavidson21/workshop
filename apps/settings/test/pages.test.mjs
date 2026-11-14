// Settings' pages (js/pages.js): which page each connector field goes on, saving one page without touching
// another, the states with no Azure DevOps, and old addresses.
// Run: node --test "apps/*/test/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/pages.js';
import { configSchema as adoSchema } from '../../../connectors/ado/index.mjs';
import { configSchema as ocSchema } from '../../../connectors/opencode/index.mjs';

test('ADO fields are spread across Connections, Work items, Pull requests and Repos', () => {
  assert.deepEqual(P.formKeys('ado', adoSchema, 'connections'), ['defaultConnection'], 'connections themselves are drawn as a list');
  assert.deepEqual(P.formKeys('ado', adoSchema, 'work-items'), ['syncConnection', 'types', 'closedStates', 'removedStates', 'reports']);
  assert.deepEqual(P.formKeys('ado', adoSchema, 'pull-requests'), ['prTeams', 'prNotNeeded'], 'PR sources are drawn by hand');
  assert.deepEqual(P.formKeys('ado', adoSchema, 'repos'), []);
  assert.deepEqual(P.formPages('ado', adoSchema).sort(), ['connections', 'pull-requests', 'work-items']);
  assert.equal(adoSchema.properties.reports['x-workshop-section'], 'Team reports (used by Runway)');
});

test('opencode: everything on Agents except PR reviews, which go on Pull requests', () => {
  assert.deepEqual(P.formKeys('opencode', ocSchema, 'pull-requests'), ['prReviews']);
  const agents = P.formKeys('opencode', ocSchema, 'agents');
  assert.ok(agents.includes('workspace') && agents.includes('hub') && !agents.includes('prReviews'));
  // Hidden folders are drawn by the Repos page, not a generated form.
  assert.ok(!agents.includes('hiddenRepos') && !P.formPages('opencode', ocSchema).includes('repos'));
});

test('an unknown connector gets its own page, and an unknown page name falls back to it', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string', 'x-workshop-page': 'nowhere' }, c: { type: 'string', 'x-workshop-page': 'pull-requests' } } };
  assert.equal(P.mainPageOf('echo'), 'c-echo');
  assert.deepEqual(P.formKeys('echo', schema, 'c-echo'), ['a', 'b']);
  assert.deepEqual(P.formKeys('echo', schema, 'pull-requests'), ['c']);
  assert.equal(P.pageOfField('ado', { 'x-workshop-tab': 'repos' }), 'repos', 'the older name still works');
});

test('subSchema keeps only the page\'s fields and their required list', () => {
  const s = P.subSchema({ type: 'object', required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } } }, ['b', 'c']);
  assert.deepEqual(Object.keys(s.properties), ['b', 'c']);
  assert.deepEqual(s.required, ['b']);
});

test('saving one page leaves the other pages\' fields as they are now', () => {
  const now = { connections: [{ name: 'work' }], types: ['Bug'], prTeams: ['A'], paths: [{ path: 'x', connection: 'work' }] };
  const out = P.mergeKeys(now, ['prTeams', 'prSources'], { prTeams: ['B'] });
  assert.deepEqual(out, { connections: [{ name: 'work' }], types: ['Bug'], prTeams: ['B'], paths: [{ path: 'x', connection: 'work' }] });
  assert.ok(!('prSources' in out), 'an emptied field is left out so the default applies');
  assert.deepEqual(now.prTeams, ['A'], 'the input is not changed');
});

test('states with no Azure DevOps: not installed, off, no connection, connected, broken', () => {
  const ado = (enabled, state = 'ready') => ({ id: 'ado', name: 'Azure DevOps', enabled, status: { state } });
  assert.equal(P.connectorState(null, null), 'missing');
  assert.equal(P.connectorState(ado(false, 'disabled'), { connections: [{ name: 'w' }] }), 'off');
  assert.equal(P.connectorState(ado(true), {}), 'empty');
  assert.equal(P.connectorState(ado(true, 'error'), { connections: [] }), 'empty', 'no connection is not an error');
  assert.equal(P.connectorState(ado(true), { connections: [{ name: 'w' }] }), 'ready');
  assert.equal(P.connectorState(ado(true, 'error'), { connections: [{ name: 'w' }] }), 'error');
  assert.equal(P.connectorState({ id: 'opencode', enabled: true, status: { state: 'ready' } }, {}), 'ready', 'only ADO needs a connection');
});

test('Overview rows: nothing set up reads as neutral, never as needing attention', () => {
  const off = P.statusRow({ id: 'ado', enabled: false, status: { state: 'disabled' } }, {});
  assert.deepEqual([off.label, off.action], ['Off', 'Set up']);
  const empty = P.statusRow({ id: 'ado', enabled: true, status: { state: 'error', message: 'No connection' } }, {});
  assert.deepEqual([empty.label, empty.message, empty.action], ['Not set up', '', 'Set up']);
  const bad = P.statusRow({ id: 'ado', enabled: true, status: { state: 'error', message: 'PAT expired' } }, { connections: [{ name: 'w' }] });
  assert.deepEqual([bad.label, bad.message, bad.action], ['Needs attention', 'PAT expired', 'Fix']);
  const warn = P.statusRow({ id: 'ado', enabled: true, status: { state: 'ready', message: 'PAT expires in 9 days' } }, { connections: [{ name: 'w' }] });
  assert.deepEqual([warn.label, warn.action], ['Ready', 'Check']);
});

test('gate notes say what to do in one line', () => {
  assert.equal(P.gateNote('off', 'Azure DevOps', 'Connections'), 'Azure DevOps is off. Turn it on in Connections.');
  assert.equal(P.gateNote('empty', 'Azure DevOps', 'Connections'), 'Add a connection first, in Connections.');
  assert.equal(P.gateNote('ready', 'Azure DevOps', 'Connections'), '');
  assert.equal(P.gateNote('error', 'Azure DevOps', 'Connections'), '', 'set up but broken still shows the settings');
});

test('old addresses open the right page', () => {
  assert.deepEqual(P.routeToPage('general'), { page: 'overview' });
  assert.deepEqual(P.routeToPage('people/you/Riley%20Chen'), { page: 'people', focus: 'you', name: 'Riley Chen' });
  assert.deepEqual(P.routeToPage('people/you'), { page: 'people', focus: 'you', name: '' });
  assert.deepEqual(P.routeToPage('people/you/%E0%A4'), { page: 'people', focus: 'you', name: '' }, 'a bad escape is no name');
  assert.deepEqual(P.routeToPage('c-ado'), { page: 'connections' });
  assert.deepEqual(P.routeToPage('c-opencode'), { page: 'agents' });
  assert.deepEqual(P.routeToPage('repos'), { page: 'repos' });
  assert.deepEqual(P.routeToPage('data'), { page: 'data' });
  assert.deepEqual(P.routeToPage('people'), { page: 'people' });
  assert.deepEqual(P.routeToPage('people/team'), { page: 'team' });
  assert.deepEqual(P.routeToPage('people/import'), { page: 'people', focus: 'import' });
  assert.deepEqual(P.routeToPage('team'), { page: 'team' });
  assert.equal(P.routeToPage(''), null);
});

test('every page is in a group the nav knows', () => {
  const groups = new Set(P.GROUPS.map(g => g.id));
  for (const [id, p] of Object.entries(P.PAGES)) assert.ok(groups.has(p.group), id);
});

test('Products sits in You & your team and works with no connector', () => {
  assert.equal(P.PAGES.products.group, 'you');
  assert.equal(P.PAGES.products.owner, undefined);
  assert.deepEqual(P.routeToPage('products'), { page: 'products' });
});

test('Settings v3: three groups and eleven nav items, some holding pages as tabs', () => {
  assert.deepEqual(P.GROUPS.map(g => g.id), ['workshop', 'you', 'connections']);
  const items = [...new Set(P.ORDER.filter(id => !P.PAGES[id].hidden).map(P.navOf))];
  assert.deepEqual(items, ['overview', 'apps', 'computer', 'data', 'people-teams', 'products', 'focus', 'writing', 'ado', 'agents', 'repos']);
  assert.deepEqual(P.tabsOf('people-teams'), ['people', 'team']);
  assert.deepEqual(P.tabsOf('writing'), ['writing-voice', 'writing-audiences', 'writing-rules']);
  assert.deepEqual(P.tabsOf('ado'), ['connections', 'work-items', 'pull-requests']);
  assert.deepEqual(P.tabsOf('repos'), ['repos'], 'a page with no nav is a nav item of its own');
  assert.deepEqual(P.tabsOf('c-echo'), ['c-echo'], 'so is an unknown connector');
  assert.equal(P.navOf('c-echo'), 'c-echo');
  for (const id of P.tabsOf('ado')) assert.equal(P.PAGES[id].group, 'connections', id);
  assert.equal(P.navLabel('ado'), 'Azure DevOps');
  assert.equal(P.navLabel('overview'), 'Status');
  assert.equal(P.navLabel('agents'), 'opencode');
  assert.equal(P.navLabel('c-echo', 'Echo'), 'Echo');
  assert.equal(P.dotOf('ado'), 'ado');
  assert.equal(P.dotOf('agents'), 'opencode');
  assert.equal(P.dotOf('people-teams'), '');
  assert.equal(P.PAGES.guide.hidden, true, 'the User guide is a link under the nav, not a nav item');
  assert.deepEqual(P.routeToPage('guide'), { page: 'guide' });
  assert.deepEqual(P.routeToPage('status'), { page: 'overview' });
  assert.deepEqual(P.routeToPage('opencode'), { page: 'agents' });
  assert.deepEqual(P.routeToPage('writing'), { page: 'writing-voice' });
});

test('Needs you: only connectors that are set up and broken or warning, Fix first', () => {
  const c = (id, enabled, status, config) => ({ info: { id, name: id.toUpperCase(), enabled, status }, config });
  const rows = [
    c('ado', true, { state: 'ready', message: 'The PAT in ADO_PAT expires in 6 days.' }, { connections: [{ name: 'w' }] }),
    c('opencode', true, { state: 'error', message: 'opencode is not running.' }, {}),
    c('echo', false, { state: 'disabled' }, {}),
    c('fine', true, { state: 'ready', message: null }, {}),
    { info: null, config: null }
  ];
  const out = P.needsYou(rows);
  assert.deepEqual(out.map(x => [x.id, x.action, x.page]), [['opencode', 'Fix', 'agents'], ['ado', 'Check', 'connections']]);
  assert.equal(out[1].message, 'The PAT in ADO_PAT expires in 6 days.');
  assert.deepEqual(P.needsYou([c('ado', true, { state: 'error', message: 'x' }, { connections: [] })]), [], 'no connection is not set up, not broken');
  assert.deepEqual(P.needsYou([c('ado', true, { state: 'starting', message: 'Reading' }, { connections: [{ name: 'w' }] })]), [], 'starting is not a warning');
  assert.deepEqual(P.needsYou([]), []);
});
