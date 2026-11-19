// Secrets in the operating system's store (lib/secrets.mjs, scripts/lib/secrets-store.mjs, `workshop secret`),
// ctx.secret for connectors, and what Settings sees. Every store is faked here: no test reads or writes a real
// Keychain, Credential Manager or Secret Service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECRET_NAME, daysLeft, readCommand, readIndex, readSecret, secretReader, secretStatus, storeName, WIN_READ } from '../lib/secrets.mjs';
import { removeCommand, removeSecret, saveCommand, saveSecret, secretProblem, writeIndexEntry } from '../../scripts/lib/secrets-store.mjs';
import { secretNames } from '../lib/connectors.mjs';
import { main } from '../../workshop.mjs';

const TOKEN = 'cf-Abc123_def456-ghi789jkl012mno345pqr678';
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-secrets-'));

test('names are lowercase words with dashes, like connector ids', () => {
  for (const ok of ['cloudflare', 'github-home', 'a1']) assert.ok(SECRET_NAME.test(ok), ok);
  for (const bad of ['', 'Cloudflare', '1abc', 'a b', 'a;calc', '../x', 'a'.repeat(41), '-x']) assert.ok(!SECRET_NAME.test(bad), bad);
});

test('each platform reads with one fixed program, the name as its own argument, and never a shell', () => {
  assert.deepEqual(readCommand('cloudflare', 'darwin'), { cmd: 'security', args: ['find-generic-password', '-s', 'workshop', '-a', 'cloudflare', '-w'], env: {} });
  assert.deepEqual(readCommand('cloudflare', 'linux'), { cmd: 'secret-tool', args: ['lookup', 'service', 'workshop', 'account', 'cloudflare'], env: {} });
  const w = readCommand('cloudflare', 'win32');
  assert.equal(w.cmd, 'powershell.exe');
  assert.equal(w.env.WORKSHOP_SECRET_TARGET, 'workshop:cloudflare');
  assert.equal(w.args.at(-1), WIN_READ);
  assert.ok(!WIN_READ.includes('cloudflare'), 'the name is never in the script text');
  assert.equal(readCommand('cloudflare', 'aix'), null);
  assert.throws(() => readCommand("x'; calc", 'darwin'), /not a valid secret name/);
  assert.equal(storeName('darwin'), 'macOS Keychain');
  assert.equal(storeName('win32'), 'Windows Credential Manager');
});

test('the Windows read script can only read: CredRead and CredFree, no write or delete', () => {
  assert.match(WIN_READ, /CredRead/);
  for (const banned of ['CredWrite', 'CredDelete', 'CredEnumerate', 'Invoke-Expression', 'iex ', 'DownloadString', 'Net.WebClient']) assert.ok(!WIN_READ.includes(banned), banned);
});

test('readSecret trims the one newline security prints and treats a failure or empty output as not saved', async () => {
  let seen;
  const exec = async (cmd, args, env) => { seen = { cmd, args, env }; return { status: 0, stdout: `${TOKEN}\n` }; };
  assert.equal(await readSecret('cloudflare', { platform: 'darwin', exec }), TOKEN);
  assert.equal(seen.cmd, 'security');
  assert.equal(await readSecret('cloudflare', { platform: 'darwin', exec: async () => ({ status: 44, stdout: '' }) }), undefined);
  assert.equal(await readSecret('cloudflare', { platform: 'linux', exec: async () => ({ status: 0, stdout: '' }) }), undefined);
  assert.equal(await readSecret('cloudflare', { platform: 'win32', exec: async () => { throw new Error('ENOENT'); } }), undefined);
  assert.equal(await readSecret('cloudflare', { platform: 'aix', exec }), undefined);
  await assert.rejects(readSecret('Bad Name', { platform: 'darwin', exec }), /not a valid secret name/);
});

test('the reader caches a value for a minute, and forget() drops it', async () => {
  let calls = 0, t = 0;
  const exec = async () => { calls += 1; return { status: 0, stdout: TOKEN }; };
  const read = secretReader({ platform: 'linux', exec, ttlMs: 60000, now: () => t });
  assert.equal(await read('cloudflare'), TOKEN);
  assert.equal(await read('cloudflare'), TOKEN);
  assert.equal(calls, 1);
  t = 61000;
  await read('cloudflare');
  assert.equal(calls, 2);
  read.forget('cloudflare');
  await read('cloudflare');
  assert.equal(calls, 3);
});

test('saving puts the value on stdin (hex for macOS), never in the arguments', () => {
  const mac = saveCommand('cloudflare', TOKEN, 'darwin');
  assert.deepEqual(mac.args, ['-i']);
  assert.match(mac.input, /^add-generic-password -U -s workshop -a cloudflare -l Workshop-cloudflare -X [0-9a-f]+\n$/);
  assert.ok(!mac.input.includes(TOKEN), 'macOS gets the value hex-encoded');
  assert.equal(Buffer.from(mac.input.trim().split(' ').at(-1), 'hex').toString('utf8'), TOKEN);
  const win = saveCommand('cloudflare', TOKEN, 'win32');
  assert.equal(win.input, `${TOKEN}\n`);
  assert.equal(win.env.WORKSHOP_SECRET_TARGET, 'workshop:cloudflare');
  const lin = saveCommand('cloudflare', TOKEN, 'linux');
  assert.equal(lin.input, TOKEN);
  for (const c of [mac, win, lin]) assert.ok(!c.args.join(' ').includes(TOKEN), `${c.cmd} has the value in its arguments`);
  assert.deepEqual(removeCommand('cloudflare', 'darwin').args, ['delete-generic-password', '-s', 'workshop', '-a', 'cloudflare']);
  assert.deepEqual(removeCommand('cloudflare', 'linux').args, ['clear', 'service', 'workshop', 'account', 'cloudflare']);
  assert.throws(() => saveCommand('x y', TOKEN, 'linux'));
});

test('saveSecret records the name only after reading the value back; secrets.json never holds a value', async () => {
  const home = tmpHome();
  try {
    const store = new Map();
    const exec = (cmd, args, input) => { store.set('cloudflare', input.trim()); return { status: 0 }; };
    const read = async n => store.get(n);
    const r = await saveSecret(home, 'cloudflare', TOKEN, { platform: 'linux', exec, read, expires: '2027-02-01', note: 'Workers and DNS', now: () => new Date('2026-11-19T12:00:00Z') });
    assert.deepEqual(r, { ok: true, message: '' });
    const text = fs.readFileSync(path.join(home, 'secrets.json'), 'utf8');
    assert.ok(!text.includes(TOKEN), 'no value in secrets.json');
    assert.deepEqual(readIndex(home).cloudflare, { store: 'Secret Service (secret-tool)', saved: '2026-11-19T12:00:00.000Z', expires: '2027-02-01', note: 'Workers and DNS' });
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, 'secrets.json')).mode & 0o777, 0o600);

    const lost = await saveSecret(home, 'other', TOKEN, { platform: 'linux', exec: () => ({ status: 0 }), read: async () => undefined });
    assert.equal(lost.ok, false);
    assert.equal(readIndex(home).other, undefined, 'not recorded when the store did not keep it');
    assert.equal((await saveSecret(home, 'x1', TOKEN, { platform: 'linux', exec: () => ({ status: 1 }), read })).ok, false);
    assert.match((await saveSecret(home, 'x1', TOKEN, { platform: 'linux', exec: () => ({ error: new Error('ENOENT') }), read })).message, /libsecret-tools/);

    assert.equal(removeSecret(home, 'cloudflare', { platform: 'linux', exec: () => ({ status: 0 }) }).ok, true);
    assert.equal(readIndex(home).cloudflare, undefined);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('secretProblem catches pasted mistakes without repeating the value', () => {
  assert.equal(secretProblem(TOKEN), null);
  for (const bad of ['', 'has space here and more', 'short', 'x'.repeat(1001), 'tab\there-and-more-text']) {
    const p = secretProblem(bad);
    assert.ok(p, bad);
    if (bad) assert.ok(!p.includes(bad));
  }
});

test('expiry: days left, and what Settings sees (never a value)', () => {
  assert.equal(daysLeft('2026-12-03', '2026-11-19'), 14);
  assert.equal(daysLeft('2026-11-18', '2026-11-19'), -1);
  assert.equal(daysLeft(null, '2026-11-19'), null);
  const index = { cloudflare: { store: 'macOS Keychain', saved: 'x', expires: '2026-12-01', note: '' } };
  assert.deepEqual(secretStatus(index, 'cloudflare', '2026-11-19'), { set: true, store: 'macOS Keychain', expires: '2026-12-01', daysLeft: 12 });
  assert.deepEqual(secretStatus(index, 'missing', '2026-11-19'), { set: false, store: null, expires: null, daysLeft: null });
});

test('readIndex ignores bad names and junk', () => {
  const home = tmpHome();
  try {
    assert.deepEqual(readIndex(home), {});
    fs.writeFileSync(path.join(home, 'secrets.json'), '{"secrets":{"Bad Name":{},"ok":{"expires":"soon","note":3}}}');
    assert.deepEqual(readIndex(home), { ok: { store: null, saved: null, expires: null, note: '' } });
    fs.writeFileSync(path.join(home, 'secrets.json'), 'not json');
    assert.deepEqual(readIndex(home), {});
    writeIndexEntry(home, 'a1', { store: 's', saved: 't', expires: null, note: '' });
    assert.deepEqual(Object.keys(readIndex(home)), ['a1']);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('secretNames finds the names in x-workshop-secret fields only', () => {
  const schema = { type: 'object', properties: {
    token: { type: 'string', title: 'T', 'x-workshop-secret': true },
    env: { type: 'string', title: 'E', 'x-workshop-env': true },
    list: { type: 'array', title: 'L', items: { type: 'object', properties: { s: { type: 'string', title: 'S', 'x-workshop-secret': true } } } }
  } };
  assert.deepEqual([...secretNames(schema, { token: 'cloudflare', env: 'X', list: [{ s: 'two' }, { s: 'Bad Name' }] })].sort(), ['cloudflare', 'two']);
});

function cli({ platform = 'darwin', secret = TOKEN, running = false, saveOk = true, stored = {} } = {}) {
  const lines = [], saves = [];
  const home = tmpHome();
  const io = {
    out: s => lines.push(s), env: { WORKSHOP_HOME: home }, platform, now: () => new Date('2026-11-19T12:00:00Z'),
    secret: async () => { if (secret instanceof Error) throw secret; return secret; },
    probe: async () => (running ? { app: 'workshop-agent' } : null),
    secretStore: {
      save: async (h, n, v, o) => { saves.push([n, v, o.expires]); if (!saveOk) return { ok: false, message: 'The store said no.' }; stored[n] = v; writeIndexEntry(h, n, { store: storeName(platform), saved: 'now', expires: o.expires, note: o.note }); return { ok: true, message: '' }; },
      read: async n => stored[n],
      remove: (h, n) => { delete stored[n]; writeIndexEntry(h, n, null); return { ok: true, message: '' }; }
    }
  };
  return { io, lines, saves, home, text: () => lines.join('\n'), done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('workshop secret set saves through the store, never prints the value, and takes an expiry', async () => {
  const c = cli({ running: true });
  try {
    assert.equal(await main(['secret', 'set', 'cloudflare', '--expires', '2027-02-01', '--note', 'Workers'], c.io), 0);
    assert.deepEqual(c.saves, [['cloudflare', TOKEN, '2027-02-01']]);
    assert.ok(!c.text().includes(TOKEN));
    assert.match(c.text(), /Saved cloudflare \(41 characters\) in macOS Keychain/);
    assert.match(c.text(), /within a minute/);
    assert.equal(await main(['secret', 'list'], c.io), 0);
    assert.match(c.text(), /cloudflare: macOS Keychain, saved now, expires 2027-02-01/);
    assert.equal(await main(['secret', 'check', 'cloudflare'], c.io), 0);
    assert.match(c.text(), /cloudflare is in macOS Keychain \(41 characters\)/);
    assert.equal(await main(['secret', 'remove', 'cloudflare'], c.io), 0);
    assert.equal(await main(['secret', 'check', 'cloudflare'], c.io), 1);
    assert.ok(!c.text().includes(TOKEN));
  } finally { c.done(); }
});

test('workshop secret refuses bad names, bad or past dates, bad pastes and failed saves', async () => {
  const c = cli();
  try {
    assert.equal(await main(['secret', 'set', 'Bad Name'], c.io), 1);
    assert.equal(await main(['secret', 'set', 'cloudflare', '--expires', 'soon'], c.io), 1);
    assert.equal(await main(['secret', 'set', 'cloudflare', '--expires', '2026-01-01'], c.io), 1);
    assert.match(c.text(), /already passed/);
    assert.deepEqual(c.saves, []);
  } finally { c.done(); }
  const bad = cli({ secret: 'short' });
  try { assert.equal(await main(['secret', 'set', 'cloudflare'], bad.io), 1); assert.match(bad.text(), /Nothing was saved/); assert.deepEqual(bad.saves, []); } finally { bad.done(); }
  const fail = cli({ saveOk: false });
  try { assert.equal(await main(['secret', 'set', 'cloudflare'], fail.io), 1); assert.match(fail.text(), /The store said no\. Nothing was saved/); } finally { fail.done(); }
  const cancel = cli({ secret: Object.assign(new Error('x'), { code: 'cancelled' }) });
  try { assert.equal(await main(['secret', 'set', 'cloudflare'], cancel.io), 1); assert.match(cancel.text(), /Cancelled/); } finally { cancel.done(); }
  const none = cli({ platform: 'aix' });
  try { assert.equal(await main(['secret', 'list'], none.io), 1); } finally { none.done(); }
});
