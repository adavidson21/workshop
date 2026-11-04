// Filling the ADO settings from a link copied out of ADO (lib/url.mjs, the config.fromUrl action).
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdoUrl, configFromUrl } from '../lib/url.mjs';

test('server links: /tfs is the server folder, then collection and project', () => {
  assert.deepEqual(parseAdoUrl('https://ado.example.com/tfs/Main/Search%20Team/_workitems/edit/123'),
    { serverUrl: 'https://ado.example.com/tfs', collection: 'Main', project: 'Search Team', repo: '' });
  assert.deepEqual(parseAdoUrl('https://ado.example.com:8443/DefaultCollection/Web/_git/site/pullrequest/42'),
    { serverUrl: 'https://ado.example.com:8443', collection: 'DefaultCollection', project: 'Web', repo: 'site' });
  assert.deepEqual(parseAdoUrl('https://ado.example.com/Main/Web/Team%20A/_backlogs/backlog'),
    { serverUrl: 'https://ado.example.com', collection: 'Main', project: 'Web', repo: '' });
  assert.deepEqual(parseAdoUrl('https://ado.example.com/tfs/Main'),
    { serverUrl: 'https://ado.example.com/tfs', collection: 'Main', project: '', repo: '' });
});

test('cloud links: the org is the collection', () => {
  assert.deepEqual(parseAdoUrl('https://dev.azure.com/contoso/Web/_boards/board'),
    { serverUrl: 'https://dev.azure.com', collection: 'contoso', project: 'Web', repo: '' });
  assert.deepEqual(parseAdoUrl('https://contoso.visualstudio.com/Web/_git/site'),
    { serverUrl: 'https://dev.azure.com', collection: 'contoso', project: 'Web', repo: 'site' });
});

test('links without a collection, or not links, say what to copy', () => {
  assert.throws(() => parseAdoUrl('not a link'), /not a link/);
  assert.throws(() => parseAdoUrl('https://ado.example.com/tfs/'), /no collection/);
  assert.throws(() => parseAdoUrl('ftp://ado.example.com/Main'), /https/);
});

test('a first link adds connection "work", the default connection and a PR source', () => {
  const { config, notes } = configFromUrl('https://ado.example.com/tfs/Main/Web/_workitems/edit/1', {});
  assert.deepEqual(config.connections, [{ name: 'work', serverUrl: 'https://ado.example.com/tfs', collection: 'Main', patEnv: 'ADO_PAT', apiVersion: '6.0', useSystemCa: true, verifyTls: true, project: 'Web' }]);
  assert.equal(config.defaultConnection, 'work');
  assert.deepEqual(config.prSources, [{ connection: 'work', project: 'Web', repos: [] }]);
  assert.ok(notes.some(n => n.includes('workshop pat ADO_PAT')));
});

test('a link for an existing connection fills its project and keeps everything else', () => {
  const current = { connections: [{ name: 'work', serverUrl: 'https://ADO.example.com/tfs/', collection: 'Main', patEnv: 'MY_PAT' }],
    prSources: [{ connection: 'work', project: 'Other', repos: ['x'] }], types: ['Bug'] };
  const { config } = configFromUrl('https://ado.example.com/tfs/Main/Web/_git/site', current);
  assert.equal(config.connections.length, 1);
  assert.equal(config.connections[0].project, 'Web');
  assert.equal(config.connections[0].patEnv, 'MY_PAT');
  assert.deepEqual(config.prSources, current.prSources);
  assert.deepEqual(config.types, ['Bug']);
  assert.equal(current.connections[0].project, undefined, 'the current config is not changed in place');
});

test('a link for another collection adds a second, uniquely named connection', () => {
  const current = { connections: [{ name: 'work', serverUrl: 'https://ado.example.com', collection: 'Main', patEnv: 'ADO_PAT' }], defaultConnection: 'work' };
  const { config } = configFromUrl('https://dev.azure.com/contoso/Web', current);
  assert.deepEqual(config.connections.map(c => c.name), ['work', 'contoso']);
  assert.equal(config.defaultConnection, 'work');
});
