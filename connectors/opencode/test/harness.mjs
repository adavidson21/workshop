// Test helpers: a synthetic workspace (docs/examples/work plus git repos), a fake opencode CLI, a ctx
// like the agent's, and waiting for state. No work data: everything here is made up.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..", "..");
export const EXAMPLE_WORK = path.join(REPO, "docs", "examples", "work");
export const isWin = process.platform === "win32";

/** Is PowerShell (the .work parser's runtime) installed? */
export const hasPowerShell = ["pwsh", "powershell"].some((exe) => spawnSync(exe, ["-NoProfile", "-Command", "1"], { windowsHide: true }).status === 0);
export const hasGit = spawnSync("git", ["--version"]).status === 0;

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};

/**
 * A workspace: .work copied from docs/examples/work (without expected.json and _dashboard), and with
 * repos: true, git repos for 41610's pr.md ("gateway", branch dev/bug/41610-rate-limit-headers) with a
 * bare "origin" outside the workspace. Returns {dir, work, origin, remove()}.
 */
export function makeWorkspace({ repos = false } = {}) {
  const root = tmp("workshop-oc-");
  const dir = path.join(root, "ws");
  const work = path.join(dir, ".work");
  fs.mkdirSync(dir);
  fs.cpSync(EXAMPLE_WORK, work, { recursive: true });
  fs.rmSync(path.join(work, "expected.json"));
  fs.rmSync(path.join(work, "_dashboard"), { recursive: true, force: true });
  // Same modification time on every file, as docs/examples/work/expected.json assumes (rule 11).
  const when = new Date("2026-10-14T12:00:00Z");
  for (const f of fs.readdirSync(work, { recursive: true })) fs.utimesSync(path.join(work, f), when, when);
  let origin = null;
  if (repos) {
    origin = path.join(root, "origin-gateway.git");
    git(root, "init", "-q", "--bare", origin);
    const repo = path.join(dir, "gateway");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    git(repo, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(repo, "README.md"), "gateway\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "first");
    git(repo, "remote", "add", "origin", origin);
    git(repo, "checkout", "-q", "-b", "dev/bug/41610-rate-limit-headers");
    fs.writeFileSync(path.join(repo, "headers.txt"), "x\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "headers");
    git(repo, "branch", "develop");
  }
  return {
    dir,
    work,
    origin,
    branchesAt: () => (origin ? git(origin, "for-each-ref", "--format=%(refname:short)", "refs/heads").split(/\r?\n/).filter(Boolean).sort() : []),
    remove: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
  };
}

/**
 * A fake `opencode` command: `--version` prints o.version, `service start|status` prints o.serviceUrl,
 * `debug paths` prints the config folder (which holds service.json with o.password, if given).
 * Returns the command to put in the connector's opencode.command setting.
 */
export function makeFakeCli({ version, serviceUrl = null, password = null }) {
  const dir = tmp("workshop-oc-cli-");
  const configDir = path.join(dir, "config");
  fs.mkdirSync(configDir);
  if (password) fs.writeFileSync(path.join(configDir, "service.json"), JSON.stringify({ password }));
  const script = path.join(dir, "fake-cli.mjs");
  fs.writeFileSync(script, `const a = process.argv.slice(2);
if (a[0] === "--version") console.log(${JSON.stringify(version)});
else if (a[0] === "service") { ${serviceUrl ? `console.log("opencode service running at ${serviceUrl}");` : `console.error("service failed"); process.exit(1);`} }
else if (a[0] === "debug" && a[1] === "paths") console.log("config  " + ${JSON.stringify(configDir)});
else process.exit(2);
`);
  let cmd;
  if (isWin) {
    cmd = path.join(dir, "opencode.cmd");
    fs.writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    cmd = path.join(dir, "opencode");
    fs.writeFileSync(cmd, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    fs.chmodSync(cmd, 0o755);
  }
  return { cmd, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** A ctx like the agent's (docs/connector.md), recording what the connector does with it. */
export function fakeCtx(config, env = {}) {
  const abort = new AbortController();
  const rec = { events: [], logs: [], statusChanges: 0 };
  const allowed = new Set(Object.values(config.opencode || {}).filter((v) => typeof v === "string" && /^[A-Z_]+$/.test(v)));
  const ctx = {
    config,
    env(name) {
      if (!allowed.has(name)) throw new Error(`Environment variable ${name} is not named in this connector's config.`);
      return env[name];
    },
    log: {
      info: (m) => rec.logs.push(`info ${m}`),
      warn: (m) => rec.logs.push(`warn ${m}`),
      error: (m) => rec.logs.push(`error ${m}`),
    },
    emit(event, payload) {
      if (!/^[a-z][a-zA-Z0-9.-]{0,63}$/.test(event)) throw new Error(`bad event name ${event}`);
      const text = JSON.stringify(payload ?? null);
      if (Buffer.byteLength(text) > 64 * 1024) throw new Error("payload too large");
      rec.events.push({ event, payload: JSON.parse(text) });
    },
    statusChanged: () => rec.statusChanges++,
    signal: abort.signal,
    home: os.tmpdir(),
  };
  return { ctx, rec, abort };
}

/** Polls fn until it returns something truthy. */
export async function waitFor(fn, what = "condition", ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Default connector config for a workspace and an opencode URL. */
export function configFor(ws, { url, command, startServer = false, passwordEnv } = {}) {
  const opencode = { startServer, command: command || "opencode", passwordEnv: passwordEnv || "OPENCODE_SERVER_PASSWORD", usernameEnv: "OPENCODE_SERVER_USERNAME" };
  if (url) opencode.url = url;
  return { workspace: ws, opencode, pollSeconds: 20 };
}
