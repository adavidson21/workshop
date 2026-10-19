// The opencode connector through the agent API, against the mock agent and the real agent (WS1).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMockAgent } from "../../../tests/mock-agent.mjs";
import { start as startReal } from "../../../agent/test-target.mjs";
import { expectError, expectJson, get, openEvents, post, put, schemas } from "../../../tests/contract/helpers.mjs";
import oc, { configSchema } from "../index.mjs";
import { startFakeOpencode } from "./fake-opencode.mjs";
import { REPO, configFor, hasPowerShell, makeWorkspace, waitFor } from "./harness.mjs";

const skip = hasPowerShell ? false : "PowerShell is not installed (the .work parser needs it)";
const PASSWORD = "fake-service-password-9b2c";

test("module follows the connector contract and its configSchema fits the settings form", () => {
  assert.equal(oc.id, "opencode");
  assert.equal(oc.api, 1);
  assert.deepEqual(schemas.validate("config-form", configSchema), []);
  const writes = Object.entries(oc.actions).filter(([, a]) => a.write).map(([n]) => n).sort();
  assert.deepEqual(writes, ["abort", "answer", "autopilot", "push", "remove", "reply", "run", "start"], "everything that changes opencode, git or .work needs confirm");
  for (const n of ["status", "state", "refresh", "file.read", "terminal"]) assert.equal(oc.actions[n].write, false);
});

test("the C0 example's opencode entry and a typical config are valid", () => {
  const hosted = JSON.parse(fs.readFileSync(path.join(REPO, "docs/examples/config.hosted.json"), "utf8"));
  assert.equal(hosted.connectors.opencode.enabled, false);
  assert.deepEqual(schemas.validate(configSchema, { workspace: "~/src/work" }), []);
  assert.deepEqual(schemas.validate(configSchema, configFor("C:\\src\\work", { url: "http://127.0.0.1:4096" })), []);
  assert.notDeepEqual(schemas.validate(configSchema, { workspace: "x", opencode: { command: 'opencode" & calc' } }), []);
  assert.notDeepEqual(schemas.validate(configSchema, {}), [], "workspace is required");
});

/** Runs fn against the mock agent and the real agent, each with opencode enabled and a fake 2.x service. */
async function withAgent(fn) {
  for (const kind of ["mock", "real"]) {
    const ws = makeWorkspace();
    const fake = await startFakeOpencode({ kind: "v2", password: PASSWORD });
    const env = { OPENCODE_SERVER_PASSWORD: PASSWORD };
    const cfg = { configVersion: 1, connectors: { opencode: { enabled: true, config: configFor(ws.dir, { url: fake.url }) } } };
    const dirs = { connectorsDir: path.join(REPO, "connectors"), appsDir: path.join(REPO, "tests", "fixtures", "apps") };
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-oc-agent-"));
    const lines = [];
    const agent = kind === "mock"
      ? await createMockAgent({ ...dirs, env, config: cfg, log: (who, level, msg) => lines.push(`${who} ${level} ${msg}`) })
      : await startReal({ ...dirs, home, env, config: cfg });
    const logs = () => (kind === "mock" ? lines.join("\n") : fs.existsSync(path.join(home, "logs"))
      ? fs.readdirSync(path.join(home, "logs")).map((f) => fs.readFileSync(path.join(home, "logs", f), "utf8")).join("\n") : "");
    try {
      await waitFor(async () => {
        const info = (await get(agent, "/api/connectors/opencode")).json;
        return info.status.state === "ready" && info.status.message === null;
      }, "the connector to be ready and connected", 60000);
      await fn({ agent, fake, ws, logs, kind });
    } catch (e) {
      e.message = `[${kind} agent] ${e.message}`;
      throw e;
    } finally {
      await agent.stop();
      await fake.close();
      fs.rmSync(home, { recursive: true, force: true });
      ws.remove();
    }
  }
}

const call = (agent, action, args, extra = {}) => post(agent, `/api/connectors/opencode/${action}`, { args, ...extra });

test("status, state and write actions through the agent; events on the stream; the password stays out", { skip }, async () => {
  await withAgent(async ({ agent, fake, logs }) => {
    const info = expectJson(await get(agent, "/api/connectors/opencode"), 200, "connector-info");
    assert.equal(info.enabled, true);
    assert.equal(info.status.details.opencode.kind, "v2");
    assert.ok(info.actions.some((a) => a.name === "push" && a.write === true));

    const st = expectJson(await call(agent, "status", {}), 200, "connector-call-response").result;
    assert.equal(st.app, "eng-agents-dashboard");
    assert.equal(st.api, 1);
    assert.equal(st.items.length, 5);

    const events = await openEvents(agent);
    try {
      const err = expectError(await call(agent, "run", { folder: "41207-fix-login-timeout", command: "/do-task 41207 3" }), 400, "confirm_required");
      assert.match(err.error, /Run a pipeline command changes something outside Workshop/);
      expectError(await call(agent, "run", { folder: "41207-fix-login-timeout" }, { confirm: true }), 400, "bad_request");
      const run = expectJson(await call(agent, "run", { folder: "41207-fix-login-timeout", command: "/do-task 41207 3" }, { confirm: true }), 200).result;
      assert.match(run.session, /^ses_/);
      fake.send({ type: "session.execution.started", data: { sessionID: run.session } });
      fake.send({ type: "session.execution.succeeded", data: { sessionID: run.session } });
      const done = await events.next("connector", (d) => d.id === "opencode" && d.event === "agent.done", 10000);
      schemas.assert("event", { event: done.event, data: done.data });
      assert.deepEqual(done.data.payload, { folder: "41207-fix-login-timeout", session: run.session, error: null });
      await events.next("connector", (d) => d.id === "opencode" && d.event === "live", 10000);

      expectError(await call(agent, "run", { folder: "nope", command: "/spec 1" }, { confirm: true }), 404, "not_found");
      const conflict = expectError(await call(agent, "start", { id: "41207", lane: "bug" }, { confirm: true }), 409, "conflict");
      assert.match(conflict.error, /already started/);
    } finally {
      events.close();
    }

    const cfg = expectJson(await get(agent, "/api/connectors/opencode/config"), 200, "connector-config");
    assert.deepEqual(cfg.env, { OPENCODE_SERVER_PASSWORD: { set: true }, OPENCODE_SERVER_USERNAME: { set: false } });
    const state = expectJson(await call(agent, "state", {}), 200).result;
    for (const text of [JSON.stringify(cfg), JSON.stringify(state), JSON.stringify(info), logs()]) assert.equal(text.includes(PASSWORD), false);
  });
});

test("a config change restarts the connector, and a bad one shows in its status", { skip }, async () => {
  await withAgent(async ({ agent, ws }) => {
    const bad = configFor(ws.dir, { url: "https://opencode.example.com" });
    expectJson(await put(agent, "/api/connectors/opencode/config", { config: bad }), 200, "connector-config");
    const info = await waitFor(async () => {
      const i = (await get(agent, "/api/connectors/opencode")).json;
      return i.status.state === "error" && i;
    }, "the error status", 30000);
    assert.match(info.status.message, /must be on this computer/);
    expectError(await call(agent, "status", {}), 503, "unavailable");
    expectError(await put(agent, "/api/connectors/opencode/config", { config: { workspace: ws.dir, extra: 1 } }), 400, "invalid_config");
  });
});
