// Settings' Update button: opens a terminal window you can see, running "workshop update --restart".
//
// The agent still runs no git and makes no request itself (docs/security.md): the update runs in that window, in
// front of you, exactly as if you had typed it. The command is fixed (this Node, this checkout's workshop.mjs), so
// nothing a page sends ends up in it. Windows and macOS only; elsewhere Settings shows the command to copy.

import { spawn } from 'node:child_process';
import path from 'node:path';

/** The command the window runs: [node, <repo>/workshop.mjs, update, --restart]. */
export const updateArgv = ({ execPath, repo }) => [execPath, path.join(repo, 'workshop.mjs'), 'update', '--restart'];

/** PowerShell: & 'node' 'C:\...\workshop.mjs' 'update' '--restart' (each part single-quoted). */
export const powershellCommand = argv => ['&', ...argv.map(s => `'${String(s).replace(/'/g, "''")}'`)].join(' ');

/** AppleScript that opens Terminal on the command (each part single-quoted for the shell). */
export function terminalScript(argv) {
  const sh = argv.map(s => `'${String(s).replace(/'/g, "'\\''")}'`).join(' ');
  return `tell application "Terminal" to do script "${sh.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\ntell application "Terminal" to activate`;
}

/**
 * Opens the window. Resolves {ok: true}, or rejects with {status, message} when this computer cannot open one
 * (501 off Windows and macOS) or the launch failed (500). A detached child gets its own window and outlives the
 * agent, which the update restarts. No -EncodedCommand and no hidden launcher: endpoint security tools often block both.
 */
export function openUpdateTerminal({ execPath = process.execPath, repo, platform = process.platform, run = spawn } = {}) {
  const argv = updateArgv({ execPath, repo });
  let exe, args;
  if (platform === 'win32') { exe = 'powershell.exe'; args = ['-NoLogo', '-NoExit', '-Command', powershellCommand(argv)]; }
  else if (platform === 'darwin') { exe = 'osascript'; args = ['-e', terminalScript(argv)]; }
  else return Promise.reject({ status: 501, message: 'Opening a terminal works on Windows and macOS. Copy the command instead.' });
  return new Promise((resolve, reject) => {
    let child;
    const failed = e => reject({ status: 500, message: `Could not open a terminal (${e.message}). Copy the command instead.` });
    try { child = run(exe, args, { cwd: repo, detached: true, stdio: 'ignore', windowsHide: false }); } catch (e) { failed(e); return; }
    child.once('error', failed);
    child.once('spawn', () => { child.unref(); resolve({ ok: true }); });
  });
}
