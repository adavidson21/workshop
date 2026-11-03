// opencode connector: git helpers for the review screen. Read-only: they never change a repo.
//
// Copied from eng-agents core/scripts/dashboard/server/review-git.mjs on branch dev/feature/review-api
// at 2626601, unchanged apart from this header.
//
// Kept free of context.mjs on purpose, so tests can import this module without starting the server.
// Every git call gets an argument array (no shell) and a timeout. Paths are passed after "--".

import { execFile } from "node:child_process";

export const MAX_FILE_BYTES = 1024 * 1024; // files over 1 MB return a placeholder instead of content

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/; // SHA-1 or SHA-256

function git(dir, args, { timeout = 30000, maxBuffer = 64 * 1024 * 1024, encoding = "utf8" } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
    execFile("git", args, { cwd: dir, env, timeout, maxBuffer, encoding, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(err.code === "ENOENT" ? "git is not on PATH." : String(stderr || err.message).trim());
        e.gitCode = err.code;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

// A branch name the review API will look up. Same rule as pushBranch in actions.mjs.
export function isSafeBranch(name) {
  return typeof name === "string" && /^[A-Za-z0-9._\/-]+$/.test(name) && !name.startsWith("-") && !name.includes("..");
}

// A repo-relative path: no absolute paths, no "..", no leading dash.
export function isSafePath(p) {
  if (typeof p !== "string" || !p || p.length > 4096 || p.includes("\0")) return false;
  if (p.startsWith("/") || p.startsWith("-") || /^[A-Za-z]:/.test(p) || p.includes("\\")) return false;
  return !p.split("/").some((seg) => seg === ".." || seg === "");
}

// Full sha of a ref (for example "refs/heads/dev/feature/12-x" or "origin/main"), or null if it does not exist.
export async function resolveSha(dir, ref) {
  try {
    const out = (await git(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim();
    return SHA_RE.test(out) ? out : null;
  } catch {
    return null;
  }
}

// Head of a local branch, or null.
export async function branchHead(dir, branch) {
  if (!isSafeBranch(branch)) throw new Error(`"${branch}" is not a branch name the review API will read.`);
  return resolveSha(dir, `refs/heads/${branch}`);
}

// git merge-base <a> <b>, or null when they share no history.
export async function mergeBase(dir, a, b) {
  try {
    const out = (await git(dir, ["merge-base", a, b])).trim();
    return SHA_RE.test(out) ? out : null;
  } catch {
    return null;
  }
}

const STATUS = { A: "added", M: "modified", D: "deleted", R: "renamed", T: "modified", C: "added" };

// Changed files between two commits, as ChangedFile[] from the spec:
// { path, oldPath?, status, additions, deletions, binary }.
// Uses `git diff --name-status -M` and `--numstat -M`, both with -z so any file name parses.
export async function changedFiles(dir, baseSha, headSha) {
  if (!SHA_RE.test(baseSha) || !SHA_RE.test(headSha)) throw new Error("changedFiles needs two full commit shas.");
  const common = ["-c", "core.quotepath=false", "diff", "-z", "-M", "--no-ext-diff", "--no-textconv"];
  const [ns, num] = await Promise.all([
    git(dir, [...common, "--name-status", baseSha, headSha]),
    git(dir, [...common, "--numstat", baseSha, headSha]),
  ]);

  const files = [];
  const byPath = new Map();
  const nsParts = ns.split("\0");
  for (let i = 0; i < nsParts.length; ) {
    const code = nsParts[i++];
    if (!code) continue;
    const letter = code[0];
    const status = STATUS[letter];
    if (!status) {
      i++; // unknown status (U, X): skip its path
      continue;
    }
    let file;
    if (letter === "R" || letter === "C") {
      const from = nsParts[i++];
      const to = nsParts[i++];
      file = letter === "R" ? { path: to, oldPath: from, status } : { path: to, status };
    } else {
      file = { path: nsParts[i++], status };
    }
    Object.assign(file, { additions: 0, deletions: 0, binary: false });
    files.push(file);
    byPath.set(file.path, file);
  }

  // numstat -z: "<add>\t<del>\t<path>\0", or for a rename "<add>\t<del>\t\0<old>\0<new>\0". Binary is "-\t-".
  const numParts = num.split("\0");
  for (let i = 0; i < numParts.length; ) {
    const head = numParts[i++];
    if (!head) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(head);
    if (!m) continue;
    let p = m[3];
    if (p === "") {
      i++; // old path
      p = numParts[i++];
    }
    const f = byPath.get(p);
    if (!f) continue;
    if (m[1] === "-" || m[2] === "-") f.binary = true;
    else {
      f.additions = +m[1];
      f.deletions = +m[2];
    }
  }
  return files;
}

// Content of one file at a commit. Returns one of:
//   { kind: "text", text }
//   { kind: "too_large", size }    over MAX_FILE_BYTES
//   { kind: "binary", size }       contains a NUL byte in its first 8000 bytes (git's own rule)
//   { kind: "missing" }            the path does not exist at that commit
export async function fileAt(dir, sha, filePath) {
  if (!SHA_RE.test(sha)) throw new Error("fileAt needs a full commit sha.");
  if (!isSafePath(filePath)) throw new Error("Bad file path.");
  const spec = `${sha}:${filePath}`;
  let size;
  try {
    const type = (await git(dir, ["cat-file", "-t", spec])).trim();
    if (type !== "blob") return { kind: "missing" };
    size = +(await git(dir, ["cat-file", "-s", spec])).trim();
  } catch {
    return { kind: "missing" };
  }
  if (size > MAX_FILE_BYTES) return { kind: "too_large", size };
  const buf = await git(dir, ["cat-file", "blob", spec], { encoding: "buffer", maxBuffer: MAX_FILE_BYTES + 1024 });
  if (buf.subarray(0, 8000).includes(0)) return { kind: "binary", size };
  return { kind: "text", text: buf.toString("utf8") };
}

// Whether commit a is an ancestor of (or equal to) commit b: true, false, or null if git cannot tell.
export async function isAncestor(dir, a, b) {
  if (!SHA_RE.test(a) || !SHA_RE.test(b)) throw new Error("isAncestor needs two full commit shas.");
  try {
    await git(dir, ["merge-base", "--is-ancestor", a, b]);
    return true;
  } catch (e) {
    return e.gitCode === 1 ? false : null;
  }
}
