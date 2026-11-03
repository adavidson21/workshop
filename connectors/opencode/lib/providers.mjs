// Which AI providers opencode can use, checked against the opencode connector's approvedProviders, for
// `workshop doctor` (connectors/opencode/README.md, Approved AI providers). Reads opencode's config files
// and saved credentials; never prints a key, a URL or anything else from them, only provider ids.
//
// opencode merges its config from these places, later ones winning (opencode's config docs):
//   ~/.config/opencode/opencode.json[c]           global (XDG_CONFIG_HOME if set)
//   OPENCODE_CONFIG                                a file named by this variable
//   <workspace>/opencode.json[c]                   the project (Workshop's workspace folder, where opencode runs)
//   <workspace>/.opencode/opencode.json[c]
//   OPENCODE_CONFIG_CONTENT                        inline JSON in this variable
//   managed folder (admin): /etc/opencode, /Library/Application Support/opencode, %ProgramData%\opencode
// Saved logins: ~/.local/share/opencode/auth.json (XDG_DATA_HOME if set; on Windows also %LOCALAPPDATA%\opencode).
//
// enabled_providers is what actually limits opencode: when it is set, every other provider is ignored, even
// one with an API key in an environment variable. So the check fails unless it is set and lists only
// approved providers, and the models opencode is told to use come from approved providers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Remove // and /* *\/ comments and trailing commas from JSONC, leaving strings alone. */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  let str = false;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (str) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === '"') str = false;
      i++;
      continue;
    }
    if (c === '"') { str = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const expandHome = (p, home) => (p === '~' ? home : p.startsWith('~/') || p.startsWith('~\\') ? path.join(home, p.slice(2)) : p);

/** The config sources opencode reads, in merge order (later wins). Each is {label, file?, text?}. */
export function configSources({ workspace, env = process.env, platform = process.platform, home = os.homedir() }) {
  const out = [];
  const both = (dir, label) => {
    for (const name of ['opencode.json', 'opencode.jsonc']) out.push({ label: `${label}${name}`, file: path.join(dir, name) });
  };
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, '.config');
  both(path.join(xdgConfig, 'opencode'), path.join(xdgConfig, 'opencode') + path.sep);
  if (platform === 'win32' && env.APPDATA) both(path.join(env.APPDATA, 'opencode'), path.join(env.APPDATA, 'opencode') + path.sep);
  if (env.OPENCODE_CONFIG) out.push({ label: 'OPENCODE_CONFIG', file: expandHome(env.OPENCODE_CONFIG, home) });
  if (workspace) {
    const ws = path.resolve(expandHome(workspace, home));
    both(ws, ws + path.sep);
    both(path.join(ws, '.opencode'), path.join(ws, '.opencode') + path.sep);
  }
  if (env.OPENCODE_CONFIG_CONTENT) out.push({ label: 'OPENCODE_CONFIG_CONTENT', text: env.OPENCODE_CONFIG_CONTENT });
  const managed = platform === 'win32' ? (env.ProgramData || env.PROGRAMDATA ? path.join(env.ProgramData || env.PROGRAMDATA, 'opencode') : null)
    : platform === 'darwin' ? '/Library/Application Support/opencode' : '/etc/opencode';
  if (managed) both(managed, managed + path.sep);
  return out;
}

/** Saved login files opencode may have. */
export function authFiles({ env = process.env, platform = process.platform, home = os.homedir() }) {
  const out = [path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode', 'auth.json')];
  if (platform === 'win32' && env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, 'opencode', 'auth.json'));
  return out;
}

const providerOf = model => (typeof model === 'string' && model.includes('/') ? model.split('/')[0] : null);
const ids = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : null);

/**
 * Check opencode's providers. Returns {state, lines, sources}: state is 'skipped' (nothing to check
 * against), 'ok' or 'bad'. Lines are plain words with provider ids only.
 */
export function checkProviders({ approved, workspace, env = process.env, platform = process.platform, home = os.homedir(), readFile = f => fs.readFileSync(f, 'utf8') }) {
  const allow = new Set((approved || []).filter(Boolean));
  if (!allow.size) return { state: 'skipped', lines: ['opencode providers: not checked. Set "Approved AI providers" in the opencode connector\'s settings to have doctor check them.'], sources: [] };
  const lines = [];
  const found = [];
  const unreadable = [];
  let enabled = null;
  let enabledFrom = null;
  const disabled = new Set();
  const models = []; // [where, provider]
  const configured = new Set();
  for (const src of configSources({ workspace, env, platform, home })) {
    let text = src.text;
    if (text === undefined) {
      try { text = readFile(src.file); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') unreadable.push(src.label); continue; }
    }
    let cfg;
    try { cfg = JSON.parse(stripJsonc(String(text).replace(/^﻿/, ''))); } catch { unreadable.push(src.label); continue; }
    if (!cfg || typeof cfg !== 'object') continue;
    found.push(src.label);
    if (ids(cfg.enabled_providers)) { enabled = ids(cfg.enabled_providers); enabledFrom = src.label; }
    for (const p of ids(cfg.disabled_providers) || []) disabled.add(p);
    for (const key of ['model', 'small_model']) { const p = providerOf(cfg[key]); if (p) models.push([`${key} in ${src.label}`, p]); }
    for (const [name, a] of Object.entries(cfg.agent && typeof cfg.agent === 'object' ? cfg.agent : {})) {
      const p = providerOf(a && a.model);
      if (p) models.push([`agent ${name} in ${src.label}`, p]);
    }
    for (const p of Object.keys(cfg.provider && typeof cfg.provider === 'object' ? cfg.provider : {})) configured.add(p);
  }
  const logins = new Set();
  for (const f of authFiles({ env, platform, home })) {
    let text;
    try { text = readFile(f); } catch { continue; }
    try { for (const p of Object.keys(JSON.parse(text) || {})) logins.add(p); } catch { unreadable.push(f); }
  }

  const list = s => [...s].sort().join(', ');
  let bad = false;
  lines.push(`opencode providers: approved ${list(allow)}.`);
  if (!enabled) {
    bad = true;
    lines.push(`  enabled_providers is not set, so opencode can use any provider it finds (a saved login or an API key in an environment variable). Add "enabled_providers": ${JSON.stringify([...allow].sort())} to your global opencode config (${path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode', 'opencode.json')}).`);
  } else {
    const extra = enabled.filter(p => !allow.has(p) && !disabled.has(p));
    if (extra.length) { bad = true; lines.push(`  enabled_providers (${enabledFrom}) lists providers that are not approved: ${extra.sort().join(', ')}.`); }
    else lines.push(`  enabled_providers (${enabledFrom}) lists only approved providers.`);
  }
  for (const [where, p] of models) {
    if (!allow.has(p)) { bad = true; lines.push(`  ${where} uses ${p}, which is not approved.`); }
  }
  const effective = p => !disabled.has(p) && (enabled ? enabled.includes(p) : true);
  const strayLogins = [...logins].filter(p => !allow.has(p));
  const strayConfigured = [...configured].filter(p => !allow.has(p));
  if (strayLogins.length) {
    const live = strayLogins.filter(effective);
    if (live.length) bad = true;
    lines.push(`  Saved logins for providers that are not approved: ${strayLogins.sort().join(', ')}${live.length ? '' : ' (blocked by enabled_providers)'}. Remove them with: opencode auth logout`);
  }
  if (strayConfigured.length) {
    const live = strayConfigured.filter(effective);
    if (live.length) bad = true;
    lines.push(`  Provider settings for providers that are not approved: ${strayConfigured.sort().join(', ')}${live.length ? '' : ' (blocked by enabled_providers)'}.`);
  }
  if (unreadable.length) { bad = true; lines.push(`  Could not read: ${unreadable.join(', ')}. Fix or remove them, then run this again.`); }
  if (!found.length && !logins.size) lines.push('  No opencode config or saved logins were found.');
  return { state: bad ? 'bad' : 'ok', lines, sources: found };
}
