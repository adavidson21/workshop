// Home's Get started checklist (js/setup.js): which steps tick themselves off, what each one says to do
// next, skipping, hiding, and reading everything through a fake SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, adoFact, card, createSetup, factsFor, onOneDrive, stepsFor, teamCount } from '../js/setup.js';

const fresh = { connected: false, ado: { state: 'browser' }, receipts: 0, dispatch: null, startAtLogin: null, name: '', tasks: 0 };
const OD = 'C:\\Users\\sam\\OneDrive - Acme\\Workshop';
const all = { connected: true, ado: { state: 'ready', message: '' }, receipts: 1, dispatch: 'ready', startAtLogin: true, name: 'Sam', tasks: 4, team: 3, dataDir: OD };
const ctx = { platform: 'win', origin: 'https://workshop.alexisdavidson.org', settings: { href: 'http://127.0.0.1:4380/apps/settings/' } };
const states = v => Object.fromEntries(v.steps.map(s => [s.id, s.state]));

test('a brand-new browser: Connect is first, steps that need Workshop wait for it', () => {
  const v = stepsFor(fresh);
  assert.deepEqual(states(v), { connect: 'todo', name: 'todo', backup: 'blocked', ado: 'blocked', team: 'todo', task: 'todo', receipt: 'todo', dispatch: 'blocked', login: 'blocked' });
  assert.equal(v.current, 'connect');
  assert.deepEqual([v.finished, v.total, v.complete], [0, 7, false]);
});

test('everything done: complete, nothing current', () => {
  const v = stepsFor(all);
  assert.ok(v.steps.every(s => s.state === 'done'));
  assert.deepEqual([v.done, v.finished, v.complete, v.current], [7, 7, true, null]);
});

test('skipping ADO: core done moves on to the later steps', () => {
  const v = stepsFor({ ...all, ado: { state: 'off' }, dispatch: 'off', startAtLogin: false }, ['ado']);
  assert.equal(states(v).ado, 'skipped');
  assert.equal(v.complete, true);
  assert.equal(v.done, 6);
  assert.equal(v.current, 'dispatch');
  assert.equal(stepsFor({ ...all }, ['ado']).steps.find(s => s.id === 'ado').state, 'done', 'done wins over skipped');
});

test('a blocked step becomes current only when nothing else core is left', () => {
  const v = stepsFor({ ...all, ado: { state: 'noPat', patEnv: 'ADO_PAT' } });
  assert.equal(v.current, 'ado');
  const w = stepsFor({ ...all, connected: false, ado: { state: 'browser' } }, ['connect']);
  assert.equal(states(w).ado, 'skipped', 'no Workshop, no ADO');
});

test('unknown facts (null) never tick a step', () => {
  const v = stepsFor({ connected: true, ado: null, receipts: 0, tasks: null, name: '' });
  assert.equal(states(v).ado, 'todo');
  assert.equal(states(v).task, 'todo');
});

test('adoFact turns connector info into one plain state', () => {
  const info = (state, extra = {}) => ({ id: 'ado', enabled: true, status: { state, message: null, ...extra } });
  const cfg = conns => ({ config: { connections: conns } });
  assert.deepEqual(adoFact(undefined), { state: 'missing' });
  assert.deepEqual(adoFact({ id: 'ado', enabled: false, status: { state: 'disabled' } }), { state: 'off' });
  assert.deepEqual(adoFact(info('error', { message: 'Add an ADO connection in Settings.' }), cfg([])), { state: 'noConnection' });
  assert.deepEqual(adoFact(info('error', { message: 'Add an ADO connection in Settings.' })), { state: 'noConnection' });
  assert.deepEqual(adoFact(info('error', { details: { patsMissing: ['WORK_PAT'] } }), cfg([{ patEnv: 'WORK_PAT' }])), { state: 'noPat', patEnv: 'WORK_PAT' });
  assert.deepEqual(adoFact(info('ready'), cfg([{ patEnv: 'ADO_PAT' }])), { state: 'ready', message: '', noExpiry: true, patEnv: 'ADO_PAT' });
  assert.equal(adoFact(info('ready', { message: 'The PAT in ADO_PAT expires in 3 days.' }), cfg([{ patEnv: 'ADO_PAT', patExpires: '2026-12-01' }])).noExpiry, false);
  assert.deepEqual(adoFact(info('error', { message: 'Two connections are named "a".' }), cfg([{}])), { state: 'error', message: 'Two connections are named "a".' });
});

test('the card: the current step is open with what to do next, and every command can be copied', () => {
  const { html, copies } = card(stepsFor(fresh), null, { ...ctx, facts: fresh });
  assert.match(html, /Get started · 0 of 7/);
  assert.match(html, /data-step="connect"[^>]*>\s*<button[^>]*aria-expanded="true"/);
  assert.deepEqual(copies, ['irm https://workshop.alexisdavidson.org/install.ps1 | iex', 'irm https://workshop.alexisdavidson.org/install-work.ps1 | iex']);
  assert.match(html, /data-copy="0"/);
  assert.match(html, /Skip this step/);
  assert.equal((html.match(/aria-expanded="true"/g) || []).length, 1);
  const mac = card(stepsFor(fresh), null, { ...ctx, platform: 'mac', origin: 'http://127.0.0.1:4380', facts: fresh });
  assert.deepEqual(mac.copies, ['curl -fsSL https://workshop.alexisdavidson.org/install.sh | bash', 'curl -fsSL https://workshop.alexisdavidson.org/install-work.sh | bash'], 'never an http installer address');
});

test('the ADO step names the PAT variable to save and links to Settings on this computer', () => {
  const f = { ...fresh, connected: true, name: 'Sam', ado: { state: 'noPat', patEnv: 'WORK_PAT' } };
  const { html, copies } = card(stepsFor(f), 'ado', { ...ctx, facts: f });
  assert.deepEqual(copies, ['workshop pat WORK_PAT']);
  assert.match(html, /picks it up within seconds/);
  const off = { ...f, ado: { state: 'off' } };
  const o = card(stepsFor(off), 'ado', { ...ctx, facts: off });
  assert.deepEqual(o.copies, ['workshop pat ADO_PAT']);
  assert.match(o.html, /href="http:\/\/127\.0\.0\.1:4380\/apps\/settings\/"[^>]*>Open Settings on this computer/);
  assert.match(o.html, /Import settings from a file/);
  const inShell = card(stepsFor(off), 'ado', { ...ctx, settings: { inShell: true }, facts: off });
  assert.match(inShell.html, /data-open="settings"/);
  const none = card(stepsFor(off), 'ado', { ...ctx, settings: null, facts: off });
  assert.ok(!/Open Settings/.test(none.html), 'no dead button when the agent address is unknown');
});

test('open steps link to the right app and route; a closed card shows no bodies', () => {
  const f = { ...all, tasks: 0, receipts: 0 };
  assert.match(card(stepsFor(f), 'task', { ...ctx, facts: f }).html, /data-open="prioritizer"/);
  assert.match(card(stepsFor(f), 'receipt', { ...ctx, facts: f }).html, /data-open="receipts" data-path="me"/);
  assert.ok(!card(stepsFor(f), '', { ...ctx, facts: f }).html.includes('su-body'));
  const skipped = card(stepsFor(f, ['receipt']), 'receipt', { ...ctx, facts: f }).html;
  assert.match(skipped, /data-unskip="receipt"/);
  assert.match(card(stepsFor(all), null, { ...ctx, facts: all }).html, /You're set up/);
});

test('text from settings is escaped', () => {
  const f = { ...fresh, connected: true, ado: { state: 'error', message: '<img src=x onerror=alert(1)>' } };
  const { html } = card(stepsFor(f), 'ado', { ...ctx, facts: f });
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img/);
});

function fakeWs({ backend = 'agent', saved = null } = {}) {
  const ws = {
    backend, mode: 'hosted', puts: [], subs: [],
    people: { async get() { return { people: [{ id: 'p1', relation: 'self' }, { id: 'p2', relation: 'report' }] }; } },
    data: {
      async get(c, o) {
        if (o && o.app === 'receipts') return { items: [] };
        if (c === 'setup') return saved;
        return null;
      },
      async put(c, env) { ws.puts.push([c, structuredClone(env)]); if (ws.conflict) { ws.conflict = false; throw Object.assign(new Error('x'), { code: 'conflict', current: { rev: 7, meta: { other: 1 } } }); } return { rev: env.rev + 1 }; }
    },
    connectors: {
      async list() { return [{ id: 'ado', enabled: true, status: { state: 'error', message: 'ADO_PAT is not set.', details: { patsMissing: ['ADO_PAT'] } } }, { id: 'opencode', enabled: false, status: { state: 'disabled' } }]; },
      async getConfig() { return { config: { connections: [{ name: 'main', patEnv: 'ADO_PAT' }] } }; }
    },
    config: { async get() { return { dataDir: OD, features: { startAtLogin: false, workMode: true } }; } }
  };
  return ws;
}

test('factsFor reads every app and connector, and keeps going when one fails', async () => {
  const f = await factsFor(fakeWs());
  assert.deepEqual(f, { connected: true, mode: 'hosted', ado: { state: 'noPat', patEnv: 'ADO_PAT' }, receipts: 0, team: 1, dataDir: OD, dispatch: 'off', startAtLogin: false, workMode: true });
  const ws = fakeWs({ backend: 'browser' });
  ws.data.get = async () => { throw new Error('no'); };
  ws.people.get = async () => { throw new Error('no'); };
  const b = await factsFor(ws);
  assert.deepEqual(b, { connected: false, mode: 'hosted', ado: { state: 'browser' }, receipts: 0, team: 0, dataDir: null, dispatch: null, startAtLogin: null, workMode: false });
});

test('createSetup saves hide and skip in home.setup, merges on a conflict, and puts it back if saving fails', async () => {
  const ws = fakeWs({ saved: { schema: 'home.setup', version: 1, rev: 3, items: [], deleted: {}, meta: { hidden: false, skipped: ['receipt', 'nope'] } } });
  let changes = 0;
  const s = createSetup(ws, { onChange: () => changes++, extra: () => ({ name: 'Sam', tasks: 2 }) });
  await s.load();
  assert.deepEqual(s.s.skipped, ['receipt'], 'unknown step ids are dropped');
  assert.equal(s.view().current, 'ado');
  await s.skip('ado');
  assert.deepEqual(ws.puts.at(-1), ['setup', { schema: 'home.setup', version: 1, rev: 3, items: [], deleted: {}, meta: { hidden: false, skipped: ['receipt', 'ado'], updatedAt: ws.puts.at(-1)[1].meta.updatedAt } }]);
  ws.conflict = true;
  await s.hide();
  assert.equal(ws.puts.at(-1)[1].rev, 7);
  assert.equal(ws.puts.at(-1)[1].meta.other, 1, 'keeps what another window saved');
  assert.equal(s.s.hidden, true);
  ws.data.put = async () => { throw Object.assign(new Error('disk'), { code: 'internal' }); };
  await assert.rejects(s.show());
  assert.equal(s.s.hidden, true, 'a failed save is undone on screen');
  assert.ok(changes >= 5);
});

test('every step has a unique id and later steps come after the core ones', () => {
  assert.equal(new Set(STEPS.map(s => s.id)).size, STEPS.length);
  const firstLater = STEPS.findIndex(s => !s.core);
  assert.ok(STEPS.slice(firstLater).every(s => !s.core));
  for (const s of STEPS) if (s.needs) assert.ok(STEPS.findIndex(x => x.id === s.needs) < STEPS.indexOf(s));
});

test('backup ticks off once the data folder is in OneDrive, and offers the move command until then', () => {
  assert.ok(onOneDrive(OD) && onOneDrive('/Users/sam/Library/CloudStorage/OneDrive-Acme/Workshop'));
  assert.ok(!onOneDrive('C:\\Users\\sam\\Workshop') && !onOneDrive(null));
  const local = { ...all, dataDir: 'C:\\Users\\sam\\Workshop' };
  const v = stepsFor(local);
  assert.equal(states(v).backup, 'todo');
  assert.equal(v.current, 'backup');
  const { html, copies } = card(v, 'backup', { ...ctx, facts: local });
  assert.ok(copies.includes('workshop data-folder --onedrive'));
  assert.match(html, /C:\\Users\\sam\\Workshop/);
});

test('team counts active reports and the manager from the people directory', () => {
  assert.equal(teamCount({ people: [{ relation: 'self' }, { relation: 'report' }, { relation: 'report', archived: true }, { relation: 'manager' }, { relation: 'peer' }] }), 2);
  assert.equal(teamCount(null), 0);
  assert.equal(states(stepsFor({ ...all, team: 0 })).team, 'todo');
});

test('Connect offers the work mode installer next to the usual one', () => {
  const { copies } = card(stepsFor(fresh), 'connect', { ...ctx, facts: fresh });
  assert.ok(copies.includes('irm https://workshop.alexisdavidson.org/install-work.ps1 | iex'));
  const mac = card(stepsFor(fresh), 'connect', { ...ctx, platform: 'mac', facts: fresh });
  assert.ok(mac.copies.includes('curl -fsSL https://workshop.alexisdavidson.org/install-work.sh | bash'));
});

test('receiptsCount: from Rapport\'s summary, 0 without one', async () => {
  const { receiptsCount } = await import('../js/setup.js');
  const summary = { schema: 'receipts.summary', version: 1, rev: 1, items: [{ id: 'entries', kind: 'count', title: 'Receipts', count: 7, updatedAt: 1 }] };
  assert.equal(receiptsCount(summary), 7);
  assert.equal(receiptsCount({ ...summary, version: 2 }), 0);
  assert.equal(receiptsCount(null), 0);
});
