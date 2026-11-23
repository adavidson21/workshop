// lib/console-window.mjs: the window Open in terminal and Bench open (1.37.0). A real window on Windows is checked by
// tests/console-window.win.mjs on a Windows runner in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { linuxTerminal, openConsole, windowsArgs } from "../lib/console-window.mjs";

const fake = (calls) => (exe, argv, o) => { calls.push({ exe, argv, o }); const c = new EventEmitter(); c.unref = () => {}; setImmediate(() => c.emit("spawn")); return c; };

test("Windows: cmd.exe start opens the window, with the PowerShell command in double quotes", async () => {
  const calls = [];
  const r = await openConsole({ cwd: "C:\\w", ps: "& 'opencode' 'attach' 'http://127.0.0.1:4096'", sh: "", platform: "win32", run: fake(calls), env: {} });
  assert.equal(r.ok, true);
  assert.equal(calls[0].exe, "cmd.exe");
  assert.deepEqual(calls[0].argv, ["/d", "/s", "/c", `"start "opencode" powershell.exe -NoLogo -NoExit -Command "& 'opencode' 'attach' 'http://127.0.0.1:4096'""`]);
  assert.equal(calls[0].o.cwd, "C:\\w");
  assert.equal(calls[0].o.windowsVerbatimArguments, true);
  assert.equal(calls[0].o.detached, true);
});

test("Windows: a \" or % in the command is refused before anything runs", async () => {
  assert.throws(() => windowsArgs("echo 100%"), (e) => e.status === 400);
  assert.throws(() => windowsArgs('echo "x"'), (e) => e.status === 400);
  const calls = [];
  await assert.rejects(openConsole({ cwd: "C:\\w", ps: "& 'C:\\%TEMP%\\opencode'", sh: "", platform: "win32", run: fake(calls), env: {} }), (e) => e.status === 400);
  assert.equal(calls.length, 0);
});

test("a program that cannot start gives a 500 that says to copy the command", async () => {
  await assert.rejects(openConsole({ cwd: "/w", ps: "x", sh: "x", platform: "win32", run: () => { throw new Error("blocked"); }, env: {} }), (e) => e.status === 500 && /Copy the command/.test(e.message));
  const failing = () => { const c = new EventEmitter(); setImmediate(() => c.emit("error", new Error("ENOENT"))); return c; };
  await assert.rejects(openConsole({ cwd: "/w", ps: "x", sh: "x", platform: "darwin", run: failing }), (e) => e.status === 500);
});

test("macOS: Terminal runs the command in the folder", async () => {
  const calls = [];
  await openConsole({ cwd: "/Users/me/my work", ps: "", sh: "'opencode' 'attach' 'http://x'", platform: "darwin", run: fake(calls) });
  assert.equal(calls[0].exe, "osascript");
  assert.match(calls[0].argv[1], /do script "cd '\/Users\/me\/my work' && 'opencode' 'attach' 'http:\/\/x'"/);
});

test("Linux: the first terminal on PATH, or a 501", async () => {
  const exists = (f) => f === path.join("/usr/bin", "gnome-terminal") || f === path.join("/usr/bin", "xterm");
  assert.deepEqual(linuxTerminal({ PATH: ["/usr/local/bin", "/usr/bin"].join(path.delimiter) }, exists), [path.join("/usr/bin", "gnome-terminal"), ["--"]]);
  assert.equal(linuxTerminal({ PATH: "/nothing" }, () => false), null);
  const calls = [];
  await openConsole({ cwd: "/w", ps: "", sh: "'opencode'", platform: "linux", run: fake(calls), terminal: () => ["/usr/bin/xterm", ["-e"]] });
  assert.deepEqual(calls[0].argv.slice(0, 3), ["-e", "sh", "-c"]);
  await assert.rejects(openConsole({ cwd: "/w", ps: "", sh: "x", platform: "linux", run: fake([]), terminal: () => null }), (e) => e.status === 501);
});
