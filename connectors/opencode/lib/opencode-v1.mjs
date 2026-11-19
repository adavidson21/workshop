// opencode connector: adapter for opencode 1.x (`opencode serve`).
//
// Copied from eng-agents core/scripts/dashboard/server/opencode-v1.mjs (gone from eng-agents since Core 2.11.0; this is the only copy). Change: the reload after
// opencode disposes its instance stops with the connector.

import { httpError, later, opt } from "./context.mjs";
import { folderForArgs, linkFrom } from "./links.mjs";
import { appendText, errText, httpJson, oc, parseProviders, permissions, questions, sessions, setBusy, setIdle, setText, toolLine, upsertSession } from "./opencode-state.mjs";
import { loadState } from "./opencode-connect.mjs";
import { broadcastLive } from "./live.mjs";
import { v1Turn } from "./chat-parts.mjs";
import { ptyEvent } from "./pty.mjs";

export function makeV1(url) {
  const base = url.replace(/\/+$/, "");
  const call = (p, o = {}) => {
    const u = new URL(base + p);
    u.searchParams.set("directory", opt.workspace);
    for (const [k, v] of Object.entries(o.query || {})) u.searchParams.set(k, v);
    return httpJson(u.toString(), o);
  };
  const msgRole = new Map(); // messageID -> role

  const normPermission = (p) => ({
    id: p.id,
    sessionID: p.sessionID,
    permission: p.permission || p.type,
    patterns: p.patterns || (p.pattern ? [].concat(p.pattern) : []),
    always: p.always || [],
    title: (p.metadata && (p.metadata.command || p.metadata.filepath || p.metadata.filePath)) || p.title || null,
  });
  const normQuestion = (q) => ({
    id: q.id,
    sessionID: q.sessionID,
    questions: (q.questions || []).map((x, i) => ({
      key: String(i),
      header: x.header || "",
      question: x.question || "",
      options: (x.options || []).map((o) => ({ label: o.label, value: o.label, description: o.description || "" })),
      multiple: !!x.multiple,
      custom: x.custom !== false,
    })),
  });

  return {
    kind: "v1",
    url: base,
    async info() {
      try {
        const r = await httpJson(base + "/global/health", { timeout: 2500 });
        return r.ok && r.data && r.data.healthy ? { version: r.data.version || null } : null;
      } catch {
        return null;
      }
    },
    async loadCommands() {
      const r = await call("/command");
      if (r.ok && Array.isArray(r.data)) oc.commands = new Set(r.data.map((c) => c.name));
    },
    async loadAgents() {
      const r = await call("/agent", { timeout: 5000 });
      if (r.ok && Array.isArray(r.data)) oc.agents = new Set(r.data.map((a) => a && a.name).filter(Boolean));
    },
    /** The session's turns, oldest first: [{id, role: "user" | "assistant", text, at}]. Text parts only. */
    async messages(id, limit = 100) {
      const r = await call(`/session/${id}/message`, { query: { limit: String(limit) } });
      if (!r.ok || !Array.isArray(r.data)) throw httpError(502, `opencode could not list the messages (${errText(r)}).`);
      return r.data.map((m) => ({
        id: (m.info && m.info.id) || "",
        role: m.info && m.info.role === "user" ? "user" : "assistant",
        text: (m.parts || []).filter((p) => p.type === "text" && !p.synthetic).map((p) => p.text).join("\n").trim(),
        at: (m.info && m.info.time && (m.info.time.completed || m.info.time.created)) || null,
      }));
    },
    async loadProviders() {
      for (const p of ["/provider", "/config/providers"]) {
        const r = await call(p, { timeout: 5000 });
        const list = r.ok ? parseProviders(r.data) : null;
        if (list) return (oc.ai = { known: true, providers: list });
      }
      return (oc.ai = { known: false, providers: [] });
    },
    async loadSessions() {
      const r = await call("/session");
      if (!r.ok || !Array.isArray(r.data)) return null;
      for (const s of r.data) upsertSession(s.id, { title: s.title, updated: s.time && s.time.updated, parent: s.parentID || null });
      const st = await call("/session/status");
      const map = st.ok && st.data && typeof st.data === "object" ? st.data : {};
      for (const s of r.data) upsertSession(s.id, { status: map[s.id] ? map[s.id].type : "idle" });
      return r.data.map((s) => s.id);
    },
    async sessionExists(id) {
      return (await call(`/session/${id}`)).ok;
    },
    async loadPrompts() {
      const [p, q] = await Promise.all([call("/permission"), call("/question")]);
      if (p.ok && Array.isArray(p.data)) {
        permissions.clear();
        for (const x of p.data) permissions.set(x.id, normPermission(x));
      }
      if (q.ok && Array.isArray(q.data)) {
        questions.clear();
        for (const x of q.data) questions.set(x.id, normQuestion(x));
      }
    },
    async lastText(id) {
      if (!id) return;
      const r = await call(`/session/${id}/message`, { query: { limit: "8" } });
      if (!r.ok || !Array.isArray(r.data)) return;
      for (let i = r.data.length - 1; i >= 0; i--) {
        const m = r.data[i];
        if (!m.info || m.info.role !== "assistant") continue;
        const text = (m.parts || []).filter((p) => p.type === "text" && !p.synthetic).map((p) => p.text).join("\n").trim();
        if (text) {
          upsertSession(id, { text, textAt: (m.info.time && (m.info.time.completed || m.info.time.created)) || null });
          return;
        }
      }
    },
    async createSession(title) {
      const r = await call("/session", { method: "POST", body: { title } });
      if (!r.ok || !r.data || !r.data.id) throw httpError(502, `opencode could not create a session (${errText(r)}).`);
      return { id: r.data.id, title: r.data.title || title };
    },
    // The 1.x command endpoint answers only when the agent finishes, so the caller does not wait for it.
    async runCommand(id, name, args) {
      const r = await call(`/session/${id}/command`, { method: "POST", body: { command: name, arguments: args }, timeout: 0 });
      return r.ok ? null : errText(r);
    },
    // `agent` names the agent for this message (chat.mjs always passes "chat"); without it opencode uses the
    // session's last agent or its default.
    async prompt(id, text, agent) {
      const r = await call(`/session/${id}/prompt_async`, { method: "POST", body: { ...(agent ? { agent } : {}), parts: [{ type: "text", text }] } });
      if (!r.ok) throw httpError(502, `opencode did not take the reply (${errText(r)}).`);
    },
    async abort(id) {
      const r = await call(`/session/${id}/abort`, { method: "POST" });
      if (!r.ok) throw httpError(502, `opencode could not stop it (${errText(r)}).`);
    },
    async replyPermission(p, answer) {
      let r = await call(`/session/${p.sessionID}/permissions/${p.id}`, { method: "POST", body: { response: answer } });
      if (r.status === 404) r = await call(`/permission/${p.id}/reply`, { method: "POST", body: { reply: answer } });
      if (!r.ok) throw httpError(502, `opencode did not take the answer (${errText(r)}).`);
    },
    async replyQuestion(q, answers) {
      const r = await call(`/question/${q.id}/reply`, { method: "POST", body: { answers } });
      if (!r.ok) throw httpError(502, `opencode did not take the answer (${errText(r)}).`);
    },
    async rejectQuestion(q) {
      const r = await call(`/question/${q.id}/reject`, { method: "POST" });
      if (!r.ok) throw httpError(502, `opencode could not dismiss it (${errText(r)}).`);
    },
    /* ---------- Chat (chat.mjs): the parts of opencode the TUI uses ---------- */
    /** Every agent: [{name, description, mode, builtIn}]. */
    async agentList() {
      const r = await call("/agent", { timeout: 5000 });
      if (!r.ok || !Array.isArray(r.data)) return [];
      return r.data.filter((a) => a && a.name).map((a) => ({ name: a.name, description: a.description || "", mode: a.mode || "all", builtIn: !!(a.builtIn || a.native), hidden: !!a.hidden }));
    },
    /** Models of the connected providers: {models: [{provider, providerName, id, name}], defaults: {provider: model}}. */
    async modelList() {
      for (const p of ["/provider", "/config/providers"]) {
        const r = await call(p, { timeout: 5000 });
        if (!r.ok || !r.data || typeof r.data !== "object") continue;
        const all = Array.isArray(r.data.all) ? r.data.all : Array.isArray(r.data.providers) ? r.data.providers : null;
        if (!all) continue;
        const on = Array.isArray(r.data.connected) ? new Set(r.data.connected) : null;
        const models = [];
        for (const pr of all) {
          if (!pr || !pr.id || (on && !on.has(pr.id))) continue;
          for (const m of Object.values(pr.models || {})) if (m && m.id) models.push({ provider: pr.id, providerName: pr.name || pr.id, id: m.id, name: m.name || m.id });
        }
        return { models, defaults: r.data.default && typeof r.data.default === "object" ? r.data.default : {} };
      }
      return { models: [], defaults: {} };
    },
    /** Every command: [{name, description}]. */
    async commandList() {
      const r = await call("/command");
      return r.ok && Array.isArray(r.data) ? r.data.filter((c) => c && c.name).map((c) => ({ name: c.name, description: c.description || "" })) : [];
    },
    /** The session itself: {id, title, parent, revert}. */
    async sessionInfo(id) {
      const r = await call(`/session/${id}`);
      if (!r.ok || !r.data) throw httpError(404, "opencode has no such session.");
      return { id: r.data.id, title: r.data.title || null, parent: r.data.parentID || null, revert: (r.data.revert && r.data.revert.messageID) || null };
    },
    /** Rich turns, oldest first (chat-parts.mjs): text, reasoning, tool calls with output and diffs, files. */
    async richMessages(id, limit = 100) {
      const r = await call(`/session/${id}/message`, { query: { limit: String(limit) } });
      if (!r.ok || !Array.isArray(r.data)) throw httpError(502, `opencode could not list the messages (${errText(r)}).`);
      return r.data.map((m) => v1Turn(m, opt.workspace));
    },
    /** A message with any agent and model, files as file parts (what the TUI sends for @path) and pasted images as data URLs (Chat 4.0.0). */
    async promptRich(id, { text, agent, model, files, images }) {
      const parts = [{ type: "text", text }];
      for (const f of files || []) parts.push({ type: "file", mime: "text/plain", url: "file://" + (f.startsWith("/") ? "" : "/") + f.replace(/\\/g, "/"), filename: f.split(/[\\/]/).pop() });
      for (const im of images || []) parts.push({ type: "file", mime: im.mime, url: `data:${im.mime};base64,${im.data}`, filename: im.name });
      const body = { parts, ...(agent ? { agent } : {}), ...(model ? { model: { providerID: model.provider, modelID: model.id } } : {}) };
      const r = await call(`/session/${id}/prompt_async`, { method: "POST", body });
      if (!r.ok) throw httpError(502, `opencode did not take the message (${errText(r)}).`);
    },
    /** A slash command. opencode answers when the agent finishes, so this does not wait: errors land on the session. */
    async commandRich(id, { name, args, agent, model }) {
      const body = { command: name, arguments: args || "", ...(agent ? { agent } : {}), ...(model ? { model: `${model.provider}/${model.id}` } : {}) };
      return call(`/session/${id}/command`, { method: "POST", body, timeout: 0 });
    },
    /** !command: runs in the workspace through opencode, like the TUI's shell mode. Does not wait either. */
    async shell(id, { command, agent, model }) {
      const body = { command, agent: agent || "build", ...(model ? { model: { providerID: model.provider, modelID: model.id } } : {}) };
      return call(`/session/${id}/shell`, { method: "POST", body, timeout: 0 });
    },
    async revert(id, messageID) {
      const r = await call(`/session/${id}/revert`, { method: "POST", body: { messageID } });
      if (!r.ok) throw httpError(502, `opencode could not undo it (${errText(r)}).`);
    },
    async unrevert(id) {
      const r = await call(`/session/${id}/unrevert`, { method: "POST" });
      if (!r.ok) throw httpError(502, `opencode could not redo it (${errText(r)}).`);
    },
    /** /compact. Answers when the summary is written, so this does not wait. */
    async summarize(id, model) {
      return call(`/session/${id}/summarize`, { method: "POST", body: model ? { providerID: model.provider, modelID: model.id } : {}, timeout: 0 });
    },
    /** Files in the workspace for @ mentions, as opencode finds them. */
    async findFiles(query) {
      const r = await call("/find/file", { query: { query, dirs: "false" }, timeout: 5000 });
      return r.ok && Array.isArray(r.data) ? r.data.filter((x) => typeof x === "string") : [];
    },
    /* ---------- Chat's workbench (Chat 4.0.0): side chats, pasted images and terminals ---------- */
    /** A copy of the session so far, for a side chat: {id, title}. */
    async fork(id) {
      const r = await call(`/session/${id}/fork`, { method: "POST", body: {} });
      if (!r.ok || !r.data || !r.data.id) throw httpError(502, `opencode could not start a side chat (${errText(r)}).`);
      return { id: r.data.id, title: r.data.title || null };
    },
    async setTitle(id, title) {
      return (await call(`/session/${id}`, { method: "PATCH", body: { title } })).ok;
    },
    /** One message as opencode keeps it ({info, parts}), or null. */
    async rawMessage(id, messageID) {
      const r = await call(`/session/${id}/message/${messageID}`);
      return r.ok && r.data && typeof r.data === "object" ? r.data : null;
    },
    /** A shell in the workspace, run by opencode (its /pty API): {id, title, status}. */
    async ptyCreate({ title }) {
      const r = await call("/pty", { method: "POST", body: { title, cwd: opt.workspace } });
      if (!r.ok || !r.data || !r.data.id) throw httpError(r.status === 404 ? 501 : 502, r.status === 404 ? "This opencode has no terminals. Update opencode (npm i -g opencode-ai), then restart it." : `opencode could not open a terminal (${errText(r)}).`);
      return { id: r.data.id, title: r.data.title || title, status: r.data.status || "running" };
    },
    /** The terminal, or null when opencode no longer has it (it exited). */
    async ptyGet(id) {
      const r = await call(`/pty/${id}`, { timeout: 5000 });
      return r.ok && r.data && r.data.id ? { id: r.data.id, title: r.data.title || "", status: r.data.status || "running", exitCode: r.data.exitCode ?? null } : null;
    },
    async ptyResize(id, rows, cols) {
      const r = await call(`/pty/${id}`, { method: "PUT", body: { size: { rows, cols } } });
      if (!r.ok && r.status !== 404) throw httpError(502, `opencode could not resize the terminal (${errText(r)}).`);
    },
    async ptyRemove(id) {
      const r = await call(`/pty/${id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw httpError(502, `opencode could not close the terminal (${errText(r)}).`);
    },
    /** The terminal's WebSocket address. `cursor`: replay its output from there (null: all opencode kept). */
    ptySocket(id, cursor) {
      const u = new URL(`${base}/pty/${id}/connect`);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.searchParams.set("directory", opt.workspace);
      if (cursor != null) u.searchParams.set("cursor", String(cursor));
      return u.toString();
    },
    eventsRequest() {
      const u = new URL(base + "/event");
      u.searchParams.set("directory", opt.workspace);
      return { url: u.toString(), headers: {} };
    },
    onEvent(ev) {
      const p = ev.properties || {};
      const sid = p.sessionID || (p.info && p.info.sessionID) || (p.part && p.part.sessionID);
      switch (ev.type) {
        case "session.created":
        case "session.updated":
          if (p.info) upsertSession(p.info.id, { title: p.info.title, updated: p.info.time && p.info.time.updated, parent: p.info.parentID || null });
          break;
        case "session.deleted":
          if (p.info) sessions.delete(p.info.id);
          break;
        case "session.status": {
          const type = (p.status && p.status.type) || "idle";
          if (type === "idle") upsertSession(sid, { status: "idle" });
          else setBusy(sid);
          if (type === "retry") upsertSession(sid, { activity: `Retrying (attempt ${p.status.attempt}): ${p.status.message || ""}` });
          break;
        }
        case "session.idle":
          setIdle(sid);
          break;
        case "session.error": {
          const e = p.error || {};
          const msg = (e.data && (e.data.message || e.data.providerID)) || e.name || "Unknown error";
          if (sid) upsertSession(sid, e.name === "MessageAbortedError" ? { activity: null, error: "Stopped." } : { error: String(msg).slice(0, 500) });
          break;
        }
        case "message.updated":
          if (p.info) {
            msgRole.set(p.info.id, p.info.role);
            if (msgRole.size > 2000) msgRole.delete(msgRole.keys().next().value);
          }
          break;
        case "message.part.updated": {
          const part = p.part || {};
          if (part.type === "tool") upsertSession(sid, { activity: toolLine(part.tool, part.state && part.state.input, part.state && part.state.title) });
          else if (part.type === "text" && msgRole.get(part.messageID) === "assistant" && !part.synthetic) setText(sid, part.id, part.text);
          else if (part.type === "reasoning") upsertSession(sid, { activity: "Thinking" });
          break;
        }
        case "message.part.delta":
          if (p.field !== "text" || msgRole.get(p.messageID) !== "assistant") return false;
          appendText(sid, p.partID, p.delta);
          break;
        case "permission.asked":
        case "permission.updated": // older 1.x
          if (p.id) permissions.set(p.id, normPermission(p));
          break;
        case "permission.replied":
          permissions.delete(p.requestID || p.permissionID || p.id);
          break;
        case "question.asked":
          if (p.id) questions.set(p.id, normQuestion(p));
          break;
        case "question.replied":
        case "question.rejected":
          questions.delete(p.requestID || p.id);
          break;
        case "command.executed":
          upsertSession(sid, { command: `/${p.name}${p.arguments ? " " + p.arguments : ""}` });
          linkFrom(sid, () => folderForArgs(p.arguments), `/${p.name} ${p.arguments || ""}`.trim());
          break;
        case "pty.exited":
        case "pty.deleted":
          ptyEvent(ev.type, p);
          return false;
        case "server.instance.disposed":
        case "global.disposed":
          later(() => loadState().then(broadcastLive, () => {}), 500);
          break;
        default:
          return false;
      }
      return true;
    },
    terminalArgs(id) {
      return ["attach", base, ...(id ? ["--session", id] : [])];
    },
    attachCommand(id) {
      const dir = /\s/.test(opt.workspace) ? `"${opt.workspace}"` : opt.workspace;
      return `opencode attach ${base}${id ? " --session " + id : ""} --dir ${dir}`;
    },
  };
}
