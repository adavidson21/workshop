// opencode connector: open a terminal window the person can see, running one command (opencode connector 1.37.0). Used by
// Open in terminal (the opencode TUI on a chat or work item) and Bench's runs.
//
// Windows: before 1.37.0 this spawned powershell.exe with Node's `detached: true`. On Windows that sets
// DETACHED_PROCESS, so PowerShell started with no console at all: no window opened and the button did nothing.
// Node has no option for CREATE_NEW_CONSOLE, so cmd.exe's `start` opens the window instead (it always gives a console
// program a new console). The command line is fixed text plus the PowerShell command in double quotes, built from
// single-quoted parts (terminalCommand); cmd reads `"` and `%` inside double quotes, so a part with either is refused
// (the person copies the command instead). tests/console-window.win.mjs checks a real window opens, on a Windows
// runner in CI.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** The cmd.exe arguments that open a new console window running PowerShell with `command` (a -Command string). */
export function windowsArgs(command, title = "opencode") {
  if (/["%\r\n]/.test(command) || /["%]/.test(title)) throw fail(400, "That command has a character cmd.exe cannot pass on (\" or %). Copy the command instead.");
  // /d skips AutoRun, /s keeps the rest of the line as is after the outer quotes go. start's first quoted argument
  // is the window title. -NoExit keeps the window open after the command ends, so its output can be read.
  return ["/d", "/s", "/c", `"start "${title}" powershell.exe -NoLogo -NoExit -Command "${command}""`];
}

/** A Linux terminal on PATH, with how it takes a command: [exe, args before the command]. */
export function linuxTerminal(env = process.env, exists = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) {
  const dirs = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  const which = (n) => dirs.map((d) => path.join(d, n)).find(exists);
  for (const [name, pre] of [["x-terminal-emulator", ["-e"]], ["gnome-terminal", ["--"]], ["konsole", ["-e"]], ["xfce4-terminal", ["-x"]], ["kitty", []], ["alacritty", ["-e"]], ["xterm", ["-e"]]]) {
    const exe = which(name);
    if (exe) return [exe, pre];
  }
  return null;
}

/**
 * Open a window in `cwd` running a command. `ps` is the PowerShell command (Windows); `sh` the sh command (macOS and
 * Linux). Resolves {ok: true} once the window's process started.
 */
export function openConsole({ cwd, ps, sh, title = "opencode", platform = process.platform, run = spawn, env = process.env, terminal = linuxTerminal }) {
  let exe, argv, opts = { cwd, stdio: "ignore", detached: true };
  try {
    if (platform === "win32") {
      exe = env.ComSpec || "cmd.exe";
      argv = windowsArgs(ps, title);
      // detached keeps cmd from holding Workshop's own console; start opens the visible window for PowerShell.
      // windowsHide hides only cmd's own (it exits at once), never the window start opens.
      opts = { ...opts, windowsHide: true, windowsVerbatimArguments: true };
    } else if (platform === "darwin") {
      const line = `cd ${shq(cwd)} && ${sh}`;
      exe = "osascript";
      argv = ["-e", `tell application "Terminal" to do script "${line.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\ntell application "Terminal" to activate`];
    } else {
      const t = terminal(env);
      if (!t) return Promise.reject(fail(501, "No terminal program found (x-terminal-emulator, gnome-terminal, konsole, xterm). Copy the command instead."));
      exe = t[0];
      argv = [...t[1], "sh", "-c", `${sh}; exec "\${SHELL:-sh}"`];
    }
  } catch (e) {
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    const failed = (err) => reject(fail(500, `Could not open a terminal (${err.message}). Copy the command instead.`));
    let child;
    try {
      child = run(exe, argv, opts);
    } catch (err) {
      failed(err);
      return;
    }
    child.once("error", failed);
    child.once("spawn", () => {
      if (child.unref) child.unref();
      resolve({ ok: true });
    });
  });
}
