// Settings' "Model for agent runs" (runModel, connector 1.32.0): runs and replies carry it; blank leaves it out.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import oc from "../index.mjs";
import { runModelOf } from "../lib/context.mjs";
import { startFakeOpencode } from "./fake-opencode.mjs";
import { configFor, fakeCtx, makeWorkspace, waitFor } from "./harness.mjs";

const PASSWORD = "fake-service-password-7a2c";
const call = (name, args = {}, ctx) => oc.actions[name].run(args, ctx);

test("runModelOf reads provider/model, and anything else as no model", () => {
  assert.deepEqual(runModelOf("google/gemini-flash-latest"), { provider: "google", id: "gemini-flash-latest" });
  assert.deepEqual(runModelOf(" openrouter/qwen/qwen3-coder "), { provider: "openrouter", id: "qwen/qwen3-coder" });
  for (const v of ["", null, undefined, "gemini", "/x", "a/", "a b/c", "a/b c"]) assert.equal(runModelOf(v), null, String(v));
});

test("the schema offers runModel as a models select a hosted page may change", () => {
  const p = oc.configSchema.properties.runModel;
  assert.equal(p.type, "string");
  assert.equal(p["x-workshop-models"], true);
  assert.equal(p["x-workshop-hosted"], true);
  const re = new RegExp(p.pattern);
  assert.ok(re.test("") && re.test("google/gemini-flash-latest") && !re.test("gemini"));
});

for (const kind of ["v1", "v2"]) {
  describe(`runModel on opencode ${kind === "v1" ? "1.x" : "2.x"}`, () => {
    let ws, fake, f;
    const ctx = () => f.ctx;
    before(async () => {
      ws = makeWorkspace();
      fake = await startFakeOpencode({ kind, password: kind === "v2" ? PASSWORD : null });
      f = fakeCtx({ ...configFor(ws.dir, { url: fake.url }), runModel: "google/gemini-flash-latest" }, { OPENCODE_SERVER_PASSWORD: PASSWORD });
      await oc.start(f.ctx);
      await waitFor(() => oc.status().state !== "starting", "the connector to read .work", 60000);
      await waitFor(() => oc.status().details.opencode.connected, "opencode to connect");
    });
    after(async () => {
      await oc.stop();
      await fake.close();
      ws.remove();
    });

    test("a run's command and a reply carry the model", async () => {
      const r = await call("run", { folder: "41207-fix-login-timeout", command: "/do-task 41207 3" }, ctx());
      const cmdRoute = kind === "v1" ? `POST /session/${r.session}/command` : `POST /api/session/${r.session}/command`;
      await waitFor(() => fake.count(cmdRoute) === 1, "the command call");
      const body = fake.bodiesFor(cmdRoute)[0];
      if (kind === "v1") assert.equal(body.model, "google/gemini-flash-latest");
      else assert.deepEqual(body.model, { providerID: "google", modelID: "gemini-flash-latest" });

      await call("reply", { session: r.session, text: "Go on." }, ctx());
      const route = kind === "v1" ? `POST /session/${r.session}/prompt_async` : `POST /api/session/${r.session}/prompt`;
      assert.deepEqual(fake.bodiesFor(route).at(-1).model, { providerID: "google", modelID: "gemini-flash-latest" });
    });
  });
}
