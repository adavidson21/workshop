// The template summarizer and summary files: same input gives the same Markdown; an edited summary is never
// overwritten; regenerating after an edit writes a new version beside it. Runs on the SDK's folder store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaSet } from '../../../tests/lib/schema.mjs';
import { entriesIn, peopleOf, settingsOf } from '../js/model.js';
import { GENERATOR, entryText, metricTotals, summarize } from '../js/summarize/template.js';
import { canonical, generate, readVersion, saveEdit, sha256, versionsFrom } from '../js/summary.js';
import { createStore } from '../js/store.js';
import { clone, fixture, workshop } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const schemas = SchemaSet.fromDir(path.join(HERE, '..', 'schemas'));
const cfg = fixture('config.json');
const settings = settingsOf(cfg, '2026-10-20');
const person = peopleOf(cfg).find(p => p.id === 'jordan-lee');
const [h1, h2] = settings.cycles;
const all = fixture('entries-jordan-lee-2026.json').items;

function input(overrides = {}) {
  return {
    person, cycle: h2, entries: entriesIn(all, h2), metrics: [fixture('metrics-jordan-lee-2026-09.json')], goals: [],
    previous: { cycle: h1, entries: entriesIn(all, h1), metrics: [fixture('metrics-jordan-lee-2026-03.json')] },
    rubric: settings.rubric, roles: settings.roles, ...overrides
  };
}

test('the template groups bullets by primary rubric section, in rubric order, with gaps and metric trends', () => {
  const out = summarize(input());
  assert.equal(out.generator, GENERATOR);
  assert.equal(out.markdown, fs.readFileSync(path.join(HERE, 'fixtures', 'summary-jordan-lee-2026-h2.md'), 'utf8'));
});

test('same input, same Markdown: no clock, and entry order in the input does not matter', () => {
  const a = summarize(input()).markdown;
  const b = summarize(input({ entries: [...entriesIn(all, h2)].reverse() })).markdown;
  assert.equal(a, b);
});

test('without metrics or a previous cycle, those lines are left out; no entries says so', () => {
  const md = summarize(input({ metrics: [], previous: null, entries: [] })).markdown;
  assert.ok(md.includes('- 0 entries.\n'));
  assert.ok(md.includes('- Rubric coverage: 0 of 7 sections.'));
  assert.ok(!md.includes('## Metrics') && !md.includes('Compared with'));
  assert.equal(entryText({ bullet: '', note: '\n\n  first line  \nsecond' }), 'first line');
  assert.deepEqual(metricTotals([fixture('metrics-jordan-lee-2026-09.json'), fixture('metrics-jordan-lee-2026-09.json')])['ado.closed'], { value: 14, unit: 'work items', months: 2 });
});

test('summary files: generate, edit, regenerate keeps the edit and writes version 2 beside it', async () => {
  const w = workshop(), win = w.open();
  const store = createStore({ data: win.data });
  const ctx = { files: win.files, store };
  const NOW = '2026-10-28T13:00:00.000Z';

  const r1 = await generate({ ...ctx, input: input(), summarize, now: NOW });
  assert.deepEqual(r1, { action: 'created', version: 1, path: 'summaries/jordan-lee/2026-h2.md' });
  const md = w.folder.read('receipts/summaries/jordan-lee/2026-h2.md');
  assert.equal(md, summarize(input()).markdown, 'the Markdown file is in the receipts folder');
  const sidecar = JSON.parse(w.folder.read('receipts/summaries/jordan-lee/2026-h2.json'));
  assert.deepEqual(schemas.validate('summary', sidecar), [], 'the sidecar matches its schema');
  assert.equal(sidecar.schema, 'receipts.summaries/jordan-lee/2026-h2');
  assert.equal(sidecar.items[0].outputHash, await sha256(md));
  assert.equal(sidecar.items[0].inputHash, await sha256(canonical(input())));
  assert.equal(sidecar.items[0].generatedAt, NOW);

  assert.equal((await generate({ ...ctx, input: input(), summarize })).action, 'unchanged', 'same input: nothing written');
  const more = input({ entries: [...entriesIn(all, h2), { ...all[0], id: 'r_new', date: '2026-10-20', rubric: ['leadership'], bullet: 'Mentored two new hires.' }] });
  const r2 = await generate({ ...ctx, input: more, summarize });
  assert.equal(r2.action, 'replaced', 'an unedited summary is replaced in place');
  assert.ok(w.folder.read('receipts/summaries/jordan-lee/2026-h2.md').includes('Mentored two new hires.'));

  // You edit it in Receipts.
  const v1 = await readVersion(ctx, 'jordan-lee', '2026-h2', 1);
  assert.equal(v1.edited, false);
  const mine = v1.content.replace('Mentored two new hires.', 'Mentored two new hires through their first launch.');
  const saved = await saveEdit(ctx, 'jordan-lee', '2026-h2', 1, mine, v1.mtime);
  assert.equal(saved.edited, true);
  await store.idle();
  assert.equal(JSON.parse(w.folder.read('receipts/summaries/jordan-lee/2026-h2.json')).items[0].edited, true);

  // Regenerate: the edit is kept, version 2 is new.
  const r3 = await generate({ ...ctx, input: input(), summarize });
  assert.deepEqual(r3, { action: 'new-version', version: 2, path: 'summaries/jordan-lee/2026-h2-v2.md' });
  assert.equal(w.folder.read('receipts/summaries/jordan-lee/2026-h2.md'), mine, 'the edited summary is never overwritten');
  assert.equal(w.folder.read('receipts/summaries/jordan-lee/2026-h2-v2.md'), summarize(input()).markdown);
  const v2side = JSON.parse(w.folder.read('receipts/summaries/jordan-lee/2026-h2-v2.json'));
  assert.deepEqual(schemas.validate('summary', v2side), []);
  assert.equal(v2side.items[0].file, 'summaries/jordan-lee/2026-h2-v2.md');
  assert.deepEqual(versionsFrom(await win.files.list('summaries/jordan-lee'), 'jordan-lee', '2026-h2').map(v => v.version), [1, 2]);
  assert.equal((await generate({ ...ctx, input: input(), summarize })).action, 'unchanged', 'version 2 is unedited and current');
});

test('summary files: an edit made in another program counts as an edit; a stale save is a conflict', async () => {
  const w = workshop(), win = w.open();
  const store = createStore({ data: win.data });
  const ctx = { files: win.files, store };
  await generate({ ...ctx, input: input(), summarize });
  const v1 = await readVersion(ctx, 'jordan-lee', '2026-h2', 1);
  w.folder.write('receipts/summaries/jordan-lee/2026-h2.md', v1.content + '\nAdded in another editor.\n');
  assert.equal((await readVersion(ctx, 'jordan-lee', '2026-h2', 1)).edited, true);
  const e = await saveEdit(ctx, 'jordan-lee', '2026-h2', 1, 'mine', v1.mtime).catch(err => err);
  assert.equal(e.code, 'conflict');
  assert.ok(e.current.content.endsWith('Added in another editor.\n'));
  const r = await generate({ ...ctx, input: input(), summarize });
  assert.equal(r.action, 'new-version');
  assert.ok(w.folder.read('receipts/summaries/jordan-lee/2026-h2.md').endsWith('Added in another editor.\n'));
});

test('the summarizer input hash is stable across key order', async () => {
  const a = input();
  const b = clone(a);
  b.person = { role: a.person.role, relation: a.person.relation, name: a.person.name, id: a.person.id, updatedAt: a.person.updatedAt, level: a.person.level, active: a.person.active };
  assert.equal(await sha256(canonical(a)), await sha256(canonical(b)));
});
