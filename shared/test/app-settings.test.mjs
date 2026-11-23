import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../app-settings.js';
import { _internals, appsFromRegistry, WorkshopError } from '../workshop-sdk.js';
import { SchemaSet } from '../../tests/lib/schema.mjs';

const schemas = SchemaSet.fromDir(new URL('../../docs/schemas/', import.meta.url).pathname);
const DECL = [{ id: 'sprints', type: 'boolean', title: 'Use sprints', description: 'Plan by sprint day.', default: true }];

test('app settings: declared switches are cleaned; bad or repeated ones dropped', () => {
  const out = A.declared([...DECL, { id: 'sprints', type: 'boolean', title: 'Again', default: false }, { id: 'Bad', type: 'boolean', title: 'x' },
    { id: 'color', type: 'string', title: 'Color' }, { id: 'quiet', type: 'boolean', title: ' Quiet ' }, null]);
  assert.deepEqual(out, [{ ...DECL[0] }, { id: 'quiet', type: 'boolean', title: 'Quiet', description: '', default: false }]);
  assert.deepEqual(A.declared(undefined), []);
});

test('app settings: defaults, then saved values; items match docs/app-settings.md', () => {
  assert.deepEqual(A.valuesFor(null, 'tasks', DECL), { sprints: true });
  const items = A.withValues([{ id: 'notes', updatedAt: 1, values: { x: true } }], 'tasks', { sprints: false, junk: { no: 1 }, Bad: true });
  assert.deepEqual(items.map(i => i.id), ['notes', 'tasks']);
  const env = { ...A.blank(), items: items.map(i => ({ ...i, updatedAt: 1 })) };
  assert.deepEqual(A.valuesFor(env, 'tasks', DECL), { sprints: false });
  assert.deepEqual(A.valuesFor(env, 'tasks', []), { sprints: false }, 'saved values are kept without a declaration');
  for (const i of env.items) assert.deepEqual(schemas.validate('app-setting', i), []);
  assert.deepEqual(schemas.validate('app', { manifestVersion: 1, id: 'x', name: 'X', version: '1.0.0', icon: 'i.svg', entry: 'index.html', settings: DECL }), []);
  assert.throws(() => A.withValues([], 'Not An Id', {}));
  assert.equal(A.readable({ ...env, version: 2 }), false);
});

test('app settings: numbers, dates, text and lines are typed, clamped and kept', () => {
  const decl = A.declared([
    { id: 'staleDays', type: 'number', title: 'Flag after', default: 30, min: 1, max: 365 },
    { id: 'cycleStart', type: 'date', title: 'Cycle starts', default: 'soon' },
    { id: 'label', type: 'text', title: 'Label', default: '  Hi  ' },
    { id: 'sections', type: 'lines', title: 'Sections', default: ['A', ' B ', 'A', ''] }
  ]);
  assert.deepEqual(decl.map(d => d.default), [30, '', 'Hi', ['A', 'B']]);
  assert.equal(decl[0].min, 1);
  const items = A.withValues([], 'people', { staleDays: 900, cycleStart: '2026-07-01', label: 'x', sections: ['Craft', 'Craft', 'Growth'], bad: NaN, nope: null });
  const env = { ...A.blank(), items: items.map(i => ({ ...i, updatedAt: 1 })) };
  assert.deepEqual(A.valuesFor(env, 'people', decl), { staleDays: 365, cycleStart: '2026-07-01', label: 'x', sections: ['Craft', 'Growth'] });
  for (const i of env.items) assert.deepEqual(schemas.validate('app-setting', i), []);
  assert.deepEqual(schemas.validate('app', { manifestVersion: 1, id: 'x', name: 'X', version: '1.0.0', icon: 'i.svg', entry: 'index.html', settings: [{ id: 'n', type: 'number', title: 'N', default: 3, min: 1 }, { id: 'l', type: 'lines', title: 'L', default: ['a'] }] }), []);
  const wrong = { ...A.blank(), items: [{ id: 'people', updatedAt: 1, values: { staleDays: 'ten' } }] };
  assert.equal(A.valuesFor(wrong, 'people', decl).staleDays, 30, 'a saved value of the wrong type keeps the default');
});

test('ws.apps.list(): carries each manifest\'s declared settings', () => {
  const list = appsFromRegistry({ apps: [{ manifest: { id: 'tasks', name: 'Tasks', settings: DECL } }] });
  assert.deepEqual(list[0].settings, DECL);
});

function store() {
  let stored = null;
  return {
    get stored() { return stored; },
    set stored(v) { stored = v; },
    async get(app, col) { assert.equal(`${app}/${col}`, 'settings/app-settings'); return stored ? structuredClone(stored) : null; },
    async put(app, col, e) { const rev = stored ? stored.rev : 0; if (e.rev !== rev) throw new WorkshopError('conflict'); stored = { ...structuredClone(e), rev: rev + 1 }; return { rev: stored.rev }; },
    subscribe() { return () => {}; }
  };
}

test('ws.appSettings: an app reads defaults and saves its own values; only Settings changes another app\'s', async () => {
  const data = store();
  const declOf = async (id) => (id === 'tasks' ? DECL : []);
  const mine = _internals.appSettingsService(data, 'tasks', declOf);
  assert.deepEqual(await mine.get(), { sprints: true });
  assert.deepEqual(await mine.declared(), DECL);
  const heard = [];
  mine.subscribe(v => heard.push(v.sprints));
  assert.deepEqual(await mine.set({ sprints: false }), { sprints: false });
  assert.equal(data.stored.schema, 'settings.app-settings');
  assert.deepEqual(heard, [false]);
  await assert.rejects(mine.set({ x: true }, { app: 'notes' }), e => e.code === 'forbidden');

  const settings = _internals.appSettingsService(data, 'settings', declOf);
  assert.deepEqual(await settings.get({ app: 'tasks' }), { sprints: false });
  await settings.set({ sprints: true }, { app: 'tasks' });
  assert.deepEqual(await mine.get(), { sprints: true });

  data.stored = { ...data.stored, version: 2 };
  await assert.rejects(mine.get(), e => e.code === 'unsupported');
});
