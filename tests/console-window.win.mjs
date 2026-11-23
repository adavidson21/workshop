// Open in terminal on a real Windows computer (CI's windows-latest runner): openConsole must open a new console
// window that runs the command in the workspace. Before opencode connector 1.37.0 a detached powershell.exe got no
// console at all, so nothing opened. This runs the same quoted command Open in terminal builds, against a stand-in
// opencode.cmd in a folder whose path has a space and an apostrophe.
//
//   node tests/console-window.win.mjs
//
// Exit 1 if any check fails. Windows only (prints "skipped" elsewhere).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { openConsole } from "../connectors/opencode/lib/console-window.mjs";
import { terminalCommand } from "../connectors/opencode/lib/actions.mjs";

if (process.platform !== "win32") { console.log("skipped: Windows only"); process.exit(0); }
const failed = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failed.push(name); };
const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); } return null; };
const read = (f) => { try { return fs.readFileSync(f, "utf8").trim(); } catch { return ""; } };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wsterm "));
const work = path.join(root, "my work's folder");
const bin = path.join(root, "o'pen code");
fs.mkdirSync(work); fs.mkdirSync(bin);
const marker = path.join(root, "tui.txt");
// The stand-in TUI: says it ran, with its arguments, where it ran, and whether it has a console (mode prints the
// console's size only when there is one).
fs.writeFileSync(path.join(bin, "opencode.cmd"), `@echo off\r\n(echo ARGS %*& echo CWD %CD%& mode con) > "${marker}"\r\nexit\r\n`);

// 1. Open in terminal's own command: & 'C:\...\opencode.cmd' 'attach' 'http://...' '--session' 'ses_...'
const ps = terminalCommand(path.join(bin, "opencode.cmd"), ["attach", "http://127.0.0.1:4096", "--session", "ses_abc123"]);
const r = await openConsole({ cwd: work, ps, sh: "", title: "opencode" });
check("openConsole resolves", r && r.ok === true);
const out = await waitFor(() => read(marker));
check("the window ran opencode with its arguments", /ARGS attach http:\/\/127\.0\.0\.1:4096 --session ses_abc123/.test(out), out);
check("in the workspace folder", out.includes(`CWD ${work}`), out);
check("with a console of its own (a window)", /Columns:\s*\d+/i.test(out), out);

// 2. The window is a new console window: a PowerShell process whose window handle is not zero.
const probe = path.join(root, "probe.txt");
await openConsole({ cwd: work, ps: `Set-Content -LiteralPath '${probe.replace(/'/g, "''")}' -Value ((Get-Process -Id $PID).MainWindowHandle.ToString() + ' ' + [Console]::WindowWidth); exit`, sh: "", title: "probe" });
const got = await waitFor(() => read(probe));
const [handle, width] = (got || "").split(" ");
console.log(`info  window handle ${handle}, width ${width}`);
check("PowerShell got a console window", Number(width) > 0, got);

// 3. For the record: the old way (powershell.exe spawned detached) in the same place.
const old = path.join(root, "old.txt");
const child = spawn("powershell.exe", ["-NoLogo", "-NoExit", "-Command", `Set-Content -LiteralPath '${old.replace(/'/g, "''")}' -Value ([Console]::WindowWidth); exit`], { cwd: work, detached: true, stdio: "ignore", windowsHide: false });
child.unref();
const was = await waitFor(() => read(old), 15000);
console.log(`info  the old way (detached powershell.exe): ${was ? `wrote "${was}"` : "wrote nothing in 15s"}`);

// 4. Characters cmd.exe would read are refused, not run.
await openConsole({ cwd: work, ps: "echo 100%", sh: "" }).then(() => check("a % is refused", false), (e) => check("a % is refused", e.status === 400, e.message));

console.log(failed.length ? `FAILED: ${failed.join(", ")}` : "all checks passed");
process.exit(failed.length ? 1 : 0);
