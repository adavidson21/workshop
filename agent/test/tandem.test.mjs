// Tandem (eng-agents) next to Workshop: what opencode has installed, when update reinstalls it, how it is
// installed, and what doctor says. PowerShell is never run: installTandem takes a fake runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { installedTandem, newerVersion, restartOpencode, opencodeStale, opencodeCommand, tandemVersionAt, installTandem, planLatest, tandemDoctor, ensureTandem, findEngAgents, parseUpdateArgs, tandemNotices, updateSummary, pinNotices } from '../../workshop.mjs';

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
    let restarts = 0;
    const restart = () => { restarts++; };
    const run = (exe, args) => { calls.push([exe, ...args]); s.install(tandemVersionAt(ea), ea); return { status: 0 }; };
    assert.ok(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run, restart }), out.join('\n'));
    assert.equal(path.basename(calls[0][5]), 'install.ps1');
    assert.deepEqual(calls[0].slice(6), ['-Personal', personal]);
    assert.equal(tandemVersionAt(ea), '2.1.0', 'checked out the tag first');
    assert.equal(restarts, 1, 'opencode is restarted so it loads the new agents');

    calls.length = 0;
    assert.ok(installTandem(ea, 'core-v2.1.0', { out: () => {}, userHome: s.userHome, ps: 'pwsh', run, restart }));
    assert.equal(path.basename(calls[0][5]), 'update.ps1');
    assert.deepEqual(calls[0].slice(6), ['-Tag', 'core-v2.1.0', '-Yes']);

    // An update from an older checkout moves to the tag before running update.ps1, so the tag's script runs.
    spawnSync('git', ['-C', ea, 'checkout', '-q', '--detach', 'core-v2.0.0']);
    calls.length = 0;
    const seen = [];
    const run2 = (exe, args) => { seen.push(tandemVersionAt(ea)); s.install(tandemVersionAt(ea), ea); return { status: 0 }; };
    assert.ok(installTandem(ea, 'core-v2.1.0', { out: () => {}, userHome: s.userHome, ps: 'pwsh', run: run2, restart }));
    assert.deepEqual(seen, ['2.1.0']);
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

test('a Tandem clone kept elsewhere is found from opencode\'s manifest, or named with --eng-agents', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    const ea = s.clone(s.eaOrigin, path.join('repos', 'AI', 'eng-agents'), 'core-v2.0.0');
    assert.equal(findEngAgents(s.ws, { userHome: s.userHome }), null, 'not next to Workshop and nothing installed');
    s.install('2.0.0', ea);
    assert.equal(findEngAgents(s.ws, { userHome: s.userHome }), ea, 'from the manifest source');
    const plan = planLatest(s.ws, () => {}, { userHome: s.userHome });
    assert.equal(plan.tags.engAgentsTag, 'core-v2.1.0');
    assert.ok(plan.lines.some(l => l.includes(`Tandem (eng-agents, ${ea})`)), 'names the folder when it is not next to Workshop');
    assert.match(tandemDoctor({ repo: s.ws, userHome: s.userHome }).line, /Core 2\.0\.0 in opencode: ok/, 'doctor checks it too');

    s.install('2.0.0', '/not/a/clone');
    assert.equal(findEngAgents(s.ws, { userHome: s.userHome }), null);
    assert.match(tandemDoctor({ repo: s.ws, userHome: s.userHome }).line, /workshop update --eng-agents/);
    assert.equal(planLatest(s.ws, () => {}, { userHome: s.userHome, engAgentsDir: ea }).tags.engAgentsTag, 'core-v2.1.0', 'named folder');
    assert.equal(findEngAgents(s.ws, { userHome: s.userHome, dir: s.root }), null, 'a named folder must be a clone');
  } finally { rm(s.root); }
});

test('update --eng-agents parses, and does not go with --pull or --check', () => {
  assert.equal(parseUpdateArgs(['--eng-agents', '/x']).opts.engAgents, '/x');
  assert.equal(parseUpdateArgs(['--eng-agents', '/x']).opts.latest, true);
  assert.equal(parseUpdateArgs(['--eng-agents', '/x', '--eng-agents-tag', 'core-v2.1.0']).opts.engAgentsTag, 'core-v2.1.0');
  assert.match(parseUpdateArgs(['--eng-agents']).error, /needs the folder/);
  assert.ok(parseUpdateArgs(['--eng-agents', '/x', '--pull']).error);
  assert.ok(parseUpdateArgs(['--eng-agents', '/x', '--check']).error);
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
    assert.equal(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run: () => { throw new Error('ran'); }, restart: () => {} }), false);
    assert.match(out.join('\n'), /Not installing an older version/);
    assert.equal(newerVersion('2.10.0', '2.9.1'), true);
    assert.equal(newerVersion('2.1.0', '2.1.0'), false);
  } finally { rm(s.root); }
});

test('restartOpencode stops and starts the 2.x service, and only explains for 1.x or no opencode', () => {
  const calls = [], out = [];
  const fake = ver => (exe, args) => { calls.push(args.join(' ')); return args[0] === '--version' ? (ver ? { status: 0, stdout: ver } : { error: new Error('ENOENT') }) : { status: 0, stdout: '' }; };
  assert.equal(restartOpencode({ out: l => out.push(l), run: fake('2.3.1') }), true);
  assert.deepEqual(calls, ['--version', 'service stop', 'service start']);
  calls.length = 0;
  assert.equal(restartOpencode({ out: l => out.push(l), run: fake('1.14.0') }), false);
  assert.deepEqual(calls, ['--version']);
  assert.match(out.at(-1), /workshop restart/);
  assert.equal(restartOpencode({ out: l => out.push(l), run: fake(null) }), false);
  assert.match(out.at(-1), /did not run here/);
});

test('doctor says to restart opencode when its service started before the last Tandem install', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    const ea = s.clone(s.eaOrigin, 'eng-agents', 'core-v2.1.0');
    const svc = path.join(s.userHome, '.config', 'opencode', 'service.json');
    s.install('2.1.0', ea);
    fs.writeFileSync(svc, '{}');
    assert.equal(opencodeStale(s.userHome), false, 'service started after the install');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(svc, old, old);
    assert.equal(opencodeStale(s.userHome), true);
    const d = tandemDoctor({ repo: s.ws, userHome: s.userHome });
    assert.equal(d.bad, true);
    assert.match(d.line, /Core 2\.1\.0 in opencode: ok\.\nopencode: .*workshop restart --opencode/);
    fs.rmSync(svc);
    assert.equal(opencodeStale(s.userHome), false, 'no service.json: 1.x or not started');
  } finally { rm(s.root); }
});

test('restartOpencode uses the opencode command from the connector config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-occmd-'));
  try {
    assert.equal(opencodeCommand(home), 'opencode');
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ connectors: { opencode: { config: { opencode: { command: '/opt/oc/opencode' } } } } }));
    assert.equal(opencodeCommand(home), '/opt/oc/opencode');
    const seen = [];
    restartOpencode({ out: () => {}, cmd: opencodeCommand(home), run: (exe, args) => { seen.push(exe); return args[0] === '--version' ? { status: 0, stdout: '2.0.0' } : { status: 0 }; } });
    assert.deepEqual(seen, ['/opt/oc/opencode', '/opt/oc/opencode', '/opt/oc/opencode']);
  } finally { rm(home); }
});

test('update --verbose and --restart parse; --restart does not go with --pull or --check', () => {
  assert.equal(parseUpdateArgs(['--verbose']).opts.verbose, true);
  assert.equal(parseUpdateArgs(['--restart']).opts.restart, true);
  assert.equal(parseUpdateArgs(['--restart']).opts.latest, true);
  assert.ok(parseUpdateArgs(['--restart', '--pull']).error);
  assert.ok(parseUpdateArgs(['--restart', '--check']).error);
});

test('a quiet update keeps only the Tandem warnings and pin lines that need you', () => {
  const ps = [
    'eng-agents update', 'What\'s new:', '  Core 2.19.1', '    - long changelog line',
    'WARNING: Company overlay not found at C:\\x. Skipping it. (Expected on a home machine.)',
    'WARNING: Personal layer is empty or missing at C:\\y. Skipping it.',
    'WARNING: Replacing a file eng-agents did not create: C:\\z (backed up)',
    'WARNING: Core changed 2 file(s) that you override. Your copy keeps winning, so it will not get these changes:',
  ].join('\r\n');
  assert.deepEqual(tandemNotices(ps), ['Core changed 2 file(s) that you override. Your copy keeps winning, so it will not get these changes:']);
  assert.deepEqual(tandemNotices(''), []);
  const pinOut = 'Built the pinned copy in C:\\ui: Workshop v1; 900 files.\nWork mode is on: open pages offer a reload.\nRunway is not included: it is not downloaded. Download it with: workshop apps on runway\nTurned off, so not included: focus';
  assert.deepEqual(pinNotices(pinOut), ['Runway is not included: it is not downloaded. Download it with: workshop apps on runway']);
});

test('updateSummary: one line for what moves, one each for current, missing and no release', () => {
  const items = [
    { kind: 'move', name: 'Workshop', to: 'v1.6.0' }, { kind: 'current', name: 'Docket', to: 'v4.0.0' },
    { kind: 'current', name: 'Runway', to: 'v1.0.0' }, { kind: 'missing', name: 'Folio' },
    { kind: 'move', name: 'Tandem', to: 'core-v2.19.1' }, { kind: 'ahead', name: 'Rapport' },
  ];
  const lines = ['', '', '', '', '', 'Rapport: 3.1.0 here is newer than the newest release (v3.0.0).'];
  assert.deepEqual(updateSummary(items, lines), [
    'Updating Workshop to v1.6.0, Tandem to core-v2.19.1.',
    '  Rapport: 3.1.0 here is newer than the newest release (v3.0.0).',
    '  Already current: Docket, Runway.',
    '  Not downloaded, skipped: Folio (add one with "workshop apps on <app>").',
  ]);
  assert.deepEqual(updateSummary([{ kind: 'current', name: 'Workshop', to: 'v1' }], ['']), ['Everything is already at its newest release.']);
});

test('installTandem is quiet: Tandem\'s output shows only when the install fails', { skip: !hasGit && 'git is not installed' }, () => {
  const s = setup();
  try {
    const ea = s.clone(s.eaOrigin, 'eng-agents', 'core-v2.0.0');
    s.install('2.0.0', ea);
    const out = [];
    const ok = (exe, args, o) => { assert.equal(o.stdio, undefined, 'output is captured'); s.install(tandemVersionAt(ea), ea); return { status: 0, stdout: "What's new:\nWARNING: Company overlay not found at x.\nWARNING: Core changed 1 file(s) that you override.\n", stderr: '' }; };
    assert.ok(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run: ok, restart: () => {} }));
    assert.doesNotMatch(out.join('\n'), /What's new|Company overlay/);
    assert.match(out.join('\n'), /Core changed 1 file/);

    spawnSync('git', ['-C', ea, 'checkout', '-q', '--detach', 'core-v2.0.0']);
    s.install('2.0.0', ea);
    out.length = 0;
    const bad = () => ({ status: 1, stdout: 'Copying agents...\nupdate: something broke', stderr: '' });
    assert.equal(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run: bad, restart: () => {} }), false);
    assert.match(out.join('\n'), /something broke[\s\S]*Tandem did not install/);

    out.length = 0;
    const loud = (exe, args, o) => { assert.equal(o.stdio, 'inherit'); s.install(tandemVersionAt(ea), ea); return { status: 0 }; };
    assert.ok(installTandem(ea, 'core-v2.1.0', { out: l => out.push(l), userHome: s.userHome, ps: 'pwsh', run: loud, restart: () => {}, verbose: true }));
  } finally { rm(s.root); }
});
