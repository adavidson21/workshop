// What other apps add to a day's note (daily.js) and Docket's wrap-up arriving through pickup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { data as sdkData } from '../shared/workshop-sdk.js';
import { addUnder, docketPlan, hashText, writeSection } from '../js/daily.js';
import { startPickup } from '../js/pickup.js';
import { STARTERS, dailyText, fill } from '../js/templates.js';
import { actionItems } from '../js/offers.js';

const DAY = '2026-11-06';
const summary = (board) => ({ schema: 'prioritizer.summary', version: 1, rev: 1, deleted: {}, items: [{ id: 'board', kind: 'board', updatedAt: 1, ...board }] });

test('{{docket}}: the day\'s Today tasks as links, else Up next, else an empty checkbox', () => {
  const env = summary({ days: { [DAY]: { focus: { total: 3, done: 1, tasks: [
    { id: 't_1', title: 'Fix [the] login', done: false }, { id: 't_2', title: 'Done one', done: true }, { id: 'bad id', title: 'x', done: false }] } } },
    upNext: [{ id: 'u_1', title: 'Up next' }] });
  assert.equal(docketPlan(env, DAY), '- [Fix (the) login](ws:prioritizer/task/t_1)');
  assert.equal(docketPlan(env, '2026-11-07'), '- [Up next](ws:prioritizer/task/u_1)', 'no Today for that day: Up next');
  assert.equal(docketPlan(null, DAY), '');
  assert.equal(docketPlan({ ...env, schema: 'other.summary' }, DAY), '');
  assert.match(dailyText(DAY, null, docketPlan(env, DAY)), /^# 2026-11-06\n\n## Plan\n\n- \[Fix \(the\) login\]\(ws:prioritizer\/task\/t_1\)\n\n## Notes/);
  assert.match(dailyText(DAY), /## Plan\n\n- \[ \] \n/, 'no Docket: one empty checkbox');
  assert.ok(STARTERS['templates/daily.md'].includes('{{docket}}'));
  assert.equal(fill('{{docket}}', { docket: '- a' }), '- a');
});

test('a Docket link on its own is not an action item to send back to Docket', () => {
  assert.deepEqual(actionItems('- [ ] [Fix](ws:prioritizer/task/t_1)\n- [ ] Call [Fix](ws:prioritizer/task/t_1) owner\n').map(i => i.text), ['Call [Fix](ws:prioritizer/task/t_1) owner']);
});

test('writeSection: added, replaced while unchanged, a new one when you edited it', () => {
  const base = '# 2026-11-06\n\n## Plan\n\n- a\n\n## Notes\n\nmine\n';
  const a = writeSection(base, 'Wrap-up', '- Done: A.');
  assert.equal(a.content, base + '\n## Wrap-up\n\n- Done: A.\n');
  assert.equal(a.heading, 'Wrap-up');
  const b = writeSection(a.content, 'Wrap-up', '- Done: A, B.', a);
  assert.equal(b.content, base + '\n## Wrap-up\n\n- Done: A, B.\n', 'replaced in place');
  const edited = b.content.replace('A, B.', 'A, B. Good day.');
  const c = writeSection(edited, 'Wrap-up', '- Done: A, B, C.', b);
  assert.equal(c.heading, 'Wrap-up (2)');
  assert.ok(c.content.includes('Good day.') && c.content.endsWith('## Wrap-up (2)\n\n- Done: A, B, C.\n'), 'your edits stay');
  const mid = writeSection('## Wrap-up\n\n- old\n\n## Notes\n\nx\n', 'Wrap-up', '- new', { heading: 'Wrap-up', hash: hashText('- old') });
  assert.equal(mid.content, '## Wrap-up\n\n- new\n\n## Notes\n\nx\n', 'a section in the middle keeps the one after it');
  assert.equal(writeSection('## Wrap-up\n\nmine\n', 'Wrap-up', '- x').heading, 'Wrap-up (2)', 'a heading you wrote is never taken over');
  assert.equal(writeSection('```\n## Wrap-up\n```\n', 'Wrap-up', '- x').heading, 'Wrap-up', 'headings in code do not count');
});

test('addUnder: at the end of the section, or a new section', () => {
  assert.equal(addUnder('# D\n\n## Notes\n\n- one\n\n## Wins\n', 'Notes', '- two'), '# D\n\n## Notes\n\n- one\n- two\n\n## Wins\n');
  assert.equal(addUnder('# D\n\n## Notes\n\n## Wins\n', 'Notes', '- two'), '# D\n\n## Notes\n\n- two\n\n## Wins\n');
  assert.equal(addUnder('# D\n', 'Notes', '- two'), '# D\n\n## Notes\n\n- two\n');
});

const offer = (id, lines, at) => ({ id, updatedAt: 1, to: 'notes', date: DAY, createdAt: at, accepted: true, text: `Wrap-up for ${DAY}`,
  payload: { kind: 'note', daily: DAY, section: 'Wrap-up', lines }, source: { app: 'prioritizer', id: 'wrap' } });
const henv = (items) => ({ schema: 'prioritizer.handoffs', version: 1, rev: 1, items, deleted: {} });
function fakeWs(cols, files) {
  return {
    data: {
      stamp: sdkData.stamp, merge: sdkData.merge,
      async get(name, o = {}) { const v = cols.get(`${o.app || 'notes'}/${name}`); return v ? structuredClone(v) : null; },
      async put(name, e) { cols.set(`notes/${name}`, { ...structuredClone(e), rev: (e.rev || 0) + 1 }); return { rev: e.rev + 1 }; },
      subscribe() {}
    },
    files: {
      async read(path) { return files.has(path) ? { content: files.get(path), mtime: 1 } : null; },
      async write(path, content, o) { if (o.create && files.has(path)) { const e = new Error('c'); e.code = 'conflict'; throw e; } files.set(path, content); return {}; }
    }
  };
}

test("Docket's wrap-up lands in the day's note, is replaced by a later one, and never overwrites your edits", async () => {
  const files = new Map(), cols = new Map();
  cols.set('prioritizer/handoffs', henv([offer('w_1', ['Done: A.', 'Day: 1 task done, 0 switches, 0 interruptions.'], '2026-11-06T21:00:00Z')]));
  const added = [];
  const p = startPickup(fakeWs(cols, files), { files: new Map() }, { onAdded: (w) => added.push(...w), dailyText: async (d) => `# ${d}\n\n## Notes\n` });
  assert.equal(await p.run(), 1);
  assert.equal(files.get(`daily/${DAY}.md`), `# ${DAY}\n\n## Notes\n\n## Wrap-up\n\n- Done: A.\n- Day: 1 task done, 0 switches, 0 interruptions.\n`);
  assert.equal(added[0].section, 'Wrap-up');
  cols.set('prioritizer/handoffs', henv([offer('w_2', ['Done: A, B.'], '2026-11-06T22:00:00Z')]));
  assert.equal(await p.run(), 1);
  assert.equal(files.get(`daily/${DAY}.md`), `# ${DAY}\n\n## Notes\n\n## Wrap-up\n\n- Done: A, B.\n`);
  files.set(`daily/${DAY}.md`, files.get(`daily/${DAY}.md`).replace('A, B.', 'A, B. Proud of this.'));
  cols.set('prioritizer/handoffs', henv([offer('w_3', ['Done: A, B, C.'], '2026-11-06T23:00:00Z')]));
  assert.equal(await p.run(), 1);
  const final = files.get(`daily/${DAY}.md`);
  assert.ok(final.includes('Proud of this.') && final.endsWith('## Wrap-up (2)\n\n- Done: A, B, C.\n'));
  assert.equal(await p.run(), 0, 'each offer once');
});

test("the day's note waits while it has unsaved edits", async () => {
  const files = new Map(), cols = new Map();
  cols.set('prioritizer/handoffs', henv([offer('w_1', ['Done: A.'], '2026-11-06T21:00:00Z')]));
  let held = true;
  const p = startPickup(fakeWs(cols, files), { files: new Map() }, { hold: () => held });
  assert.equal(await p.run(), 0);
  held = false;
  assert.equal(await p.run(), 1);
  assert.ok(files.get(`daily/${DAY}.md`).includes('## Wrap-up'), 'made from the starter daily template');
});

const hEnv = (items) => ({ schema: 'home.handoffs', version: 1, rev: 1, items, deleted: {} });
const cap = (id, payload, text = 'Rollback needs the flag off') => ({ id, updatedAt: 1, to: 'notes', date: DAY, createdAt: `${DAY}T10:00:00Z`, accepted: true, text, payload: { kind: 'note', title: text, ...payload }, source: { app: 'home', id } });

test('quick capture: n <folder>: makes a note there, n today: goes under ## Notes, a missing folder falls back', async () => {
  const files = new Map([['runbooks/deploy.md', '# Deploy\n']]), cols = new Map();
  cols.set('home/handoffs', hEnv([cap('c_1', { folder: 'runbooks' }), cap('c_2', { daily: DAY }, 'Priya asked about the offsite'), cap('c_3', { folder: 'gone' }, 'Lost one'), cap('c_4', { folder: '../x' }, 'Bad')]));
  const added = [];
  const notesFake = { files: new Map([['runbooks/deploy.md', { mtime: 1 }]]) };
  const p = startPickup(fakeWs(cols, files), notesFake, { onAdded: (w) => added.push(...w), dailyText: async (d) => `# ${d}\n\n## Plan\n\n## Notes\n\n## Wins\n` });
  assert.equal(await p.run(), 4);
  assert.ok(files.get('runbooks/rollback-needs-the-flag-off.md').startsWith('# Rollback needs the flag off'));
  assert.equal(files.get(`daily/${DAY}.md`), `# ${DAY}\n\n## Plan\n\n## Notes\n\n- Priya asked about the offsite\n\n## Wins\n`);
  assert.ok(files.get('quick-notes.md').includes('- Lost one') && files.get('quick-notes.md').includes('- Bad'), 'a gone or invalid folder: Quick Notes, as a plain capture from Home');
  assert.deepEqual(added.filter(x => x.fellBack).map(x => x.fellBack), ['gone']);
});
