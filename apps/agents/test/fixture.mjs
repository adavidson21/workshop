// For tests/e2e.py: a synthetic workspace (docs/examples/work plus a git repo with a bare origin) and a fake
// opencode 1.x server, both from the opencode connector's test helpers. No work data.
//
//   node apps/agents/test/fixture.mjs
//
// Prints one JSON line {workspace, opencode, origin} when ready (origin: the bare repo gateway pushes to).
// Then reads commands, one JSON object per line:
//   {"ask": {"id": "per_x", "session": "ses_..."|null, "title": "git push"}}   a permission prompt
//   {"requests": true}                                                          the requests seen, and branches at origin
// and answers each with one JSON line. Stops when stdin closes.
import readline from "node:readline";
import { makeWorkspace } from "../../../connectors/opencode/test/harness.mjs";
import { startFakeOpencode } from "../../../connectors/opencode/test/fake-opencode.mjs";

const ws = makeWorkspace({ repos: true });
const fake = await startFakeOpencode({ kind: "v1" });
console.log(JSON.stringify({ workspace: ws.dir, opencode: fake.url, origin: ws.origin }));

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return console.log(JSON.stringify({ error: "bad json" })); }
  if (m.ask) {
    const p = { id: m.ask.id, sessionID: m.ask.session || "ses_tui0", permission: "bash", patterns: [m.ask.title], metadata: { command: m.ask.title } };
    if (!m.ask.session && !fake.state.sessions.has("ses_tui0")) fake.state.sessions.set("ses_tui0", { id: "ses_tui0", title: "Started in the TUI" });
    fake.state.permissions.push(p);
    fake.send({ type: "permission.asked", properties: p });
    return console.log(JSON.stringify({ ok: true }));
  }
  if (m.requests) return console.log(JSON.stringify({ requests: fake.state.requests, bodies: fake.state.bodies, branches: ws.branchesAt() }));
  console.log(JSON.stringify({ error: "unknown command" }));
});
const quit = async () => { await fake.close(); ws.remove(); process.exit(0); };
rl.on("close", quit);
process.on("SIGTERM", quit);
