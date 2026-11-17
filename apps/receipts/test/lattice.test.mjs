import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/lattice.js';
import * as R from '../js/state.js';
import { parseDoc } from '../js/goals/model.js';

const e = o => R.cleanEntry({ id: R.newId('r'), about: 'p_1', kind: 'win', text: 'x', date: '2026-11-03', ...o });

test('talking points: the note\'s own section wins; else built from prep, never concerns', () => {
  const note = '# 1:1\n\n## Talking points\n\n- Conference budget\n- [ ] Rollback drill\n- \n\n## Notes\n\n- not this\n';
  assert.equal(L.talkingPoints(note, null), '- Conference budget\n- Rollback drill\n');
  const packet = {
    last: { state: 'ok', open: ['Send the runbook'] },
    docket: { state: 'ok', waiting: [{ title: 'Review the spec' }] },
    receipts: { state: 'ok', groups: { win: [e({ text: 'Fixed the flaky test' })], feedback: [e({ kind: 'feedback', text: 'Clearer PRs' })], growth: [], concern: [e({ kind: 'concern', text: 'SECRET' })] } }
  };
  const out = L.talkingPoints('## Talking points\n\n- \n', packet);
  assert.equal(out, '- Follow up: Send the runbook\n- Check in: Review the spec\n- Shout out: Fixed the flaky test\n- Feedback: Clearer PRs\n');
  assert.ok(!out.includes('SECRET'));
  assert.equal(L.talkingPoints('', { last: { state: 'none' }, docket: { state: 'missing' }, receipts: { state: 'ok', groups: {} } }), '');
});

test('receipts and review sections for Lattice leave concerns out', () => {
  assert.equal(L.receiptText(e({ text: 'Led the review', metric: '-30% time' })), 'Led the review (-30% time) (Nov 3)');
  assert.equal(L.receiptText(e({ kind: 'concern', text: 'no' })), '');
  const review = R.buildReview([e({ text: 'A', sections: ['Craft'] }), e({ kind: 'concern', text: 'B', sections: ['Craft'] }), e({ text: 'C', sections: ['Growth'] })],
    { about: 'p_1', period: { from: '', to: '' }, sections: ['Craft', 'Growth', 'Results'] });
  assert.equal(L.sectionText(review.groups[0]), '- A');
  assert.equal(L.reviewText(review), 'Craft\n- A\n\nGrowth\n- C\n');
  assert.equal(L.reviewText(review, { Craft: 'Edited craft' }), 'Craft\nEdited craft\n\nGrowth\n- C\n');
});

test('objective text for a Lattice goal', () => {
  const d = parseDoc('## Make releases boring\n\n- Rollback under 5 min: 40% [at risk]\n- Runbook: done\n- Plain one\n');
  assert.equal(L.objectiveText(d.objectives[0]), 'Make releases boring\n- Rollback under 5 min: 40%, at risk\n- Runbook: done\n- Plain one\n');
});

test('reading a Lattice export: CSV or a spreadsheet paste, columns by header', () => {
  const csv = 'Goal Name,Owner,Status,Progress,Parent Goal\n"Make releases boring",Team,On Track,62,\n"One-click rollback, for search",Priya Raman,at risk,0.6,Make releases boring\n,Nobody,,,\n';
  assert.deepEqual(L.parseLatticeGoals(csv), [
    { name: 'Make releases boring', owner: 'Team', progress: '62%', status: 'on track', parent: '' },
    { name: 'One-click rollback, for search', owner: 'Priya Raman', progress: '60%', status: 'at risk', parent: 'Make releases boring' }
  ]);
  const tsv = 'Title\tOwners\tProgress (%)\tStatus\nShadow on-call\tDana Ortiz; Sam\t50%\tProgressing\n';
  assert.deepEqual(L.parseLatticeGoals(tsv), [{ name: 'Shadow on-call', owner: 'Dana Ortiz', progress: '50%', status: 'on track', parent: '' }]);
  assert.throws(() => L.parseLatticeGoals('Foo,Bar\n1,2\n'), /No goal column/);
  assert.equal(L.progressOf('Completed'), 'done');
  assert.equal(L.progressOf('n/a'), '');
});

test('planning and applying an import: matches by title, updates only changed lines, adds what is missing', () => {
  const goals = [
    { name: 'Make releases boring', owner: 'Team', progress: '62%', status: 'on track', parent: '' },
    { name: 'Cut deploy time', owner: 'Team', progress: '70%', status: 'on track', parent: 'Make releases boring' },
    { name: 'One-click rollback', owner: 'Priya Raman', progress: '60%', status: 'at risk', parent: 'Make releases boring' },
    { name: 'Mentor interns', owner: 'J. Smith', progress: '10%', status: '', parent: '' }
  ];
  const people = [{ id: 'p_1', name: 'Priya Raman', folder: 'p-1' }];
  const team = '# Team goals\n\n## Make releases boring\n\n- Cut deploy time: 40% [on track]\n  - measured weekly\n- Untouched: 10%\n';
  const plan = L.planImport(goals, { people, meNames: ['Alex'], quarter: '2026-q4', docs: { 'goals/team/2026-q4.md': team } });
  assert.deepEqual(plan.map(p => [p.owner, p.title, p.action, p.supports, p.unknownOwner || false]), [
    ['team', 'Make releases boring', 'update', '', false],
    ['p-1', 'One-click rollback', 'new', 'Make releases boring', false],
    ['', 'Mentor interns', 'new', '', true]
  ]);
  assert.deepEqual(plan[0].changes, ['Cut deploy time: 40% to 70%']);
  assert.deepEqual(plan[1].krs, [{ text: 'One-click rollback', progress: '60%', status: 'at risk' }]);

  const after = L.applyImport(team, [plan[0], { ...plan[0], krs: [{ text: 'Brand new', progress: '5%', status: '' }] }]);
  assert.equal(after, '# Team goals\n\n## Make releases boring\n\n- Cut deploy time: 70% [on track]\n  - measured weekly\n- Untouched: 10%\n- Brand new: 5%\n');
  const fresh = L.applyImport('', [plan[1]], { title: 'Q4 2026' });
  assert.equal(fresh, '# Q4 2026\n\n## One-click rollback\n\nSupports: Make releases boring\n\n- One-click rollback: 60% [at risk]\n');
  const d = parseDoc(fresh);
  assert.equal(d.objectives[0].supports, 'Make releases boring');
  assert.equal(d.objectives[0].krs[0].progress.status, 'at risk');
  const again = L.planImport(goals.slice(2, 3), { people, quarter: '2026-q4', docs: { 'goals/p-1/2026-q4.md': fresh } });
  assert.equal(again[0].action, 'same', 'importing the same export twice changes nothing');
});
