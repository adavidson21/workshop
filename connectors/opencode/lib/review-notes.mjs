// opencode connector: what the code review screen shows beside the diff (1.27.0, Workshop project doc
// claude/publish-review-v1-plan.md). Pure: text in, data out, so tests need no workspace.
//
// - Tandem's own findings, from review.md and the earlier rounds in history/review-*.md, at their lines. A Blocker
//   or Should fix from an earlier round became a fix task (autopilot builds those before the PR text), so it shows
//   as fixed; anything in the current review.md, and every Nit and question, shows as open. Context only: they are
//   never sent back unless the engineer comments.
// - Reading order: each task's files in task order (tasks.md), tests right after the code they test, generated and
//   lock files last and folded. Each file says which task changed it.

const lc = (s) => String(s || "").toLowerCase();
const clean = (s) => String(s || "").replace(/`/g, "").trim();

/** Rows of a Markdown table under a heading matching `heading` (a regex on the heading text). */
function tableUnder(text, heading) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let inSec = false;
  for (const l of lines) {
    const h = /^#{1,6}\s+(.+?)\s*$/.exec(l);
    if (h) { inSec = heading.test(h[1]); continue; }
    if (!inSec) continue;
    const m = /^\s*\|(.*)\|\s*$/.exec(l);
    if (!m) continue;
    const cells = m[1].split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || !c)) continue;
    out.push(cells);
  }
  return out;
}

/**
 * A location cell, `repo/path/File.cs:42` or `path:42-50`, as {path, line} for `repo`, or null when it is not a
 * file and line, or names another of the item's repos (`repos`).
 */
export function locOf(cell, repo, repos = []) {
  const t = clean(cell);
  const m = /^(.+?):(\d+)(?:-\d+)?$/.exec(t);
  if (!m) return null;
  let p = m[1].replace(/\\/g, "/").replace(/^\.\//, "");
  if (repo && lc(p).startsWith(lc(repo) + "/")) p = p.slice(repo.length + 1);
  else if (repos.some((r) => r && lc(r) !== lc(repo) && lc(p).startsWith(lc(r) + "/"))) return null;
  return { path: p, line: Number(m[2]) };
}

/** The findings table of a review.md: [{n, severity, category, location, problem, fix}]. */
export function findingsOf(text) {
  const rows = tableUnder(text, /code quality|findings/i);
  const out = [];
  for (const c of rows) {
    if (c.length < 5 || c[0] === "#" || /^severity$/i.test(c[1])) continue;
    const sev = clean(c[1]);
    if (!/^(blocker|should fix|nit)$/i.test(sev)) continue;
    out.push({ n: clean(c[0]), severity: sev.toLowerCase() === "should fix" ? "should_fix" : sev.toLowerCase(), category: clean(c[2]).toLowerCase(), location: clean(c[3]), problem: clean(c[4]), fix: clean(c[5] || "") });
  }
  return out;
}

/** "Questions for you" lines that name a location: [{location, text}]. */
export function questionsOf(text) {
  const m = /^##\s+Questions for you\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(String(text || ""));
  if (!m) return [];
  const out = [];
  for (const l of m[1].split(/\r?\n/)) {
    const q = /^\s*[-*]\s+`([^`]+:\d+(?:-\d+)?)`\s*:?\s*(.+?)\s*$/.exec(l);
    if (q) out.push({ location: q[1], text: q[2] });
  }
  return out;
}

/**
 * Notes for one repo of an item. `rounds` are review texts oldest first: [{name, text}], the last one being the
 * current review.md. Returns [{id, path, line, kind: "finding" | "question", severity, category, text, state, round}].
 */
export function notesFor(rounds, repo, repos = []) {
  const out = [];
  const list = (rounds || []).filter((r) => r && r.text);
  list.forEach((r, i) => {
    const current = i === list.length - 1;
    for (const f of findingsOf(r.text)) {
      const at = locOf(f.location, repo, repos);
      if (!at) continue;
      const fixed = !current && (f.severity === "blocker" || f.severity === "should_fix");
      out.push({ id: `${r.name}#${f.n}`, path: at.path, line: at.line, kind: "finding", severity: f.severity, category: f.category, text: f.fix ? `${f.problem} Fix: ${f.fix}` : f.problem, state: fixed ? "fixed" : "open", round: i + 1 });
    }
    if (current) {
      for (const [k, q] of questionsOf(r.text).entries()) {
        const at = locOf(q.location, repo, repos);
        if (!at) continue;
        out.push({ id: `${r.name}#q${k + 1}`, path: at.path, line: at.line, kind: "question", severity: "question", category: "", text: q.text, state: "open", round: i + 1 });
      }
    }
  });
  return out.slice(0, 200);
}

/** Tasks with their repo and files: [{n, title, repo, files: [path]}]. */
export function tasksWithFiles(text) {
  const out = [];
  const parts = String(text || "").split(/^##\s+\[([ xX])\]\s+Task\s+(\d+)\s*:\s*(.+?)\s*$/m);
  for (let i = 1; i + 3 <= parts.length; i += 4) {
    const body = parts[i + 3] || "";
    const repo = (/^\s*-\s*Repo:\s*`?([^`\r\n]+?)`?\s*$/m.exec(body) || [])[1] || null;
    const files = [];
    const fm = /^\s*-\s*Files:\s*$([\s\S]*?)(?=^\s*-\s+[A-Z][A-Za-z ]+:|(?![\s\S]))/m.exec(body);
    if (fm) for (const l of fm[1].split(/\r?\n/)) { const f = /`([^`]+)`/.exec(l); if (f) files.push(f[1].replace(/\\/g, "/")); }
    out.push({ n: Number(parts[i + 1]), title: parts[i + 2], repo: repo ? repo.trim() : null, files });
  }
  return out;
}

const GENERATED = [/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|Gemfile\.lock|poetry\.lock|composer\.lock|packages\.lock\.json|Cargo\.lock|go\.sum)$/i, /\.min\.(js|css)$/i, /\.snap$/i, /\.Designer\.cs$/i, /(^|\/)Migrations\/.*\.Designer\.cs$/i, /(^|\/)(dist|build|out|coverage)\//i, /\.g\.(cs|ts)$/i];
export const isGenerated = (p) => GENERATED.some((r) => r.test(p));
export const isTest = (p) => /(^|\/)(tests?|__tests__|spec|specs|e2e)\/|\.(test|spec)\.[a-z0-9]+$|Tests?\.cs$/i.test(p);

/** The changed files in reading order, each with `task` ({n, title} or null) and `folded` (generated or lock file). */
export function readingOrder(files, tasks, repo) {
  const mine = (tasks || []).filter((t) => !t.repo || !repo || lc(t.repo) === lc(repo) || lc(t.repo).endsWith("/" + lc(repo)));
  const taskOf = new Map();
  for (const t of mine) {
    for (const f of t.files) {
      let p = f;
      if (repo && lc(p).startsWith(lc(repo) + "/")) p = p.slice(repo.length + 1);
      if (!taskOf.has(lc(p))) taskOf.set(lc(p), t);
    }
  }
  const rank = (f) => {
    const t = taskOf.get(lc(f.path));
    return [isGenerated(f.path) ? 2 : t ? 0 : 1, t ? t.n : 9999];
  };
  // Tests go right after the code they test: same task, code first; a test with no task goes after its code file.
  const stem = (p) => p.split("/").pop().replace(/\.(test|spec)(?=\.)/i, "").replace(/Tests?(?=\.cs$)/, "").replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  const withRank = files.map((f, i) => ({ f, i, r: rank(f), test: isTest(f.path) ? 1 : 0, stem: stem(f.path) }));
  withRank.sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || (a.stem === b.stem ? a.test - b.test : 0) || (a.r[0] === 1 ? a.stem.localeCompare(b.stem) || a.test - b.test : a.i - b.i));
  return withRank.map(({ f }) => {
    const t = taskOf.get(lc(f.path));
    return { ...f, task: t ? { n: t.n, title: t.title } : null, folded: isGenerated(f.path) };
  });
}
