#!/usr/bin/env node
// The `workshop` command: one entry point for running and looking after the local agent.
//
//   workshop start [--port n] [--quiet]   Start the agent (same as node agent/start.mjs).
//   workshop install [--login] [setup]    First run: create ~/.workshop. --login also turns on start at login.
//                                          Setup options (used by the one-line installer, scripts/bootstrap.*):
//                                          --allow <origin>, --work-mode, --workspace <folder>, --opencode <command>,
//                                          --powershell <command>. See setupFromFlags below.
//   workshop pin [--docket <folder>|--no-docket]  Build work mode's pinned copy of the site into ~/.workshop/ui.
//   workshop open [--print]                Open Workshop on this computer (sign-in and settings) in the default browser. --print only prints.
//   workshop stop | restart                Stop the running agent; restart it in the background.
//   workshop pat [NAME] [--remove]         Save a PAT in a user environment variable (default ADO_PAT) without showing it.
//   workshop uninstall                     Turn off start at login. Leaves your data folder (dataDir) and ~/.workshop in place.
//   workshop doctor                        Check Node, config.json, the port, the data folder, start at login and hosted mode.
//   workshop doctor ado [options]          Check the ADO connector (wraps connectors/ado/doctor.mjs).
//   workshop publish [--out <dir>]         Build the static site (hosted or browser mode) with apps/registry.json.
//   workshop update [--tag <tag>] [--docket-tag <tag>] [--pull]
//                                          Move this checkout to a release tag (no options: list the tags, change
//                                          nothing). --pull is the old git pull. Other installs: how to update.
//   workshop version                       Print the agent version.
//   workshop help                          This help.
//
// Node 22 or later, standard library only, no npm install. See docs/security.md.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './agent/version.mjs';
import { SchemaSet } from './agent/lib/schema.mjs';
import { resolveHome, homePaths, defaultConfig, DEFAULT_PORT } from './agent/lib/home.mjs';
import { writeJsonAtomic } from './agent/lib/fsutil.mjs';
import { dataDirProblem, defaultDataDir } from './agent/lib/datadir.mjs';
import { enableStartAtLogin, disableStartAtLogin, startAtLoginStatus } from './agent/lib/login.mjs';
import { main as adoDoctorMain } from './connectors/ado/doctor.mjs';
import { checkProviders } from './connectors/opencode/lib/providers.mjs';
import { pinInto, verifyPinned, describeBuild, uiDirOf } from './agent/lib/pinned.mjs';
import { ENV_NAME, liveEnv, readWindowsUserEnv } from './agent/lib/userenv.mjs';
import { patProblem, readSecret, startBackground, stopAgent, writeWindowsUserEnv } from './scripts/lib/control.mjs';

export const REPO = path.dirname(fileURLToPath(import.meta.url));
const SERVED_DIRS = ['shell', 'shared', 'icons', 'apps'];
const SERVED_FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];

const USAGE = `Usage: workshop <command> [options]

  start [--port <n>] [--quiet]   Start the agent, print the address to open.
  install [--login] [options]    Create ~/.workshop. --login also turns on start at login (no admin).
                                 --allow <origin>       turn on hosted mode and allow this site
                                 --work-mode            turn on work mode: Workshop runs from a pinned copy on
                                                        this computer and no site can pair (see workshop pin)
                                 --workspace <folder>   turn on the opencode connector with this workspace
                                 --opencode <command>   the command that runs opencode (if not set yet)
                                 --powershell <command> the PowerShell command (if not set yet)
  open [--print]                 Open Workshop on this computer in your default browser: it signs that browser in,
                                 links to Workshop's site to pair, and has the settings only this computer can change.
                                 --print only prints the sign-in address, to open in another browser.
  stop                           Stop Workshop if it is running.
  restart                        Stop Workshop, then start it again in the background (no window).
  pat [NAME] [--remove]          Save a personal access token in the user environment variable NAME (default
                                 ADO_PAT). Paste it when asked; it is not shown or kept in shell history.
                                 Workshop picks it up within seconds on Windows, with no restart.
                                 --remove deletes the variable.
  uninstall                      Turn off start at login. Leaves your data folder (dataDir, default ~/Workshop)
                                 and ~/.workshop in place.
  doctor                         Check Node, config.json, the port, the data folder, start at login and hosted mode.
  doctor ado [options]           Check the ADO connector. Run "workshop doctor ado --help" for its options.
  publish [--out <dir>]          Build the static site for hosted or browser mode (default out: dist/).
  pin [--docket <folder>]        Build work mode's pinned copy of Workshop (and Docket) from this install into
      [--no-docket]              ~/.workshop/ui. The agent serves only that copy, checked file by file.
  update                         List the release tags and say which one this is. Changes nothing.
  update --tag <tag>             Move this checkout to a release tag, then rebuild the pinned copy if work mode is
         [--docket-tag <tag>]    on. --docket-tag also moves the Docket checkout the pinned copy is built from.
  update --pull                  Update to the newest code on the current branch (git pull), not a release.
  version                        Print the agent version.
  help                           Show this.

Home folder: ~/.workshop, or set WORKSHOP_HOME. Data folder: dataDir in config.json, default ~/Workshop.
See docs/security.md.`;

// --------------------------------------------------------------- helpers

/** The schema set used to validate config.json and app manifests. */
export const loadSchemas = () => SchemaSet.fromDir(path.join(REPO, 'docs', 'schemas'));

/** GET /api/health on 127.0.0.1:port. Resolves the health object if it is the agent, else null. */
export function agentHealth(port, { timeout = 1000 } = {}) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(body && body.app === 'workshop-agent' ? body : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/** Read config.json without changing it, and say what (if anything) is wrong with it. */
export function inspectConfig(file, schemas) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { state: 'missing', problems: [], config: null };
    return { state: 'unreadable', problems: [`Could not read ${file}: ${e.code || e.message}`], config: null };
  }
  let value;
  try { value = JSON.parse(text.replace(/^﻿/, '')); } catch (e) {
    return { state: 'badjson', problems: [`Not valid JSON: ${e.message}`], config: null };
  }
  const errs = schemas.validate('config', value);
  if (errs.length) return { state: 'badschema', problems: errs, config: value };
  return { state: 'ok', problems: [], config: value };
}

/** The data folder config.json names, or the default (~/Workshop) when it names none. */
export const configDataDir = (config, defaultDir = defaultDataDir()) =>
  (config && typeof config.dataDir === 'string' && config.dataDir) || defaultDir;

/**
 * What `workshop doctor` says about the data folder, without changing it (a write check leaves no file
 * behind). The agent's own rules decide what is allowed (agent/lib/datadir.mjs, dataDirProblem). A missing
 * folder is fine: the agent creates it on start.
 */
export function inspectDataDir(dir, home) {
  const problem = dataDirProblem(dir, home);
  if (problem) return { state: 'invalid', problem };
  const st = fs.statSync(dir, { throwIfNoEntry: false });
  if (!st) return { state: 'missing' };
  if (!st.isDirectory()) return { state: 'invalid', problem: `${dir} is a file, not a folder.` };
  // A real write, as the agent does: on Windows, access checks miss folder permissions. The name starts with
  // "." and ends in ".tmp", so the agent never treats it as data.
  const probe = path.join(dir, `.workshop-doctor-check-${process.pid}.tmp`);
  try {
    fs.readdirSync(dir);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    return { state: 'ok' };
  } catch (e) {
    try { fs.rmSync(probe, { force: true }); } catch { /* nothing to clean up */ }
    return { state: 'readonly', problem: `Workshop cannot read and write it (${e.code || e.message}).` };
  }
}

/** Whether the one-time copy from <home>/data into the data folder has run: <home>/data/moved.json. */
export function inspectOldData(home) {
  const old = path.join(home, 'data');
  if (!fs.statSync(old, { throwIfNoEntry: false })?.isDirectory()) return { state: 'none', old };
  const file = path.join(old, 'moved.json');
  if (!fs.existsSync(file)) return { state: 'pending', old };
  let moved = null;
  try { moved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* still done: the file is the marker */ }
  return { state: 'done', old, movedTo: moved?.movedTo, movedAt: moved?.movedAt };
}

// --------------------------------------------------------------- doctor

/**
 * Build the lines `workshop doctor` prints and its exit code. `probe` checks whether the agent answers on a
 * port (defaults to the real health check); tests pass their own.
 */
export async function doctorReport({ home = resolveHome(), env = process.env, platform = process.platform, nodeVersion = process.version, probe = agentHealth, defaultDir = defaultDataDir(), uiDir = uiDirOf(home), userHome = os.homedir() } = {}) {
  const schemas = loadSchemas();
  const paths = homePaths(home);
  const lines = [];
  let bad = false;
  lines.push(`Workshop ${VERSION}`);

  const [major, minor] = String(nodeVersion).replace(/^v/, '').split('.').map(Number);
  if (major >= 22) lines.push(`Node ${nodeVersion}: ok.`);
  else { lines.push(`Node ${nodeVersion}: too old. Workshop needs Node 22 or later.`); bad = true; }
  const certStoreOk = major > 22 || (major === 22 && minor >= 15);
  if (platform === 'win32' && !certStoreOk && !env.NODE_EXTRA_CA_CERTS) {
    lines.push('Note: Node before 22.15 on Windows does not use the system certificate store. Set NODE_EXTRA_CA_CERTS to your company root certificate if connectors cannot reach your servers.');
  }

  lines.push(`Home: ${home}`);
  const info = inspectConfig(paths.config, schemas);
  if (info.state === 'missing') lines.push('config.json: not created yet. It is written with everything off the first time the agent starts.');
  else if (info.state === 'ok') lines.push('config.json: ok.');
  else {
    lines.push(`config.json: there is a problem, so the agent will not start until it is fixed:`);
    for (const p of info.problems) lines.push(`  ${p}`);
    lines.push(`  Fix ${paths.config}, or move it away to start fresh, then run this again.`);
    bad = true;
  }

  const dataDir = configDataDir(info.config, defaultDir);
  const fromConfig = dataDir !== defaultDir;
  const dd = inspectDataDir(dataDir, home);
  const label = `Data folder: ${dataDir}${fromConfig ? '' : ' (the default)'}`;
  if (dd.state === 'ok') lines.push(`${label}: ok, exists and is writable.`);
  else if (dd.state === 'missing') lines.push(`${label}: not created yet. The agent creates it when it starts.`);
  else {
    lines.push(`${label}: there is a problem, so the agent will not start until it is fixed:`);
    lines.push(`  ${dd.problem}`);
    lines.push(`  Change "dataDir" in ${paths.config} or in Settings, then run this again.`);
    bad = true;
  }
  const old = inspectOldData(home);
  if (old.state === 'done') {
    lines.push(`Old data in ${old.old}: copied to the data folder${old.movedTo ? ` (${old.movedTo})` : ''}${old.movedAt ? ` on ${old.movedAt}` : ''}. The old files are kept.`);
  } else if (old.state === 'pending') {
    lines.push(`Old data in ${old.old}: not copied yet. The agent copies it once, on start, if the data folder has no app data.`);
  } else {
    lines.push(`Old data in ${old.old}: none, nothing to copy.`);
  }

  const port = info.config?.port ?? DEFAULT_PORT;
  const health = await probe(port);
  lines.push(health ? `Port ${port}: the agent is running here (version ${health.version || '?'}).` : `Port ${port}: no agent is running here now.`);

  const want = info.config?.features?.startAtLogin === true;
  const st = startAtLoginStatus({ platform, env, dir: env.WORKSHOP_LOGIN_DIR });
  if (st.kind === 'unsupported') lines.push(`Start at login: not supported on ${platform}.`);
  else {
    lines.push(`Start at login: ${want ? 'on' : 'off'} in config; launcher ${st.installed ? 'present' : 'absent'} (${st.path}).`);
    if (want !== st.installed) lines.push('  The flag and the launcher disagree. Starting the agent, or running "workshop install" or "workshop uninstall", puts them back in step.');
  }

  const work = info.config?.features?.workMode === true;
  const pin = verifyPinned(uiDir);
  if (work) {
    if (pin.ok) lines.push(`Work mode: on. Pinned copy: ${describeBuild(pin.build)}; all ${pin.files.size} files match build.json.`);
    else { lines.push(`Work mode: on, but there is a problem, so Workshop cannot open: ${pin.problem}`); bad = true; }
  } else {
    lines.push(`Work mode: off.${pin.ok ? ` A pinned copy is ready (${describeBuild(pin.build)}); turn work mode on in Settings to use it.` : ''}`);
  }

  const hosted = info.config?.features?.hostedMode === true;
  const origins = info.config?.allowedOrigins || [];
  lines.push(`Hosted mode: ${hosted ? 'on' : 'off'}${work && hosted ? ' (not used: work mode is on, so no site can pair)' : ''}; allowed origins: ${origins.length ? origins.join(', ') : 'none'}.`);
  if (hosted && !work && origins.length === 0) lines.push('  Hosted mode is on but no origins are allowed, so no hosted page can pair. Add one in Settings.');

  const enabled = Object.entries(info.config?.connectors || {}).filter(([, c]) => c && c.enabled === true).map(([id]) => id);
  lines.push(`Connectors on: ${enabled.length ? enabled.join(', ') : 'none'}.`);

  // Which AI providers opencode can use (connectors/opencode/README.md, Approved AI providers).
  const oc = info.config?.connectors?.opencode?.config;
  if (oc) {
    const r = checkProviders({ approved: oc.approvedProviders, workspace: oc.workspace, env, platform, home: userHome });
    for (const l of r.lines) lines.push(l);
    if (r.state === 'bad') bad = true;
  }

  lines.push(bad ? 'Result: fix the problems above.' : 'Result: all good.');
  return { lines, code: bad ? 1 : 0 };
}

// --------------------------------------------------------------- publish

/** The apps/registry.json contents (same shape as GET /api/apps), built from appsDir. Empty if there is none. */
export function buildRegistry(appsDir, schemas) {
  let dirs = [];
  try { dirs = fs.readdirSync(appsDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name); } catch { return { apps: [] }; }
  const apps = [];
  for (const dir of dirs) {
    const file = path.join(appsDir, dir, 'app.json');
    if (!fs.existsSync(file)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { continue; }
    if (schemas.validate('app', manifest).length || manifest.id !== dir) continue;
    apps.push({ base: `/apps/${dir}/`, manifest });
  }
  apps.sort((a, b) => (a.manifest.order ?? Infinity) - (b.manifest.order ?? Infinity) || a.manifest.name.localeCompare(b.manifest.name));
  return { apps };
}

/**
 * Copy the files the agent serves into `outDir` and write apps/registry.json, so a static host (hosted or
 * browser mode) can serve the same site with no agent. Returns a short summary.
 */
export function publish({ repo = REPO, outDir, schemas = loadSchemas() }) {
  const out = path.resolve(outDir || path.join(repo, 'dist'));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const copied = [];
  for (const name of SERVED_FILES) {
    const src = path.join(repo, name);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(out, name)); copied.push(name); }
  }
  for (const name of SERVED_DIRS) {
    const src = path.join(repo, name);
    if (fs.existsSync(src)) { fs.cpSync(src, path.join(out, name), { recursive: true }); copied.push(`${name}/`); }
  }
  const registry = buildRegistry(path.join(repo, 'apps'), schemas);
  fs.mkdirSync(path.join(out, 'apps'), { recursive: true });
  fs.writeFileSync(path.join(out, 'apps', 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  return { out, copied, apps: registry.apps.length };
}

// --------------------------------------------------------------- install and uninstall

function ensureHome(home) {
  const paths = homePaths(home);
  fs.mkdirSync(home, { recursive: true });
  if (!fs.existsSync(paths.config)) return writeJsonAtomic(paths.config, defaultConfig()).then(() => true);
  return Promise.resolve(false);
}

async function setStartAtLoginFlag(home, schemas, on) {
  const paths = homePaths(home);
  const info = inspectConfig(paths.config, schemas);
  if (info.state === 'badjson' || info.state === 'badschema' || info.state === 'unreadable') {
    throw new Error(`config.json has a problem. Run "workshop doctor" and fix it first.`);
  }
  const config = info.config || defaultConfig();
  config.features = { ...defaultConfig().features, ...(config.features || {}), startAtLogin: on };
  await writeJsonAtomic(paths.config, config);
}

/** Read install's setup options. Returns {opts} or {error}. --allow can be given more than once. */
export function parseInstallArgs(rest) {
  const opts = { login: false, allow: [], workMode: false };
  const value = { '--workspace': 'workspace', '--opencode': 'opencode', '--powershell': 'powershell' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--login') { opts.login = true; continue; }
    if (a === '--work-mode') { opts.workMode = true; continue; }
    if (a === '--allow' || value[a]) {
      const v = rest[++i];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value.` };
      if (a === '--allow') opts.allow.push(v.replace(/\/+$/, '')); else opts[value[a]] = v;
      continue;
    }
    return { error: `Unknown option ${a}. Run "workshop help".` };
  }
  if (opts.workMode && opts.allow.length) return { error: '--work-mode and --allow do not go together: in work mode no site can pair.' };
  return { opts };
}

/**
 * Apply install's setup options to a config object (changed in place). It only adds: an origin already
 * allowed stays, and connector settings already saved are kept, so running the installer again never undoes
 * what the user changed in Settings. Returns plain-words lines saying what changed.
 */
export function setupFromFlags(config, opts, schemas) {
  const said = [];
  if (opts.workMode) {
    // Work mode: the pinned copy on this computer, and no hosted site. Allowed sites stay listed (unused) so
    // turning work mode off later in Settings brings them back.
    const before = config.features?.workMode === true;
    config.features = { ...defaultConfig().features, ...(config.features || {}), workMode: true, hostedMode: false };
    said.push(before ? 'Work mode is on (unchanged); hosted mode is off.' : 'Turned on work mode and turned off hosted mode. Build the pinned copy with: workshop pin');
  }
  for (const origin of opts.allow || []) {
    if (schemas.validate({ $ref: 'common.schema.json#/$defs/origin' }, origin).length) throw new Error(`${origin} is not a site address like https://example.org.`);
    config.features = { ...defaultConfig().features, ...(config.features || {}), hostedMode: true };
    config.allowedOrigins = config.allowedOrigins || [];
    if (!config.allowedOrigins.includes(origin)) { config.allowedOrigins.push(origin); said.push(`Allowed ${origin} (hosted mode is on).`); }
  }
  if (opts.workspace || opts.opencode || opts.powershell) {
    config.connectors = config.connectors || {};
    const entry = config.connectors.opencode || { enabled: false };
    const cfg = { ...(entry.config || {}) };
    if (opts.workspace && !cfg.workspace) { cfg.workspace = opts.workspace; said.push(`opencode workspace folder: ${opts.workspace}`); }
    if (opts.opencode && !(cfg.opencode && cfg.opencode.command)) { cfg.opencode = { ...(cfg.opencode || {}), command: opts.opencode }; said.push(`opencode command: ${opts.opencode}`); }
    if (opts.powershell && !cfg.powershell) { cfg.powershell = opts.powershell; said.push(`PowerShell command: ${opts.powershell}`); }
    if (!cfg.workspace) throw new Error('Pass --workspace too: the opencode connector needs a workspace folder.');
    if (opts.workspace && entry.enabled !== true && !entry.config) { entry.enabled = true; said.push('Turned on the opencode connector.'); }
    config.connectors.opencode = { ...entry, config: cfg };
  }
  return said;
}

async function runInstall(opts, io) {
  const home = resolveHome(io.env);
  const schemas = loadSchemas();
  const port = (inspectConfig(homePaths(home).config, schemas).config?.port) ?? DEFAULT_PORT;
  if (await agentHealth(port)) {
    io.out('Workshop is running. Stop it first (Ctrl+C where it is running), or turn Start at login on in Settings, then run this again.');
    return 1;
  }
  const created = await ensureHome(home);
  io.out(created ? `Created ${home} with default settings (everything off).` : `Using ${home}.`);
  if (opts.allow?.length || opts.workMode || opts.workspace || opts.opencode || opts.powershell) {
    const info = inspectConfig(homePaths(home).config, schemas);
    if (info.state !== 'ok') { io.out('config.json has a problem. Run "workshop doctor" and fix it first.'); return 1; }
    let said;
    try { said = setupFromFlags(info.config, opts, schemas); } catch (e) { io.out(e.message); return 1; }
    const errs = schemas.validate('config', info.config);
    if (errs.length) { io.out(`Those settings are not valid: ${errs[0]}`); return 1; }
    await writeJsonAtomic(homePaths(home).config, info.config);
    for (const line of said) io.out(line);
  }
  if (opts.login !== true) {
    // Without --login, install never changes start at login: a setting turned on earlier stays on.
    const on = inspectConfig(homePaths(home).config, schemas).config?.features?.startAtLogin === true;
    io.out(on ? 'Start at login is on (unchanged). Turn it off in Settings, or run "workshop uninstall".'
      : 'Start at login is off. Turn it on in Settings, or run "workshop install --login".');
  } else {
    await setStartAtLoginFlag(home, schemas, true);
    const r = await enableStartAtLogin({ repo: REPO, env: io.env, dir: io.env.WORKSHOP_LOGIN_DIR });
    io.out(`Start at login is on. Launcher: ${r.path}`);
  }
  io.out('\nStart Workshop now with:  workshop start');
  return 0;
}

async function runUninstall(io) {
  const home = resolveHome(io.env);
  const schemas = loadSchemas();
  const port = (inspectConfig(homePaths(home).config, schemas).config?.port) ?? DEFAULT_PORT;
  if (await agentHealth(port)) {
    io.out('Workshop is running. Stop it first, or turn Start at login off in Settings, then run this again.');
    return 1;
  }
  try { await setStartAtLoginFlag(home, schemas, false); } catch (e) { io.out(e.message); return 1; }
  const r = await disableStartAtLogin({ repo: REPO, env: io.env, dir: io.env.WORKSHOP_LOGIN_DIR });
  io.out(r.removed ? `Start at login is off. Removed ${r.path}.` : 'Start at login was already off.');
  const dataDir = configDataDir(inspectConfig(homePaths(home).config, schemas).config, io.defaultDataDir);
  io.out(`Uninstall left your data folder (${dataDir}) and the Workshop home folder (${home}) in place. Delete them yourself if you want them gone.`);
  return 0;
}

// --------------------------------------------------------------- start and update (spawn)

function runStart(rest) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(REPO, 'agent', 'start.mjs'), ...rest], { stdio: 'inherit' });
    const forward = sig => { try { child.kill(sig); } catch { /* already gone */ } };
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 0)));
    child.on('error', () => resolve(1));
  });
}

/**
 * Where to get a new release, from package.json (`homepage`, or `repository` as a string or {url}) if this
 * install has one. Null otherwise: Workshop names no repo of its own, so other companies' copies stay generic.
 */
export function releaseSource(repo = REPO) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')); } catch { return null; }
  const raw = pkg && (pkg.homepage || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url));
  const url = typeof raw === 'string' ? raw.replace(/^git\+/, '') : '';
  return /^https?:\/\//.test(url) ? url : null;
}

/** What `workshop update` says when this folder is not a git checkout. */
export function manualUpdateLines(repo = REPO) {
  const src = releaseSource(repo);
  return [
    `This is not a git checkout. Download the latest release of Workshop${src ? ` (${src})` : ''} and replace this folder with it.`,
    'If you installed with the one-line installer, run it again with WORKSHOP_TAG set to the release you want (README.md, One-line install).',
    `Current version: ${VERSION}.`
  ];
}

// A release tag: letters, digits, dots, dashes and underscores (v1.2.0). No slashes or option-like names, so
// it can never be read as a git option or a path.
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const validTag = t => typeof t === 'string' && TAG.test(t) && !t.includes('..');

/** Read update's options. Returns {opts} or {error}. */
export function parseUpdateArgs(rest) {
  const opts = { tag: null, docketTag: null, pull: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--pull') { opts.pull = true; continue; }
    if (a === '--tag' || a === '--docket-tag') {
      const v = rest[++i];
      if (!validTag(v)) return { error: `${a} needs a release tag like v1.2.0.` };
      if (a === '--tag') opts.tag = v; else opts.docketTag = v;
      continue;
    }
    return { error: `Unknown option ${a}. Run "workshop help".` };
  }
  if (opts.pull && (opts.tag || opts.docketTag)) return { error: '--pull and --tag do not go together.' };
  return { opts };
}

/** Run git in a folder. Never throws: {code, out, err}. */
export function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error) return { code: -1, out: '', err: r.error.code === 'ENOENT' ? 'git is not installed.' : r.error.message };
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const isCheckout = dir => fs.existsSync(path.join(dir, '.git'));

/** {commit, ref} for a git checkout (ref: the exact tag, else the branch), or null when it is not one. */
export function gitInfo(dir) {
  if (!dir || !isCheckout(dir)) return null;
  const commit = git(dir, ['rev-parse', 'HEAD']);
  if (commit.code !== 0) return null;
  const tag = git(dir, ['describe', '--tags', '--exact-match', 'HEAD']);
  const branch = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const ref = tag.code === 0 ? tag.out : branch.code === 0 && branch.out !== 'HEAD' ? `${branch.out} (not a release tag)` : 'not a release tag';
  return { commit: commit.out, ref };
}

/** Move a checkout to a tag: refuse local changes, fetch tags (never moving an existing one), check out detached. */
export function checkoutTag(dir, tag, out) {
  const dirty = git(dir, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty.code !== 0) { out(`Could not read ${dir}: ${dirty.err}`); return false; }
  if (dirty.out) { out(`${dir} has local changes. Commit or undo them first, then run this again.`); return false; }
  const fetched = git(dir, ['fetch', '--tags', '--quiet', 'origin']);
  // A tag that changed on the remote is refused by git ("would clobber existing tag"). That is a warning sign,
  // so say it plainly instead of forcing it.
  if (fetched.code !== 0) out(`Could not fetch tags${fetched.err ? `: ${fetched.err.split('\n')[0]}` : ''}. Using the tags already here.`);
  const commit = git(dir, ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`]);
  if (commit.code !== 0) { out(`There is no tag ${tag} in ${dir}. Run "workshop update" to list the tags.`); return false; }
  const co = git(dir, ['checkout', '--quiet', '--detach', `refs/tags/${tag}`]);
  if (co.code !== 0) { out(`Could not check out ${tag}: ${co.err.split('\n')[0]}`); return false; }
  out(`${path.basename(dir)} is now at ${tag} (${commit.out.slice(0, 12)}).`);
  return true;
}

/** The release tags in a checkout, newest version first. */
// Release tags are v<version> (Workshop, Docket) or core-v<version> (eng-agents). Other tags, such as a
// docket-android build tag, are never offered as releases.
export const isReleaseTag = t => validTag(t) && /^(core-)?v\d+(\.\d+)*$/.test(t);
export function listTags(dir, max = 5) {
  const r = git(dir, ['tag', '--list', '--sort=-v:refname']);
  return r.code === 0 ? r.out.split('\n').filter(isReleaseTag).slice(0, max) : [];
}

/** The Docket checkout the pinned copy is built from: <repo>/.remote/prioritizer, else a docket folder next to the repo. */
export function findDocket(repo = REPO) {
  for (const dir of [path.join(repo, '.remote', 'prioritizer'), path.join(path.dirname(repo), 'docket')]) {
    if (fs.existsSync(path.join(dir, 'app.json'))) return dir;
  }
  return null;
}

/** Read pin's options. Returns {opts} or {error}. */
export function parsePinArgs(rest) {
  const opts = { docket: undefined, noDocket: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--no-docket') { opts.noDocket = true; continue; }
    if (a === '--docket') {
      const v = rest[++i];
      if (!v || v.startsWith('--')) return { error: '--docket needs a folder.' };
      opts.docket = path.resolve(v);
      continue;
    }
    return { error: `Unknown option ${a}. Run "workshop help".` };
  }
  if (opts.noDocket && opts.docket) return { error: '--docket and --no-docket do not go together.' };
  return { opts };
}

/** Build the pinned copy for a home. Returns {build, docketDir} or throws with plain words. */
export function pin({ home, repo = REPO, opts = {}, schemas = loadSchemas(), uiDir = uiDirOf(home) }) {
  const docketDir = opts.noDocket ? null : (opts.docket ?? findDocket(repo));
  if (opts.docket && !fs.existsSync(path.join(opts.docket, 'app.json'))) throw new Error(`${opts.docket} is not a Docket checkout (no app.json).`);
  const workshop = { version: VERSION, ...(gitInfo(repo) || {}) };
  const docket = docketDir ? (() => {
    let version;
    try { version = JSON.parse(fs.readFileSync(path.join(docketDir, 'app.json'), 'utf8')).version; } catch { /* checked by buildPinned */ }
    return { version, ...(gitInfo(docketDir) || {}) };
  })() : null;
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const build = pinInto(uiDir, { repo, docketDir, registry: dir => buildRegistry(dir, schemas), info: { workshop, docket } });
  return { build, docketDir };
}

async function runPin(rest, io) {
  const parsed = parsePinArgs(rest);
  if (parsed.error) { io.out(parsed.error); return 1; }
  const home = resolveHome(io.env);
  let r;
  try { r = pin({ home, opts: parsed.opts }); } catch (e) { io.out(`Could not build the pinned copy: ${e.message}`); return 1; }
  io.out(`Built the pinned copy in ${uiDirOf(home)}: ${describeBuild(r.build)}; ${Object.keys(r.build.files).length} files.`);
  if (!r.docketDir) io.out('Docket is not included: no Docket checkout was found. Pass --docket <folder> (a clone of Docket at a release tag) to include it.');
  for (const [name, x] of [['Workshop', r.build.workshop], ['Docket', r.build.docket]]) {
    if (x && !(x.ref && !/not a release tag/.test(x.ref))) io.out(`Note: ${name} is not at a release tag. For work, use "workshop update --tag <tag>" first.`);
  }
  const info = inspectConfig(homePaths(home).config, loadSchemas());
  const port = info.config?.port ?? DEFAULT_PORT;
  if (info.config?.features?.workMode === true) {
    io.out(await agentHealth(port) ? 'Work mode is on: open pages offer a reload to the new copy. If Workshop itself was updated, run "workshop restart" too.' : 'Work mode is on. Start Workshop with: workshop start');
  } else io.out('Work mode is off. Turn it on in Settings (Workshop on this computer), or run "workshop install --work-mode" while Workshop is stopped.');
  return 0;
}

async function runUpdate(rest, io) {
  const parsed = parseUpdateArgs(rest);
  if (parsed.error) { io.out(parsed.error); return 1; }
  const { opts } = parsed;
  if (!isCheckout(REPO)) {
    for (const l of manualUpdateLines()) io.out(l);
    return 0;
  }
  if (opts.pull) {
    return new Promise(resolve => {
      const child = spawn('git', ['-C', REPO, 'pull', '--ff-only'], { stdio: 'inherit' });
      child.on('error', () => { io.out('Could not run git. Update by hand: git pull.'); resolve(1); });
      child.on('exit', code => { io.out(`Current version: ${VERSION}. This is the newest code, not a release: for work, use "workshop update --tag <tag>".`); resolve(code ?? 0); });
    });
  }
  if (!opts.tag && !opts.docketTag) {
    const f = git(REPO, ['fetch', '--tags', '--quiet', 'origin']);
    if (f.code !== 0) io.out(`Could not fetch tags${f.err ? `: ${f.err.split('\n')[0]}` : ''}. Showing the tags already here.`);
    const now = gitInfo(REPO);
    io.out(`Workshop ${VERSION}, at ${now ? `${now.ref} (${now.commit.slice(0, 12)})` : 'an unknown commit'}.`);
    const tags = listTags(REPO);
    if (!tags.length) { io.out('There are no release tags yet. Nothing was changed.'); return 0; }
    io.out(`Release tags, newest first: ${tags.join(', ')}.`);
    io.out(`Nothing was changed. To move to one: workshop update --tag ${tags[0]}`);
    return 0;
  }
  const home = resolveHome(io.env);
  const info = inspectConfig(homePaths(home).config, loadSchemas());
  const running = await agentHealth(info.config?.port ?? DEFAULT_PORT);
  if (opts.tag && !checkoutTag(REPO, opts.tag, io.out)) return 1;
  if (opts.docketTag) {
    const d = findDocket(REPO);
    if (!d || !isCheckout(d)) { io.out('--docket-tag needs a git clone of Docket (in .remote/prioritizer, or a docket folder next to Workshop).'); return 1; }
    if (!checkoutTag(d, opts.docketTag, io.out)) return 1;
  }
  if (info.config?.features?.workMode === true) {
    // The new code builds the copy, so run it in a fresh process.
    io.out('Work mode is on, so the pinned copy is rebuilt from this release.');
    const r = spawnSync(process.execPath, [path.join(REPO, 'workshop.mjs'), 'pin'], { stdio: 'inherit', env: io.env });
    if (r.status !== 0) { io.out('Rebuilding the pinned copy failed. Run "workshop pin" to see why.'); return 1; }
  }
  if (running) io.out('Workshop is running the old version: run "workshop restart" to run this one.');
  return 0;
}

// --------------------------------------------------------------- open

/** The sign-in address for the running agent: http://127.0.0.1:<port>/?token=<token>. */
export function signInUrl(home, port) {
  const token = fs.readFileSync(homePaths(home).token, 'utf8').trim();
  return `http://127.0.0.1:${port}/?token=${token}`;
}

async function runOpen(rest, io) {
  const home = resolveHome(io.env);
  const port = (inspectConfig(homePaths(home).config, loadSchemas()).config?.port) ?? DEFAULT_PORT;
  if (!(await agentHealth(port))) { io.out(`Workshop is not running on port ${port}. Log out and back in, or run: workshop start`); return 1; }
  let url;
  try { url = signInUrl(home, port); } catch { io.out(`Could not read the token in ${home}.`); return 1; }
  const work = inspectConfig(homePaths(home).config, loadSchemas()).config?.features?.workMode === true;
  io.out(work
    ? `Open this address in the browser you use Workshop in. It signs that browser in, and Workshop opens there from the pinned copy (work mode):\n\n  ${url}\n`
    : `Open this address in the browser you use Workshop in. It signs that browser in to Workshop on this computer, then Connect on Workshop's site pairs it:\n\n  ${url}\n`);
  if (rest.includes('--print')) return 0;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: process.platform === 'win32' }).on('error', () => {}).unref(); } catch { /* printed above */ }
  return 0;
}

// --------------------------------------------------------------- stop, restart and pat

const configuredPort = io => (inspectConfig(homePaths(resolveHome(io.env)).config, loadSchemas()).config?.port) ?? DEFAULT_PORT;

async function runStop(io) {
  const port = configuredPort(io);
  const r = await stopAgent({ port, probe: io.probe || agentHealth, ...(io.control || {}) });
  io.out(r.message);
  return r.ok ? 0 : 1;
}

async function runRestart(io) {
  const port = configuredPort(io);
  const probe = io.probe || agentHealth;
  const s = await stopAgent({ port, probe, ...(io.control || {}) });
  if (!s.ok) { io.out(s.message); return 1; }
  if (s.wasRunning) io.out('Workshop stopped.');
  const r = await startBackground({ repo: REPO, port, probe, env: io.env, ...(io.control || {}) });
  io.out(r.message);
  return r.ok ? 0 : 1;
}

/**
 * workshop pat [NAME] [--remove]: saves a token in a user environment variable without echoing it or
 * putting it on a command line (setx "<token>" leaves it in PowerShell's history file). Windows only; on
 * macOS and Linux it explains where the variable goes.
 */
async function runPat(rest, io) {
  const remove = rest.includes('--remove');
  const extra = rest.filter(a => a.startsWith('-') && a !== '--remove');
  if (extra.length) { io.out(`Unknown option ${extra[0]}. Usage: workshop pat [NAME] [--remove]`); return 1; }
  const name = rest.find(a => !a.startsWith('-')) || 'ADO_PAT';
  if (!ENV_NAME.test(name)) { io.out(`"${name}" is not a valid environment variable name. Use letters, digits and _, for example ADO_PAT.`); return 1; }
  const platform = io.platform || process.platform;
  if (platform !== 'win32') {
    io.out(`On macOS and Linux, Workshop reads ${name} from the terminal it starts in, so it is not saved here.`);
    if (!remove) io.out(`Add this line to your shell profile (~/.zshrc or ~/.bashrc), with your token in place of the dots:\n\n  export ${name}='...'\n\nThen open a new terminal and run: workshop restart`);
    else io.out(`Remove the "export ${name}=" line from your shell profile, then open a new terminal and run: workshop restart`);
    return 0;
  }
  const store = io.userEnv || { read: n => readWindowsUserEnv(n), write: (n, v) => writeWindowsUserEnv(n, v) };
  if (remove) {
    const r = store.write(name, null);
    io.out(r.ok ? `Removed ${name}. Programs that are already running keep their copy until they restart.` : r.message);
    return r.ok ? 0 : 1;
  }
  let value;
  try {
    value = await (io.secret || readSecret)({ prompt: `Paste the token for ${name} and press Enter (it will not show): ` });
  } catch (e) {
    io.out(e && e.code === 'cancelled' ? 'Cancelled. Nothing was saved.' : 'Could not read the token. Nothing was saved.');
    return 1;
  }
  const problem = patProblem(value);
  if (problem) { io.out(`${problem} Nothing was saved.`); return 1; }
  const w = store.write(name, value);
  if (!w.ok) { io.out(`${w.message} Nothing was saved.`); return 1; }
  if (store.read(name) !== value) { io.out(`Windows did not keep ${name}. Try again, or set it in Settings > System > About > Advanced system settings > Environment Variables.`); return 1; }
  io.out(`Saved ${name} (${value.length} characters) for your Windows account.`);
  const running = await (io.probe || agentHealth)(configuredPort(io));
  io.out(running
    ? 'Workshop picks it up within a few seconds; no restart needed. Check it in Settings, or run: workshop doctor ado'
    : 'Start Workshop with: workshop start');
  io.out('Tip: put the token\'s expiry date on its ADO connection in Settings ("PAT expires") to get a warning two weeks before.');
  return 0;
}

// --------------------------------------------------------------- command line

export async function main(argv, io = { out: s => console.log(s), env: process.env }) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { io.out(USAGE); return 0; }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') { io.out(VERSION); return 0; }

  if (cmd === 'start') return runStart(rest);
  if (cmd === 'stop') return runStop(io);
  if (cmd === 'restart') return runRestart(io);
  if (cmd === 'pat') return runPat(rest, io);

  if (cmd === 'doctor') {
    if (rest[0] === 'ado') {
      const adoArgs = rest.slice(1);
      const importWrite = adoArgs.includes('--import') && adoArgs.includes('--write');
      if (importWrite) {
        const home = resolveHome(io.env);
        const port = (inspectConfig(homePaths(home).config, loadSchemas()).config?.port) ?? DEFAULT_PORT;
        if (await agentHealth(port)) {
          io.out('Workshop is running, so writing config.json now could clash with it. Stop the agent first, or change ADO settings in Settings instead.');
          return 1;
        }
      }
      // Saved user variables, read live, so a PAT saved with "workshop pat" counts in this same terminal.
      return adoDoctorMain(adoArgs, { ...io, env: liveEnv(io.env, { platform: io.platform || process.platform }) });
    }
    const { lines, code } = await doctorReport({ env: io.env });
    for (const l of lines) io.out(l);
    return code;
  }

  if (cmd === 'install') {
    const parsed = parseInstallArgs(rest);
    if (parsed.error) { io.out(parsed.error); return 1; }
    return runInstall(parsed.opts, io);
  }
  if (cmd === 'uninstall') return runUninstall(io);
  if (cmd === 'open') return runOpen(rest, io);

  if (cmd === 'publish') {
    const i = rest.indexOf('--out');
    const outDir = i >= 0 ? rest[i + 1] : undefined;
    if (i >= 0 && !outDir) { io.out('--out needs a folder.'); return 1; }
    const r = publish({ outDir });
    io.out(`Built the static site in ${r.out}: ${r.copied.join(', ')}. apps/registry.json lists ${r.apps} app(s).`);
    io.out('Publish that folder to your static host (for example GitHub Pages with Cloudflare DNS), then add its origin to allowedOrigins and turn on hosted mode in Settings.');
    return 0;
  }

  if (cmd === 'update') return runUpdate(rest, io);
  if (cmd === 'pin') return runPin(rest, io);

  io.out(`Unknown command "${cmd}". Run "workshop help".`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
