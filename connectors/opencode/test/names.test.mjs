// lib/names.mjs: the folder name Workshop picks for a new board run (1.36.0), the same rule Tandem's commands use.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freeName, shortName } from "../lib/names.mjs";

test("shortName: the first 5 meaningful words, lowercase, filler dropped, at most 40 characters", () => {
  assert.equal(shortName("I want to add a new ticket called a change request"), "i-want-ticket-called-change");
  assert.equal(shortName("Add CSV export to the Reports page!"), "csv-export-reports-page");
  assert.equal(shortName("Spike: how does the cache work?", 5), "spike-how-does-cache-work");
  assert.equal(shortName("internationalization localization accessibility performance observability"), "internationalization-localization");
  assert.ok(shortName("x".repeat(80)).length <= 40);
  assert.equal(shortName("   "), "untitled");
  assert.equal(shortName("the a an"), "untitled");
});

test("freeName never picks a folder that is there already", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-names-"));
  try {
    assert.equal(freeName("Bulk export", "shape", root), "bulk-export");
    fs.mkdirSync(path.join(root, "shape-bulk-export"));
    assert.equal(freeName("Bulk export", "shape", root), "bulk-export-2");
    fs.mkdirSync(path.join(root, "shape-bulk-export-2"));
    assert.equal(freeName("Bulk export", "shape", root), "bulk-export-3");
    assert.equal(freeName("Bulk export", "scope", root), "bulk-export", "another kind does not clash");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
