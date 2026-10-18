// docs/work-format.md: the regexes in the doc, applied to docs/examples/work/, give expected.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from './helpers.mjs';
import { regexesFromDoc, parseWorkRoot } from '../lib/work-parse.mjs';

const doc = fs.readFileSync(path.join(REPO, 'docs', 'work-format.md'), 'utf8');
const example = path.join(REPO, 'docs', 'examples', 'work');

function copyWithSameTimes(src, dest, when) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyWithSameTimes(s, d, when);
    else if (e.name !== 'expected.json') { fs.copyFileSync(s, d); fs.utimesSync(d, when, when); }
  }
}

test('every regex in the doc compiles', () => {
  const R = regexesFromDoc(doc);
  for (const name of ['itemFolder', 'notesFolder', 'field', 'gate', 'task', 'progressEntry', 'prBranch', 'section']) assert.ok(R[name], `missing ${name}`);
  assert.ok(R.field('Type') instanceof RegExp);
});

test('the example .work folder reads as documented', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-work-'));
  try {
    copyWithSameTimes(example, root, new Date('2026-10-18T12:00:00Z'));
    const got = parseWorkRoot(root, regexesFromDoc(doc));
    const { items: expected } = JSON.parse(fs.readFileSync(path.join(example, 'expected.json'), 'utf8'));
    assert.deepEqual(got.map(i => i.folder), expected.map(i => i.folder), '_dashboard must be ignored');
    for (const e of expected) assert.deepEqual(got.find(i => i.folder === e.folder), e, e.folder);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('review goes stale when tasks.md is newer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-work-'));
  try {
    copyWithSameTimes(example, root, new Date('2026-10-18T12:00:00Z'));
    const later = new Date('2026-10-18T13:00:00Z');
    fs.utimesSync(path.join(root, '41610-rate-limit-headers', 'tasks.md'), later, later);
    const item = parseWorkRoot(root, regexesFromDoc(doc)).find(i => i.folder === '41610-rate-limit-headers');
    assert.deepEqual([item.next.stage, item.next.command], ['review', '/review 41610']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the step words table matches the parser', () => {
  for (const [cmd, words] of [['start', 'Set up the repos and branches'], ['spec', 'Write the spec'], ['plan', 'Write the plan'], ['tasks', 'Split the plan into tasks'],
    ['bug', 'Analyze the bug'], ['review', 'Review the changes'], ['pr', 'Write the PR text'], ['resume', 'Resume this item'], ['approve', 'Approve']]) {
    assert.ok(doc.includes(`| \`${cmd}\` | ${words} |`), `step words for ${cmd}`);
  }
});
