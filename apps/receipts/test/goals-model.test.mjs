// Rapport Goals: the model. All data here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/goals/model.js';

const TEAM = `# Platform team, Q4 2026

Intro text.

## Make releases boring

Why: deploys are the top source of after-hours pages.

- Cut median deploy time from 22 to 15 min: 18 min [on track]
  - Measured from the deploy dashboard, weekly median.
- Roll back any service in under 5 min: 40% [at risk]
- Zero Sev-1s caused by a deploy: done

## Grow the on-call bench

- Two more people on the rotation: 1 [behind]
`;

const REPORT = `# Q4 2026

## Ship one-click rollback

Supports: Make releases boring

- Rollback button in the deploy page: 60% [on track]
- Runbook updated and reviewed: done

## Learn Terraform

- Finish the course: 30%
`;

test('quarters', () => {
  assert.equal(G.quarterKey(new Date(2026, 10, 4)), '2026-q4');
  assert.equal(G.quarterKey(new Date(2026, 0, 1)), '2026-q1');
  assert.equal(G.quarterLabel('2026-q4'), 'Q4 2026');
  assert.equal(G.shiftQuarter('2026-q4', 1), '2027-q1');
  assert.equal(G.shiftQuarter('2026-q1', -1), '2025-q4');
  assert.equal(G.goalsPath('team', '2026-q4'), 'goals/team/2026-q4.md');
  assert.equal(G.ownerFolder('p_mh3k9x2a'), 'p-mh3k9x2a');
  const files = [{ path: 'goals/team/2026-q2.md' }, { path: 'goals/p-a/2025-q4.md' }, { path: 'goals/p-a/notes.md' }, { path: 'other/x.md' }];
  assert.deepEqual(G.parseFiles(files).map(f => [f.owner, f.quarter]), [['team', '2026-q2'], ['p-a', '2025-q4']]);
  assert.deepEqual(G.quartersFrom(files, new Date(2026, 10, 4)), ['2027-q1', '2026-q4', '2026-q2', '2025-q4']);
});

test('parseProgress', () => {
  const p = s => G.parseProgress(s);
  assert.deepEqual([p('Ship it: 40%').pct, p('Ship it: 40%').label, p('Ship it: 40%').text], [0.4, '40%', 'Ship it']);
  assert.equal(p('Beat it: 150%').pct, 1);
  assert.equal(p('Beat it: 150%').label, '150%');
  assert.equal(p('Thing: done').pct, 1);
  assert.equal(p('Thing [done]').pct, 1);
  assert.equal(p('Thing [done]').status, 'done');
  const d = p('Cut median deploy time from 22 to 15 min: 18 min [on track]');
  assert.equal(d.kind, 'number'); assert.equal(d.unit, 'min'); assert.equal(d.status, 'on track');
  assert.equal(Math.round(d.pct * 100), 57);
  assert.equal(p('Get to 15 reviews: 3').pct, 0.2);
  assert.equal(p('Keep p95 under 300 ms: 280 ms').pct, null);
  assert.equal(p('Keep p95 under 300 ms: 280 ms').label, '280 ms');
  assert.equal(p('Count: 1,200 users').value, 1200);
  assert.equal(p('Grow: 1.5k').kind, 'none');
  for (const [s, want] of [['at-risk', 'at risk'], ['Behind', 'at risk'], ['blocked', 'off track'], ['ontrack', 'on track'], ['completed', 'done']]) assert.equal(p(`X: 1% [${s}]`).status, want);
  assert.equal(p('Ship [v2]').text, 'Ship [v2]');
  assert.equal(p('Ship [v2]').status, '');
  const r = p('Ratio: 3 to 1: 50%');
  assert.equal(r.text, 'Ratio: 3 to 1'); assert.equal(r.pct, 0.5);
  assert.equal(p('No progress here').kind, 'none');
  assert.equal(p('Label: words').kind, 'none');
});

test('parseDoc: title, preamble, objectives, Supports, KRs and notes', () => {
  const d = G.parseDoc(TEAM);
  assert.equal(d.title, 'Platform team, Q4 2026');
  assert.equal(d.titleLine, 0);
  assert.equal(d.preamble, 'Intro text.');
  assert.deepEqual(d.objectives.map(o => o.title), ['Make releases boring', 'Grow the on-call bench']);
  const o = d.objectives[0];
  assert.equal(o.krs.length, 3);
  assert.equal(o.krs[0].text, 'Cut median deploy time from 22 to 15 min');
  assert.equal(o.krs[0].notes, '- Measured from the deploy dashboard, weekly median.');
  assert.equal(o.body, 'Why: deploys are the top source of after-hours pages.');
  assert.equal(d.objectives[1].krs[0].progress.status, 'at risk');
  const r = G.parseDoc(REPORT).objectives[0];
  assert.equal(r.supports, 'Make releases boring');
  assert.equal(r.krs.length, 2);
  const many = G.parseDoc('## A\n\nsupports: first\nSupports: second\n\n * KR at column 1: 10%\n');
  assert.equal(many.objectives[0].supports, 'first');
  assert.equal(many.objectives[0].krs[0].progress.pct, 0.1);
  assert.match(many.objectives[0].body, /Supports: second/);
});

test('parseDoc: task lists, fences, CRLF and odd input', () => {
  const t = G.parseDoc('## A\n\n- [x] Done thing\n- [ ] Open thing\n- [ ] Partial: 20%\n').objectives[0].krs;
  assert.deepEqual(t.map(k => k.progress.pct), [1, null, 0.2]);
  assert.equal(t[0].text, 'Done thing');
  const f = G.parseDoc('## A\n\n```\n## Not a heading\n- not a kr: 50%\nSupports: nope\n```\n- Real: 10%\n');
  assert.equal(f.objectives.length, 1);
  assert.equal(f.objectives[0].krs.length, 1);
  assert.equal(f.objectives[0].supports, '');
  const c = G.parseDoc(REPORT.replace(/\n/g, '\r\n'));
  assert.equal(c.eol, '\r\n');
  assert.equal(c.objectives[0].supports, 'Make releases boring');
  assert.deepEqual(G.parseDoc('').objectives, []);
  for (let n = 0; n < 200; n++) {
    const junk = Array.from({ length: 300 }, () => String.fromCharCode(Math.floor(Math.random() * 0x2fff))).join('').replace(/\u0000/g, '') + '\n## x\n- y: 1%\n```';
    assert.doesNotThrow(() => G.parseDoc(junk));
  }
});

const sameExcept = (a, b, line) => {
  const x = a.split(/\r?\n/), y = b.split(/\r?\n/);
  assert.equal(x.length, y.length);
  x.forEach((l, i) => { if (i !== line) assert.equal(y[i], l, `line ${i}`); });
};

test('setKr changes only that line', () => {
  const kr = G.parseDoc(TEAM).objectives[0].krs[1];
  const out = G.setKr(TEAM, kr.line, { progress: '50%', status: 'at risk', expectText: kr.text });
  sameExcept(TEAM, out, kr.line);
  assert.equal(out.split('\n')[kr.line], '- Roll back any service in under 5 min: 50% [at risk]');
  const crlf = TEAM.replace(/\n/g, '\r\n');
  const o2 = G.setKr(crlf, kr.line, { progress: 'done', status: '' });
  assert.equal(o2.split('\r\n').length, crlf.split('\r\n').length);
  assert.ok(!/[^\r]\n/.test(o2));
  assert.equal(G.setKr(TEAM, kr.line, { progress: '1%', expectText: 'Something else' }), null);
  assert.equal(G.setKr(TEAM, 0, { progress: '1%' }), null);
  assert.throws(() => G.setKr(TEAM, kr.line, { progress: 'lots' }), e => e.code === 'bad_request');
  const task = '## A\n- [ ] Open thing\n';
  assert.equal(G.setKr(task, 1, { progress: 'done' }), '## A\n- [x] Open thing: done\n');
  assert.equal(G.setKr('## A\n* Keep it: 1%', 1, { progress: '' }), '## A\n* Keep it');
});

test('setSupports adds, replaces and removes', () => {
  const d = G.parseDoc(REPORT);
  const learn = d.objectives[1];
  const added = G.setSupports(REPORT, learn.line, 'Grow the on-call bench');
  assert.equal(G.parseDoc(added).objectives[1].supports, 'Grow the on-call bench');
  assert.match(added, /## Learn Terraform\n\nSupports: Grow the on-call bench\n\n- Finish the course: 30%/);
  const replaced = G.setSupports(REPORT, d.objectives[0].line, 'Grow the on-call bench');
  sameExcept(REPORT, replaced, d.objectives[0].supportsLine);
  const removed = G.setSupports(REPORT, d.objectives[0].line, null);
  assert.equal(G.parseDoc(removed).objectives[0].supports, '');
  assert.match(removed, /## Ship one-click rollback\n\n- Rollback/);
  assert.equal(G.setSupports('## A', 0, 'B'), '## A\n\nSupports: B');
  const crlf = G.setSupports(REPORT.replace(/\n/g, '\r\n'), learn.line, 'X');
  assert.ok(!/[^\r]\n/.test(crlf));
});

test('renamedObjectives and renameSupports', () => {
  const before = G.parseDoc(TEAM);
  const after = G.parseDoc(TEAM.replace('## Make releases boring', '## Make releases dull'));
  assert.deepEqual(G.renamedObjectives(before, after), [{ from: 'Make releases boring', to: 'Make releases dull' }]);
  assert.deepEqual(G.renamedObjectives(before, G.parseDoc(TEAM + '\n## Third\n')), []);
  assert.deepEqual(G.renamedObjectives(before, G.parseDoc(TEAM.replace('boring', 'Boring.'))), []);
  const r = G.renameSupports(REPORT, 'make releases boring!', 'Make releases dull');
  assert.equal(r.count, 1);
  assert.match(r.text, /Supports: Make releases dull/);
  assert.equal(G.renameSupports(REPORT, 'Make releases', 'X').count, 0);
});

test('buildTree places report objectives', () => {
  const people = [{ id: 'p_1', name: 'Dev One' }, { id: 'p_2', name: 'Dev Two' }, { id: 'p_3', name: 'Dev Three', archived: true }, { id: 'p_4', name: 'Dev Four' }];
  const tree = G.buildTree({
    team: { path: 'goals/team/2026-q4.md', doc: G.parseDoc(TEAM) },
    reports: [
      { person: people[0], path: 'goals/p-1/2026-q4.md', doc: G.parseDoc(REPORT) },
      { person: people[1], path: 'goals/p-2/2026-q4.md', doc: null },
      { person: people[2], path: 'goals/p-3/2026-q4.md', doc: null },
      { person: people[3], path: 'goals/p-4/2026-q4.md', doc: G.parseDoc('## Help\n\nSupports: MAKE releases   boring.\n\n- One: 10%\n') }
    ],
    unknown: [{ folder: 'p-gone', path: 'goals/p-gone/2026-q4.md', doc: G.parseDoc('## Old\n- x: 1%') }]
  });
  assert.deepEqual(tree.team[0].supporters.map(s => s.person.name), ['Dev One', 'Dev Four']);
  const top = tree.team[0].progress;
  assert.equal(top.measured, 3);
  assert.equal(Math.round(top.pct * 100), Math.round(((18 - 22) / (15 - 22) + 0.4 + 1) / 3 * 100));
  assert.equal(top.status, 'at risk');
  assert.deepEqual(tree.unaligned.map(u => u.objective.title), ['Learn Terraform', 'Old']);
  assert.equal(tree.unaligned[1].person.name, 'Unknown person (p-gone)');
  assert.deepEqual(tree.missing.map(p => p.name), ['Dev Two']);
  assert.deepEqual(tree.unknown, [{ folder: 'p-gone', path: 'goals/p-gone/2026-q4.md' }]);
  const none = G.buildTree({ team: null, reports: [{ person: people[0], path: 'x', doc: G.parseDoc(REPORT) }] });
  assert.equal(none.team.length, 0);
  assert.equal(none.unaligned.length, 2);
  assert.deepEqual(G.rollup({ krs: [] }), { pct: null, measured: 0, total: 0, status: '' });
});

test('templates and carryOver', () => {
  const t = G.parseDoc(G.teamTemplate('2026-q4'));
  assert.equal(t.title, 'Team goals, Q4 2026');
  assert.deepEqual(t.objectives.map(o => o.krs.length), [3, 3]);
  assert.equal(t.objectives[0].body, 'Why it matters, in a sentence or two.');
  const r = G.parseDoc(G.reportTemplate('2026-q4', ['Make releases boring']));
  assert.deepEqual(r.objectives.map(o => o.supports), ['Make releases boring', '']);
  assert.equal(G.parseDoc(G.reportTemplate('2026-q4')).objectives[0].supports, '');
  const next = G.carryOver(TEAM, '2026-q4', '2027-q1');
  const d = G.parseDoc(next);
  assert.equal(d.title, 'Platform team, Q1 2027');
  assert.ok(d.objectives.every(o => o.krs.every(k => k.progress.label === '0%' && !k.progress.status)));
  assert.match(next, /Why: deploys are the top source/);
  assert.equal(G.carryOver('## A\n- [x] Thing\n'), '## A\n- [ ] Thing\n');
});
