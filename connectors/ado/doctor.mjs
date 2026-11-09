#!/usr/bin/env node
// workshop doctor ado: checks the ADO connector from a terminal. Also runs on its own as:
//   node connectors/ado/doctor.mjs [options]
//
//   (no option)      Check each connection and list what a sync finds. Same as ado_helper.py --test.
//   --compare        Run ado_helper.py and the connector against your ADO and print match and mismatch
//                    counts only. Writes nothing.
//   --write-check <id>  Add a tag to one work item you pick and remove it again, to check the PAT can write,
//                    the revision check works, and the comments API answers. Prints plain-word results only.
//   --import         Build connector settings from ado-helper.json and eng-agents config.json and print
//                    them. Add --write to save them into ~/.workshop/config.json.
//
// Never prints a PAT. See connectors/ado/README.md for every option.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ado from './index.mjs';
import { AdoError, SettingsError, clientFor } from './lib/client.mjs';
import { daysLeft, patHint, WARN_DAYS } from './lib/pat.mjs';
import { normalize } from './lib/config.mjs';
import { compareDataset, compareSync } from './lib/compare.mjs';
import { dataset } from './lib/dataset.mjs';
import { importConfig } from './lib/import.mjs';
import { cleanKnown, sync } from './lib/sync.mjs';
import { writeCheck } from './lib/write.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
// Where ado_helper.py used to be: Docket's checkout before Docket 5.4.0 retired it (next to Workshop, or in
// .remote/prioritizer), then the old in-repo path. Today pass --helper with the copy you still run. The copy you run day to day, with its ado-helper.json, is
// usually somewhere else: pass --helper for that one.
export const HELPER_CANDIDATES = [
  path.join(path.dirname(REPO), 'docket', 'ado-helper', 'ado_helper.py'),
  path.join(REPO, '.remote', 'prioritizer', 'ado-helper', 'ado_helper.py'),
  path.join(REPO, 'apps', 'prioritizer', 'ado-helper', 'ado_helper.py')
];
const DEFAULT_HELPER = HELPER_CANDIDATES.find(f => fs.existsSync(f)) || HELPER_CANDIDATES[0];
const HARNESS = path.join(HERE, 'lib', 'helper_harness.py');

const USAGE = `Usage: node connectors/ado/doctor.mjs [options]

  (no option)                Check each connection and list what a sync finds.
  --config <file>            Use connector settings from this JSON file instead of Workshop's config.
  --compare                  Compare ado_helper.py with the connector on your ADO. Prints counts only, writes nothing.
    --helper <file>          the ado_helper.py you run today (default: Docket's copy next to Workshop). Its ado-helper.json is used.
    --python <command>       Python to run it with (default: py -3 on Windows, else python3).
    --known <ids>            Work item IDs to treat as already known, comma separated.
    --areas <a;b>            Area paths for the team dataset, separated by semicolons.
    --people <x;y>           People for the team dataset, separated by semicolons.
    --days <n>               Dataset window in days (default 42).
  --write-check <id>         Add a tag to work item <id> (pick a test item) and remove it again. Checks the PAT can
                             write, ADO refuses a stale revision, and the comments API answers. Uses the connection for
                             my work items. Changes nothing else and prints no titles or names.
  --import                   Print connector settings built from your old configs.
    --helper-config <file>   ado-helper.json (default: next to ado_helper.py in this repo, if present).
    --eng-agents-config <f>  eng-agents config.json (default: ~/.config/eng-agents/config.json, if present).
    --write                  Save them into Workshop's config.json (connectors.ado.config). Does not turn the connector on.
  --help                     Show this.`;

export function parseArgs(argv) {
  const o = { mode: 'test' };
  const takes = new Set(['--config', '--helper', '--python', '--known', '--areas', '--people', '--days', '--helper-config', '--eng-agents-config']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compare') o.mode = 'compare';
    else if (a === '--import') o.mode = 'import';
    else if (a === '--write') o.write = true;
    else if (a === '--write-check') {
      if (i + 1 >= argv.length || !/^\d+$/.test(argv[i + 1])) throw new SettingsError('--write-check needs a work item ID.');
      o.mode = 'write-check';
      o.id = Number(argv[++i]);
    }
    else if (a === '--help' || a === '-h') o.mode = 'help';
    else if (takes.has(a)) {
      if (i + 1 >= argv.length) throw new SettingsError(`${a} needs a value.`);
      o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else throw new SettingsError(`Unknown option ${a}. Run with --help.`);
  }
  return o;
}

export function workshopHome(env = process.env) {
  return env.WORKSHOP_HOME || path.join(os.homedir(), '.workshop');
}

function readJson(file, what) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw new SettingsError(`No ${what} at ${file}.`);
    throw new SettingsError(`Could not read ${what} at ${file}: ${e.message}`);
  }
}

function connectorConfig(o, env) {
  if (o.config) return readJson(path.resolve(o.config), 'settings file');
  const file = path.join(workshopHome(env), 'config.json');
  const cfg = readJson(file, 'Workshop config');
  const c = cfg.connectors?.ado?.config;
  if (!c) throw new SettingsError(`Workshop's config has no ADO settings yet. Run: node connectors/ado/doctor.mjs --import --write`);
  return c;
}

// ---------------------------------------------------------------- test (like ado_helper.py --test)

async function runTest(o, io) {
  const { config: cfg, problems } = normalize(connectorConfig(o, io.env));
  for (const p of problems) io.out(`Problem: ${p}`);
  if (!cfg.connections.length) return 1;
  const env = name => io.env[name];
  let failed = problems.length > 0;
  io.out(`Workshop ADO connector ${ado.version}\n\nConnections:`);
  for (const c of cfg.connections) {
    const set = Boolean(String(io.env[c.patEnv] || '').trim());
    io.out(`  ${c.name.padEnd(12)} ${c.base}   PAT from ${c.patEnv} (${set ? 'set' : 'NOT SET'})`);
    if (!set) { io.out(`  ${''.padEnd(12)} ${patHint(c.patEnv)}`); failed = true; continue; }
    try {
      const res = await clientFor(c, env).call('GET', 'connectionData', { api: '1.0' });
      io.out(`  ${''.padEnd(12)} ${res?.authenticatedUser?.id ? 'Connected.' : 'Answered, but did not say who you are.'}`);
    } catch (e) {
      if (!(e instanceof AdoError || e instanceof SettingsError)) throw e;
      io.out(`  ${''.padEnd(12)} ${e.message}`);
      failed = true;
    }
    const days = daysLeft(c.patExpires);
    if (days === null) io.out(`  ${''.padEnd(12)} No "PAT expires" date in Settings, so Workshop cannot warn before it expires.`);
    else if (days < 0) { io.out(`  ${''.padEnd(12)} PAT expired on ${c.patExpires} (by the date in Settings).`); failed = true; }
    else io.out(`  ${''.padEnd(12)} PAT expires ${c.patExpires} (${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`})${days <= WARN_DAYS ? '. Make a new one soon.' : '.'}`);
  }
  const r = await sync({ cfg, env }, cleanKnown((o.known || '').split(',')), []);
  io.out(`\nConnected. ${r.items.length} open work items assigned to you:`);
  for (const it of r.items.slice(0, 15)) io.out(`  #${it.id}  ${String(it.type).padEnd(11)} ${String(it.state).padEnd(10)} ${it.title}`);
  if (!cfg.prSources.length) io.out('\nNo PR sources set. Add one in Settings, on the Repos tab.');
  else if (r.prError) { io.out('\nPull requests failed: ' + r.prError); failed = true; }
  else {
    const prs = r.prs.items;
    io.out(`\n${prs.length} pull requests waiting on you:`);
    const rank = { blocking: 0, asked: 1, pool: 2 };
    for (const p of [...prs].sort((a, b) => rank[a.tier] - rank[b.tier] || String(a.created || '').localeCompare(String(b.created || '')))) {
      const tag = p.waiting ? 'waiting' : p.tier + (p.lastBlocker ? ' (last one)' : '');
      io.out(`  PR ${String(p.id).padEnd(6)} ${tag.padEnd(20)} ${p.repo}: ${p.title}`);
    }
    if (r.prs.notNeeded) io.out(`  ${r.prs.notNeeded} more did not need you (Settings, Pull requests, PRs that don't need you).`);
    for (const n of r.prs.notes) io.out('  Note: ' + n);
  }
  return failed ? 1 : 0;
}

// ---------------------------------------------------------------- compare (counts only)

function pythonCommand(o) {
  if (o.python) {
    const parts = o.python.split(' ').filter(Boolean);
    return { cmd: parts[0], args: parts.slice(1) };
  }
  return process.platform === 'win32' ? { cmd: 'py', args: ['-3'] } : { cmd: 'python3', args: [] };
}

function runHarness(python, request, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(python.cmd, [...python.args, '-B', HARNESS], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', () => {}); // may hold helper details; not printed
    child.on('error', () => reject(new SettingsError(`Could not start ${python.cmd}. Pass --python with your Python 3 command.`)));
    child.on('close', code => {
      if (code !== 0) return reject(new SettingsError(`The helper did not finish (exit code ${code}). Check that ${python.cmd} runs Python 3.8 or later.`));
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8')).results); } catch { reject(new SettingsError('The helper printed something that is not JSON.')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

const split = s => String(s || '').split(';').map(x => x.trim()).filter(Boolean);

async function runCompare(o, io) {
  const helperPy = path.resolve(o.helper || DEFAULT_HELPER);
  if (!fs.existsSync(helperPy)) throw new SettingsError(`No ado_helper.py at ${helperPy}. Pass --helper <the ado_helper.py you run today>; its ado-helper.json must be next to it.`);
  const helperCfgFile = path.join(path.dirname(helperPy), 'ado-helper.json');
  if (!fs.existsSync(helperCfgFile)) throw new SettingsError(`There is no ado-helper.json next to ${helperPy}. Pass --helper <the ado_helper.py you run today>: the one in the folder where you first ran it, which has your ado-helper.json.`);
  const helperCfg = readJson(helperCfgFile, 'ado-helper.json');
  const { config: cfg } = normalize(importConfig({ helper: helperCfg }).config);
  const known = cleanKnown(String(o.known || '').split(',').filter(Boolean));
  const req = { areas: split(o.areas), people: split(o.people), days: o.days ? Number(o.days) : 42 };
  const wantDataset = req.areas.length > 0 || req.people.length > 0;
  const calls = [{ fn: 'sync', known, knownPrs: [] }, ...(wantDataset ? [{ fn: 'dataset', req }] : [])];

  io.out('Comparing ado_helper.py with the Workshop ADO connector. Counts only; nothing is written.');
  const helper = await runHarness(pythonCommand(o), { helper: helperPy, config: null, calls }, io.env);
  const env = name => io.env[name];
  const d = { cfg, env };
  const mine = [];
  for (const c of calls) {
    try {
      mine.push({ ok: c.fn === 'sync' ? await sync(d, c.known, c.knownPrs) : await dataset(d, c.req) });
    } catch (e) {
      if (!(e instanceof AdoError || e instanceof SettingsError)) throw e;
      mine.push({ error: e.message });
    }
  }
  const reports = [compareSync(helper[0], mine[0])];
  if (wantDataset) reports.push(compareDataset(helper[1], mine[1]));
  else io.out('Dataset: skipped (pass --areas or --people to include it)');
  for (const r of reports) for (const l of r.lines) io.out(l);
  const allOk = reports.every(r => r.ok);
  io.out(allOk ? 'Result: everything matches.' : 'Result: differences found.');
  return allOk ? 0 : 1;
}

// ---------------------------------------------------------------- write check (Runway's Publish)

async function runWriteCheck(o, io) {
  const { config: cfg, problems } = normalize(connectorConfig(o, io.env));
  for (const p of problems) io.out(`Problem: ${p}`);
  if (!cfg.connections.length) return 1;
  io.out(`Checking writes on work item ${o.id}. A tag "workshop-write-check" is added and then removed.`);
  const r = await writeCheck({ cfg, env: name => io.env[name] }, o.id);
  io.out(`Connection: ${r.connection}`);
  for (const s of r.steps) io.out(`  ${s}`);
  const bad = r.steps.some(s => s.startsWith('Problem') || s.includes('did not answer'));
  io.out(bad ? 'Result: problems found.' : 'Result: writes work.');
  return bad ? 1 : 0;
}

// ---------------------------------------------------------------- import

async function runImport(o, io) {
  const helperFile = o.helperConfig ? path.resolve(o.helperConfig) : path.join(path.dirname(DEFAULT_HELPER), 'ado-helper.json');
  const home = io.env.USERPROFILE || io.env.HOME || os.homedir();
  const engFile = o.engAgentsConfig ? path.resolve(o.engAgentsConfig) : path.join(home, '.config', 'eng-agents', 'config.json');
  const helper = o.helperConfig || fs.existsSync(helperFile) ? readJson(helperFile, 'ado-helper.json') : undefined;
  const engAgents = o.engAgentsConfig || fs.existsSync(engFile) ? readJson(engFile, 'eng-agents config') : undefined;
  if (!helper && !engAgents) throw new SettingsError('Found neither ado-helper.json nor eng-agents config.json. Pass --helper-config or --eng-agents-config.');
  const cfgFile = path.join(workshopHome(io.env), 'config.json');
  const whole = fs.existsSync(cfgFile) ? readJson(cfgFile, 'Workshop config') : null;
  const current = whole?.connectors?.ado?.config;
  const { config, notes } = importConfig({ helper, engAgents, current });
  io.out(`Read: ${[helper && helperFile, engAgents && engFile].filter(Boolean).join(', ')}`);
  for (const n of notes) io.out(`Note: ${n}`);
  const { problems } = normalize(config);
  for (const p of problems) io.out(`Problem: ${p}`);
  io.out(JSON.stringify(config, null, 2));
  if (!o.write) {
    io.out('\nNothing was saved. Add --write to save these settings into ' + cfgFile);
    return problems.length ? 1 : 0;
  }
  if (problems.length) throw new SettingsError('Not saved: fix the problems above first.');
  const next = whole || { configVersion: 1, port: 4380, allowedOrigins: [], features: { startAtLogin: false, hostedMode: false }, connectors: {} };
  next.connectors = next.connectors || {};
  next.connectors.ado = { enabled: next.connectors.ado?.enabled === true, ...next.connectors.ado, config };
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile + '.tmp', JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(cfgFile + '.tmp', cfgFile);
  io.out(`\nSaved to ${cfgFile}.${next.connectors.ado.enabled ? '' : ' Turn on the ADO connector in Settings to use it.'}`);
  return 0;
}

// ---------------------------------------------------------------- main

export async function main(argv, io = { out: s => console.log(s), env: process.env }) {
  try {
    const o = parseArgs(argv);
    if (o.mode === 'help') { io.out(USAGE); return 0; }
    if (o.mode === 'compare') return await runCompare(o, io);
    if (o.mode === 'import') return await runImport(o, io);
    if (o.mode === 'write-check') return await runWriteCheck(o, io);
    return await runTest(o, io);
  } catch (e) {
    if (e instanceof AdoError || e instanceof SettingsError) {
      io.out('\n' + e.message);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
