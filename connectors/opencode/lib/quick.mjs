// opencode connector: Quick answers in Chat (Chat 4.5.0, connector 1.38.0). A quick question ("what is our release
// day?", "who owns billing?") used to go to an agent that reads the config, the repo map, product notes and code
// with one tool call after another: each call is another full request to the model, which on a small local model
// felt like deep research for a one-line answer.
//
// Quick does the looking up in code: it scores the knowledge base's text (Folio notes, products and glossary from
// Settings, the workspace repo map) against the question, puts the best passages in the request, and asks once,
// with no tools. The model reads one prompt and writes one answer, streamed. "Go deeper" in Chat sends the same
// question to an agent that can read the code.
//
// Pure apart from reading files: docsFor(question, {dataDir, workspace}) -> {text, sources}.

import fs from "node:fs";
import path from "node:path";

export const MAX_FILES = 1500;
export const MAX_FILE = 200000; // characters; bigger notes are skipped
export const CHUNK = 1400; // characters per passage
export const BUDGET = 9000; // characters of passages in one request (about 2,300 tokens), fits a 32K window easily
export const BUDGET_LOCAL = 6000;
const SKIP_DIRS = new Set(["history", ".trash", "trash", "attachments", ".git", "node_modules", "templates"]);
const STOP = new Set("the and for are but not you all any can had her was one our out has his how its may new now who did get let put say she too use what when where which while with why will would could should does this that these those there their them they then than from into onto your yours about after before just like more most much some such only also over very here have been being were is a an of to in on at by or as be it if so do no up we me my i".split(" "));

/** The words that matter in a question: lower case, 3 letters or more (2 for upper-case short forms like PR), no common words. */
export function terms(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/[A-Za-z0-9][A-Za-z0-9_.-]*/g)) {
    const raw = m[0].replace(/[.-]+$/, "");
    const w = raw.toLowerCase();
    if ((w.length >= 3 || /^[A-Z0-9]{2}$/.test(raw)) && !STOP.has(w)) out.add(w);
    // Plural and simple suffixes, so "releases" finds "release".
    if (w.length > 4 && w.endsWith("s")) out.add(w.slice(0, -1));
  }
  return [...out];
}

/** Markdown cut at its headings, then at CHUNK: [{title, text}]. The first heading is the note's title. */
export function chunks(text, title = "") {
  const out = [];
  let head = title, buf = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) for (let i = 0; i < t.length; i += CHUNK) out.push({ title: head, text: t.slice(i, i + CHUNK) });
    buf = [];
  };
  for (const line of String(text || "").replace(/^---\n[\s\S]*?\n---\n/, "").split(/\r?\n/)) {
    const h = /^#{1,4}\s+(.+)$/.exec(line);
    if (h) { flush(); head = title && h[1] !== title ? `${title} > ${h[1].trim()}` : h[1].trim(); }
    buf.push(line);
  }
  flush();
  return out;
}

function readSmall(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE) return null;
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function walk(dir, out, root) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of names) {
    if (out.length >= MAX_FILES) return;
    if (d.name.startsWith(".") && d.name !== ".") continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name.toLowerCase())) walk(full, out, root); }
    else if (d.isFile() && /\.md$/i.test(d.name)) out.push(full);
  }
}

/** Settings' products and glossary as plain lines, so they score like notes. */
function settingsText(file) {
  const raw = readSmall(file);
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : [];
  const lines = items.slice(0, 500).map((it) => {
    if (!it || typeof it !== "object") return "";
    const bits = Object.entries(it).filter(([k, v]) => !/^(id|updatedAt|createdAt)$/.test(k) && v != null && v !== "" && !(Array.isArray(v) && !v.length));
    return "- " + bits.map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("; ");
  }).filter((l) => l.length > 2);
  return lines.length ? lines.join("\n") : null;
}

/** Every passage Quick may use: [{source, title, text}]. `source` is the path Chat's Sources chips understand. */
export function corpus({ dataDir, workspace } = {}) {
  const out = [];
  if (dataDir) {
    const notes = ["folio", "notes"].map((d) => path.join(dataDir, d)).find((d) => fs.existsSync(d));
    if (notes) {
      const files = [];
      walk(notes, files, notes);
      for (const f of files) {
        const text = readSmall(f);
        if (!text) continue;
        const rel = path.relative(dataDir, f).split(path.sep).join("/");
        const title = (/^#\s+(.+)$/m.exec(text) || [])[1] || path.basename(f, ".md");
        for (const c of chunks(text, title.trim())) out.push({ source: rel, ...c });
      }
    }
    for (const [file, title] of [["products.json", "Products"], ["glossary.json", "Glossary"]]) {
      const text = settingsText(path.join(dataDir, "settings", file));
      if (text) for (const c of chunks(text, title)) out.push({ source: `settings/${file}`, ...c });
    }
  }
  if (workspace) {
    const map = readSmall(path.join(workspace, "AGENTS.md"));
    if (map) for (const c of chunks(map, "Repo map")) out.push({ source: "AGENTS.md", ...c });
  }
  return out;
}

/** The passages that best fit the question, within `budget` characters, best first. */
export function rank(question, passages, budget = BUDGET) {
  const q = terms(question);
  if (!q.length || !passages.length) return [];
  const n = passages.length;
  const df = new Map(q.map((t) => [t, 0]));
  const lower = passages.map((p) => `${p.title}\n${p.text}`.toLowerCase());
  for (const l of lower) for (const t of q) if (l.includes(t)) df.set(t, df.get(t) + 1);
  const scored = passages.map((p, i) => {
    let score = 0;
    const title = `${p.title} ${p.source}`.toLowerCase();
    for (const t of q) {
      const d = df.get(t);
      if (!d || !lower[i].includes(t)) continue;
      const idf = Math.log(1 + n / d);
      score += idf * (title.includes(t) ? 2 : 1);
    }
    return { p, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const out = [];
  let used = 0;
  for (const { p } of scored) {
    if (used + p.text.length > budget) continue;
    out.push(p);
    used += p.text.length;
    if (used > budget * 0.95) break;
  }
  return out;
}

/** The system text for one quick answer, and the notes it carries. */
export function quickSystem(question, passages, { name = "" } = {}) {
  const sources = [...new Set(passages.map((p) => p.source))];
  const notes = passages.length
    ? passages.map((p) => `[${p.source}] ${p.title}\n${p.text}`).join("\n\n---\n\n")
    : "(No notes matched this question.)";
  return [
    `You answer quick questions${name ? ` for ${name}` : ""} from their own notes, in Workshop. Answer right away: no tools, no plan, no preamble.`,
    "Be brief: one to four sentences, or a short list. Use the notes below when they cover the question. When they do not, say so in one short line, then give your best short answer from general knowledge and say it is not from their notes.",
    "If the question needs reading code or many files to answer well, give what you can and say \"Go deeper\" would look further.",
    sources.length ? "End with a line `Sources:` and, on the lines after it, each note you used as `- `path`` (only the ones you used, paths exactly as shown in brackets)." : "",
    "",
    "Notes:",
    "",
    notes,
  ].filter((l, i) => l !== "" || i > 3).join("\n");
}

/** Look up the notes for a question: {system, sources}. */
export function docsFor(question, { dataDir, workspace, local = false, name = "" } = {}) {
  const picked = rank(question, corpus({ dataDir, workspace }), local ? BUDGET_LOCAL : BUDGET);
  return { system: quickSystem(question, picked, { name }), sources: [...new Set(picked.map((p) => p.source))] };
}
