// eng-agents live dashboard: Adapter for opencode 1.x (`opencode serve`).

import { httpError, opt } from "./context.mjs";
import { folderForArgs, linkFrom } from "./links.mjs";
import { appendText, errText, httpJson, oc, permissions, questions, sessions, setBusy, setIdle, setText, toolLine, upsertSession } from "./opencode-state.mjs";
import { loadState } from "./opencode-connect.mjs";
import { broadcastLive } from "./live.mjs";

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
    async loadSessions() {
      const r = await call("/session");
      if (!r.ok || !Array.isArray(r.data)) return null;
      for (const s of r.data) upsertSession(s.id, { title: s.title, updated: s.time && s.time.updated });
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
    async prompt(id, text) {
      const r = await call(`/session/${id}/prompt_async`, { method: "POST", body: { parts: [{ type: "text", text }] } });
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
          if (p.info) upsertSession(p.info.id, { title: p.info.title, updated: p.info.time && p.info.time.updated });
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
        case "server.instance.disposed":
        case "global.disposed":
          setTimeout(() => loadState().then(broadcastLive, () => {}), 500);
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
