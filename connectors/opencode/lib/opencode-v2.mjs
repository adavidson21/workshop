// opencode connector: adapter for the opencode 2.x background service (/api routes).
//
// Copied from eng-agents core/scripts/dashboard/server/opencode-v2.mjs. Change: the user name comes
// from the connector config (usernameEnv) instead of OPENCODE_SERVER_USERNAME directly.

import { httpError, inWorkspace, opt } from "./context.mjs";
import { folderForArgs, folderForPrompt, linkFrom } from "./links.mjs";
import { appendText, errText, httpJson, oc, permissions, questions, refreshPromptsSoon, sessions, setBusy, setIdle, setText, toolLine, upsertSession } from "./opencode-state.mjs";

export function makeV2(url, password) {
  const base = url.replace(/\/+$/, "");
  const auth = password ? { authorization: "Basic " + Buffer.from(`${opt.username || "opencode"}:${password}`).toString("base64") } : {};
  const loc = () => `location%5Bdirectory%5D=${encodeURIComponent(opt.workspace)}`;
  const call = (p, o = {}) => httpJson(base + p, { ...o, headers: { ...auth, ...(o.headers || {}) } });
  const wsSessions = new Set(); // sessions in this workspace
  const toolNames = new Map(); // tool call id -> tool name

  function normPermission(p) {
    return {
      id: p.id,
      sessionID: p.sessionID,
      permission: p.action,
      patterns: p.resources || [],
      always: p.save || [],
      title: (p.metadata && (p.metadata.command || p.metadata.filepath || p.metadata.filePath)) || (p.resources || [])[0] || null,
      message: p.message || null,
    };
  }
  function normForm(f) {
    return {
      id: f.id,
      sessionID: f.sessionID,
      title: f.title,
      questions: (f.fields || []).map((x) => ({
        key: x.key,
        header: x.title || "",
        question: x.description || x.title || "",
        options: (x.options || []).map((o) => ({ label: o.label || String(o.value), value: o.value !== undefined ? o.value : o.label, description: o.description || "" })),
        multiple: x.type === "multiselect" || !!x.multiple,
        custom: x.custom !== false,
      })),
    };
  }

  return {
    kind: "v2",
    url: base,
    hasPassword: !!password,
    async info() {
      const r = await call("/api/info", { timeout: 3000 });
      return r.ok && r.data ? { version: r.data.version || null } : null;
    },
    async loadCommands() {
      const r = await call(`/api/command?${loc()}`);
      if (r.ok && r.data && Array.isArray(r.data.data)) oc.commands = new Set(r.data.data.map((c) => c.name));
    },
    async loadSessions() {
      const r = await call(`/api/session?directory=${encodeURIComponent(opt.workspace)}&limit=200`);
      const list = r.ok && r.data && Array.isArray(r.data.data) ? r.data.data : null;
      if (!list) return null;
      for (const s of list) {
        wsSessions.add(s.id);
        upsertSession(s.id, { title: s.title || null, updated: s.time && s.time.updated });
      }
      const act = await call("/api/session/active");
      const active = act.ok && act.data && act.data.data ? act.data.data : {};
      for (const id of wsSessions) upsertSession(id, { status: active[id] ? "busy" : "idle" });
      return list.map((s) => s.id);
    },
    async sessionExists(id) {
      const r = await call(`/api/session/${id}`);
      return r.ok;
    },
    async loadPrompts() {
      const [p, f] = await Promise.all([call(`/api/permission/request?${loc()}`), call(`/api/form?${loc()}`)]);
      if (p.ok && p.data && Array.isArray(p.data.data)) {
        permissions.clear();
        for (const x of p.data.data) permissions.set(x.id, normPermission(x));
      }
      if (f.ok && f.data && Array.isArray(f.data.data)) {
        questions.clear();
        for (const x of f.data.data) questions.set(x.id, normForm(x));
      }
    },
    async lastText(id) {
      if (!id) return;
      const r = await call(`/api/session/${id}/message?limit=12&order=desc`);
      const list = r.ok && r.data && Array.isArray(r.data.data) ? r.data.data : null;
      if (!list) return;
      for (const m of list) {
        if (m.type !== "assistant") continue;
        const text = (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
        if (text) {
          upsertSession(id, { text, textAt: (m.time && (m.time.completed || m.time.created)) || null });
          return;
        }
      }
    },
    async createSession(title) {
      const r = await call("/api/session", { method: "POST", body: { title, location: { directory: opt.workspace } } });
      if (!r.ok || !r.data || !r.data.data) throw httpError(502, `opencode could not create a session (${errText(r)}).`);
      wsSessions.add(r.data.data.id);
      return { id: r.data.data.id, title: r.data.data.title || title };
    },
    async runCommand(id, name, args) {
      const r = await call(`/api/session/${id}/command`, { method: "POST", body: { name, text: args }, timeout: 30000 });
      return r.ok ? null : errText(r);
    },
    async prompt(id, text) {
      const r = await call(`/api/session/${id}/prompt`, { method: "POST", body: { text } });
      if (!r.ok) throw httpError(502, `opencode did not take the reply (${errText(r)}).`);
    },
    async abort(id) {
      const r = await call(`/api/session/${id}/interrupt`, { method: "POST" });
      if (!r.ok) throw httpError(502, `opencode could not stop it (${errText(r)}).`);
    },
    async replyPermission(p, answer) {
      const r = await call(`/api/session/${p.sessionID}/permission/${p.id}/reply`, { method: "POST", body: { decision: answer } });
      if (!r.ok) throw httpError(502, `opencode did not take the answer (${errText(r)}).`);
    },
    async replyQuestion(q, answers) {
      const answer = {};
      q.questions.forEach((qq, i) => {
        const picked = (answers[i] || []).map((label) => {
          const o = qq.options.find((x) => x.label === label);
          return o ? String(o.value) : label;
        });
        answer[qq.key] = qq.multiple ? picked : picked[0];
      });
      const r = await call(`/api/session/${q.sessionID}/form/${q.id}/reply`, { method: "POST", body: { answer } });
      if (!r.ok) throw httpError(502, `opencode did not take the answer (${errText(r)}).`);
    },
    async rejectQuestion(q) {
      const r = await call(`/api/session/${q.sessionID}/form/${q.id}`, { method: "DELETE" });
      if (!r.ok) throw httpError(502, `opencode could not dismiss it (${errText(r)}).`);
    },
    eventsRequest() {
      return { url: base + "/api/event", headers: auth };
    },
    onEvent(ev) {
      const t = ev.type || "";
      const d = ev.data || {};
      const sid = d.sessionID || (d.form && d.form.sessionID) || (d.info && d.info.metadata && d.info.metadata.sessionID);
      const here = ev.location && ev.location.directory ? inWorkspace(ev.location.directory) : null;
      if (t === "session.created" && (here || inWorkspace(d.location && d.location.directory))) wsSessions.add(sid);
      if (t.startsWith("permission.") || t.startsWith("form.")) {
        if (here !== false) refreshPromptsSoon();
        return true;
      }
      if (t === "command.updated") {
        if (here !== false) this.loadCommands().catch(() => {});
        return false;
      }
      if (!sid || !wsSessions.has(sid)) return false;
      if (t === "session.created" || /^session\.(updated|title\.updated|renamed)$/.test(t)) {
        if (d.title) upsertSession(sid, { title: d.title });
      } else if (t === "session.deleted") {
        sessions.delete(sid);
        wsSessions.delete(sid);
      } else if (t === "session.execution.started") setBusy(sid);
      else if (t.startsWith("session.execution.")) {
        const outcome = t.slice("session.execution.".length);
        const msg = d.error ? d.error.message || d.error.name || String(d.error) : null;
        setIdle(sid, outcome === "succeeded" ? null : outcome === "interrupted" ? "Stopped." : `Failed${msg ? ": " + String(msg).slice(0, 300) : "."}`);
      } else if (t === "session.text.delta") appendText(sid, `${d.assistantMessageID}:${d.ordinal}`, d.delta);
      else if (t === "session.text.ended") setText(sid, `${d.assistantMessageID}:${d.ordinal}`, d.text);
      else if (t.startsWith("session.reasoning.")) upsertSession(sid, { activity: "Thinking" });
      else if (t === "session.tool.input.started") {
        toolNames.set(d.id, d.name);
        if (toolNames.size > 500) toolNames.delete(toolNames.keys().next().value);
        upsertSession(sid, { activity: d.name });
      } else if (t === "session.tool.called") upsertSession(sid, { activity: toolLine(toolNames.get(d.id) || d.name || "tool", d.input) });
      else if (t === "session.inbox.enqueued" && d.item && d.item.type === "user") {
        const text = d.item.payload && d.item.payload.text;
        linkFrom(sid, () => folderForPrompt(text) || (/^\/\S/.test(text || "") ? folderForArgs(String(text).replace(/^\/\S+\s*/, "")) : null), null);
      } else return false;
      return true;
    },
    // The TUI on a session. 2.x clients share the background service, so no URL is needed.
    terminalArgs(id) {
      return id ? ["--session", id] : [];
    },
    attachCommand(id) {
      const dir = /\s/.test(opt.workspace) ? `"${opt.workspace}"` : opt.workspace;
      return `opencode${id ? " --session " + id : ""} ${dir}`;
    },
  };
}
