// Where the opencode connector keeps things (Workshop docs/connector.md, ctx.dataDir and ctx.scratch): the Chat
// list in the data folder, hub requests and 1:1 packets in its working folder, and the old places on an agent
// that gives neither.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hubRoot } from "../lib/hub.mjs";
import { oneOnOneRoot } from "../lib/one-on-one.mjs";
import { moveOldChats, oldChatFile } from "../lib/chat.mjs";

test("hub requests and 1:1 packets go in the working folder when the agent gives one", () => {
  assert.equal(hubRoot("/h", "/d/.scratch/opencode"), path.join("/d/.scratch/opencode", "hub"));
  assert.equal(oneOnOneRoot("/h", "/d/.scratch/opencode"), path.join("/d/.scratch/opencode", "oneonones"));
  assert.equal(hubRoot("/h", null), path.join("/h", "data", "_connectors", "opencode", "hub"));
  assert.equal(oneOnOneRoot("/h", null), path.join("/h", "data", "_connectors", "opencode", "oneonones"));
});

test("the Chat list is copied into the data folder once, and the old file is kept", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-chats-"));
  try {
    const home = path.join(root, "home");
    const from = oldChatFile(home);
    const to = path.join(root, "Workshop", "chat", "chats.json");
    assert.equal(moveOldChats(to, from), false, "nothing to copy");
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.writeFileSync(from, '{"version":1,"items":[]}');
    assert.equal(moveOldChats(to, from), true);
    assert.equal(fs.readFileSync(to, "utf8"), '{"version":1,"items":[]}');
    assert.ok(fs.existsSync(from));
    fs.writeFileSync(to, '{"version":1,"items":[{"session":"s"}]}');
    assert.equal(moveOldChats(to, from), false, "never overwrites");
    assert.match(fs.readFileSync(to, "utf8"), /"s"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
