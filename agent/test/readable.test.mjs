// The data folder, readable without Workshop (docs/data-format.md, Readable without Workshop): README.md and the
// readable copy, from the agent and from `workshop export --readable`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start, tempHome, rmHome, put, post, get, envelope, dataDirOf } from './helpers.mjs';
import { readmeText, writeReadme, toCsv, toMarkdown, MARK, COPY_DIR } from '../lib/readable.mjs';
import { exportReadable } from '../../workshop.mjs';

test('README.md says what each folder is, and a README of your own is left alone', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  fs.mkdirSync(dd, { recursive: true });
  try {
    const apps = [{ id: 'tasks', name: 'Tasks', folder: 'docket' }];
    assert.equal(await writeReadme(dd, apps), 'written');
    const text = fs.readFileSync(path.join(dd, 'README.md'), 'utf8');
    assert.ok(text.startsWith(MARK));
    assert.match(text, /\| `docket\/` \| Tasks \|/);
    assert.match(text, /Nothing in this folder is uploaded by Workshop/);
    assert.equal(await writeReadme(dd, apps), 'same');
    fs.writeFileSync(path.join(dd, 'README.md'), '# Mine\n');
    assert.equal(await writeReadme(dd, apps), 'kept');
    assert.equal(fs.readFileSync(path.join(dd, 'README.md'), 'utf8'), '# Mine\n');
  } finally { rmHome(home); }
});

test('the agent writes README.md on start; Workshop never reads it as data', async () => {
  const home = tempHome();
  const agent = await start(home);
  try {
    assert.ok(fs.readFileSync(path.join(dataDirOf(home), 'README.md'), 'utf8').startsWith(MARK));
    assert.equal((await get(agent, '/api/data/notes')).json.collections.length, 0);
  } finally { await agent.stop(); rmHome(home); }
});

test('CSV opens in Excel: a byte order mark, quoted cells, dates from change stamps, deleted items left out', () => {
  const csv = toCsv([{ id: 'a', updatedAt: 1792330000000, title: 'Say "hi", then go', tags: ['x'] }, { id: 'b', done: true }]);
  assert.ok(csv.startsWith('﻿id,updatedAt,title,tags,done\r\n'));
  assert.match(csv, /a,2026-[0-9-]+ [0-9:]+ UTC,"Say ""hi"", then go","\[""x""\]",\r\n/);
  assert.match(csv, /b,,,,true\r\n$/);
});

test('Markdown has one section per item, named by its title', () => {
  const md = toMarkdown('Tasks: tasks', { items: [{ id: 't1', updatedAt: 1, title: 'Draft plan', value: 3, notes: 'line one\nline two' }], meta: { updatedAt: 1, capacity: 20 } });
  assert.match(md, /^# Tasks: tasks\n\n## Draft plan\n\n- \*\*value:\*\* 3\n- \*\*notes:\*\*\n\n  line one\n  line two/);
  assert.match(md, /## Settings[\s\S]*"capacity": 20/);
  assert.match(toMarkdown('X', { items: [] }), /Nothing here yet/);
});

test('the readable copy has every collection and file, replaces the last copy, and changes no data', async () => {
  const home = tempHome();
  const agent = await start(home);
  const dd = dataDirOf(home);
  try {
    await put(agent, '/api/data/notes/pages', envelope('notes', 'pages', [{ id: 'p1', updatedAt: 1792330000000, title: 'First' }, { id: 'p2', updatedAt: 1792330000000, title: 'Second' }]));
    await put(agent, '/api/files/notes/summaries/q4.md', { content: '# Q4\n', create: true });
    const before = fs.readFileSync(path.join(dd, 'notes', 'pages.json'), 'utf8');
    const r = (await post(agent, '/api/storage/readable', {})).json;
    assert.deepEqual([r.apps, r.collections, r.files], [1, 1, 1]);
    const copy = path.join(dd, COPY_DIR);
    const app = fs.readdirSync(copy).find(n => n !== 'README.md');
    assert.match(fs.readFileSync(path.join(copy, app, 'pages.csv'), 'utf8'), /Second/);
    assert.match(fs.readFileSync(path.join(copy, app, 'pages.md'), 'utf8'), /## First/);
    assert.equal(fs.readFileSync(path.join(copy, app, 'summaries', 'q4.md'), 'utf8'), '# Q4\n');
    assert.equal(fs.readFileSync(path.join(dd, 'notes', 'pages.json'), 'utf8'), before);
    fs.writeFileSync(path.join(copy, app, 'stale.csv'), 'old');
    await post(agent, '/api/storage/readable', {});
    assert.ok(!fs.existsSync(path.join(copy, app, 'stale.csv')), 'the copy is replaced as a whole');
    assert.deepEqual((await get(agent, '/api/files/notes')).json.files.map(f => f.path), ['summaries/q4.md'], 'Workshop never lists the copy');
    const st = (await get(agent, '/api/storage')).json;
    assert.equal(st.readableCopy.path, copy);
  } finally { await agent.stop(); rmHome(home); }
});

test('workshop export --readable works without the agent, using the real folder names', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  try {
    fs.mkdirSync(path.join(dd, 'docket'), { recursive: true });
    fs.writeFileSync(path.join(dd, 'docket', 'tasks.json'), `${JSON.stringify({ schema: 'prioritizer.tasks', version: 3, rev: 2, updatedAt: '2026-11-01T00:00:00.000Z', items: [{ id: 't1', updatedAt: 1, title: 'Ship it' }] }, null, 2)}\n`);
    fs.mkdirSync(path.join(dd, 'folio'), { recursive: true }); // old folders, not renamed yet: read where they are
    fs.writeFileSync(path.join(dd, 'folio', 'a.md'), '# A\n');
    const r = await exportReadable({ home, dataDir: dd });
    assert.equal(r.collections, 1);
    assert.equal(r.files, 1);
    assert.match(fs.readFileSync(path.join(dd, COPY_DIR, 'Tasks', 'tasks.md'), 'utf8'), /## Ship it/);
    assert.equal(fs.readFileSync(path.join(dd, COPY_DIR, 'Notes', 'a.md'), 'utf8'), '# A\n');
    assert.match(fs.readFileSync(path.join(dd, 'README.md'), 'utf8'), /\| `docket\/` \| Tasks \|/);
  } finally { rmHome(home); }
});

test('readme names every app the agent knows', () => {
  assert.match(readmeText([{ id: 'a', name: 'A app', folder: 'a' }, { id: 'b', name: 'B app', folder: 'bee' }]), /\| `a\/` \| A app \|\n\| `bee\/` \| B app \|/);
});
