// opencode connector: Chat's terminal (Workshop docs/chat.md, Terminal; connector 1.26.0, Chat 4.0.0).
//
// Real shells in the workspace, run by opencode (its /pty API, opencode 1.x) and shown in Chat with xterm.js. This
// module holds each terminal's WebSocket to opencode and passes what the shell prints to the page as connector
// events (`term.out`, at most CHUNK characters each). It keeps the last KEEP characters, so a page that opens later
// or reloads catches up with `term.read`. Keys go back with `term.input`. Workshop's agent runs nothing: opencode
// runs the shell, as it does for its own desktop app.
//
// opencode keeps a terminal while its shell runs, so a terminal outlives a page reload and a connector restart. The
// ids of the terminals Chat opened are kept in this connector's storage and attached again when a page asks. When the
// shell exits, opencode drops it; Chat shows it as exited until you close it.
//
// Positions (`at`, `from`, `cursor`) count characters of output since the shell started, as opencode's own cursor
// does, so a page can tell when it missed some and read them again.

import { ctx, httpError, log } from "./context.mjs";
import { oc } from "./opencode-state.mjs";
import { emit } from "./live.mjs";

export const MAX_TERMS = 4;
export const KEEP = 120000; // characters of output kept per terminal for a page that opens later
export const CHUNK = 8000; // characters per event: a control character takes 6 bytes in JSON, and events stay under 64 KB
export const MAX_INPUT = 65536;
const FLUSH_MS = 16;
const STORE = "terminals";
const RETRY_MS = [300, 1000, 2000, 4000, 8000];
const ID = /^pty[A-Za-z0-9_-]{1,100}$/;

const terms = new Map(); // id -> term (see make)
let loading = null;
let makeSocket = (url) => new WebSocket(url);

/** Forgets every terminal (the connector stopped): sockets close, opencode keeps the shells. Tests pass a socket maker. */
export function resetTerms({ socket } = {}) {
  for (const t of terms.values()) detach(t);
  terms.clear();
  loading = null;
  if (socket) makeSocket = socket;
}

/** Whether this opencode can run terminals for Chat. */
export const canTerm = () => !!(oc.connected && oc.api && oc.api.ptyCreate && oc.api.ptySocket);
function need() {
  if (!oc.connected || !oc.api) throw httpError(503, "opencode is not connected.");
  if (!canTerm()) throw httpError(501, "This opencode has no terminals Chat can use. Update opencode, or use Open in a window.");
}

function make(id, title) {
  return { id, title: String(title || "Terminal").slice(0, 60), status: "running", exitCode: null, buf: "", end: 0, sent: 0, ws: null, state: "idle", retry: 0, timer: null, flushTimer: null, queue: "", decoder: null };
}
const view = (t) => ({ id: t.id, title: t.title, status: t.status, exitCode: t.exitCode, cursor: t.end, live: t.state === "open" });

async function save() {
  if (!ctx || !ctx.storage) return;
  try { await ctx.storage.put(STORE, [...terms.values()].filter((t) => t.status === "running").map((t) => ({ id: t.id, title: t.title }))); }
  catch (e) { log(`terminal list not saved: ${e.message}`); }
}
/** The terminals Chat opened before a restart: those opencode still has are attached again. */
function ensureLoaded() {
  if (!loading) loading = (async () => {
    const saved = ctx && ctx.storage ? await ctx.storage.get(STORE).catch(() => null) : null;
    for (const s of Array.isArray(saved) ? saved : []) {
      if (!s || !ID.test(String(s.id)) || terms.has(s.id)) continue;
      const info = await oc.api.ptyGet(s.id).catch(() => null);
      if (info && info.status !== "exited") terms.set(s.id, make(s.id, s.title || info.title));
    }
    await save();
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
async function get(id) {
  need();
  await ensureLoaded();
  const t = terms.get(String(id || ""));
  if (!t) throw httpError(404, "That terminal is closed.");
  return t;
}

/* ---------- the socket to opencode ---------- */

function attach(t) {
  if (t.ws || t.status !== "running") return;
  clearTimeout(t.timer);
  let ws;
  try { ws = makeSocket(oc.api.ptySocket(t.id, t.end || null)); }
  catch (e) { retry(t, e); return; }
  t.ws = ws; t.state = "connecting"; t.decoder = new TextDecoder();
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    if (t.ws !== ws) return;
    t.state = "open"; t.retry = 0;
    if (t.queue) { const q = t.queue; t.queue = ""; try { ws.send(q); } catch { /* closes below */ } }
  };
  ws.onmessage = (e) => { if (t.ws === ws) message(t, e.data); };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (t.ws !== ws) return;
    t.ws = null; t.state = "idle";
    if (t.status === "running") gone(t);
  };
}
function message(t, data) {
  if (typeof data === "string") return output(t, data);
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes || !bytes.length) return;
  // opencode's own messages are binary and start with a 0 byte: {"cursor": n} says where the output it sent ends.
  if (bytes[0] === 0) {
    try {
      const m = JSON.parse(new TextDecoder().decode(bytes.subarray(1)));
      if (m && Number.isInteger(m.cursor) && m.cursor >= t.end - t.buf.length) t.end = m.cursor;
    } catch { /* not one we know */ }
    return;
  }
  output(t, t.decoder.decode(bytes, { stream: true }));
}
function output(t, text) {
  if (!text) return;
  t.buf += text;
  t.end += text.length;
  if (t.buf.length > KEEP) t.buf = t.buf.slice(t.buf.length - KEEP);
  if (!t.flushTimer) t.flushTimer = setTimeout(() => flush(t), FLUSH_MS);
}
function flush(t) {
  clearTimeout(t.flushTimer);
  t.flushTimer = null;
  const start = t.end - t.buf.length;
  for (let from = Math.max(t.sent, start); from < t.end; from += CHUNK) {
    emit("term.out", { id: t.id, at: from, data: t.buf.slice(from - start, Math.min(t.end, from + CHUNK) - start) });
  }
  t.sent = t.end;
}
/** The socket closed: the shell exited (opencode no longer has it), or the connection dropped (try again). */
async function gone(t) {
  const info = oc.connected && oc.api && oc.api.ptyGet ? await oc.api.ptyGet(t.id).catch(() => undefined) : undefined;
  if (!terms.has(t.id) || t.ws) return;
  if (info === null || (info && info.status === "exited")) return exited(t, info ? info.exitCode : null);
  retry(t);
}
function retry(t, e) {
  if (e) log(`terminal ${t.id}: ${e.message}`);
  if (!terms.has(t.id) || t.status !== "running" || t.ws) return;
  const wait = RETRY_MS[Math.min(t.retry++, RETRY_MS.length - 1)];
  clearTimeout(t.timer);
  t.timer = setTimeout(() => { if (oc.connected) attach(t); else retry(t); }, wait);
  if (t.timer.unref) t.timer.unref();
}
function exited(t, code) {
  if (t.status === "exited") return;
  flush(t);
  t.status = "exited";
  t.exitCode = Number.isInteger(code) ? code : t.exitCode;
  detach(t);
  emit("term.exit", { id: t.id, exitCode: t.exitCode });
  save();
}
function detach(t) {
  clearTimeout(t.timer); t.timer = null;
  if (t.flushTimer) flush(t);
  const ws = t.ws;
  t.ws = null; t.state = "idle";
  if (ws) try { ws.close(); } catch { /* already closed */ }
}

/** opencode's events: a shell exited, or a terminal was removed (by Chat or another opencode client). */
export function ptyEvent(type, p) {
  const t = p && terms.get(p.id);
  if (!t) return;
  if (type === "pty.exited") exited(t, p.exitCode);
  else if (type === "pty.deleted") exited(t, null);
}

/** opencode (re)connected: attach the terminals Chat opened, so their output reaches open pages again. */
export function termResume() {
  if (!canTerm()) return;
  ensureLoaded().then(() => { for (const t of terms.values()) attach(t); }, (e) => log(`terminals not attached again: ${e.message}`));
}

/* ---------- actions ---------- */

/** term.list: the terminals Chat opened, and whether this opencode can run them. */
export async function termList() {
  if (!canTerm()) return { can: false, max: MAX_TERMS, terms: [] };
  await ensureLoaded();
  for (const t of terms.values()) attach(t);
  return { can: true, max: MAX_TERMS, terms: [...terms.values()].map(view) };
}

/** term.open: a new shell in the workspace. `rows` and `cols` size it to the page's terminal. */
export async function termOpen({ title, rows, cols } = {}) {
  need();
  await ensureLoaded();
  const running = [...terms.values()].filter((t) => t.status === "running");
  if (running.length >= MAX_TERMS) throw httpError(409, `Up to ${MAX_TERMS} terminals. Close one first.`);
  // Exited terminals make room for new ones, oldest first.
  for (const t of [...terms.values()].filter((x) => x.status === "exited").slice(0, Math.max(0, terms.size + 1 - MAX_TERMS))) terms.delete(t.id);
  const used = new Set([...terms.values()].map((t) => t.title));
  let n = 1;
  while (used.has(`Terminal ${n}`)) n++;
  const name = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60) || `Terminal ${n}`;
  const info = await oc.api.ptyCreate({ title: name });
  const t = make(info.id, name);
  terms.set(t.id, t);
  if (rows && cols) await oc.api.ptyResize(t.id, rows, cols).catch(() => {});
  attach(t);
  await save();
  log(`terminal ${t.id} opened`);
  return view(t);
}

/** term.read: what the terminal printed from `from` on (as much as is kept), for a page catching up. */
export async function termRead({ id, from }) {
  const t = await get(id);
  attach(t);
  const start = t.end - t.buf.length;
  const f = Number.isInteger(from) ? Math.max(start, Math.min(from, t.end)) : start;
  return { ...view(t), from: f, data: t.buf.slice(f - start) };
}

/** term.input: keys, pasted text or escape sequences, as xterm.js sends them. */
export async function termInput({ id, data }) {
  const t = await get(id);
  const s = String(data == null ? "" : data);
  if (!s) return { ok: true };
  if (s.length > MAX_INPUT) throw httpError(400, "That is too much to paste at once.");
  if (t.status !== "running") throw httpError(409, "This terminal has exited. Close it and open a new one.");
  if (t.state === "open") t.ws.send(s);
  else {
    if (t.queue.length + s.length > MAX_INPUT) throw httpError(409, "The terminal is reconnecting. Try again in a moment.");
    t.queue += s;
    attach(t);
  }
  return { ok: true };
}

/** term.resize: the page's terminal changed size. */
export async function termResize({ id, rows, cols }) {
  const t = await get(id);
  if (t.status !== "running") return { ok: true };
  await oc.api.ptyResize(t.id, Math.max(2, Math.min(300, rows | 0)), Math.max(2, Math.min(1000, cols | 0)));
  return { ok: true };
}

/** term.close: ends the shell (if it still runs) and forgets the terminal. */
export async function termClose({ id }) {
  const t = await get(id);
  terms.delete(t.id);
  detach(t);
  if (t.status === "running") await oc.api.ptyRemove(t.id).catch((e) => log(`terminal ${t.id} not closed: ${e.message}`));
  await save();
  emit("term.gone", { id: t.id });
  return { ok: true };
}
