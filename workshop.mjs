#!/usr/bin/env node
// The `workshop` command: one entry point for running and looking after the local agent.
//
//   workshop start [--port n] [--quiet]   Start the agent (same as node agent/start.mjs).
//   workshop install [--login]            First run: create ~/.workshop. --login also turns on start at login.
//   workshop uninstall                     Turn off start at login. Leaves your data folder (dataDir) and ~/.workshop in place.
//   workshop doctor                        Check Node, config.json, the port, the data folder, start at login and hosted mode.
//   workshop doctor ado [options]          Check the ADO connector (wraps connectors/ado/doctor.mjs).
//   workshop publish [--out <dir>]         Build the static site (hosted or browser mode) with apps/registry.json.
//   workshop update                        Update this checkout (git pull) and show the version. Other installs: how to update.
//   workshop version                       Print the agent version.
//   workshop help                          This help.
//
// Node 22 or later, standard library only, no npm install. See docs/security.md.
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './agent/version.mjs';
import { SchemaSet } from './agent/lib/schema.mjs';
import { resolveHome, homePaths, defaultConfig, DEFAULT_PORT } from './agent/lib/home.mjs';
import { writeJsonAtomic } from './agent/lib/fsutil.mjs';
import { dataDirProblem, defaultDataDir } from './agent/lib/datadir.mjs';
import { enableStartAtLogin, disableStartAtLogin, startAtLoginStatus } from './agent/lib/login.mjs';
import { main as adoDoctorMain } from './connectors/ado/doctor.mjs';

export const REPO = path.dirname(fileURLToPath(import.meta.url));
const SERVED_DIRS = ['shell', 'shared', 'icons', 'apps'];
const SERVED_FILES = ['index.html', 'manifest.webmanifest', 'sw.js'];

const USAGE = `Usage: workshop <command> [options]

  start [--port <n>] [--quiet]   Start the agent, print the address to open.
  install [--login]              Create ~/.workshop. --login also turns on start at login (no admin).
  uninstall                      Turn off start at login. Leaves your data folder (dataDir, default ~/Workshop)
                                 and ~/.workshop in place.
  doctor                         Check Node, config.json, the port, the data folder, start at login and hosted mode.
  doctor ado [options]           Check the ADO connector. Run "workshop doctor ado --help" for its options.
  publish [--out <dir>]          Build the static site for hosted or browser mode (default out: dist/).
  update                         Update this checkout (git pull) and print the version.
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
export async function doctorReport({ home = resolveHome(), env = process.env, platform = process.platform, nodeVersion = process.version, probe = agentHealth, defaultDir = defaultDataDir() } = {}) {
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

  const hosted = info.config?.features?.hostedMode === true;
  const origins = info.config?.allowedOrigins || [];
  lines.push(`Hosted mode: ${hosted ? 'on' : 'off'}; allowed origins: ${origins.length ? origins.join(', ') : 'none'}.`);
  if (hosted && origins.length === 0) lines.push('  Hosted mode is on but no origins are allowed, so no hosted page can pair. Add one in Settings.');

  const enabled = Object.entries(info.config?.connectors || {}).filter(([, c]) => c && c.enabled === true).map(([id]) => id);
  lines.push(`Connectors on: ${enabled.length ? enabled.join(', ') : 'none'}.`);

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
  if (opts.login !== true) {
    io.out('Start at login is off. Turn it on in Settings, or run "workshop install --login".');
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
    `Current version: ${VERSION}.`
  ];
}

function runUpdate(io) {
  if (!fs.existsSync(path.join(REPO, '.git'))) {
    for (const l of manualUpdateLines()) io.out(l);
    return Promise.resolve(0);
  }
  return new Promise(resolve => {
    const child = spawn('git', ['-C', REPO, 'pull', '--ff-only'], { stdio: 'inherit' });
    child.on('error', () => { io.out('Could not run git. Update by hand: git pull.'); resolve(1); });
    child.on('exit', code => { io.out(`Current version: ${VERSION}.`); resolve(code ?? 0); });
  });
}

// --------------------------------------------------------------- command line

export async function main(argv, io = { out: s => console.log(s), env: process.env }) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { io.out(USAGE); return 0; }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') { io.out(VERSION); return 0; }

  if (cmd === 'start') return runStart(rest);

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
      return adoDoctorMain(adoArgs, io);
    }
    const { lines, code } = await doctorReport({ env: io.env });
    for (const l of lines) io.out(l);
    return code;
  }

  if (cmd === 'install') return runInstall({ login: rest.includes('--login') }, io);
  if (cmd === 'uninstall') return runUninstall(io);

  if (cmd === 'publish') {
    const i = rest.indexOf('--out');
    const outDir = i >= 0 ? rest[i + 1] : undefined;
    if (i >= 0 && !outDir) { io.out('--out needs a folder.'); return 1; }
    const r = publish({ outDir });
    io.out(`Built the static site in ${r.out}: ${r.copied.join(', ')}. apps/registry.json lists ${r.apps} app(s).`);
    io.out('Publish that folder to your static host (for example GitHub Pages with Cloudflare DNS), then add its origin to allowedOrigins and turn on hosted mode in Settings.');
    return 0;
  }

  if (cmd === 'update') return runUpdate(io);

  io.out(`Unknown command "${cmd}". Run "workshop help".`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
