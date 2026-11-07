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
  assert.deepEqual(P.formKeys('ado', adoSchema, 'pull-requests'), ['prTeams'], 'PR sources are drawn by hand');
  assert.deepEqual(P.formKeys('ado', adoSchema, 'repos'), []);
  assert.deepEqual(P.formPages('ado', adoSchema).sort(), ['connections', 'pull-requests', 'work-items']);
  assert.equal(adoSchema.properties.reports['x-workshop-section'], 'Team reports (used by Runway)');
});

test('opencode: everything on Agents except PR reviews, which go on Pull requests', () => {
  assert.deepEqual(P.formKeys('opencode', ocSchema, 'pull-requests'), ['prReviews']);
  const agents = P.formKeys('opencode', ocSchema, 'agents');
  assert.ok(agents.includes('workspace') && agents.includes('hub') && !agents.includes('prReviews'));
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
