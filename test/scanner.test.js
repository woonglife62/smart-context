import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  listTextFiles,
  scanFiles,
  scanFilesNode,
  scanFilesWithRipgrep,
  isRipgrepAvailable
} from "../src/scanner.js";

const root = path.resolve("test/fixtures/sample-project");

function rgInstalled() {
  const candidates = process.platform === "win32" ? ["rg", "rg.exe", "C:/ProgramData/chocolatey/bin/rg.exe"] : ["rg"];
  for (const c of candidates) {
    try {
      const result = spawnSync(c, ["--version"], { stdio: "ignore" });
      if (result.status === 0) return true;
    } catch {}
  }
  return false;
}

test("scanFilesNode returns the same shape as before", async () => {
  const files = await listTextFiles(root, [root], []);
  const matches = await scanFilesNode(root, files, ["auth"]);
  assert.ok(matches.length > 0);
  for (const entry of matches) {
    assert.ok(typeof entry.filePath === "string");
    assert.ok(typeof entry.relativeFile === "string");
    assert.ok(Array.isArray(entry.lines));
    assert.ok(Array.isArray(entry.matches));
    for (const m of entry.matches) {
      assert.ok(typeof m.line === "number");
      assert.ok(typeof m.text === "string");
    }
  }
});

test("scanFiles auto-fallback returns matches", async () => {
  const files = await listTextFiles(root, [root], []);
  const matches = await scanFiles(root, files, ["auth"]);
  assert.ok(matches.length > 0);
  assert.ok(matches.some((entry) => entry.relativeFile.endsWith("middleware.ts")));
});

test("scanFilesWithRipgrep matches Node implementation when rg available", { skip: !isRipgrepAvailable() && !rgInstalled() }, async () => {
  const files = await listTextFiles(root, [root], []);
  const nodeMatches = await scanFilesNode(root, files, ["auth"]);
  const rgMatches = await scanFilesWithRipgrep(root, files, ["auth"]);
  const nodeFiles = new Set(nodeMatches.map((m) => m.relativeFile));
  const rgFiles = new Set(rgMatches.map((m) => m.relativeFile));
  for (const f of nodeFiles) {
    assert.ok(rgFiles.has(f), `rg missing ${f}`);
  }
  for (const entry of rgMatches) {
    assert.ok(typeof entry.filePath === "string");
    assert.ok(typeof entry.relativeFile === "string");
    assert.ok(Array.isArray(entry.lines));
    assert.ok(Array.isArray(entry.matches));
  }
});

test("isRipgrepAvailable returns false when SMART_CONTEXT_DISABLE_RG is set", () => {
  const previous = process.env.SMART_CONTEXT_DISABLE_RG;
  process.env.SMART_CONTEXT_DISABLE_RG = "1";
  try {
    assert.equal(isRipgrepAvailable(), false);
  } finally {
    if (previous === undefined) delete process.env.SMART_CONTEXT_DISABLE_RG;
    else process.env.SMART_CONTEXT_DISABLE_RG = previous;
  }
});
