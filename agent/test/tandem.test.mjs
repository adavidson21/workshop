// Tandem (eng-agents) next to Workshop: what opencode has installed, when update reinstalls it, how it is
// installed, and what doctor says. PowerShell is never run: installTandem takes a fake runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installedTandem, newerVersion, tandemVersionAt, installTandem, planLatest, tandemDoctor, ensureTandem, findEngAgents } from '../../workshop.mjs';

const hasGit = spawnSync('git', ['--version']).status === 0;
const rm = d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

/** A temp root with an origin (Workshop at v1.0.0, Tandem with core-v2.0.0 and core-v2.1.0), clones of both next to
 *  each other, and a user home with opencode's config folder. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-tandem-'));
  const g = (dir, ...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const make = (name, commits) => {
    const dir = path.join(root, `${name}-origin`);
    fs.mkdirSync(dir);
    g(dir, 'init', '-q', '-b', 'main');
    for (const [files, tag] of commits) {
      for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
      g(dir, 'add', '.'); g(dir, 'commit', '-qm', tag); g(dir, 'tag', tag);
    }
    return dir;
  };
  const wsOrigin = make('workshop', [[{ 'f.txt': 'one' }, 'v1.0.0']]);
  const eaOrigin = make('eng-agents', [[{ 'core/VERSION': '2.0.0', 'update.ps1': '', 'install.ps1': '' }, 'core-v2.0.0'], [{ 'core/VERSION': '2.1.0' }, 'core-v2.1.0']]);
  const clone = (origin, name, at) => {
    const dir = path.join(root, name);
    assert.equal(spawnSync('git', ['clone', '-q', origin, dir]).status, 0);
    if (at) g(dir, 'checkout', '-q', '--detach', at);
    return dir;
  };
  const ws = clone(wsOrigin, 'workshop', 'v1.0.0');
  const userHome = path.join(root, 'home');
  fs.mkdirSync(userHome);
  const install = (core, source) => {
    const d = path.join(userHome, '.config', 'opencode', 'eng-agents');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), '\uFEFF' + JSON.stringify({ source, components: { core: { version: core } } }));
  };
  return { root, ws, eaOrigin, clone, userHome, install };
}

test('installedTandem reads the manifest install.ps1 writes, BOM and all', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    assert.equal(installedTandem(s.userHome), null, 'nothing installed');
    s.install('2.0.0', 'C:\\repos\\eng-agents');
    assert.deepEqual(installedTandem(s.userHome), { core: '2.0.0', source: 'C:\\repos\\eng-agents' });
  } finally { rm(s.root); }
});

test('update reinstalls Tandem when opencode has an older Core, even with the checkout already at the newest tag', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    const ea = s.clone(s.eaOrigin, 'eng-agents', 'core-v2.1.0');
    assert.equal(findEngAgents(s.ws), ea);
    assert.equal(tandemVersionAt(ea, 'refs/tags/core-v2.1.0'), '2.1.0');
    s.install('2.0.0', ea);
    let plan = planLatest(s.ws, () => {}, { userHome: s.userHome });
    assert.equal(plan.tags.engAgentsTag, 'core-v2.1.0', 'the stale install is the bug this fixes');
    assert.ok(plan.lines.some(l => /Core 2\.0\.0 in opencode -> core-v2\.1\.0/.test(l)), plan.lines.join('\n'));
    s.install('2.1.0', ea);
    plan = planLatest(s.ws, () => {}, { userHome: s.userHome });
    assert.equal(plan.tags.engAgentsTag, undefined);
    assert.ok(plan.lines.some(l => /Tandem \(eng-agents\): already at core-v2\.1\.0/.test(l)), plan.lines.join('\n'));
  } finally { rm(s.root); }
});

test('without a Tandem clone, update says how to add it only when Dispatch is on', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    assert.ok(planLatest(s.ws, () => {}, { userHome: s.userHome }).lines.some(l => /workshop apps on dispatch/.test(l)));
    assert.ok(!planLatest(s.ws, () => {}, { userHome: s.userHome, dispatchOn: false }).lines.some(l => /Tandem/.test(l)));
  } finally { rm(s.root); }
});

test('installTandem: first install moves to the tag and runs install.ps1; later ones run update.ps1 -Tag -Yes', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    const ea = s.clone(s.eaOrigin, 'eng-agents', 'core-v2.0.0');
    const personal = path.join(s.userHome, '.config', 'eng-agents', 'personal');
    fs.mkdirSync(personal, { recursive: true });
    const calls = [], out = [];
    const run = (exe, args) => { calls.push([exe, ...args]); s.install(tandemVersionAt(ea), ea); return { status: 0 }; };
    assert.ok(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run }), out.join('\n'));
    assert.equal(path.basename(calls[0][5]), 'install.ps1');
    assert.deepEqual(calls[0].slice(6), ['-Personal', personal]);
    assert.equal(tandemVersionAt(ea), '2.1.0', 'checked out the tag first');
    assert.ok(out.some(l => /workshop restart/.test(l)), 'says opencode needs a restart');

    calls.length = 0;
    assert.ok(installTandem(ea, 'core-v2.1.0', { out: () => {}, userHome: s.userHome, ps: 'pwsh', run }));
    assert.equal(path.basename(calls[0][5]), 'update.ps1');
    assert.deepEqual(calls[0].slice(6), ['-Tag', 'core-v2.1.0', '-Yes']);
  } finally { rm(s.root); }
});

test('installTandem fails plainly without PowerShell, or when opencode does not end up with that version', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    const ea = s.clone(s.eaOrigin, 'eng-agents', 'core-v2.0.0');
    const out = [];
    assert.equal(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: null }), false);
    assert.match(out.join('\n'), /needs PowerShell/);
    s.install('2.0.0', ea);
    out.length = 0;
    assert.equal(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run: () => ({ status: 0 }) }), false, 'exit 0 but still 2.0.0');
    assert.match(out.join('\n'), /Tandem did not install/);
  } finally { rm(s.root); }
});

test('ensureTandem leaves a Tandem installed from elsewhere alone', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    s.install('2.0.0', '/somewhere/else');
    const out = [];
    assert.equal(ensureTandem({ repo: s.ws, out: l => out.push(l), userHome: s.userHome }), true);
    assert.match(out.join('\n'), /already installed in opencode from \/somewhere\/else/);
    assert.equal(fs.existsSync(path.join(s.root, 'eng-agents')), false, 'nothing downloaded');
  } finally { rm(s.root); }
});

test('doctor flags a Tandem install that is behind its checkout', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    assert.match(tandemDoctor({ repo: s.ws, userHome: s.userHome }).line, /not installed, so Dispatch has no agents/);
    assert.equal(tandemDoctor({ repo: s.ws, userHome: s.userHome, dispatchOn: false }), null);
    const ea = s.clone(s.eaOrigin, 'eng-agents', 'core-v2.1.0');
    let d = tandemDoctor({ repo: s.ws, userHome: s.userHome });
    assert.equal(d.bad, true); assert.match(d.line, /not installed in opencode/);
    s.install('2.0.0', ea);
    d = tandemDoctor({ repo: s.ws, userHome: s.userHome });
    assert.equal(d.bad, true); assert.match(d.line, /opencode has Core 2\.0\.0, but .* is at 2\.1\.0/);
    s.install('2.1.0', ea);
    d = tandemDoctor({ repo: s.ws, userHome: s.userHome });
    assert.equal(d.bad, false); assert.match(d.line, /Core 2\.1\.0 in opencode: ok/);
  } finally { rm(s.root); }
});

test('update never moves Tandem back to an older release than opencode has', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    const ea = s.clone(s.eaOrigin, 'eng-agents');
    s.install('2.10.0', ea);
    const plan = planLatest(s.ws, () => {}, { userHome: s.userHome });
    assert.equal(plan.tags.engAgentsTag, undefined, '2.10.0 is newer than core-v2.1.0');
    assert.ok(plan.lines.some(l => /newer than the newest release \(core-v2\.1\.0\)/.test(l)), plan.lines.join('\n'));
    const out = [];
    assert.equal(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run: () => { throw new Error('ran'); } }), false);
    assert.match(out.join('\n'), /Not installing an older version/);
    assert.equal(newerVersion('2.10.0', '2.9.1'), true);
    assert.equal(newerVersion('2.1.0', '2.1.0'), false);
  } finally { rm(s.root); }
});
