import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notesCards } from '../js/summary-cards.js';
import { buildIndex } from '../js/model.js';
import { SchemaSet } from './workshop/schema.mjs';

const schemas = SchemaSet.fromDir(join(dirname(fileURLToPath(import.meta.url)), 'workshop', 'schemas'));

test('Notes publishes a count, recent notes and app mentions, with titles and paths only', () => {
  const ix = buildIndex([
    { path: 'a.md', content: '# Alpha\n\nSecret text. [t](ws:prioritizer/task/t_1)', mtime: 3 },
    { path: 'b.md', content: '# Beta', mtime: 5 },
    { path: 'templates/meeting.md', content: '# {{title}}', mtime: 9 }
  ]);
  const cards = notesCards(ix);
  const by = Object.fromEntries(cards.map(c => [c.id, c]));
  assert.equal(by.notes.count, 2);
  assert.deepEqual(by.recent.rows.map(r => r.id), ['b.md', 'a.md']);
  assert.deepEqual(by.mentions.rows, [{ id: 'prioritizer/task/t_1|a.md', title: 'Alpha', route: 'a.md', note: 'prioritizer/task/t_1' }]);
  assert.equal(JSON.stringify(cards).includes('Secret'), false);
  for (const c of cards) assert.deepEqual(schemas.validate('summary-card', { ...c, updatedAt: 1 }), [], c.id);
});
