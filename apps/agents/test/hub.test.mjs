// The hub's pure parts (js/hub-model.js): route.json checks against docs/schemas/hub-route.schema.json, the capture
// shape, the context sent with a message, and answer rendering. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actAllowed, answerHtml, checkRoute, hubContext, hubId, isHubCommand, isLow, toProposal } from '../js/hub-model.js';
import { SchemaSet } from '../../../tests/lib/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schemas = SchemaSet.fromDir(path.join(ROOT, 'docs/schemas'));
const examples = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith('hub-route.')).map(f => [f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]) : [];

test('checkRoute agrees with the schema on every docs example', { skip: !schemas.schemas['hub-route.schema.json'] && 'the hub-route schema is not on this branch yet (WS17a)' }, () => {
  for (const [f, r] of examples(path.join(ROOT, 'docs/examples'))) assert.ok(checkRoute(r), f);
  for (const [f, r] of examples(path.join(ROOT, 'docs/examples/invalid'))) assert.equal(checkRoute(r), null, f);
});

test('checkRoute: each intent needs its own field, unknown fields are refused', () => {
  assert.deepEqual(checkRoute({ version: 1, intent: 'go', go: { app: 'queue' } }), { version: 1, intent: 'go', go: { app: 'queue' } });
  assert.equal(checkRoute({ version: 1, intent: 'go' }), null);
  assert.equal(checkRoute({ version: 2, intent: 'go', go: { app: 'queue' } }), null);
  assert.equal(checkRoute({ version: 1, intent: 'go', go: { app: 'queue' }, run: 'x' }), null);
  assert.equal(checkRoute({ version: 1, intent: 'capture', act: { connector: 'ado', action: 'workitem.update', label: 'x' } }), null, 'an act disguised as a capture');
  assert.equal(checkRoute({ version: 1, intent: 'capture', proposals: [{ to: 'queue', text: 'x', payload: { kind: 'task' } }] }), null);
  assert.equal(checkRoute({ version: 1, intent: 'capture', proposals: [{ to: 'prioritizer', text: 'x', payload: { kind: 'win' } }] }), null, 'Docket takes tasks only');
  assert.equal(checkRoute({ version: 1, intent: 'capture', proposals: [{ to: 'receipts', text: 'x', payload: { kind: 'task' } }] }), null);
  assert.equal(checkRoute({ version: 1, intent: 'clarify', clarify: { question: 'Which?', choices: ['one'] } }), null, 'at least two choices');
  assert.equal(checkRoute({ version: 1, intent: 'ask', ask: { repos: ['a'], extra: 1 } }), null);
  assert.ok(checkRoute({ version: 1, intent: 'ask', ask: { repos: [] } }));
  assert.equal(checkRoute(null), null);
});

test('only spike and start.local are offered as buttons', () => {
  assert.equal(actAllowed({ connector: 'opencode', action: 'spike' }), true);
  assert.equal(actAllowed({ connector: 'opencode', action: 'start.local' }), true);
  assert.equal(actAllowed({ connector: 'opencode', action: 'push' }), false);
  assert.equal(actAllowed({ connector: 'ado', action: 'workitem.update' }), false);
});

test('toProposal: the shared capture shape', () => {
  const p = toProposal({ to: 'prioritizer', text: 'Keys', payload: { kind: 'task', title: 'Keys from IT', waiting: true }, confidence: 0.3, reason: 'r' });
  assert.equal(p.kind, 'waiting');
  assert.equal(p.title, 'Keys from IT');
  assert.equal(isLow(p), true);
  assert.equal(toProposal({ to: 'receipts', text: 'x', payload: { kind: 'growth' } }).kind, 'receipt');
  assert.equal(toProposal({ to: 'notes', text: 'x', payload: { kind: 'note' } }).kind, 'note');
});

test('hubContext: names only, from the directory, Docket\'s summary and Settings\' teams; archived and unknown versions left out', () => {
  const people = { schema: 'settings.people', version: 1, items: [{ id: 'p_1', name: 'Person One', relation: 'report', role: 'secret role' }, { id: 'p_2', name: 'Gone', archived: true }] };
  const summary = { schema: 'prioritizer.summary', version: 1, rev: 1, items: [{ id: 'lists', kind: 'targets', capture: 'task', title: 'Lists', updatedAt: 1, rows: [{ id: 'l1', title: 'Inbox' }] }] };
  const teams = { schema: 'settings.teams', version: 1, rev: 1, items: [{ id: 't_mine', name: 'Mine', areas: ['Project\\Team'], updatedAt: 1 }] };
  assert.deepEqual(hubContext({ people, summary, teams }), { people: [{ id: 'p_1', name: 'Person One', relation: 'report', team: true }], lists: ['Inbox'], areas: ['Project\\Team'] });
  assert.deepEqual(hubContext({ people: { ...people, version: 9 } }).people, []);
  assert.deepEqual(hubContext({ summary: { ...summary, version: 2 }, teams: { ...teams, version: 2 } }), { people: [], lists: [], areas: [] });
  assert.deepEqual(hubContext(), { people: [], lists: [], areas: [] });
});
test('answerHtml escapes everything and links only http(s)', () => {
  const h = answerHtml('<!-- c -->**net8.0** in `Api.csproj`\n\n## Confirmed\n\n- <script>alert(1)</script>\n- see https://example.com/x?a=1&b=2 and javascript:alert(1)');
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('&lt;script&gt;'));
  assert.ok(h.includes('<b>net8.0</b>') && h.includes('<code>Api.csproj</code>') && h.includes('<h4>Confirmed</h4>'));
  assert.ok(h.includes('<a href="https://example.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">'));
  assert.ok(!/href="javascript/.test(h));
  assert.ok(!h.includes('c -->'));
});

test('ids and hub sessions', () => {
  assert.match(hubId(), /^hub_[a-z0-9]{3,}$/);
  assert.equal(isHubCommand('/hub C:\\x\\request.md'), true);
  assert.equal(isHubCommand('/spike x'), false);
});
