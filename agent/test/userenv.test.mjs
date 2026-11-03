// Saved user environment variables read live (lib/userenv.mjs), so a PAT saved after Workshop started is
// seen without a restart. The Windows registry is faked here, except in the last test, which runs only on
// Windows and uses the real one with a throwaway variable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveEnv, parseRegQuery, readWindowsUserEnv } from '../lib/userenv.mjs';
import { writeWindowsUserEnv } from '../../scripts/lib/control.mjs';

const REG = '\r\nHKEY_CURRENT_USER\\Environment\r\n    ADO_PAT    REG_SZ    abc123-token\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\x\r\n    EMPTY    REG_SZ    \r\n\r\n';

test('parseRegQuery reads REG_SZ, expands REG_EXPAND_SZ, and matches names without case', () => {
  assert.equal(parseRegQuery(REG, 'ADO_PAT'), 'abc123-token');
  assert.equal(parseRegQuery(REG, 'ado_pat'), 'abc123-token');
  assert.equal(parseRegQuery(REG, 'Path', { USERPROFILE: 'C:\\Users\\a' }), 'C:\\Users\\a\\bin;C:\\x');
  assert.equal(parseRegQuery(REG, 'MISSING'), undefined);
});

test('readWindowsUserEnv asks reg for one valid name and treats a failure as not set', () => {
  const calls = [];
  const exec = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: REG }; };
  assert.equal(readWindowsUserEnv('ADO_PAT', { exec }), 'abc123-token');
  assert.deepEqual(calls[0], ['reg', 'query', 'HKCU\\Environment', '/v', 'ADO_PAT']);
  assert.equal(readWindowsUserEnv('BAD NAME', { exec }), undefined);
  assert.equal(readWindowsUserEnv('A;calc', { exec }), undefined);
  assert.equal(calls.length, 1, 'invalid names never reach reg');
  assert.equal(readWindowsUserEnv('ADO_PAT', { exec: () => ({ status: 1, stdout: '' }) }), undefined);
});

test('writeWindowsUserEnv sends the value on stdin, never on the command line', () => {
  let seen;
  const exec = (cmd, args, input) => { seen = { cmd, args, input }; return { status: 0 }; };
  assert.deepEqual(writeWindowsUserEnv('ADO_PAT', 'secret-token-value', { exec }), { ok: true, message: '' });
  assert.equal(seen.cmd, 'powershell.exe');
  assert.equal(seen.args.join(' ').includes('secret-token-value'), false);
  assert.equal(seen.input, 'secret-token-value\n');
  assert.match(seen.args.at(-1), /SetEnvironmentVariable\('ADO_PAT', \$v, 'User'\)/);
  assert.equal(writeWindowsUserEnv("A');calc;('", 'x', { exec }).ok, false);
  assert.match(writeWindowsUserEnv('ADO_PAT', null, { exec }).ok && seen.args.at(-1), /\$null/);
  assert.equal(writeWindowsUserEnv('ADO_PAT', 'x', { exec: () => ({ status: 1 }) }).ok, false);
  assert.equal(writeWindowsUserEnv('ADO_PAT', 'x', { exec: () => ({ error: new Error('ENOENT') }) }).ok, false);
});

test('liveEnv on Windows prefers the saved value, caches it briefly, and falls back to the process', () => {
  const saved = { ADO_PAT: 'first' };
  let reads = 0;
  let t = 0;
  const env = liveEnv({ ADO_PAT: 'from-start', HOME_ONLY: 'h' }, { platform: 'win32', read: n => { reads++; return saved[n]; }, ttlMs: 5000, now: () => t });
  assert.equal(env.ADO_PAT, 'first');
  saved.ADO_PAT = 'second';
  t = 4000;
  assert.equal(env.ADO_PAT, 'first', 'cached');
  t = 6000;
  assert.equal(env.ADO_PAT, 'second', 'saved after start: seen without a restart');
  assert.equal(env.HOME_ONLY, 'h');
  delete saved.ADO_PAT;
  t = 20000;
  assert.equal(env.ADO_PAT, 'from-start');
  assert.equal(env['not a name'], undefined);
  assert.ok(reads >= 3);
});

test('liveEnv elsewhere is the process environment itself', () => {
  const base = { A: '1' };
  assert.equal(liveEnv(base, { platform: 'linux' }), base);
  assert.equal(liveEnv(base, { platform: 'darwin' }), base);
});

test('Windows: a value saved for the user is read back, then removed', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const name = `WORKSHOP_TEST_${process.pid}`;
  try {
    assert.deepEqual(writeWindowsUserEnv(name, 'test-token-0123456789abcdef'), { ok: true, message: '' });
    assert.equal(readWindowsUserEnv(name), 'test-token-0123456789abcdef');
    assert.equal(liveEnv({}, { platform: 'win32' })[name], 'test-token-0123456789abcdef');
  } finally {
    writeWindowsUserEnv(name, null);
  }
  assert.equal(readWindowsUserEnv(name), undefined);
});
