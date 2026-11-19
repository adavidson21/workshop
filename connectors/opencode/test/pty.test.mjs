// Tests for lib/pty.mjs (Chat's terminal) with a stand-in opencode API and WebSocket. Synthetic data only.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { CHUNK, KEEP, MAX_TERMS, ptyEvent, resetTerms, termClose, termInput, termList, termOpen, termRead, termResize, termResume } from "../lib/pty.mjs";
import { oc } from "../lib/opencode-state.mjs";
import { configure } from "../lib/context.mjs";

let events, store, sockets, calls, ptys;
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
class FakeSocket {
  constructor(url) { this.url = url; this.sent = []; this.closed = false; sockets.push(this); setImmediate(() => this.onopen && this.onopen()); }
  send(d) { this.sent.push(d); }
  close() { this.closed = true; }
  drop() { this.onclose && this.onclose(); }
  say(text) { this.onmessage({ data: text }); }
  cursor(n) { const b = new TextEncoder().encode("\0" + JSON.stringify({ cursor: n })); this.onmessage({ data: b.buffer }); }
}
const rejects = (p, code, re) => assert.rejects(p, (e) => e.code === code && (!re || re.test(e.message)));

beforeEach(() => {
  events = []; store = {}; sockets = []; calls = []; ptys = new Map();
  configure({ config: { workspace: os.tmpdir() }, env: () => undefined, log: { info() {}, warn() {} }, emit: (event, payload) => events.push({ event, ...payload }),
    storage: { async get(k) { return store[k]; }, async put(k, v) { store[k] = JSON.parse(JSON.stringify(v)); } } });
  resetTerms({ socket: (url) => new FakeSocket(url) });
  oc.connected = true;
  let n = 0;
  oc.api = {
    async ptyCreate({ title }) { const id = `pty_${++n}x`; ptys.set(id, { id, title, status: "running" }); calls.push(["create", title]); return { id, title, status: "running" }; },
    async ptyGet(id) { return ptys.get(id) || null; },
    async ptyResize(id, rows, cols) { calls.push(["resize", id, rows, cols]); },
    async ptyRemove(id) { ptys.delete(id); calls.push(["remove", id]); },
    ptySocket: (id, cursor) => `ws://x/pty/${id}/connect${cursor == null ? "" : `?cursor=${cursor}`}`,
  };
});

test("an opencode without terminals says so instead of failing", async () => {
  oc.api = {};
  assert.deepEqual(await termList(), { can: false, max: MAX_TERMS, terms: [] });
  await rejects(termOpen({}), "bad_request", /no terminals/);
});

test("open, type, read what it printed, resize, and close a terminal", async () => {
  const t = await termOpen({ rows: 30, cols: 100 });
  assert.equal(t.title, "Terminal 1");
  assert.deepEqual(calls, [["create", "Terminal 1"], ["resize", t.id, 30, 100]]);
  assert.equal(sockets[0].url, `ws://x/pty/${t.id}/connect`, "a new terminal replays all opencode kept");
  assert.deepEqual(store.terminals, [{ id: t.id, title: "Terminal 1" }], "kept for a restart");
  await tick();
  await termInput({ id: t.id, data: "ls\r" });
  assert.deepEqual(sockets[0].sent, ["ls\r"]);
  sockets[0].say("hello ");
  sockets[0].say("world");
  sockets[0].cursor(11);
  await tick();
  assert.deepEqual(events.filter((e) => e.event === "term.out").map((e) => [e.at, e.data]), [[0, "hello world"]], "one event per flush");
  assert.deepEqual(await termRead({ id: t.id, from: 6 }), { id: t.id, title: "Terminal 1", status: "running", exitCode: null, cursor: 11, live: true, from: 6, data: "world" });
  await termResize({ id: t.id, rows: 9999, cols: 1 });
  assert.deepEqual(calls.at(-1), ["resize", t.id, 300, 2], "sizes are kept in range");
  assert.equal((await termList()).terms.length, 1);
  await termClose({ id: t.id });
  assert.deepEqual(calls.at(-1), ["remove", t.id]);
  assert.ok(sockets[0].closed);
  assert.equal(events.at(-1).event, "term.gone");
  assert.deepEqual(store.terminals, []);
  await rejects(termRead({ id: t.id }), "not_found");
});

test("long output comes in chunks, and only the last KEEP characters are kept", async () => {
  const t = await termOpen({});
  await tick();
  sockets[0].say("x".repeat(KEEP + 500));
  await tick();
  const outs = events.filter((e) => e.event === "term.out");
  assert.ok(outs.every((e) => e.data.length <= CHUNK));
  assert.equal(outs[0].at, 500, "what fell out of the buffer before the flush is not sent");
  const r = await termRead({ id: t.id, from: 0 });
  assert.equal(r.from, 500);
  assert.equal(r.data.length, KEEP);
  assert.equal(r.cursor, KEEP + 500);
});

test("a shell that exits stays readable until you close it; keys are refused", async () => {
  const t = await termOpen({});
  await tick();
  sockets[0].say("bye\r\n");
  ptyEvent("pty.exited", { id: t.id, exitCode: 3 });
  assert.deepEqual(events.filter((e) => e.event !== "term.out").map((e) => [e.event, e.exitCode]), [["term.exit", 3]]);
  const r = await termRead({ id: t.id });
  assert.equal(r.status, "exited");
  assert.equal(r.data, "bye\r\n");
  await rejects(termInput({ id: t.id, data: "x" }), "conflict", /exited/);
  await termClose({ id: t.id });
  assert.ok(!calls.some((c) => c[0] === "remove"), "opencode already dropped it");
});

test("a dropped connection comes back from where it was; a gone shell is marked exited", async () => {
  const t = await termOpen({});
  await tick();
  sockets[0].say("abc");
  sockets[0].drop();
  await tick(400);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].url, `ws://x/pty/${t.id}/connect?cursor=3`);
  ptys.delete(t.id);
  sockets[1].drop();
  await tick();
  assert.equal((await termRead({ id: t.id })).status, "exited");
});

test("keys typed while connecting wait for the socket", async () => {
  const t = await termOpen({});
  await termInput({ id: t.id, data: "a" });
  await termInput({ id: t.id, data: "b" });
  assert.deepEqual(sockets[0].sent, []);
  await tick();
  assert.deepEqual(sockets[0].sent, ["ab"]);
});

test("up to MAX_TERMS running terminals; exited ones make room", async () => {
  const ids = [];
  for (let i = 0; i < MAX_TERMS; i++) ids.push((await termOpen({})).id);
  assert.deepEqual((await termList()).terms.map((t) => t.title), ["Terminal 1", "Terminal 2", "Terminal 3", "Terminal 4"]);
  await rejects(termOpen({}), "conflict", /Close one first/);
  ptyEvent("pty.exited", { id: ids[1], exitCode: 0 });
  const next = await termOpen({ title: "  build   watch " });
  assert.equal(next.title, "build watch");
  assert.equal((await termList()).terms.length, MAX_TERMS);
});

test("after a restart, terminals opencode still runs are attached again", async () => {
  const a = await termOpen({});
  const b = await termOpen({});
  ptys.delete(a.id); // a's shell ended while the connector was stopped
  resetTerms();
  sockets.length = 0;
  const list = await termList();
  assert.deepEqual(list.terms.map((t) => t.id), [b.id]);
  assert.equal(sockets[0].url, `ws://x/pty/${b.id}/connect`, "everything opencode kept is replayed");
  assert.deepEqual(store.terminals, [{ id: b.id, title: "Terminal 2" }]);
  sockets[0].say("prompt$ ");
  sockets[0].cursor(500);
  await tick();
  const r = await termRead({ id: b.id });
  assert.deepEqual([r.from, r.cursor, r.data], [492, 500, "prompt$ "], "opencode's cursor is the truth when it kept less than it printed");
});

test("when opencode connects again, the terminals stream without a page asking", async () => {
  const a = await termOpen({});
  resetTerms();
  sockets.length = 0;
  termResume();
  await tick();
  assert.deepEqual(sockets.map((s) => s.url), [`ws://x/pty/${a.id}/connect`]);
  sockets[0].say("still building");
  await tick();
  assert.deepEqual(events.filter((e) => e.event === "term.out").map((e) => e.data).at(-1), "still building");
  oc.api = {};
  resetTerms();
  termResume(); // an opencode without terminals: nothing to do
});
