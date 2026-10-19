// The opencode connector against fake opencode 1.x and 2.x servers, through a ctx like the agent's.
// Each test names the PARITY.md item it covers, for example [P-run].
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import oc from "../index.mjs";
import { startFakeOpencode } from "./fake-opencode.mjs";
import { EXAMPLE_WORK, configFor, fakeCtx, hasGit, hasPowerShell, makeFakeCli, makeWorkspace, waitFor } from "./harness.mjs";

const skip = hasPowerShell ? false : "PowerShell is not installed (the .work parser needs it)";
const PASSWORD = "fake-service-password-5d1e";
const expected = JSON.parse(fs.readFileSync(path.join(EXAMPLE_WORK, "expected.json"), "utf8"));
const numbered = expected.items.filter((i) => i.kind === "item");

const call = (name, args = {}, ctx) => oc.actions[name].run(args, ctx);
async function rejects(promise, code, re) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.code, code, `expected code ${code}, got ${e.code}: ${e.message}`);
    if (re) assert.match(e.message, re);
    return true;
  });
}

async function startConnector(config, env = {}) {
  const f = fakeCtx(config, env);
  await oc.start(f.ctx);
  await waitFor(() => oc.status().state !== "starting", "the connector to read .work", 60000);
  return f;
}

const busyEvent = (kind, sid) => (kind === "v1" ? { type: "session.status", properties: { sessionID: sid, status: { type: "busy" } } } : { type: "session.execution.started", data: { sessionID: sid } });
const idleEvent = (kind, sid) => (kind === "v1" ? { type: "session.idle", properties: { sessionID: sid } } : { type: "session.execution.succeeded", data: { sessionID: sid } });

for (const kind of ["v1", "v2"]) {
  describe(`opencode ${kind === "v1" ? "1.x" : "2.x"} (explicit URL)`, { skip }, () => {
    let ws, fake, f;
    const ctx = () => f.ctx;
    const live = async () => (await call("state", {}, ctx())).liveMode.live;
    const finish = async (sid) => {
      fake.send(busyEvent(kind, sid));
      fake.send(idleEvent(kind, sid));
      await waitFor(async () => (await live()).sessions[sid]?.status === "idle", "the session to go idle");
    };

    before(async () => {
      ws = makeWorkspace();
      fake = await startFakeOpencode({ kind, password: kind === "v2" ? PASSWORD : null });
      f = await startConnector(configFor(ws.dir, { url: fake.url }), { OPENCODE_SERVER_PASSWORD: PASSWORD });
      await waitFor(() => oc.status().details.opencode.connected && fake.state.streams.size === 1, "opencode to connect");
    });
    after(async () => {
      await oc.stop();
      await fake.close();
      ws.remove();
    });

    test("[P-connect] connects and follows the event stream", async () => {
      const s = oc.status();
      assert.equal(s.state, "ready");
      assert.equal(s.message, null);
      assert.equal(s.details.opencode.kind, kind);
      assert.equal(s.details.opencode.version, fake.state.version);
      assert.equal(s.details.workspace, ws.dir);
      assert.equal(fake.state.streams.size, 1);
    });

    test("[P-status] status keeps the shell API 1 shape, with next.text from the parser", async () => {
      const st = await call("status", {}, ctx());
      assert.deepEqual(Object.keys(st).sort(), ["api", "app", "error", "items", "opencode", "starting", "version", "workspace"]);
      assert.equal(st.app, "eng-agents-dashboard");
      assert.equal(st.api, 1);
      assert.equal(st.version, oc.version);
      assert.equal(st.workspace, path.basename(ws.dir));
      assert.deepEqual(st.opencode, { connected: true, error: null });
      assert.equal(st.error, null);
      assert.deepEqual(st.starting, []);
      assert.deepEqual(st.items.map((i) => i.id).sort(), numbered.map((i) => i.id).sort());
      for (const want of numbered) {
        const got = st.items.find((i) => i.id === want.id);
        assert.deepEqual(Object.keys(got).sort(), ["agent", "autopilot", "blocked", "bucket", "id", "lane", "next", "paused", "stage", "tasks", "title", "waiting"]);
        assert.equal(got.title, want.title);
        assert.equal(got.lane, want.lane);
        assert.equal(got.bucket, want.bucket, `${want.id} bucket`);
        assert.equal(got.stage, want.next.stage, `${want.id} stage`);
        const text = want.paused ? "Resume this item" : want.next.text;
        assert.deepEqual(got.next, { command: want.next.command, action: want.next.action, text, needsYou: want.next.needsYou }, `${want.id} next`);
        assert.equal(got.paused, !!want.paused);
        assert.equal(got.blocked, !!want.blocked);
        assert.deepEqual(got.tasks, { done: want.tasks.done, total: want.tasks.total });
        assert.equal(got.agent, null);
        assert.equal(got.autopilot, null);
      }
    });

    test("[P-state] state has the model, step words, PR text and the live opencode state", async () => {
      const s = await call("state", {}, ctx());
      assert.ok(s.stepWords && s.stepWords.spec, "stepWords from New-Dashboard.ps1");
      const ship = s.items.find((i) => i.id === "41610");
      assert.equal(ship.pr.length, 1);
      assert.equal(ship.pr[0].repo, "gateway");
      assert.equal(ship.pr[0].branch, "dev/bug/41610-rate-limit-headers");
      assert.equal(ship.pr[0].title, "Send rate limit headers on every response");
      assert.match(ship.pr[0].description, /Adds the standard rate limit headers/);
      assert.ok(Array.isArray(s.activity));
      assert.equal(s.liveMode.error, null);
      assert.equal(s.liveMode.live.opencode.connected, true);
      assert.equal(s.liveMode.live.opencode.kind, kind);
      assert.match(s.liveMode.live.opencode.attach, /^opencode /, "the TUI command for the More menu");
      assert.equal("token" in s.liveMode, false);
    });

    test("[P-run] run starts a pipeline command in the item's session; do-task gets a fresh one", async () => {
      const r = await call("run", { folder: "41207-fix-login-timeout", command: "/do-task 41207 3" }, ctx());
      assert.match(r.session, /^ses_/);
      const sid = r.session;
      const created = fake.bodiesFor(kind === "v1" ? "POST /session" : "POST /api/session").at(-1);
      assert.equal(created.title, "41207: /do-task 41207 3");
      if (kind === "v2") assert.equal(created.location.directory, ws.dir);
      await waitFor(() => fake.count(kind === "v1" ? `POST /session/${sid}/command` : `POST /api/session/${sid}/command`) === 1, "the command call");
      const body = fake.bodiesFor(kind === "v1" ? `POST /session/${sid}/command` : `POST /api/session/${sid}/command`)[0];
      assert.deepEqual(body, kind === "v1" ? { command: "do-task", arguments: "41207 3" } : { name: "do-task", text: "41207 3" });
      const links = JSON.parse(fs.readFileSync(path.join(ws.work, "_dashboard", "sessions.json"), "utf8"));
      assert.equal(links["41207-fix-login-timeout"].sessions.at(-1).id, sid);
      assert.equal(links["41207-fix-login-timeout"].sessions.at(-1).command, "/do-task 41207 3");

      // Busy: a second command for the same item waits.
      await rejects(call("run", { folder: "41207-fix-login-timeout", command: "/review 41207" }, ctx()), "conflict", /still working/);
      await finish(sid);
      // Idle: /review reuses the item's session.
      const again = await call("run", { folder: "41207-fix-login-timeout", command: "/review 41207" }, ctx());
      assert.equal(again.session, sid);
      await finish(sid);
      // do-task always gets a new one.
      const fresh = await call("run", { folder: "41207-fix-login-timeout", command: "/do-task 41207 3" }, ctx());
      assert.notEqual(fresh.session, sid);
      await finish(fresh.session);
    });

    test("[P-run] run refuses unknown items, non-commands and commands opencode does not have", async () => {
      await rejects(call("run", { folder: "nope", command: "/spec 1" }, ctx()), "not_found");
      await rejects(call("run", { folder: "41207-fix-login-timeout", command: "spec 41207" }, ctx()), "bad_request", /Not a command/);
      await rejects(call("run", { folder: "41207-fix-login-timeout", command: "/deploy 41207" }, ctx()), "bad_request", /no \/deploy command/);
    });

    test("[P-events] agent.done, live and model events, all small", async () => {
      const r = await call("run", { folder: "41455-audit-log-filter", command: "/spec 41455" }, ctx());
      await finish(r.session);
      await waitFor(() => f.rec.events.some((e) => e.event === "agent.done" && e.payload.session === r.session), "agent.done");
      const done = f.rec.events.filter((e) => e.event === "agent.done" && e.payload.session === r.session);
      assert.equal(done.length, 1, "one agent.done per turn");
      assert.deepEqual(done[0].payload, { folder: "41455-audit-log-filter", session: r.session, error: null });
      await waitFor(() => f.rec.events.some((e) => e.event === "live"), "live");
      const lastLive = f.rec.events.filter((e) => e.event === "live").at(-1).payload;
      assert.deepEqual(Object.keys(lastLive).sort(), ["autopilot", "busy", "connected", "error", "waiting"]);
      assert.ok(f.rec.events.some((e) => e.event === "model" && e.payload.items === expected.items.length));
      for (const e of f.rec.events) assert.ok(JSON.stringify(e.payload).length < 4096, `${e.event} payload is small`);
    });

    test("[P-start] start runs /start <id> <lane> in a new session and reports it as starting", async () => {
      const r = await call("start", { id: "50001", lane: "feature" }, ctx());
      const created = fake.bodiesFor(kind === "v1" ? "POST /session" : "POST /api/session").at(-1);
      assert.equal(created.title, "50001: /start 50001 feature");
      await waitFor(() => fake.count(kind === "v1" ? `POST /session/${r.session}/command` : `POST /api/session/${r.session}/command`) === 1, "the /start call");
      const st = await call("status", {}, ctx());
      assert.deepEqual(st.starting, [{ id: "50001", agent: "busy", waiting: false, error: null }]);
      await rejects(call("start", { id: "50001", lane: "feature" }, ctx()), "conflict", /already starting/);
      await rejects(call("start", { id: "41207", lane: "bug" }, ctx()), "conflict", /already started/);
      // /start ended but its folder is not there yet: still listed, now idle.
      fake.send(busyEvent(kind, r.session));
      fake.send(idleEvent(kind, r.session));
      await waitFor(async () => (await call("status", {}, ctx())).starting[0]?.agent === "idle", "/start to end");
    });

    test("[P-reply] reply sends text to the session, and a /command to the item's pipeline", async () => {
      const r = await call("run", { folder: "41300-export-retry-fails", command: "/bug 41300" }, ctx());
      await finish(r.session);
      await call("reply", { session: r.session, text: "Use the second approach." }, ctx());
      const route = kind === "v1" ? `POST /session/${r.session}/prompt_async` : `POST /api/session/${r.session}/prompt`;
      assert.deepEqual(fake.bodiesFor(route).at(-1), kind === "v1" ? { parts: [{ type: "text", text: "Use the second approach." }] } : { text: "Use the second approach." });
      await finish(r.session);
      const viaReply = await call("reply", { session: r.session, text: "/tasks 41300" }, ctx());
      assert.equal(viaReply.session, r.session, "a /command reply runs in the item's session");
      await finish(r.session);
      await rejects(call("reply", { session: "ses_unknown", text: "hi" }, ctx()), "not_found");
      await rejects(call("reply", { session: r.session, text: "   " }, ctx()), "bad_request");
    });

    test("[P-answer] permission prompts: shown with their item, agent.waiting, answered", async () => {
      const r = await call("run", { folder: "41610-rate-limit-headers", command: "/pr 41610" }, ctx());
      const sid = r.session;
      if (kind === "v1") {
        const p = { id: "per_1", sessionID: sid, permission: "bash", patterns: ["git push"], metadata: { command: "git push" } };
        fake.state.permissions.push(p);
        fake.send({ type: "permission.asked", properties: p });
      } else {
        fake.state.permissions.push({ id: "per_1", sessionID: sid, action: "bash", resources: ["git push"], save: [], metadata: { command: "git push" } });
        fake.send({ type: "permission.asked", data: { sessionID: sid }, location: { directory: ws.dir } });
      }
      const p = await waitFor(async () => (await live()).permissions.find((x) => x.id === "per_1"), "the permission prompt");
      assert.equal(p.folder, "41610-rate-limit-headers");
      assert.equal(p.title, "git push");
      const waitEv = await waitFor(() => f.rec.events.find((e) => e.event === "agent.waiting" && e.payload.kind === "permission"), "agent.waiting");
      assert.deepEqual(waitEv.payload, { folder: "41610-rate-limit-headers", session: sid, kind: "permission", question: "git push" });
      const st = await call("status", {}, ctx());
      assert.equal(st.items.find((i) => i.id === "41610").waiting, true);
      await rejects(call("answer", { kind: "permission", id: "per_1", reply: "sometimes" }, ctx()), "bad_request");
      await call("answer", { kind: "permission", id: "per_1", reply: "once" }, ctx());
      if (kind === "v1") assert.deepEqual(fake.bodiesFor(`POST /session/${sid}/permissions/per_1`), [{ response: "once" }]);
      else assert.deepEqual(fake.bodiesFor(`POST /api/session/${sid}/permission/per_1/reply`), [{ decision: "once" }]);
      assert.equal((await live()).permissions.length, 0);
      await rejects(call("answer", { kind: "permission", id: "per_1", reply: "once" }, ctx()), "not_found", /already answered/);
      await finish(sid);
    });

    test("[P-answer] questions: shown, answered by label, or dismissed", async () => {
      const r = await call("run", { folder: "41455-audit-log-filter", command: "/spec 41455" }, ctx());
      const sid = r.session;
      const ask = (id) => {
        if (kind === "v1") {
          const q = { id, sessionID: sid, questions: [{ header: "Branch", question: "Which branch?", options: [{ label: "main" }, { label: "dev" }] }] };
          fake.state.forms.push(q);
          fake.send({ type: "question.asked", properties: q });
        } else {
          fake.state.forms.push({ id, sessionID: sid, title: "Branch", fields: [{ key: "branch", title: "Branch", description: "Which branch?", type: "select", options: [{ label: "Main", value: "main" }, { label: "Dev", value: "dev" }] }] });
          fake.send({ type: "form.created", data: { sessionID: sid }, location: { directory: ws.dir } });
        }
      };
      ask("que_1");
      const q = await waitFor(async () => (await live()).questions.find((x) => x.id === "que_1"), "the question");
      assert.equal(q.folder, "41455-audit-log-filter");
      assert.equal(q.questions[0].question, "Which branch?");
      await waitFor(() => f.rec.events.find((e) => e.event === "agent.waiting" && e.payload.kind === "question"), "agent.waiting");
      await call("answer", { kind: "question", id: "que_1", answers: [[kind === "v1" ? "dev" : "Dev"]] }, ctx());
      if (kind === "v1") assert.deepEqual(fake.bodiesFor("POST /question/que_1/reply"), [{ answers: [["dev"]] }]);
      else assert.deepEqual(fake.bodiesFor(`POST /api/session/${sid}/form/que_1/reply`), [{ answer: { branch: "dev" } }]);
      ask("que_2");
      await waitFor(async () => (await live()).questions.find((x) => x.id === "que_2"), "the second question");
      await call("answer", { kind: "question", id: "que_2", reject: true }, ctx());
      assert.equal(fake.count(kind === "v1" ? "POST /question/que_2/reject" : `DELETE /api/session/${sid}/form/que_2`), 1);
      await finish(sid);
    });

    test("[P-abort] abort stops the session", async () => {
      const r = await call("run", { folder: "41207-fix-login-timeout", command: "/do-task 41207 3" }, ctx());
      await call("abort", { session: r.session }, ctx());
      assert.equal(fake.count(kind === "v1" ? `POST /session/${r.session}/abort` : `POST /api/session/${r.session}/interrupt`), 1);
      await finish(r.session);
    });

    test("[P-terminal] terminal refuses a bad session id; elsewhere than Windows and macOS it says to copy the command", async () => {
      await rejects(call("terminal", { session: "ses_1; rm -rf ~" }, ctx()), "bad_request", /Bad session id/);
      const s = await call("state", {}, ctx());
      assert.equal(s.liveMode.live.canOpenTerminal, process.platform === "win32" || process.platform === "darwin");
      // Opening a real terminal window is checked by hand (PARITY.md); here only where it cannot open one.
      if (process.platform === "linux") await rejects(call("terminal", {}, ctx()), "bad_request", /Copy the command instead/);
    });

    test("[P-autopilot] autopilot runs the next step in a fresh session and stops when asked", async () => {
      await rejects(call("autopilot", { folder: "41455-audit-log-filter", action: "start" }, ctx()), "conflict", /paused/);
      await rejects(call("autopilot", { folder: "41300-export-retry-fails", action: "start" }, ctx()), "conflict", /bug.md is approved/);
      const before = fake.state.sessions.size;
      await call("autopilot", { folder: "41207-fix-login-timeout", action: "start" }, ctx());
      assert.equal(fake.state.sessions.size, before + 1, "a new session for the step");
      const created = fake.bodiesFor(kind === "v1" ? "POST /session" : "POST /api/session").at(-1);
      assert.equal(created.title, "41207: /do-task 41207 3");
      const st = await call("status", {}, ctx());
      assert.deepEqual(st.items.find((i) => i.id === "41207").autopilot, { status: "running", message: null });
      await rejects(call("run", { folder: "41207-fix-login-timeout", command: "/review 41207" }, ctx()), "conflict", /Autopilot is running/);
      assert.ok(f.rec.events.some((e) => e.event === "autopilot" && e.payload.folder === "41207-fix-login-timeout" && e.payload.status === "running"));
      await call("autopilot", { folder: "41207-fix-login-timeout", action: "stop" }, ctx());
      assert.ok(f.rec.events.some((e) => e.event === "autopilot" && e.payload.status === "stopped"));
      const saved = JSON.parse(fs.readFileSync(path.join(ws.work, "_dashboard", "autopilot.json"), "utf8"));
      assert.equal(saved["41207-fix-login-timeout"].status, "stopped");
      await call("autopilot", { folder: "41207-fix-login-timeout", action: "dismiss" }, ctx());
      const sid = (await call("state", {}, ctx())).liveMode.live.items["41207-fix-login-timeout"].current;
      await finish(sid);
    });

    test("[P-autopilot] Approve and build approves the bug analysis first", async () => {
      await call("autopilot", { folder: "41300-export-retry-fails", action: "approve-start" }, ctx());
      const created = fake.bodiesFor(kind === "v1" ? "POST /session" : "POST /api/session").at(-1);
      assert.equal(created.title, "41300: /approve 41300 bug");
      await call("autopilot", { folder: "41300-export-retry-fails", action: "stop" }, ctx());
      const sid = (await call("state", {}, ctx())).liveMode.live.items["41300-export-retry-fails"].current;
      await finish(sid);
    });

    test("[P-secret] the 2.x password never shows up in results, events or logs", async () => {
      const everything = JSON.stringify([await call("state", {}, ctx()), await call("status", {}, ctx()), oc.status(), f.rec.events, f.rec.logs]);
      assert.equal(everything.includes(PASSWORD), false);
    });
  });
}

describe("opencode 2.x found through the CLI", { skip }, () => {
  test("[P-connect] opencode service start gives the URL; the password comes from service.json", async () => {
    const ws = makeWorkspace();
    const fake = await startFakeOpencode({ kind: "v2", password: PASSWORD });
    const cli = makeFakeCli({ version: "2.0.4", serviceUrl: fake.url, password: PASSWORD });
    try {
      await startConnector(configFor(ws.dir, { command: cli.cmd, startServer: true }));
      await waitFor(() => oc.status().details.opencode.connected, "opencode to connect", 30000);
      assert.equal(oc.status().details.opencode.kind, "v2");
      assert.ok(fake.count("GET /api/event") >= 1);
    } finally {
      await oc.stop();
      await fake.close();
      cli.remove();
      ws.remove();
    }
  });

  test("[P-connect] a service on another computer is refused", async () => {
    const ws = makeWorkspace();
    const cli = makeFakeCli({ version: "2.0.4", serviceUrl: "http://192.0.2.10:4096", password: PASSWORD });
    try {
      await startConnector(configFor(ws.dir, { command: cli.cmd }));
      await waitFor(() => /not on this computer/.test(oc.status().details.opencode.error || ""), "the refusal", 30000);
      assert.equal(oc.status().state, "ready", ".work still works without opencode");
      assert.equal(oc.status().details.opencode.connected, false);
      await rejects(call("run", { folder: "41207-fix-login-timeout", command: "/spec 41207" }), "unavailable", /not on this computer/);
    } finally {
      await oc.stop();
      cli.remove();
      ws.remove();
    }
  });
});

describe("settings and lifecycle", { skip }, () => {
  test("a URL that is not on this computer, or a missing .work, is reported in status", async () => {
    const ws = makeWorkspace();
    try {
      await startConnector(configFor(ws.dir, { url: "https://opencode.example.com" }));
      assert.equal(oc.status().state, "error");
      assert.match(oc.status().message, /must be on this computer/);
      await oc.stop();
      await startConnector(configFor(path.join(ws.dir, "missing")));
      assert.equal(oc.status().state, "error");
      assert.match(oc.status().message, /No \.work folder/);
      await rejects(call("status"), "unavailable", /No \.work folder/);
      await oc.stop();
      await startConnector({ ...configFor(ws.dir, { url: "http://127.0.0.1:9" }), powershell: "no-such-powershell-xyz" });
      assert.equal(oc.status().state, "error");
      assert.match(oc.status().message, /Could not run PowerShell/);
    } finally {
      await oc.stop();
      ws.remove();
    }
  });

  test("[P-connect] without opencode, .work still reads and actions that need opencode say so", async () => {
    const ws = makeWorkspace();
    try {
      await startConnector(configFor(ws.dir, { url: "http://127.0.0.1:9" }));
      await waitFor(() => oc.status().details.opencode.error, "the connection error", 15000);
      const s = oc.status();
      assert.equal(s.state, "ready");
      assert.match(s.message, /opencode is not running at http:\/\/127\.0\.0\.1:9/);
      const st = await call("status");
      assert.equal(st.opencode.connected, false);
      assert.equal(st.items.length, numbered.length);
      await rejects(call("start", { id: "1", lane: "bug" }), "unavailable", /not running/);
    } finally {
      await oc.stop();
      ws.remove();
    }
  });

  test("[P-refresh] refresh and the watcher pick up .work changes; file.read reads only .work Markdown", async () => {
    const ws = makeWorkspace();
    try {
      const f = await startConnector(configFor(ws.dir, { url: "http://127.0.0.1:9" }));
      fs.writeFileSync(path.join(ws.work, "41455-audit-log-filter", "spec.md"), "# Spec\n\nStatus: APPROVED\n");
      const r = await call("refresh");
      assert.deepEqual(r, { ok: true, error: null });
      const item = (await call("status")).items.find((i) => i.id === "41455");
      assert.equal(item.next.command, "/plan 41455", "approved spec: the plan is next (the item stays paused)");
      assert.equal(item.paused, true);
      fs.mkdirSync(path.join(ws.work, "60001-new-item"));
      fs.writeFileSync(path.join(ws.work, "60001-new-item", "workitem.md"), "# Work item 60001: New item\n\n- Type: Bug\n");
      await waitFor(async () => (await call("status")).items.some((i) => i.id === "60001"), "the watcher or poll to see the new folder", 30000);
      assert.ok(f.rec.events.filter((e) => e.event === "model").length >= 2);

      const plan = await call("file.read", { folder: "41207-fix-login-timeout", file: "plan.md" });
      assert.match(plan.text, /^# Plan: 41207/);
      await rejects(call("file.read", { folder: "..", file: "secret.md" }), "not_found");
      await rejects(call("file.read", { folder: "41207-fix-login-timeout", file: "../../x.md" }), "not_found");
      await rejects(call("file.read", { folder: "41207-fix-login-timeout", file: "notes.txt" }), "not_found");
      await rejects(call("file.read", { folder: "41207-fix-login-timeout", file: "missing.md" }), "not_found");
    } finally {
      await oc.stop();
      ws.remove();
    }
  });

  test("stop ends the event stream and sends nothing more", async () => {
    const ws = makeWorkspace();
    const fake = await startFakeOpencode({ kind: "v1" });
    try {
      const f = await startConnector(configFor(ws.dir, { url: fake.url }));
      await waitFor(() => fake.state.streams.size === 1, "the event stream");
      await oc.stop();
      assert.equal(oc.status().state, "stopped");
      await waitFor(() => fake.state.streams.size === 0, "the stream to close", 5000);
      const n = f.rec.events.length;
      fs.writeFileSync(path.join(ws.work, "41207-fix-login-timeout", "notes.md"), "x\n");
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(f.rec.events.length, n);
      await rejects(call("status"), "unavailable");
    } finally {
      await oc.stop();
      await fake.close();
      ws.remove();
    }
  });

  test("a hand-edited sessions.json in another shape does not break the state", async () => {
    const ws = makeWorkspace();
    try {
      fs.mkdirSync(path.join(ws.work, "_dashboard"), { recursive: true });
      fs.writeFileSync(path.join(ws.work, "_dashboard", "sessions.json"), JSON.stringify({ "41207-fix-login-timeout": "ses_example" }));
      await startConnector(configFor(ws.dir, { url: "http://127.0.0.1:9" }));
      const s = await call("state");
      assert.deepEqual(s.liveMode.live.items, {});
    } finally {
      await oc.stop();
      ws.remove();
    }
  });
});

describe("remove", { skip }, () => {
  test("[P-remove] remove needs the item id typed, then deletes only that .work folder and its state", async () => {
    const ws = makeWorkspace({ repos: hasGit });
    const fake = await startFakeOpencode({ kind: "v1" });
    try {
      await startConnector(configFor(ws.dir, { url: fake.url }));
      await waitFor(() => oc.status().details.opencode.connected, "opencode");
      const r = await call("run", { folder: "41610-rate-limit-headers", command: "/pr 41610" });
      fake.send(idleEvent("v1", r.session));
      await rejects(call("remove", { folder: "41610-rate-limit-headers", confirm: "41611" }), "bad_request", /Type 41610 to confirm/);
      await rejects(call("remove", { folder: "_dashboard", confirm: "_dashboard" }), "not_found");
      await waitFor(async () => (await call("state")).liveMode.live.sessions[r.session]?.status === "idle", "idle");
      assert.deepEqual(await call("remove", { folder: "41610-rate-limit-headers", confirm: "41610" }), { ok: true, removed: "41610-rate-limit-headers" });
      assert.equal(fs.existsSync(path.join(ws.work, "41610-rate-limit-headers")), false);
      const links = JSON.parse(fs.readFileSync(path.join(ws.work, "_dashboard", "sessions.json"), "utf8"));
      assert.equal("41610-rate-limit-headers" in links, false);
      assert.equal((await call("status")).items.some((i) => i.id === "41610"), false);
      if (hasGit) assert.ok(fs.existsSync(path.join(ws.dir, "gateway", ".git")), "repos are left alone");
      const spike = await call("remove", { folder: "spike-cache-options", confirm: "spike-cache-options" });
      assert.equal(spike.removed, "spike-cache-options");
    } finally {
      await oc.stop();
      await fake.close();
      ws.remove();
    }
  });
});

describe("push", { skip: skip || (!hasGit && "git is not installed") }, () => {
  let ws;
  const prFile = () => path.join(ws.work, "41610-rate-limit-headers", "pr.md");
  const setBranch = async (line) => {
    const text = fs.readFileSync(prFile(), "utf8").replace(/^Branch: .*$/m, line);
    fs.writeFileSync(prFile(), text);
    await call("refresh");
  };
  before(async () => {
    ws = makeWorkspace({ repos: true });
    await startConnector(configFor(ws.dir, { url: "http://127.0.0.1:9" }));
  });
  after(async () => {
    await oc.stop();
    ws.remove();
  });

  test("[P-push] pushes only the pr.md branch, with -u, to origin", async () => {
    const r = await call("push", { folder: "41610-rate-limit-headers", repo: "gateway" });
    assert.deepEqual(r, { ok: true, message: "Pushed dev/bug/41610-rate-limit-headers in gateway." });
    assert.deepEqual(ws.branchesAt(), ["dev/bug/41610-rate-limit-headers"]);
  });

  test("[P-push] never pushes main, master, develop, dev or the PR's target branch", async () => {
    for (const b of ["main", "master", "develop", "dev", "Main"]) {
      await setBranch(`Branch: \`${b}\` -> \`release\``);
      await rejects(call("push", { folder: "41610-rate-limit-headers", repo: "gateway" }), "bad_request", /does not push/);
    }
    await setBranch("Branch: `release` -> `release`");
    await rejects(call("push", { folder: "41610-rate-limit-headers", repo: "gateway" }), "bad_request", /does not push release/);
    assert.deepEqual(ws.branchesAt(), ["dev/bug/41610-rate-limit-headers"]);
  });

  test("[P-push] refuses odd branch names and repo folders outside the workspace", async () => {
    for (const b of ["-f", "a..b", "x;rm"]) {
      await setBranch(`Branch: \`${b}\` -> \`main\``);
      await rejects(call("push", { folder: "41610-rate-limit-headers", repo: "gateway" }), "bad_request");
    }
    await setBranch("Branch: `dev/bug/41610-rate-limit-headers` -> `main`");
    await rejects(call("push", { folder: "41610-rate-limit-headers", repo: "../gateway" }), "not_found", /no section/);
    await rejects(call("push", { folder: "41610-rate-limit-headers", repo: "web-app" }), "not_found", /no section/);
    await rejects(call("push", { folder: "41207-fix-login-timeout", repo: "auth-lib" }), "not_found", /no section/);
  });

  test("[P-push] never force pushes: a diverged remote branch fails with git's message", async () => {
    const gw = path.join(ws.dir, "gateway");
    const { spawnSync } = await import("node:child_process");
    const g = (...a) => spawnSync("git", a, { cwd: gw, encoding: "utf8" });
    g("commit", "-q", "--amend", "-m", "rewritten");
    await rejects(call("push", { folder: "41610-rate-limit-headers", repo: "gateway" }), "unavailable", /Push failed for gateway/);
  });
});
