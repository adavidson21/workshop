// The GitHub connector's roadmap for Roadmaps: milestones as Epics, feature-labeled issues as Features, sub-issues as stories.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startFakeGitHub, TOKEN } from './fake-github.mjs';
import { normalize } from '../lib/config.mjs';
import { iterationsList, parseArea, releaseNoteOf, roadmapList } from '../lib/roadmap.mjs';

async function withD(fn) {
  const srv = await startFakeGitHub();
  try {
    const { config } = normalize({ connections: [{ name: 'github', apiUrl: srv.url, tokenEnv: 'GH' }] });
    await fn({ cfg: config, env: n => (n === 'GH' ? TOKEN : undefined), now: new Date('2026-11-14T12:00:00Z') }, srv);
  } finally { await srv.close(); }
}

test('areas: owner/repo or owner/repo/<area>, with slashes or backslashes', () => {
  assert.deepEqual(parseArea('acme/web'), { repo: 'acme/web', area: '' });
  assert.deepEqual(parseArea('acme\\web\\auth'), { repo: 'acme/web', area: 'auth' });
  assert.equal(parseArea('acme'), null);
});

test('release note from its own section', () => {
  assert.equal(releaseNoteOf('Intro\n\n## Release notes\nFaster.\n\n## Other\nx'), 'Faster.');
  assert.equal(releaseNoteOf('No section'), '');
});

test('a whole repo: every milestone, open Features with their milestone and dates, no stories by default', () => withD(async d => {
  const r = await roadmapList(d, { areas: ['acme/web'], fields: ['Custom.ReleaseNotes'] });
  const by = Object.fromEntries(r.items.map(i => [i.ref, i]));
  assert.deepEqual(Object.keys(by).sort(), ['acme/web milestone v2.1', 'acme/web milestone v3.0', 'acme/web#40', 'acme/web#41']);
  const epic = by['acme/web milestone v2.1'];
  assert.equal(epic.type, 'Epic');
  assert.equal(epic.targetDate, '2026-12-15');
  assert.ok(Number.isInteger(epic.id));
  const f = by['acme/web#40'];
  assert.equal(f.type, 'Feature');
  assert.equal(f.parentId, epic.id);
  assert.equal(f.targetDate, '2026-12-15', 'takes its milestone due date');
  assert.equal(f.area, 'acme/web/auth');
  assert.deepEqual(f.assignee, { name: 'kim', email: '' });
  assert.equal(f.storiesTotal, 2);
  assert.equal(f.storiesDone, 1);
  assert.equal(f.custom['Custom.ReleaseNotes'], 'Sign-in is faster.');
  assert.equal(by['acme/web#41'].parentId, null);
  assert.equal(r.connection, 'github');
}));

test('stories and closed items when asked; an area keeps only its Features and their milestones', () => withD(async d => {
  const all = await roadmapList(d, { areas: ['acme/web'], stories: true, includeClosed: true });
  const refs = all.items.map(i => i.ref);
  assert.ok(refs.includes('acme/web#42'), 'closed Feature');
  const story = all.items.find(i => i.ref === 'acme/web#43');
  assert.equal(story.type, 'User Story');
  assert.equal(story.parentId, all.items.find(i => i.ref === 'acme/web#40').id);
  assert.ok(refs.includes('acme/web#44'), 'closed story with includeClosed');
  const open = await roadmapList(d, { areas: ['acme/web'], stories: true });
  assert.ok(!open.items.some(i => i.ref === 'acme/web#44'));
  const area = await roadmapList(d, { areas: ['acme\\web\\auth'] });
  assert.deepEqual(area.items.map(i => i.ref).sort(), ['acme/web milestone v2.1', 'acme/web#40']);
  await assert.rejects(roadmapList(d, { areas: ['nope'] }), /owner\/repo/);
}));

test('iterations.list: none on GitHub', () => withD(async d => {
  assert.deepEqual(iterationsList(d, { project: 'acme' }).iterations, []);
}));
