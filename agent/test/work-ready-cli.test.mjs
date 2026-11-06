// The workshop command's everyday parts for a work computer: up, data-folder, and picking the data folder
// (company OneDrive) at install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, companyOneDrive, onOneDrive, chooseDataDir, parseDataFolderArgs, parseInstallArgs, startMenuDir } from '../../workshop.mjs';

const tempDir = pfx => fs.mkdtempSync(path.join(os.tmpdir(), pfx));
const rm = d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
const writeConfig = (home, extra = {}) => fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ configVersion: 1, port: 4398, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {}, ...extra }));
const readConfig = home => JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));

test('only the company OneDrive counts, never a personal one', () => {
  assert.equal(companyOneDrive({ OneDriveCommercial: 'C:\\Users\\a\\OneDrive - Acme', OneDrive: 'C:\\Users\\a\\OneDrive' }, { platform: 'win32' }), 'C:\\Users\\a\\OneDrive - Acme');
  assert.equal(companyOneDrive({ OneDrive: 'C:\\Users\\a\\OneDrive' }, { platform: 'win32' }), null);
  const mac = tempDir('workshop-od-mac-');
  try {
    fs.mkdirSync(path.join(mac, 'Library', 'CloudStorage', 'OneDrive-Personal'), { recursive: true });
    assert.equal(companyOneDrive({}, { platform: 'darwin', home: mac }), null);
    fs.mkdirSync(path.join(mac, 'Library', 'CloudStorage', 'OneDrive-Acme'));
    assert.equal(companyOneDrive({}, { platform: 'darwin', home: mac }), path.join(mac, 'Library', 'CloudStorage', 'OneDrive-Acme'));
  } finally { rm(mac); }
});

test('onOneDrive recognizes OneDrive folders on Windows and Mac', () => {
  assert.ok(onOneDrive('C:\\Users\\a\\OneDrive - Acme\\Workshop'));
  assert.ok(onOneDrive('/Users/a/Library/CloudStorage/OneDrive-Acme/Workshop'));
  assert.ok(!onOneDrive('C:\\Users\\a\\Workshop'));
  assert.ok(!onOneDrive('/home/a/NotOneDriveStuff'));
});

test('options for install and data-folder', () => {
  assert.equal(parseInstallArgs(['--onedrive']).opts.oneDrive, true);
  assert.equal(parseInstallArgs(['--data-dir', '/x']).opts.dataDir, '/x');
  assert.ok(parseInstallArgs(['--data-dir']).error);
  assert.ok(parseInstallArgs(['--onedrive', '--data-dir', '/x']).error);
  assert.deepEqual(parseDataFolderArgs([]).opts, { target: null, oneDrive: false });
  assert.equal(parseDataFolderArgs(['--onedrive']).opts.oneDrive, true);
  assert.ok(parseDataFolderArgs(['/a', '/b']).error);
  assert.ok(parseDataFolderArgs(['/a', '--onedrive']).error);
  assert.ok(parseDataFolderArgs(['--bogus']).error);
});

test('install picks the company OneDrive only on a new install', () => {
  const home = tempDir('workshop-cd-home-');
  const od = tempDir('workshop-cd-od-');
  const defaultDir = path.join(tempDir('workshop-cd-def-'), 'Workshop');
  const env = { OneDriveCommercial: od };
  try {
    const fresh = {};
    assert.match(chooseDataDir(fresh, { oneDrive: true }, { home, env, defaultDir })[0], /company OneDrive|Data folder/);
    assert.equal(fresh.dataDir, path.join(od, 'Workshop'));
    // A dataDir already chosen is kept.
    const set = { dataDir: '/somewhere/else' };
    assert.match(chooseDataDir(set, { oneDrive: true }, { home, env, defaultDir })[0], /stays there/);
    assert.equal(set.dataDir, '/somewhere/else');
    // Data already in the default folder stays there: changing dataDir never moves files.
    fs.mkdirSync(path.join(defaultDir, 'prioritizer'), { recursive: true });
    const used = {};
    assert.match(chooseDataDir(used, { oneDrive: true }, { home, env, defaultDir })[0], /workshop data-folder/);
    assert.equal(used.dataDir, undefined);
    // No company OneDrive: nothing changes.
    const none = {};
    assert.match(chooseDataDir(none, { oneDrive: true }, { home, env: {}, defaultDir, platform: 'linux' })[0], /No company OneDrive/);
    assert.equal(none.dataDir, undefined);
  } finally { rm(home); rm(od); rm(path.dirname(defaultDir)); }
});

test('data-folder copies everything to an empty folder, switches to it, and keeps the old one', async () => {
  const home = tempDir('workshop-df-home-');
  const oldDir = path.join(tempDir('workshop-df-old-'), 'Workshop');
  const target = path.join(tempDir('workshop-df-new-'), 'Workshop');
  const out = [];
  const io = { out: s => out.push(s), env: { WORKSHOP_HOME: home }, defaultDataDir: oldDir, probe: async () => null };
  try {
    writeConfig(home);
    fs.mkdirSync(path.join(oldDir, 'receipts', 'entries'), { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'receipts', 'entries', 'me.json'), '{"a":1}');
    fs.writeFileSync(path.join(oldDir, 'notes.md'), 'hi');
    assert.equal(await main(['data-folder'], io), 0);
    assert.match(out.join('\n'), new RegExp(`Your data is in ${oldDir.replace(/\\/g, '\\\\')}`));
    out.length = 0;
    assert.equal(await main(['data-folder', target], io), 0, out.join('\n'));
    assert.equal(readConfig(home).dataDir, target);
    assert.equal(fs.readFileSync(path.join(target, 'receipts', 'entries', 'me.json'), 'utf8'), '{"a":1}');
    assert.ok(fs.existsSync(path.join(oldDir, 'notes.md')), 'old folder kept');
    assert.match(out.join('\n'), /Copied 2 files/);
    // Already there.
    out.length = 0;
    assert.equal(await main(['data-folder', target], io), 0);
    assert.match(out.join('\n'), /already in/);
  } finally { rm(home); rm(path.dirname(oldDir)); rm(path.dirname(target)); }
});

test('data-folder refuses a folder with files in it, and changes nothing', async () => {
  const home = tempDir('workshop-df2-home-');
  const target = tempDir('workshop-df2-new-');
  const out = [];
  try {
    writeConfig(home);
    fs.writeFileSync(path.join(target, 'x.txt'), 'x');
    assert.equal(await main(['data-folder', target], { out: s => out.push(s), env: { WORKSHOP_HOME: home }, defaultDataDir: path.join(target, 'nope'), probe: async () => null }), 1);
    assert.match(out.join('\n'), /already has files/);
    assert.equal(readConfig(home).dataDir, undefined);
  } finally { rm(home); rm(target); }
});

test('copyTree copies nested files, refuses to write over one, and says which', async () => {
  const { copyTree } = await import('../../workshop.mjs');
  const src = tempDir('workshop-ct-src-'), dest = path.join(tempDir('workshop-ct-dest-'), 'Workshop');
  try {
    fs.mkdirSync(path.join(src, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a', 'b', 'x.json'), '1');
    fs.writeFileSync(path.join(src, 'y.md'), '2');
    fs.mkdirSync(dest);
    assert.equal(copyTree(src, dest), 2, 'an existing empty destination is fine');
    assert.equal(fs.readFileSync(path.join(dest, 'a', 'b', 'x.json'), 'utf8'), '1');
    assert.throws(() => copyTree(src, dest), /already there: .*x\.json/);
  } finally { rm(src); rm(path.dirname(dest)); }
});

test('data-folder --onedrive needs a company OneDrive', async () => {
  const home = tempDir('workshop-df3-home-');
  const out = [];
  try {
    writeConfig(home);
    assert.equal(await main(['data-folder', '--onedrive'], { out: s => out.push(s), env: { WORKSHOP_HOME: home }, platform: 'linux', probe: async () => null }), 1);
    assert.match(out.join('\n'), /no company OneDrive/);
  } finally { rm(home); }
});

test('up opens Workshop without starting a second one when it is running', async () => {
  const home = tempDir('workshop-up-home-');
  const opened = [];
  try {
    writeConfig(home);
    const io = { out: () => {}, env: { WORKSHOP_HOME: home }, probe: async () => ({ app: 'workshop-agent' }), open: async rest => { opened.push(rest); return 0; }, control: { spawnFn: () => { throw new Error('must not start'); } } };
    assert.equal(await main(['up'], io), 0);
    assert.equal(opened.length, 1);
  } finally { rm(home); }
});

test('up starts Workshop in the background when it is not running, then opens it', async () => {
  const home = tempDir('workshop-up2-home-');
  let started = 0, up = false;
  const opened = [];
  try {
    writeConfig(home);
    const io = {
      out: () => {}, env: { WORKSHOP_HOME: home },
      probe: async () => (up ? { app: 'workshop-agent' } : null),
      open: async rest => { opened.push(rest); return 0; },
      control: { spawnFn: () => { started++; up = true; return { on() {}, unref() {} }; }, sleep: async () => {} }
    };
    assert.equal(await main(['up'], io), 0);
    assert.equal(started, 1);
    assert.equal(opened.length, 1);
  } finally { rm(home); }
});

test('the Start menu folder is only on Windows', () => {
  assert.equal(startMenuDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'linux'), null);
  assert.match(startMenuDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32'), /Start Menu.Programs.Workshop$/);
});
