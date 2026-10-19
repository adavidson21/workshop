// Start at login (docs/config.md, features.startAtLogin; docs/security.md). Per user, no admin rights, and
// off until the user turns it on. One small launcher file per platform, written into the place the OS runs
// at login:
//   Windows   the Startup folder          a .cmd that runs the agent minimized
//   macOS     ~/Library/LaunchAgents       a LaunchAgent plist, RunAtLoad
//   Linux     ~/.config/autostart          a .desktop entry
// The launcher runs this computer's Node on agent/start.mjs. Nothing here starts a process or reaches the
// network: it only writes or removes that one file, so the agent's "no outbound requests" rule holds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileAtomic } from './fsutil.mjs';

// The fixed launcher name per platform. Fixed so we only ever touch our own file, never the user's others.
const WIN_FILE = 'Workshop.cmd';
const MAC_LABEL = 'org.workshop.agent';
const MAC_FILE = `${MAC_LABEL}.plist`;
const LINUX_FILE = 'workshop.desktop';

/** Where the login launcher goes on this platform. `dir` overrides the computed folder (used by tests). */
export function loginItem({ platform = process.platform, env = process.env, home = os.homedir(), dir } = {}) {
  if (platform === 'win32') {
    const base = dir || path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    return { kind: 'cmd', dir: base, path: path.join(base, WIN_FILE) };
  }
  if (platform === 'darwin') {
    const base = dir || path.join(home, 'Library', 'LaunchAgents');
    return { kind: 'launchagent', dir: base, path: path.join(base, MAC_FILE) };
  }
  if (platform === 'linux') {
    const base = dir || path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'autostart');
    return { kind: 'desktop', dir: base, path: path.join(base, LINUX_FILE) };
  }
  return { kind: 'unsupported', dir: null, path: null };
}

const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** The launcher file contents for a platform, running `execPath startScript --quiet`. */
export function loginContent({ kind, execPath, startScript }) {
  if (kind === 'cmd') {
    // Minimized so it does not steal focus. The agent keeps running until the user signs out.
    return `@echo off\r\nstart "Workshop" /min "${execPath}" "${startScript}" --quiet\r\n`;
  }
  if (kind === 'launchagent') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(execPath)}</string>
    <string>${xml(startScript)}</string>
    <string>--quiet</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
  }
  if (kind === 'desktop') {
    return `[Desktop Entry]
Type=Application
Name=Workshop
Comment=Start the Workshop agent at login
Exec="${execPath}" "${startScript}" --quiet
Terminal=false
X-GNOME-Autostart-enabled=true
`;
  }
  throw new Error(`Start at login is not supported on ${process.platform}.`);
}

function resolved(opts) {
  const item = loginItem(opts);
  if (item.kind === 'unsupported') throw new Error(`Start at login is not supported on ${opts.platform || process.platform}.`);
  const repo = opts.repo;
  if (!repo) throw new Error('enable/disable start at login needs the repo path.');
  const startScript = opts.startScript || path.join(repo, 'agent', 'start.mjs');
  const execPath = opts.execPath || process.execPath;
  return { item, startScript, execPath };
}

/** Create the login launcher so the agent starts at the next login. Returns { path, kind }. */
export async function enableStartAtLogin(opts) {
  const { item, startScript, execPath } = resolved(opts);
  const content = loginContent({ kind: item.kind, execPath, startScript });
  await writeFileAtomic(item.path, content);
  return { path: item.path, kind: item.kind };
}

/** Remove the login launcher if it is there. Returns { removed, path }. */
export async function disableStartAtLogin(opts) {
  const item = loginItem(opts);
  if (item.kind === 'unsupported') return { removed: false, path: null };
  let removed = false;
  try { fs.rmSync(item.path, { force: false }); removed = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { removed, path: item.path };
}

/** Is the login launcher present? Returns { installed, path, kind }. */
export function startAtLoginStatus(opts = {}) {
  const item = loginItem(opts);
  if (item.kind === 'unsupported') return { installed: false, path: null, kind: 'unsupported' };
  return { installed: fs.existsSync(item.path), path: item.path, kind: item.kind };
}

/**
 * Make the login launcher match `on`: create it when true, remove it when false. Best effort by design, so
 * the caller (the agent on a config change) never fails a request because a startup folder could not be
 * written. Returns { ok, action, path, error }.
 */
export async function applyStartAtLogin(on, opts) {
  try {
    if (on) { const r = await enableStartAtLogin(opts); return { ok: true, action: 'enabled', path: r.path }; }
    const r = await disableStartAtLogin(opts); return { ok: true, action: r.removed ? 'removed' : 'absent', path: r.path };
  } catch (e) {
    return { ok: false, action: on ? 'enable' : 'disable', path: null, error: e.message };
  }
}
