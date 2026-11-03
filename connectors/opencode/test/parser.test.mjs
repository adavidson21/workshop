// The .work parser (parser/New-Dashboard.ps1, a copy of eng-agents' core/scripts/dashboard/New-Dashboard.ps1)
// run directly on the synthetic example workspace. Needs PowerShell; skipped without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { hasPowerShell, makeWorkspace, REPO } from "./harness.mjs";

const skip = hasPowerShell ? false : "PowerShell is not installed (the .work parser needs it)";
const ps = ["pwsh", "powershell"].find((exe) => spawnSync(exe, ["-NoProfile", "-Command", "1"], { windowsHide: true }).status === 0);
const script = path.join(REPO, "connectors", "opencode", "parser", "New-Dashboard.ps1");

test("a TSD that /publish marked PUBLISHED to <path> on <date> shows as Published", { skip }, () => {
  const ws = makeWorkspace();
  try {
    const r = spawnSync(ps, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-WorkRoot", ws.work, "-AsJson"], { cwd: ws.dir, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    const tsd = JSON.parse(r.stdout).items.find((i) => i.folder === "tsd-billing-api");
    assert.ok(tsd, "the example TSD is listed");
    assert.equal(tsd.state, "Published");
  } finally { ws.remove(); }
});
