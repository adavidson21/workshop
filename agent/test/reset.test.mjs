// Start over (docs/agent-api.md, Reset): the zip backup, the plan, the ticket and phrase, and the API from end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { start, tempHome, rmHome, put, post, get, envelope, dataDirOf } from './helpers.mjs';
import { openEvents } from '../../tests/contract/helpers.mjs';
import { ResetTickets, RESET_WAIT_MS, TICKET_MS, crc32, expectedPhrase, listFiles, readZip, resetTargets, writeZip, backupPath } from '../lib/reset.mjs';

test('the zip is read back byte for byte, stored or deflated, with UTF-8 names', () => {
  const home = tempHome();
  const dir = path.dirname(home);
  try {
    const big = Buffer.from('tasks '.repeat(5000));
    const tiny = Buffer.from([1, 2, 3]);
    fs.writeFileSync(path.join(dir, 'big.json'), big);
    const zip = path.join(dir, 'b.zip');
    const r = writeZip(zip, [{ name: 'Workshop data/docket/tasks.json', abs: path.join(dir, 'big.json') }, { name: 'Readable copy/Café/ü.bin', data: tiny }]);
    assert.equal(r.files, 2);
    assert.equal(fs.existsSync(`${zip}.tmp`), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(zip).mode & 0o777, 0o600);
    const back = readZip(zip, { contents: true });
    assert.deepEqual(back.map(e => e.name), ['Workshop data/docket/tasks.json', 'Readable copy/Café/ü.bin']);
    assert.ok(back[0].data.equals(big));
    assert.ok(back[1].data.equals(tiny));
    assert.ok(fs.statSync(zip).size < big.length, 'text is deflated');
    // A damaged zip is refused, so nothing would be deleted.
    const buf = fs.readFileSync(zip);
    buf[70] ^= 0xff; // inside the first file's data (30-byte header, 31-byte name)
    fs.writeFileSync(zip, buf);
    assert.throws(() => readZip(zip));
  } finally { rmHome(home); }
});

test('crc32 matches the standard check value, with and without zlib.crc32', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
  if (typeof zlib.crc32 === 'function') {
    const saved = zlib.crc32;
    try { Object.defineProperty(zlib, 'crc32', { value: undefined, configurable: true, writable: true }); } catch { return; }
    try { assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926); } finally { zlib.crc32 = saved; }
  }
});

test('the phrase names what goes', () => {
  assert.equal(expectedPhrase({ everything: true, count: 9, tandem: true }), 'delete everything');
  assert.equal(expectedPhrase({ everything: false, count: 2, tandem: false }), 'delete 2 apps');
  assert.equal(expectedPhrase({ everything: false, count: 1, tandem: true }), 'delete 1 app');
  assert.equal(expectedPhrase({ everything: false, count: 0, tandem: true }), 'delete work items');
  assert.equal(expectedPhrase({ everything: false, count: 0, tandem: false }), null);
});

test('a ticket works once, only after the wait, and expires', () => {
  let now = 1000;
  const t = new ResetTickets({ now: () => now });
  const { ticket, waitMs } = t.issue();
  assert.equal(waitMs, RESET_WAIT_MS);
  assert.match(t.take('nope'), /no longer valid/);
  now += RESET_WAIT_MS - 3000;
  assert.match(t.take(ticket), /Wait 3 more seconds/);
  now += 3000;
  assert.equal(t.take(ticket), null);
  assert.match(t.take(ticket), /no longer valid/, 'used up');
  const second = t.issue().ticket;
  now += TICKET_MS + 1;
  assert.match(t.take(second), /expired/);
});

test('the plan: an app takes its folder, old-name folder, trash, backups and readable copy; everything takes them whole', () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  const mk = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dd, rel)), { recursive: true }); fs.writeFileSync(path.join(dd, rel), text); };
  try {
    mk('docket/tasks.json'); mk('tasks/tasks.json'); mk('.trash/docket/a.20261025T140500123Z.md');
    mk('.backups/2026-10-25/docket/tasks.v2.json'); mk('Readable copy/Tasks/tasks.csv'); mk('folio/a.md'); mk('.trash/folio/b.md');
    mk('.scratch/opencode/hub/1/req.md'); mk('2026/mine.txt'); mk('README.md');
    const docket = { id: 'tasks', name: 'Tasks', folder: 'docket' };
    const folio = { id: 'notes', name: 'Notes', folder: 'folio' };
    const some = resetTargets({ dataDir: dd, apps: [docket] }).map(t => t.zip);
    assert.deepEqual(some, ['Workshop data/docket', 'Workshop data/tasks', 'Workshop data/.trash/docket', 'Workshop data/.backups/2026-10-25/docket', 'Workshop data/Readable copy/Tasks']);
    const all = resetTargets({ dataDir: dd, apps: [docket, folio], everything: true }).map(t => t.zip);
    assert.deepEqual(all, ['Workshop data/docket', 'Workshop data/tasks', 'Workshop data/folio', 'Workshop data/.trash', 'Workshop data/.backups', 'Workshop data/.scratch', 'Workshop data/Readable copy']);
    assert.ok(!all.some(z => z.includes('2026') && !z.includes('.backups')), 'folders that are not apps are never taken');
    const files = listFiles(resetTargets({ dataDir: dd, apps: [folio] })).map(f => f.name);
    assert.deepEqual(files, ['Workshop data/folio/a.md', 'Workshop data/.trash/folio/b.md']);
    assert.match(path.basename(backupPath(dd, new Date(2026, 10, 19, 16, 5))), /^Workshop backup 2026-11-19 1605\.zip$/);
  } finally { rmHome(home); }
});

async function ready(agent) {
  const r = await get(agent, '/api/reset');
  assert.equal(r.status, 200, r.text);
  return r.json;
}

test('Start over: needs the phrase and a ticket, saves a zip, deletes only the picked app, and says so', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  const agent = await start(home, null, { resetWaitMs: 300 });
  const ev = await openEvents(agent);
  try {
    assert.equal((await put(agent, '/api/data/board/tasks', envelope('board', 'tasks', [{ id: 'a', updatedAt: 1792330000000, title: 'Keep me safe' }]))).status, 200);
    assert.equal((await put(agent, '/api/files/pages/one.md', { content: '# One\n', create: true })).status, 200);
    fs.writeFileSync(path.join(dd, 'mine.txt'), 'the person\'s own file');

    const plan = await ready(agent);
    assert.deepEqual(plan.apps.map(a => a.id).sort(), ['board', 'pages']);
    assert.ok(plan.apps.find(a => a.id === 'board').bytes > 0);
    assert.equal(plan.tandem.available, false);
    assert.equal(plan.backupDir, path.dirname(dd));

    assert.equal((await post(agent, '/api/reset', { apps: ['board'], phrase: 'delete 1 app', ticket: plan.ticket }, { origin: 'https://work.example.org' })).status, 403, 'never from another site');
    let r = await post(agent, '/api/reset', { apps: ['board'], phrase: 'delete everything', ticket: plan.ticket });
    assert.equal(r.status, 400); assert.match(r.json.error, /Type "delete 1 app"/);
    r = await post(agent, '/api/reset', { apps: ['board'], phrase: 'delete 1 app', ticket: plan.ticket });
    assert.equal(r.status, 400); assert.match(r.json.error, /Wait \d+ more second/, 'the wait is checked by the agent, not only the page');
    r = await post(agent, '/api/reset', { apps: ['board'], tandem: true, phrase: 'delete 1 app', ticket: plan.ticket });
    assert.equal(r.status, 503, 'Tandem needs the opencode connector');
    r = await post(agent, '/api/reset', { apps: ['nope'], phrase: 'delete 1 app', ticket: plan.ticket });
    assert.equal(r.status, 400);
    assert.ok(fs.existsSync(path.join(dd, 'board', 'tasks.json')), 'nothing deleted yet');

    await new Promise(res => setTimeout(res, 350));
    r = await post(agent, '/api/reset', { apps: ['board'], phrase: ' delete 1 app ', ticket: plan.ticket });
    assert.equal(r.status, 200, r.text);
    assert.equal(fs.existsSync(path.join(dd, 'board')), false);
    assert.ok(fs.existsSync(path.join(dd, 'pages', 'one.md')), 'other apps are kept');
    assert.ok(fs.existsSync(path.join(dd, 'mine.txt')), 'files that are not Workshop\'s are kept');
    await ev.next('reset', d => d.state === 'started');
    await ev.next('reset', d => d.state === 'done');

    const zip = r.json.backup.path;
    assert.equal(path.dirname(zip), path.dirname(dd));
    const entries = readZip(zip, { contents: true });
    assert.equal(entries[0].name, 'README.txt');
    assert.match(entries[0].data.toString(), /To put it back/);
    const tasks = entries.find(e => e.name === 'Workshop data/board/tasks.json');
    assert.match(tasks.data.toString(), /Keep me safe/);
    assert.equal(r.json.backup.files, entries.length - 1);

    assert.equal((await post(agent, '/api/reset', { apps: ['pages'], phrase: 'delete 1 app', ticket: plan.ticket })).status, 400, 'a ticket works once');
    const after = await ready(agent);
    assert.equal(after.last.backup.path, zip);
    assert.deepEqual(after.last.apps.map(a => a.id), ['board']);
    // A fresh write works again afterwards.
    assert.equal((await put(agent, '/api/data/board/tasks', envelope('board', 'tasks', []))).status, 200);
  } finally { ev.close(); await agent.stop(); rmHome(home); }
});

test('Start over, everything: every app, the trash and backups go; the README and other folders stay', async () => {
  const home = tempHome();
  const dd = dataDirOf(home);
  const agent = await start(home, null, { resetWaitMs: 0 });
  try {
    await put(agent, '/api/data/board/tasks', envelope('board', 'tasks', [{ id: 'a', updatedAt: 1792330000000 }]));
    await put(agent, '/api/files/pages/one.md', { content: '# One\n', create: true });
    fs.mkdirSync(path.join(dd, '.trash', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dd, '.trash', 'pages', 'old.20261025T140500123Z.md'), 'old');
    fs.mkdirSync(path.join(dd, '2026'), { recursive: true });
    fs.writeFileSync(path.join(dd, '2026', 'mine.md'), 'mine');
    const plan = await ready(agent);
    let r = await post(agent, '/api/reset', { apps: 'all', phrase: 'delete 2 apps', ticket: plan.ticket });
    assert.equal(r.status, 400); assert.match(r.json.error, /delete everything/);
    r = await post(agent, '/api/reset', { apps: ['board', 'pages'], phrase: 'delete everything', ticket: plan.ticket });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.everything, true);
    for (const gone of ['board', 'pages', '.trash']) assert.equal(fs.existsSync(path.join(dd, gone)), false, gone);
    assert.ok(fs.existsSync(path.join(dd, 'README.md')));
    assert.ok(fs.existsSync(path.join(dd, '2026', 'mine.md')));
    assert.ok(readZip(r.json.backup.path).some(e => e.name === 'Workshop data/.trash/pages/old.20261025T140500123Z.md'));
  } finally { await agent.stop(); rmHome(home); }
});
