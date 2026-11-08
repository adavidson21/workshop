#!/usr/bin/env node
// The `workshop` command: one entry point for running and looking after the local agent.
//
//   workshop start [--port n] [--quiet]   Start the agent (same as node agent/start.mjs).
//   workshop install [--login] [setup]    First run: create ~/.workshop. --login also turns on start at login.
//                                          Setup options (used by the one-line installer, scripts/bootstrap.*):
//                                          --allow <origin>, --work-mode, --workspace <folder>, --opencode <command>,
//                                          --powershell <command>. See setupFromFlags below.
//   workshop pin [--docket <folder>|--no-docket] [--runway <folder>|--no-runway] [--receipts <folder>|--no-receipts] [--notes <folder>|--no-notes]
//                                          Build work mode's pinned copy of the site into ~/.workshop/ui.
//   workshop open [--print]                Open Workshop on this computer (sign-in and settings) in the default browser. --print only prints.
//   workshop stop | restart                Stop the running agent; restart it in the background.
//   workshop pat [NAME] [--remove]         Save a PAT in a user environment variable (default ADO_PAT) without showing it.
//   workshop uninstall                     Turn off start at login. Leaves your data folder (dataDir) and ~/.workshop in place.
//   workshop doctor                        Check Node, config.json, the port, the data folder, start at login and hosted mode.
//   workshop doctor ado [options]          Check the ADO connector (wraps connectors/ado/doctor.mjs).
//   workshop publish [--out <dir>]         Build the static site (hosted or browser mode) with apps/registry.json.
//   workshop apps [on|off <app>]           List the apps, or turn one on or off (work mode: downloads a separate
//                                          app if needed and rebuilds the pinned copy). See docs/apps.md.
//   workshop update [--check] [--tag <tag>] [--<app>-tag <tag>] [--pull]
//                                          No options: move Workshop, Docket, Runway and Rapport to their newest
//                                          release tags and rebuild the pinned copy. --check lists the tags and
//                                          changes nothing. --tag moves to one tag. --pull is the old git pull.
//                                          --eng-agents <folder> names the eng-agents clone to update.
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
import { SITE } from './shared/site.js';
import { SchemaSet } from './agent/lib/schema.mjs';
import { resolveHome, homePaths, defaultConfig, DEFAULT_PORT } from './agent/lib/home.mjs';
import { writeJsonAtomic } from './agent/lib/fsutil.mjs';
import { dataDirProblem, defaultDataDir } from './agent/lib/datadir.mjs';
import { enableStartAtLogin, disableStartAtLogin, startAtLoginStatus } from './agent/lib/login.mjs';
import { main as adoDoctorMain } from './connectors/ado/doctor.mjs';
import { checkProviders } from './connectors/opencode/lib/providers.mjs';
import { verifyPinned, describeBuild, uiDirOf, REMOTE_APPS, DOCKET_ID } from './agent/lib/pinned.mjs';
import { buildRegistry as registryOf, findRemote as findRemoteIn, findApp, downloadDir, pinApps, readOff, writeOff, appSwitches } from './agent/lib/apps.mjs';
import { ENV_NAME, liveEnv, readWindowsUserEnv } from './agent/lib/userenv.mjs';
import { patProblem, readSecret, startBackground, stopAgent, writeWindowsUserEnv } from './scripts/lib/control.mjs';

export const REPO = path.dirname(fileURLToPath(import.meta.url));
const SERVED_DIRS = ['shell', 'shared', 'icons', 'apps'];
const SERVED_FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];

const USAGE = `Usage: workshop <command> [options]

  up                             Start Workshop in the background if it is not running, then open it. The Start
                                 menu's Workshop shortcut runs this.
  start [--port <n>] [--quiet]   Start the agent in this window, print the address to open.
  install [--login] [options]    Create ~/.workshop. --login also turns on start at login (no admin).
                                 --allow <origin>       turn on hosted mode and allow this site
                                 --work-mode            turn on work mode: Workshop runs from a pinned copy on
                                                        this computer and no site can pair (see workshop pin)
                                 --workspace <folder>   turn on the opencode connector with this workspace
                                 --opencode <command>   the command that runs opencode (if not set yet)
                                 --powershell <command> the PowerShell command (if not set yet)
                                 --data-dir <folder>    use this data folder (new installs only: never moves data)
                                 --onedrive             use Workshop in your company OneDrive as the data folder,
                                                        when there is one (new installs only)
  open [--print]                 Open Workshop on this computer in your default browser: it signs that browser in,
                                 links to Workshop's site to pair, and has the settings only this computer can change.
                                 --print only prints the sign-in address, to open in another browser.
  stop                           Stop Workshop if it is running.
  restart [--opencode]           Stop Workshop, then start it again in the background (no window). --opencode
                                 also restarts opencode's background service, so it loads newly installed agents.
  data-folder [<folder>]         Say where your data is. With a folder (or --onedrive for your company OneDrive),
              [--onedrive]       copy your data there and use it from now on. The old folder is kept.
  pat [NAME] [--remove]          Save a personal access token in the user environment variable NAME (default
                                 ADO_PAT). Paste it when asked; it is not shown or kept in shell history.
                                 Workshop picks it up within seconds on Windows, with no restart.
                                 --remove deletes the variable.
  uninstall                      Turn off start at login. Leaves your data folder (dataDir, default ~/Workshop)
                                 and ~/.workshop in place.
  doctor                         Check Node, config.json, the port, the data folder, start at login and hosted mode.
  doctor ado [options]           Check the ADO connector. Run "workshop doctor ado --help" for its options.
  publish [--out <dir>]          Build the static site for hosted or browser mode (default out: dist/).
  pin [--docket <folder>]        Build work mode's pinned copy of Workshop (with Docket, Runway, Rapport and
      [--no-docket]              Folio) from this install into ~/.workshop/ui. The agent serves only that
      [--runway <folder>]        copy, checked file by file. Docket, Runway, Rapport and Folio come from a
      [--no-runway]              docket, runway, receipts and notes folder next to Workshop (or
      [--receipts <folder>]      .remote/<id>) unless a folder is given.
      [--no-receipts]            Apps turned off (workshop apps off) are left out.
      [--notes <folder>]
      [--no-notes]
  apps                           List the apps and whether each is on.
  apps on <app>                  Turn an app on. In work mode, an app in its own repo (Docket, Runway, Rapport, Folio)
                                 is downloaded next to Workshop first, at its newest release, and the pinned
                                 copy is rebuilt. For Dispatch, Tandem (eng-agents) is downloaded next to
                                 Workshop and installed in opencode. Settings (Apps) has the same switches.
  apps off <app>                 Turn an app off: it leaves the rail (and the pinned copy in work mode).
  update                         Update Workshop, Docket, Runway, Rapport, Folio and Tandem (eng-agents) each to its
                                 newest release tag (skipping any already there), then rebuild the pinned copy if
                                 work mode is on. Tandem is reinstalled in opencode when opencode's copy is behind.
                                 Tandem's clone is the one next to Workshop, else the one opencode installed from.
  update --eng-agents <folder>   Same, using the eng-agents clone in <folder> (also goes with --eng-agents-tag).
  update --check                 List the release tags and say which one this is. Changes nothing.
  update --tag <tag>             Move this checkout to a release tag, then rebuild the pinned copy if work mode is
         [--docket-tag <tag>]    on. --docket-tag and --runway-tag also move the Docket and Runway checkouts
         [--runway-tag <tag>]    the pinned copy is built from. --receipts-tag and --notes-tag do the same for Rapport and Folio.
         [--receipts-tag <tag>]  --eng-agents-tag installs Tandem in opencode at that tag (core-v<version>).
         [--notes-tag <tag>]
         [--eng-agents-tag <tag>]
  update --pull                  Update to the newest code on the current branch (git pull), not a release.
  version                        Print the agent version.
  remote-apps                    List the apps work mode pins from other repos (apps/remote.json), for the installers.
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
export async function doctorReport({ repo = REPO, home = resolveHome(), env = process.env, platform = process.platform, nodeVersion = process.version, probe = agentHealth, defaultDir = defaultDataDir(), uiDir = uiDirOf(home), userHome = os.homedir() } = {}) {
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
  // Tandem: what opencode loads should match the checkout next to Workshop (a stale install has missing agents).
  if (oc || findEngAgents(repo, { userHome })) {
    const t = tandemDoctor({ repo, userHome, dispatchOn: !readOff(home).has('agents') });
    if (t) { lines.push(...t.line.split('\n')); if (t.bad) bad = true; }
  }

  lines.push(bad ? 'Result: fix the problems above.' : 'Result: all good.');
  return { lines, code: bad ? 1 : 0 };
}

// --------------------------------------------------------------- publish

/** The apps/registry.json contents (same shape as GET /api/apps), built from appsDir. Empty if there is none. */
export const buildRegistry = (appsDir, schemas) => registryOf(appsDir, schemas);

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
  const value = { '--workspace': 'workspace', '--opencode': 'opencode', '--powershell': 'powershell', '--data-dir': 'dataDir' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--login') { opts.login = true; continue; }
    if (a === '--onedrive') { opts.oneDrive = true; continue; }
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
  if (opts.dataDir && opts.oneDrive) return { error: 'Pass --data-dir or --onedrive, not both.' };
  return { opts };
}

/**
 * The company OneDrive folder on this computer, or null. Only the work (OneDrive for Business) folder, never a
 * personal OneDrive: work data stays on storage the company manages. Windows sets OneDriveCommercial; on a Mac
 * it is the one ~/Library/CloudStorage/OneDrive-<Company> folder (not OneDrive-Personal).
 */
export function companyOneDrive(env = process.env, { platform = process.platform, home = os.homedir() } = {}) {
  const od = env.OneDriveCommercial;
  if (od && (path.isAbsolute(od) || path.win32.isAbsolute(od))) return od;
  if (platform === 'darwin') {
    const cs = path.join(home, 'Library', 'CloudStorage');
    let names = [];
    try { names = fs.readdirSync(cs).filter(n => /^OneDrive-/.test(n) && !/^OneDrive-Personal/i.test(n)); } catch { /* none */ }
    if (names.length === 1) return path.join(cs, names[0]);
  }
  return null;
}

/** Whether a folder exists and has anything in it. */
export const hasFiles = dir => { try { return fs.readdirSync(dir).length > 0; } catch { return false; } };

/** Whether a path is inside a OneDrive folder (any OneDrive). */
export const onOneDrive = dir => /[\\/]OneDrive([ -][^\\/]*)?([\\/]|$)/i.test(String(dir || ''));

/**
 * Pick the data folder at install (opts.dataDir, or opts.oneDrive for the company OneDrive). Only for a new
 * install: a dataDir already in config.json is kept, and so is the default folder once it holds data, because
 * changing dataDir never moves files (`workshop data-folder` does). Returns plain-words lines.
 */
export function chooseDataDir(config, opts, { home, env = process.env, defaultDir = defaultDataDir(), platform, userHome } = {}) {
  if (!opts.dataDir && !opts.oneDrive) return [];
  let want = opts.dataDir ? path.resolve(opts.dataDir) : null;
  if (!want) {
    const od = companyOneDrive(env, { platform, home: userHome });
    if (!od) return ['No company OneDrive on this computer, so your data stays in ' + configDataDir(config, defaultDir) + '.'];
    want = path.join(od, 'Workshop');
  }
  const now = configDataDir(config, defaultDir);
  if (path.resolve(now) === want) return [`Data folder: ${want} (unchanged).`];
  if (config.dataDir || hasFiles(defaultDir)) {
    return [`Your data is in ${now}, so it stays there. To move it to ${want}, run: workshop data-folder "${want}"`];
  }
  const problem = dataDirProblem(want, home);
  if (problem) throw new Error(problem);
  config.dataDir = want;
  return [`Data folder: ${want}${onOneDrive(want) ? ' (in your company OneDrive, so it is backed up)' : ''}.`];
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
    said.push(before ? 'Work mode is on (unchanged); hosted mode is off.' : 'Turned on work mode and turned off hosted mode. Workshop builds its pinned copy when it starts.');
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
  if (opts.allow?.length || opts.workMode || opts.workspace || opts.opencode || opts.powershell || opts.dataDir || opts.oneDrive) {
    const info = inspectConfig(homePaths(home).config, schemas);
    if (info.state !== 'ok') { io.out('config.json has a problem. Run "workshop doctor" and fix it first.'); return 1; }
    let said;
    try {
      said = setupFromFlags(info.config, opts, schemas);
      said.push(...chooseDataDir(info.config, opts, { home, env: io.env, defaultDir: io.defaultDataDir || defaultDataDir(), platform: io.platform, userHome: io.userHome }));
    } catch (e) { io.out(e.message); return 1; }
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
  io.out('\nStart Workshop and open it with:  workshop up');
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
  const menu = startMenuDir(io.env, io.platform || process.platform);
  if (menu && fs.existsSync(menu)) { fs.rmSync(menu, { recursive: true, force: true }); io.out(`Removed the Start menu shortcuts (${menu}).`); }
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

/** True when update's options name any tag (Workshop's or a remote app's). */
const anyTag = opts => !!opts.tag || !!opts.engAgentsTag || REMOTE_APPS.some(a => opts[`${a.key}Tag`]);

/** Read update's options. Returns {opts} or {error}. With no options, update means --latest. */
export function parseUpdateArgs(rest) {
  // --<key>-tag for each app from another repo (apps/remote.json): --docket-tag, --runway-tag, --receipts-tag.
  const opts = { tag: null, ...Object.fromEntries(REMOTE_APPS.map(a => [`${a.key}Tag`, null])), engAgentsTag: null, engAgents: null, pull: false, latest: false, check: false };
  const keys = { '--tag': 'tag', ...Object.fromEntries(REMOTE_APPS.map(a => [`--${a.key}-tag`, `${a.key}Tag`])), '--eng-agents-tag': 'engAgentsTag' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--pull') { opts.pull = true; continue; }
    if (a === '--latest') { opts.latest = true; continue; }
    if (a === '--check') { opts.check = true; continue; }
    if (a === '--eng-agents') {
      const v = rest[++i];
      if (!v || v.startsWith('--')) return { error: '--eng-agents needs the folder of your eng-agents clone.' };
      opts.engAgents = v;
      continue;
    }
    if (keys[a]) {
      const v = rest[++i];
      if (!validTag(v)) return { error: `${a} needs a release tag like v1.2.0.` };
      opts[keys[a]] = v;
      continue;
    }
    return { error: `Unknown option ${a}. Run "workshop help".` };
  }
  if (opts.pull && anyTag(opts)) return { error: '--pull and --tag do not go together.' };
  if (opts.latest && (opts.pull || anyTag(opts))) return { error: '--latest picks every tag itself, so it does not go with --tag or --pull.' };
  if (opts.check && (opts.pull || opts.latest || anyTag(opts))) return { error: '--check only lists the release tags, so it goes on its own.' };
  if (opts.engAgents && (opts.pull || opts.check)) return { error: '--eng-agents goes with a plain "workshop update" or --eng-agents-tag.' };
  if (!opts.pull && !opts.check && !anyTag(opts)) opts.latest = true;
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

/** The newest full release tag (<prefix>1.2.3) in a checkout with this prefix ('v' for Workshop, Docket, Runway and Rapport, 'core-v' for
 *  eng-agents), after fetching tags. Null when there is none. */
export function latestTag(dir, prefix = 'v', out = () => {}) {
  const f = git(dir, ['fetch', '--tags', '--quiet', 'origin']);
  if (f.code !== 0) out(`Could not fetch tags in ${dir}${f.err ? `: ${f.err.split('\n')[0]}` : ''}. Using the tags already here.`);
  return listTags(dir, Infinity).find(t => t.startsWith(prefix) && /^\d+\.\d+\.\d+$/.test(t.slice(prefix.length))) ?? null;
}

/** The release tags on a checkout's current commit (more than one tag can sit on a commit, like docket-android). */
const tagsAtHead = dir => { const r = git(dir, ['tag', '--points-at', 'HEAD']); return r.code === 0 ? r.out.split('\n').filter(isReleaseTag) : []; };

// ------------------------------------------------- Tandem (eng-agents)
// Tandem is Dispatch's agents. Its checkout sits next to Workshop like Docket, Runway and Rapport, and moves by
// core-v<version> release tags. Unlike them it is not served: its own install.ps1 copies the agents and commands
// into opencode's config (~/.config/opencode), which is what opencode loads. So Workshop moves the checkout AND
// installs it, and checks that what opencode has matches the checkout.
export const TANDEM_REPO = SITE.repos['eng-agents'];
export const tandemDir = (repo = REPO) => path.join(path.dirname(repo), 'eng-agents');

/** True when a folder is an eng-agents checkout (has update.ps1 and .git). */
export const isTandemCheckout = dir => !!dir && fs.existsSync(path.join(dir, 'update.ps1')) && isCheckout(dir);

/**
 * The eng-agents checkout Workshop updates, or null: the folder given (update --eng-agents), else the one next to
 * Workshop (where the work mode setup clones it), else the folder opencode's copy was installed from (the source
 * install.ps1 records in its manifest), so a clone kept elsewhere is updated too.
 */
export function findEngAgents(repo = REPO, { userHome = os.homedir(), dir = null } = {}) {
  if (dir) return isTandemCheckout(dir) ? path.resolve(dir) : null;
  const next = tandemDir(repo);
  if (isTandemCheckout(next)) return next;
  const src = installedTandem(userHome)?.source;
  return isTandemCheckout(src) ? src : null;
}

/** What Tandem's install.ps1 recorded in opencode's config: {core, source} or null when nothing is installed. */
export function installedTandem(userHome = os.homedir()) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(userHome, '.config', 'opencode', 'eng-agents', 'manifest.json'), 'utf8').replace(/^﻿/, ''));
    return { core: m?.components?.core?.version ?? null, source: typeof m?.source === 'string' ? m.source : null };
  } catch { return null; }
}

/** True when version a is newer than b (dotted numbers, like 2.10.0 and 2.9.1). False when either is missing. */
export function newerVersion(a, b) {
  if (!a || !b) return false;
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** The opencode command the opencode connector uses (config opencode.command, e.g. the installer's own copy), else "opencode". */
export function opencodeCommand(home = resolveHome()) {
  try {
    const c = JSON.parse(fs.readFileSync(homePaths(home).config, 'utf8'));
    const cmd = c?.connectors?.opencode?.config?.opencode?.command;
    return typeof cmd === 'string' && cmd.trim() ? cmd.trim() : 'opencode';
  } catch { return 'opencode'; }
}

// On Windows, a path with spaces is quoted for the shell (opencode is often an npm .cmd shim, which needs one).
const shellCmd = cmd => (process.platform === 'win32' && /\s/.test(cmd) && !/^".*"$/.test(cmd) ? `"${cmd}"` : cmd);

/** opencode's major version (from opencode --version), or null when it does not run. */
export function opencodeMajor(run = spawnSync, cmd = 'opencode') {
  const r = run(shellCmd(cmd), ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 15000, shell: process.platform === 'win32' });
  const m = !r.error && r.status === 0 && /(\d+)\.\d+\.\d+/.exec(r.stdout || '');
  return m ? Number(m[1]) : null;
}

/**
 * opencode reads its agents when it starts, so after a Tandem install its background service (2.x) is restarted;
 * Dispatch reconnects to it. 1.x has no service: an "opencode serve" Workshop started goes with "workshop restart".
 */
export function restartOpencode({ out, run = spawnSync, cmd = opencodeCommand() } = {}) {
  const major = opencodeMajor(run, cmd);
  if (major === null) { out(`opencode (${cmd}) did not run here, so it was not restarted. Restart it before using Dispatch.`); return false; }
  if (major < 2) { out('opencode loads agents when it starts: run "workshop restart", and close any opencode you started yourself.'); return false; }
  const o = { encoding: 'utf8', windowsHide: true, timeout: 60000, shell: process.platform === 'win32' };
  run(shellCmd(cmd), ['service', 'stop'], o);
  const r = run(shellCmd(cmd), ['service', 'start'], o);
  if (r.error || r.status !== 0) { out('Could not restart opencode\'s background service. Run: opencode service stop, then opencode service start'); return false; }
  out('Restarted opencode\'s background service so it loads the new agents. Close any opencode window you had open, then reload Dispatch.');
  return true;
}

/** Tandem's Core version at a ref of its checkout (core/VERSION), or null. */
export function tandemVersionAt(dir, ref = 'HEAD') {
  const r = git(dir, ['show', `${ref}:core/VERSION`]);
  return r.code === 0 && /^\d+(\.\d+)*$/.test(r.out) ? r.out : null;
}

/** The PowerShell to run Tandem's scripts with: pwsh, else Windows PowerShell. Null when there is none. */
export function findPowerShell(platform = process.platform) {
  for (const exe of platform === 'win32' ? ['pwsh', 'powershell'] : ['pwsh']) {
    const r = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (!r.error && r.status === 0) return exe;
  }
  return null;
}

/**
 * Install Tandem from its checkout into opencode at a release tag. The checkout is moved to the tag first. With an
 * earlier install, the tag's update.ps1 does it (it keeps the Personal and Company layers used last time);
 * otherwise install.ps1 runs, with ~/.config/eng-agents/personal when it exists (as the installer does).
 * Returns true when opencode now has that tag's Core version.
 */
export function installTandem(dir, tag, { out, userHome = os.homedir(), ps = findPowerShell(), run = spawnSync, allowOlder = false, restart = restartOpencode } = {}) {
  { const w = tandemVersionAt(dir, `refs/tags/${tag}`), have = installedTandem(userHome)?.core;
    if (!allowOlder && newerVersion(have, w)) { out(`opencode has Tandem Core ${have}, newer than ${tag}. Not installing an older version.`); return false; } }
  if (!ps) { out('Tandem needs PowerShell to install (pwsh, or Windows PowerShell). Install PowerShell 7, then run "workshop update" again.'); return false; }
  const want = tandemVersionAt(dir, `refs/tags/${tag}`);
  const before = installedTandem(userHome);
  const psArgs = file => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, file)];
  // Move to the tag first in both cases, so the scripts that run are that release's own. An older checkout's
  // update.ps1 can fail against a newer tag (Core 2.9's looked for the dashboard VERSION file removed in 2.11).
  if (!checkoutTag(dir, tag, out)) return false;
  let args;
  if (before) args = [...psArgs('update.ps1'), '-Tag', tag, '-Yes'];
  else {
    args = psArgs('install.ps1');
    const personal = path.join(userHome, '.config', 'eng-agents', 'personal');
    if (fs.existsSync(personal)) { args.push('-Personal', personal); out(`Using your personal layer at ${personal}.`); }
  }
  out(`${before ? 'Updating' : 'Installing'} Tandem ${tag} in opencode ...`);
  const r = run(ps, args, { stdio: 'inherit', windowsHide: true });
  const after = installedTandem(userHome);
  if (r.error || r.status !== 0 || !after || (want && after.core !== want)) {
    out(`Tandem did not install${r.error ? ` (${r.error.message})` : ''}. See the messages above, then run "workshop update" again.`);
    return false;
  }
  out(`Tandem ${after.core} is installed in opencode.`);
  restart({ out });
  return true;
}

/** Download Tandem next to Workshop (git clone) and install it at its newest release. Returns true when installed. */
export function downloadTandem({ repo = REPO, out, userHome = os.homedir(), ps } = {}) {
  const dir = tandemDir(repo);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    out(`${dir} already exists but is not an eng-agents clone. Move it aside, then run this again.`);
    return false;
  }
  out(`Downloading Tandem (eng-agents) into ${dir} ...`);
  const r = spawnSync('git', ['clone', '--quiet', `https://github.com/${TANDEM_REPO}.git`, dir], { encoding: 'utf8', windowsHide: true });
  if (r.error) { out(r.error.code === 'ENOENT' ? 'git is not installed, so Tandem cannot be downloaded.' : `Could not run git: ${r.error.message}`); return false; }
  if (r.status !== 0) { out(`Could not download Tandem: ${(r.stderr || '').trim().split('\n')[0] || `git exited with ${r.status}`}`); return false; }
  const tag = latestTag(dir, 'core-v', out);
  if (!tag) { out('Tandem has no release tags yet, so it was not installed. Work mode installs only release tags.'); return false; }
  return installTandem(dir, tag, { out, userHome, ps: ps === undefined ? findPowerShell() : ps });
}

/** For "workshop apps on dispatch" in work mode: download Tandem if it is not next to Workshop, and install it at its
 *  newest release if opencode does not have it. A Tandem installed from elsewhere is left alone. */
export function ensureTandem({ repo = REPO, out, userHome = os.homedir() } = {}) {
  const dir = findEngAgents(repo, { userHome });
  if (!dir) {
    const inst = installedTandem(userHome);
    if (inst) { out(`Tandem ${inst.core ?? ''} is already installed in opencode from ${inst.source ?? 'another folder'}, so it is left as it is.`); return true; }
    return downloadTandem({ repo, out, userHome });
  }
  if (installedTandem(userHome)) return true;
  const tag = latestTag(dir, 'core-v', out);
  if (!tag) { out('Tandem has no release tags yet, so it was not installed. Work mode installs only release tags.'); return false; }
  return installTandem(dir, tag, { out, userHome });
}

/** What doctor says about Tandem: a line, and whether it is a problem. Null when there is nothing to say. */
/**
 * True when opencode's 2.x background service last started before Tandem was last installed, so it has not loaded
 * agents added by that install ("Agent not found"). The service writes service.json when it starts; Tandem's
 * install.ps1 writes its manifest. False when either is missing (1.x, or no install).
 */
export function opencodeStale(userHome = os.homedir()) {
  try {
    const oc = path.join(userHome, '.config', 'opencode');
    return fs.statSync(path.join(oc, 'eng-agents', 'manifest.json')).mtimeMs > fs.statSync(path.join(oc, 'service.json')).mtimeMs + 1000;
  } catch { return false; }
}

const STALE_LINE = 'opencode: its background service started before Tandem was last installed, so it may not know newer agents (Dispatch says "Agent not found"). Run: workshop restart --opencode';

export function tandemDoctor({ repo = REPO, userHome = os.homedir(), dispatchOn = true } = {}) {
  const r = tandemDoctorInner({ repo, userHome, dispatchOn });
  if (r && !r.bad && installedTandem(userHome) && opencodeStale(userHome)) return { line: `${r.line}\n${STALE_LINE}`, bad: true };
  return r;
}

function tandemDoctorInner({ repo, userHome, dispatchOn }) {
  const dir = findEngAgents(repo, { userHome }), inst = installedTandem(userHome);
  if (!dir && !inst) return dispatchOn ? { line: 'Tandem (eng-agents): not installed, so Dispatch has no agents. Add it with: workshop apps on dispatch', bad: false } : null;
  if (!dir) return { line: `Tandem (eng-agents): Core ${inst.core ?? 'unknown'} in opencode, from ${inst.source ?? 'an unknown folder'}, which is not an eng-agents clone, so "workshop update" leaves it alone. To update it, run: workshop update --eng-agents <folder of your eng-agents clone>`, bad: false };
  const have = tandemVersionAt(dir);
  if (!inst) return { line: `Tandem (eng-agents): downloaded at ${dir} but not installed in opencode. Run: workshop update`, bad: true };
  if (have && inst.core !== have) return { line: `Tandem (eng-agents): opencode has Core ${inst.core ?? 'unknown'}, but ${dir} is at ${have}. Agents added since then are missing. Run: workshop update`, bad: true };
  return { line: `Tandem (eng-agents): Core ${inst.core} in opencode: ok.`, bad: false };
}

/** A remote app's checkout the pinned copy is built from: <repo>/.remote/<id>, else a <key> folder next to the repo
 *  (docket, runway, receipts). `key` is a REMOTE_APPS key. */
export const findRemote = (key, repo = REPO) => findRemoteIn(key, repo);
export const findDocket = (repo = REPO) => findRemote('docket', repo);

/** Read pin's options: --<key> <folder> and --no-<key> for each remote app. Returns {opts} or {error}. */
export function parsePinArgs(rest) {
  const opts = {};
  for (const a of REMOTE_APPS) { opts[a.key] = undefined; opts[`no${a.name}`] = false; }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const a = REMOTE_APPS.find(x => arg === `--${x.key}` || arg === `--no-${x.key}`);
    if (!a) return { error: `Unknown option ${arg}. Run "workshop help".` };
    if (arg === `--no-${a.key}`) { opts[`no${a.name}`] = true; continue; }
    const v = rest[++i];
    if (!v || v.startsWith('--')) return { error: `--${a.key} needs a folder.` };
    opts[a.key] = path.resolve(v);
  }
  for (const a of REMOTE_APPS) {
    if (opts[`no${a.name}`] && opts[a.key]) return { error: `--${a.key} and --no-${a.key} do not go together.` };
  }
  return { opts };
}

/** Build the pinned copy for a home. Returns {build, docketDir, dirs, off, skipped} or throws with plain words.
 *  `skipped` lists apps left out because their app.json is not valid: [{id, problem}]. */
export function pin({ home, repo = REPO, opts = {}, schemas = loadSchemas(), uiDir = uiDirOf(home) }) {
  // Apps turned off (workshop apps off, or Settings) stay out; --no-<key> leaves one out for this build only.
  const remotes = {};
  for (const a of REMOTE_APPS) {
    if (opts[`no${a.name}`]) remotes[a.key] = null;
    else if (opts[a.key]) remotes[a.key] = opts[a.key];
  }
  const r = pinApps({ home, repo, schemas, uiDir, remotes, gitInfo: dir => gitInfo(dir) });
  return { build: r.build, docketDir: r.dirs.docket, dirs: r.dirs, off: r.off, skipped: r.skipped };
}

/** What pin says about apps it left out because their app.json is not valid. */
export function skippedLines(skipped = []) {
  return skipped.map(({ id, problem }) => {
    const a = REMOTE_APPS.find(x => x.id === id);
    const fix = a ? `Move ${a.name} to a release that fixes it (workshop update --latest), or fix ${findRemote(a.key) || a.key}/app.json` : `Fix apps/${id}/app.json`;
    return `${a ? a.name : id} is not included: ${problem}. ${fix}, then run "workshop pin" again.`;
  });
}

async function runPin(rest, io) {
  const parsed = parsePinArgs(rest);
  if (parsed.error) { io.out(parsed.error); return 1; }
  const home = resolveHome(io.env);
  let r;
  try { r = pin({ home, opts: parsed.opts }); } catch (e) { io.out(`Could not build the pinned copy: ${e.message}`); return 1; }
  io.out(`Built the pinned copy in ${uiDirOf(home)}: ${describeBuild(r.build)}; ${Object.keys(r.build.files).length} files.`);
  for (const a of REMOTE_APPS) {
    if (r.off.has(a.id)) io.out(`${a.name} is turned off, so it is not included. Turn it on with: workshop apps on ${a.key}`);
    else if (!r.dirs[a.key] && !parsed.opts[`no${a.name}`]) io.out(`${a.name} is not included: it is not downloaded. Download it with: workshop apps on ${a.key}`);
  }
  for (const l of skippedLines(r.skipped)) io.out(l);
  const offBuiltIn = [...r.off].filter(id => !REMOTE_APPS.some(a => a.id === id));
  if (offBuiltIn.length) io.out(`Turned off, so not included: ${offBuiltIn.join(', ')}. See "workshop apps".`);
  for (const [name, x] of [['Workshop', r.build.workshop], ...REMOTE_APPS.map(a => [a.name, r.build[a.key]])]) {
    if (x && !(x.ref && !/not a release tag/.test(x.ref))) io.out(`Note: ${name} is not at a release tag. For work, run "workshop update" first.`);
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
  if (opts.check) {
    const f = git(REPO, ['fetch', '--tags', '--quiet', 'origin']);
    if (f.code !== 0) io.out(`Could not fetch tags${f.err ? `: ${f.err.split('\n')[0]}` : ''}. Showing the tags already here.`);
    const now = gitInfo(REPO);
    io.out(`Workshop ${VERSION}, at ${now ? `${now.ref} (${now.commit.slice(0, 12)})` : 'an unknown commit'}.`);
    const tags = listTags(REPO);
    if (!tags.length) { io.out('There are no release tags yet. Nothing was changed.'); return 0; }
    io.out(`Release tags, newest first: ${tags.join(', ')}.`);
    io.out('Nothing was changed. To update everything to the newest release: workshop update');
    return 0;
  }
  if (opts.engAgents && !findEngAgents(REPO, { dir: opts.engAgents })) {
    io.out(`${opts.engAgents} is not an eng-agents clone (no update.ps1 or no .git).`);
    return 1;
  }
  const home = resolveHome(io.env);
  const info = inspectConfig(homePaths(home).config, loadSchemas());
  if (opts.latest) {
    const plan = planLatest(REPO, io.out, { dispatchOn: !readOff(home).has('agents'), engAgentsDir: opts.engAgents });
    for (const l of plan.lines) io.out(l);
    Object.assign(opts, plan.tags);
  }
  const running = await agentHealth(info.config?.port ?? DEFAULT_PORT);
  const moved = anyTag(opts);
  if (opts.tag && !checkoutTag(REPO, opts.tag, io.out)) return 1;
  for (const a of REMOTE_APPS) {
    const t = opts[`${a.key}Tag`];
    if (!t) continue;
    const d = findRemote(a.key, REPO);
    if (!d || !isCheckout(d)) { io.out(`--${a.key}-tag needs a download of ${a.name}. Get it with: workshop apps on ${a.key}`); return 1; }
    if (!checkoutTag(d, t, io.out)) return 1;
  }
  // Tandem last: a failed install leaves Workshop and its apps updated, and says so.
  let tandemFailed = false;
  if (opts.engAgentsTag) {
    const ea = findEngAgents(REPO, { dir: opts.engAgents });
    if (!ea) { io.out('--eng-agents-tag needs an eng-agents clone: one next to Workshop, the one opencode installed from, or --eng-agents <folder>. Get one with: workshop apps on dispatch'); return 1; }
    tandemFailed = !installTandem(ea, opts.engAgentsTag, { out: io.out, allowOlder: !opts.latest });
  }
  if (!moved) io.out('Everything is already at its newest release.');
  if (info.config?.features?.workMode === true) {
    // Rebuilt even when nothing moved, so an app downloaded or turned on since the last build shows up.
    // The new code builds the copy, so run it in a fresh process.
    io.out('Work mode is on, so the pinned copy is rebuilt.');
    const r = spawnSync(process.execPath, [path.join(REPO, 'workshop.mjs'), 'pin'], { stdio: 'inherit', env: io.env });
    if (r.status !== 0) { io.out('Rebuilding the pinned copy failed. Run "workshop pin" to see why.'); return 1; }
  } else if (!moved) io.out('Nothing was changed.');
  if (running && opts.tag) io.out('Workshop is running the old version: run "workshop restart" to run this one.');
  else if (running && moved && anyTag({ ...opts, engAgentsTag: null })) io.out('Reload Workshop in your browser to use the new version.');
  return tandemFailed ? 1 : 0;
}

/**
 * What `workshop update --latest` moves to: the newest release tag of Workshop and of each remote app's checkout
 * found (Docket, Runway, Rapport), skipping any that are already there or have no release yet. Tandem (eng-agents next to
 * Workshop) gets engAgentsTag when its checkout is behind or opencode has another Core version than its newest tag.
 * Returns {tags: {tag, <key>Tag..., engAgentsTag}, lines}.
 */
export function planLatest(repo = REPO, out = () => {}, { userHome = os.homedir(), dispatchOn = true, engAgentsDir = null } = {}) {
  const tags = {}, lines = [];
  const consider = (name, dir, key) => {
    const latest = latestTag(dir, 'v', out);
    const at = tagsAtHead(dir), now = at[0] ?? null;
    if (!latest) lines.push(`${name}: no release tags yet. Left as it is.`);
    else if (at.includes(latest)) lines.push(`${name}: already at ${latest}.`);
    else { tags[key] = latest; lines.push(`${name}: ${now ?? 'not at a release tag'} -> ${latest}.`); }
  };
  consider('Workshop', repo, 'tag');
  for (const a of REMOTE_APPS) {
    const d = findRemote(a.key, repo);
    if (d && isCheckout(d)) consider(a.name, d, `${a.key}Tag`);
    else lines.push(`${a.name}: not downloaded, so skipped. To add it: workshop apps on ${a.key}`);
  }
  // Tandem: behind when the checkout is not at its newest tag, or opencode has a different Core than that tag.
  const ea = findEngAgents(repo, { userHome, dir: engAgentsDir });
  if (ea) {
    const latest = latestTag(ea, 'core-v', out);
    const want = latest && tandemVersionAt(ea, `refs/tags/${latest}`);
    const inst = installedTandem(userHome);
    if (!latest) lines.push('Tandem (eng-agents): no release tags yet. Left as it is.');
    else if (inst && want && newerVersion(inst.core, want)) lines.push(`Tandem (eng-agents): opencode has Core ${inst.core}, newer than the newest release (${latest}). Left as it is; release it from eng-agents (Actions, Release) for "workshop update" to manage it.`);
    else if (inst && want && inst.core === want && tagsAtHead(ea).includes(latest)) lines.push(`Tandem (eng-agents): already at ${latest}.`);
    else { tags.engAgentsTag = latest; lines.push(`Tandem (eng-agents${ea === tandemDir(repo) ? '' : `, ${ea}`}): ${inst ? `Core ${inst.core ?? 'unknown'} in opencode` : 'not installed in opencode'} -> ${latest}.`); }
  } else if (dispatchOn) lines.push('Tandem (eng-agents): not downloaded, so skipped. To add it: workshop apps on dispatch');
  return { tags, lines };
}

// --------------------------------------------------------------- apps

/** Clone a separate app next to Workshop and move it to its newest release tag (or leave it on its default
 *  branch when it has none). Returns the folder, or null after saying why it could not. */
export function downloadApp(app, { repo = REPO, out }) {
  const dir = downloadDir(app.key, repo);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    out(`${dir} already exists but is not a ${app.name} download (no app.json). Move it aside, then run this again.`);
    return null;
  }
  out(`Downloading ${app.name} into ${dir} ...`);
  const r = spawnSync('git', ['clone', '--quiet', `https://github.com/${app.repo}.git`, dir], { encoding: 'utf8', windowsHide: true });
  if (r.error) { out(r.error.code === 'ENOENT' ? 'git is not installed, so it cannot be downloaded.' : `Could not run git: ${r.error.message}`); return null; }
  if (r.status !== 0) { out(`Could not download ${app.name}: ${(r.stderr || '').trim().split('\n')[0] || `git exited with ${r.status}`}`); return null; }
  const tag = latestTag(dir, 'v', out);
  if (tag) { if (!checkoutTag(dir, tag, out)) return null; } else out(`${app.name} has no release tags yet, so it stays on the newest code.`);
  return dir;
}

function switchLines(list) {
  const lines = [];
  const noCopy = list.workMode && !list.pinned;
  if (noCopy) lines.push('  There is no pinned copy yet. Build it with: workshop pin');
  for (const a of list.apps) {
    let state = a.on ? 'on' : 'off';
    if (!a.canTurnOff) state = 'always on';
    let note = '';
    if (a.separate && a.on && list.workMode) {
      if (!a.downloaded) note = `not downloaded: run "workshop apps on ${a.key}"`;
      else if (a.problem) note = `downloaded (${a.ref || 'unknown version'}), but left out of the pinned copy: ${a.problem}`;
      else if (!a.inWorkshop && !noCopy) note = `downloaded (${a.ref || 'unknown version'}), not in the pinned copy yet: run "workshop pin"`;
      else note = a.ref || '';
    } else if (list.workMode && !noCopy && a.on && !a.inWorkshop) note = 'not in the pinned copy yet: run "workshop pin"';
    lines.push(`  ${a.name.padEnd(12)} ${state.padEnd(10)}${note ? ` ${note}` : ''}`);
  }
  return lines;
}

async function runApps(rest, io) {
  const home = resolveHome(io.env);
  const schemas = loadSchemas();
  const info = inspectConfig(homePaths(home).config, schemas);
  const workMode = info.config?.features?.workMode === true;
  const list = () => appSwitches({ home, repo: REPO, schemas, workMode });
  const [action, word, ...extra] = rest;
  if (!action) {
    io.out(`Apps${workMode ? ' (work mode: the rail shows what is in the pinned copy)' : ''}:`);
    for (const l of switchLines(list())) io.out(l);
    io.out('Turn one on or off: workshop apps on <app>, workshop apps off <app>. Or use Settings, Apps.');
    return 0;
  }
  if ((action !== 'on' && action !== 'off') || extra.length) { io.out('Use: workshop apps, workshop apps on <app>, or workshop apps off <app>.'); return 1; }
  const all = list();
  const app = findApp(word, all.apps.map(a => ({ ...a, key: a.key || a.id })));
  if (!app) { io.out(`There is no app called "${word || ''}". Apps: ${all.apps.map(a => a.key || a.id).join(', ')}.`); return 1; }
  if (!app.canTurnOff) { io.out(`${app.name} is always on.`); return action === 'on' ? 0 : 1; }
  const off = readOff(home);
  if (action === 'on') {
    if (app.separate && workMode && !app.downloaded && !downloadApp(app, { out: io.out })) return 1;
    // Dispatch's agents (Tandem) come from their own repo too: downloaded next to Workshop and installed in opencode.
    if (app.id === 'agents' && workMode && !ensureTandem({ out: io.out })) return 1;
    off.delete(app.id);
  } else off.add(app.id);
  await writeOff(home, off);
  io.out(`${app.name} is ${action}.`);
  if (!workMode) {
    io.out(action === 'on' ? `It shows in Workshop's rail. Reload Workshop if it is open.` : `It no longer shows in Workshop's rail. Reload Workshop if it is open.`);
    return 0;
  }
  let r;
  try { r = pin({ home }); } catch (e) { io.out(`Could not rebuild the pinned copy: ${e.message}`); return 1; }
  io.out(`Rebuilt the pinned copy: ${describeBuild(r.build)}.`);
  for (const l of skippedLines(r.skipped)) io.out(l);
  io.out(await agentHealth(info.config?.port ?? DEFAULT_PORT) ? 'Reload Workshop in your browser to see the change.' : 'Start Workshop with: workshop up');
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
  if (!(await agentHealth(port))) { io.out(`Workshop is not running on port ${port}. Start it and open it with: workshop up`); return 1; }
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

async function runRestart(rest, io) {
  const bad = rest.find(a => a !== '--opencode');
  if (bad) { io.out(`Unknown option ${bad}. Usage: workshop restart [--opencode]`); return 2; }
  const port = configuredPort(io);
  const probe = io.probe || agentHealth;
  const s = await stopAgent({ port, probe, ...(io.control || {}) });
  if (!s.ok) { io.out(s.message); return 1; }
  if (s.wasRunning) io.out('Workshop stopped.');
  // opencode's 2.x background service outlives Workshop; --opencode restarts it too, so it reloads agents and config.
  if (rest.includes('--opencode')) (io.restartOpencode || restartOpencode)({ out: io.out, cmd: opencodeCommand(resolveHome(io.env)) });
  const r = await startBackground({ repo: REPO, port, probe, env: io.env, ...(io.control || {}) });
  io.out(r.message);
  return r.ok ? 0 : 1;
}

/** The Start menu folder the Windows installers put Workshop's shortcuts in, or null off Windows. */
export const startMenuDir = (env = process.env, platform = process.platform) =>
  platform === 'win32' && env.APPDATA ? path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Workshop') : null;

/** workshop up: start in the background when needed, then open Workshop in the browser. */
async function runUp(rest, io) {
  const port = configuredPort(io);
  const probe = io.probe || agentHealth;
  if (!(await probe(port))) {
    const r = await startBackground({ repo: REPO, port, probe, env: io.env, ...(io.control || {}) });
    io.out(r.message);
    if (!r.ok) return 1;
  }
  return (io.open || runOpen)(rest, io);
}

/** Read data-folder's options. Returns {opts} or {error}. */
export function parseDataFolderArgs(rest) {
  const opts = { target: null, oneDrive: false };
  for (const a of rest) {
    if (a === '--onedrive') { opts.oneDrive = true; continue; }
    if (a.startsWith('-')) return { error: `Unknown option ${a}. Usage: workshop data-folder [<folder> | --onedrive]` };
    if (opts.target) return { error: 'Give one folder.' };
    opts.target = a;
  }
  if (opts.target && opts.oneDrive) return { error: 'Give a folder or --onedrive, not both.' };
  return { opts };
}

/**
 * Copy every file under src into dest (made as needed), never writing over a file. Returns the number of files.
 * fs.cpSync is not used: its errorOnExist check has thrown ERR_FS_CP_EEXIST for an empty destination on Windows
 * (Node 22's native cpSync), and its error does not say which file. Symlinks are skipped.
 */
export function copyTree(src, dest) {
  let n = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name), to = path.join(dest, e.name);
    if (e.isDirectory()) n += copyTree(from, to);
    else if (e.isFile()) {
      try { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
      catch (err) { throw new Error(`${err.code === 'EEXIST' ? 'already there' : err.code || err.message}: ${to}`); }
      n++;
    }
  }
  return n;
}

/**
 * workshop data-folder: say where the data is, or move it. Moving copies every file into the new folder (which
 * must be empty), points dataDir at it, and keeps the old folder untouched. Workshop is stopped for the copy and
 * started again afterwards if it was running.
 */
async function runDataFolder(rest, io) {
  const parsed = parseDataFolderArgs(rest);
  if (parsed.error) { io.out(parsed.error); return 1; }
  const { opts } = parsed;
  const home = resolveHome(io.env);
  const schemas = loadSchemas();
  const paths = homePaths(home);
  const info = inspectConfig(paths.config, schemas);
  const defaultDir = io.defaultDataDir || defaultDataDir();
  const now = configDataDir(info.config, defaultDir);
  const od = companyOneDrive(io.env, { platform: io.platform, home: io.userHome });
  if (!opts.target && !opts.oneDrive) {
    io.out(`Your data is in ${now}${onOneDrive(now) ? ' (in OneDrive, so it is backed up)' : ''}.`);
    if (!onOneDrive(now)) io.out(od ? `To keep it in your company OneDrive instead: workshop data-folder --onedrive (${path.join(od, 'Workshop')})` : 'It is not backed up by Workshop. Copy it somewhere safe now and then, or move it with: workshop data-folder <folder>');
    return 0;
  }
  if (info.state !== 'ok' && info.state !== 'missing') { io.out('config.json has a problem. Run "workshop doctor" and fix it first.'); return 1; }
  let target;
  if (opts.oneDrive) {
    if (!od) { io.out('There is no company OneDrive on this computer. Sign in to OneDrive for your work account, or give a folder: workshop data-folder <folder>'); return 1; }
    target = path.join(od, 'Workshop');
  } else target = path.resolve(opts.target);
  if (path.resolve(now) === target) { io.out(`Your data is already in ${target}.`); return 0; }
  const problem = dataDirProblem(target, home);
  if (problem) { io.out(problem); return 1; }
  if (hasFiles(target)) { io.out(`${target} already has files in it. Pick an empty or new folder, so nothing in it is written over.`); return 1; }
  const port = info.config?.port ?? DEFAULT_PORT;
  const probe = io.probe || agentHealth;
  const wasRunning = Boolean(await probe(port));
  if (wasRunning) {
    const s = await stopAgent({ port, probe, ...(io.control || {}) });
    if (!s.ok) { io.out(s.message); return 1; }
    io.out('Stopped Workshop for the move.');
  }
  let copied = 0;
  const existed = fs.existsSync(target);
  try {
    fs.mkdirSync(target, { recursive: true });
    if (fs.existsSync(now)) copied = copyTree(now, target);
  } catch (e) {
    // The target was empty (checked above), so what is in it now is a partial copy: remove it.
    try {
      if (existed) for (const n of fs.readdirSync(target)) fs.rmSync(path.join(target, n), { recursive: true, force: true });
      else fs.rmSync(target, { recursive: true, force: true });
    } catch { /* leave it; the message says what failed */ }
    io.out(`Could not copy your data to ${target}: ${e.message}. Nothing was changed: Workshop still uses ${now}.`);
    if (wasRunning) await startBackground({ repo: REPO, port, probe, env: io.env, ...(io.control || {}) });
    return 1;
  }
  const config = info.config || defaultConfig();
  config.dataDir = target;
  await writeJsonAtomic(paths.config, config);
  io.out(`Copied ${copied} file${copied === 1 ? '' : 's'} to ${target}. Workshop uses that folder from now on.`);
  io.out(`Your old folder (${now}) is kept as it was. Delete it once you have checked everything is there.`);
  if (wasRunning) {
    const r = await startBackground({ repo: REPO, port, probe, env: io.env, ...(io.control || {}) });
    io.out(r.message);
    if (!r.ok) return 1;
  }
  return 0;
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

/** The apps work mode pins from other repos (apps/remote.json), one per line for the installers:
 *  <folder key>\t<app id>\t<name>\t<required|optional>\t<owner/repo>. Docket is required (the pinned copy needs it). */
export function remoteAppLines(apps = REMOTE_APPS, repoOf = id => (readRemote().find(a => a.id === id) || {}).repo) {
  return apps.map(a => [a.key, a.id, a.name, a.id === DOCKET_ID ? 'required' : 'optional', repoOf(a.id) || ''].join('\t'));
}
function readRemote() {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, 'apps', 'remote.json'), 'utf8')).apps || []; } catch { return []; }
}

// --------------------------------------------------------------- command line

export async function main(argv, io = { out: s => console.log(s), env: process.env }) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { io.out(USAGE); return 0; }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') { io.out(VERSION); return 0; }
  if (cmd === 'remote-apps') { for (const l of remoteAppLines()) io.out(l); return 0; }

  if (cmd === 'up') return runUp(rest, io);
  if (cmd === 'data-folder') return runDataFolder(rest, io);
  if (cmd === 'start') return runStart(rest);
  if (cmd === 'stop') return runStop(io);
  if (cmd === 'restart') return runRestart(rest, io);
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
  if (cmd === 'apps') return runApps(rest, io);

  io.out(`Unknown command "${cmd}". Run "workshop help".`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
