// opencode connector: one shape for a session's turns in the Chat app (docs/chat.md), from either opencode API.
// No I/O, so tests feed it raw messages.
//
// A turn: {id, role: "user" | "assistant", text, at, agent, model: {provider, id} | null, tokens, cost, error,
// parts: [...]}. `text` is the turn's plain text (what Save as note and the hub's threads use); `parts` is what the
// Chat app draws, in order:
//   {type: "text", text}
//   {type: "reasoning", text}
//   {type: "tool", tool, status: "pending" | "running" | "completed" | "error", title, input, output, error, diff,
//    todos: [{content, status}], child}
//   {type: "file", name}
//   {type: "patch", files: [path]}
//   {type: "subtask", agent, text}
//   {type: "compaction"}
// Long outputs are cut (head and tail kept), and file paths in the workspace are shown relative to it.

export const OUT_MAX = 8000;
export const DIFF_MAX = 16000;
export const TEXT_MAX = 60000;

/** Keeps the start and the end of a long string. */
export function cut(s, max = OUT_MAX) {
  const t = typeof s === "string" ? s : s == null ? "" : String(s);
  if (t.length <= max) return t;
  const tail = Math.floor(max / 4);
  return `${t.slice(0, max - tail)}\n... (${t.length - max} characters cut) ...\n${t.slice(-tail)}`;
}

/** A path inside `root` as root-relative with forward slashes; anything else as it is. */
export function relPath(p, root) {
  const s = String(p || "");
  if (!s || !root) return s;
  const norm = (x) => x.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(root), v = norm(s);
  const ci = /^[a-z]:\//i.test(r); // Windows paths compare without case
  const same = ci ? v.toLowerCase().startsWith(r.toLowerCase() + "/") : v.startsWith(r + "/");
  return same ? v.slice(r.length + 1) : s;
}

const STATUS = new Set(["pending", "running", "completed", "error"]);
function status(x) {
  const s = String(x || "").toLowerCase();
  if (STATUS.has(s)) return s;
  if (/^(done|success|succeeded|complete)$/.test(s)) return "completed";
  if (/^(fail|failed|error)$/.test(s)) return "error";
  return s ? "running" : "completed";
}

/** The one line that says what a tool call is about: the command, file, pattern or link. */
export function toolSubject(tool, input, root) {
  const i = input && typeof input === "object" ? input : {};
  const file = i.filePath || i.filepath || i.path || i.file;
  if (/bash|shell/.test(tool)) return String(i.command || i.description || "");
  if (file) return relPath(file, root);
  if (i.pattern) return String(i.pattern) + (i.include ? `  (${i.include})` : "");
  if (i.url) return String(i.url);
  if (tool === "task") return [i.subagent_type || i.agent, i.description].filter(Boolean).join(": ");
  if (i.query) return String(i.query);
  if (i.description) return String(i.description);
  return "";
}

function todos(x) {
  const list = Array.isArray(x) ? x : null;
  if (!list) return null;
  return list.slice(0, 60).filter((t) => t && (t.content || t.text)).map((t) => ({ content: String(t.content || t.text).slice(0, 300), status: String(t.status || "pending") }));
}

/** A tool call in either API: {tool, status, title, input, output, error, diff, todos, child}. */
export function toolPart({ tool, state, input, output, title, metadata, error }, root) {
  const name = String(tool || "tool");
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const inp = input && typeof input === "object" ? input : {};
  const out = output != null ? output : meta.output;
  const part = {
    type: "tool",
    tool: name,
    status: status(state),
    title: String(title || "").slice(0, 300),
    input: cut(toolSubject(name, inp, root), 600),
  };
  if (out != null && out !== "") part.output = cut(typeof out === "string" ? out : JSON.stringify(out, null, 1));
  if (error) part.error = cut(typeof error === "string" ? error : error.message || JSON.stringify(error), 2000);
  const diff = meta.diff || (typeof inp.patchText === "string" ? inp.patchText : null);
  if (typeof diff === "string" && diff) part.diff = cut(diff, DIFF_MAX);
  else if (/^(write|create)$/.test(name) && typeof inp.content === "string") part.diff = cut(inp.content.split(/\r?\n/).map((l) => "+" + l).join("\n"), DIFF_MAX);
  else if (name === "edit" && typeof inp.oldString === "string" && typeof inp.newString === "string") {
    part.diff = cut([...inp.oldString.split(/\r?\n/).map((l) => "-" + l), ...inp.newString.split(/\r?\n/).map((l) => "+" + l)].join("\n"), DIFF_MAX);
  }
  const td = todos(inp.todos) || todos(meta.todos);
  if (td && /todo/.test(name)) part.todos = td;
  const child = meta.sessionId || meta.sessionID;
  if (typeof child === "string" && child) part.child = child;
  return part;
}

const modelOf = (provider, id) => (provider && id ? { provider: String(provider), id: String(id) } : null);
function tokensOf(t) {
  if (!t || typeof t !== "object") return null;
  const n = (x) => (typeof x === "number" && isFinite(x) ? x : 0);
  const cache = t.cache && typeof t.cache === "object" ? t.cache : {};
  return { input: n(t.input), output: n(t.output), reasoning: n(t.reasoning), cacheRead: n(cache.read), cacheWrite: n(cache.write) };
}
function errorOf(e) {
  if (!e) return null;
  if (typeof e === "string") return e.slice(0, 500);
  if (e.name === "MessageAbortedError") return "Stopped.";
  return String((e.data && e.data.message) || e.message || e.name || "Error").slice(0, 500);
}
function joinText(parts) {
  return parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").trim().slice(0, TEXT_MAX);
}

/** opencode 1.x: {info, parts}. */
export function v1Turn(m, root) {
  const info = (m && m.info) || {};
  const parts = [];
  for (const p of (m && Array.isArray(m.parts) ? m.parts : [])) {
    if (!p || typeof p !== "object") continue;
    if (p.type === "text") {
      if (!p.synthetic && !p.ignored && p.text) parts.push({ type: "text", text: String(p.text).slice(0, TEXT_MAX) });
    } else if (p.type === "reasoning") {
      if (p.text) parts.push({ type: "reasoning", text: cut(p.text, OUT_MAX) });
    } else if (p.type === "tool") {
      const st = p.state || {};
      parts.push(toolPart({ tool: p.tool, state: st.status, input: st.input, output: st.output, title: st.title, metadata: st.metadata, error: st.error }, root));
    } else if (p.type === "file") {
      parts.push({ type: "file", name: relPath((p.source && p.source.path) || p.filename || p.url || "file", root) });
    } else if (p.type === "patch") {
      parts.push({ type: "patch", files: (Array.isArray(p.files) ? p.files : []).slice(0, 50).map((f) => relPath(f, root)) });
    } else if (p.type === "subtask") {
      parts.push({ type: "subtask", agent: String(p.agent || ""), text: cut(p.description || p.prompt || "", 600) });
    } else if (p.type === "compaction") parts.push({ type: "compaction" });
  }
  const role = info.role === "user" ? "user" : "assistant";
  const model = info.model && typeof info.model === "object" ? modelOf(info.model.providerID, info.model.modelID) : modelOf(info.providerID, info.modelID);
  return {
    id: info.id || "",
    role,
    text: joinText(parts),
    at: (info.time && (info.time.completed || info.time.created)) || null,
    agent: info.agent || info.mode || null,
    model,
    tokens: role === "assistant" ? tokensOf(info.tokens) : null,
    cost: typeof info.cost === "number" ? info.cost : null,
    error: errorOf(info.error),
    summary: !!info.summary,
    parts,
  };
}

/** opencode 2.x: {id, type, content: [...]}, read loosely (text, reasoning, tool and file content). */
export function v2Turn(m, root) {
  const parts = [];
  for (const c of (m && Array.isArray(m.content) ? m.content : [])) {
    if (!c || typeof c !== "object") continue;
    if (c.type === "text") { if (c.text && !c.synthetic) parts.push({ type: "text", text: String(c.text).slice(0, TEXT_MAX) }); }
    else if (c.type === "reasoning") { if (c.text) parts.push({ type: "reasoning", text: cut(c.text, OUT_MAX) }); }
    else if (c.type === "tool" || c.type === "tool-call" || c.type === "tool_call") {
      const st = c.state && typeof c.state === "object" ? c.state : {};
      parts.push(toolPart({ tool: c.name || c.tool, state: st.status || c.status || (typeof c.state === "string" ? c.state : null), input: c.input || st.input, output: c.output != null ? c.output : st.output, title: c.title || st.title, metadata: c.metadata || st.metadata, error: c.error || st.error }, root));
    } else if (c.type === "file") parts.push({ type: "file", name: relPath(c.path || c.filename || c.name || c.url || "file", root) });
  }
  const role = m && m.type === "user" ? "user" : "assistant";
  const mod = m && m.model;
  return {
    id: (m && m.id) || "",
    role,
    text: joinText(parts),
    at: (m && m.time && (m.time.completed || m.time.created)) || null,
    agent: (m && m.agent) || null,
    model: mod && typeof mod === "object" ? modelOf(mod.providerID || mod.provider, mod.modelID || mod.id) : null,
    tokens: role === "assistant" ? tokensOf(m && m.tokens) : null,
    cost: m && typeof m.cost === "number" ? m.cost : null,
    error: errorOf(m && m.error),
    summary: false,
    parts,
  };
}
