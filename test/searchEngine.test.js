import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { smartContext } from "../src/searchEngine.js";

const workspaceRoot = path.resolve("test/fixtures/sample-project");

test("smartContext returns brief ranked snippets and stats", async () => {
  const result = await smartContext({ workspaceRoot, query: "where is auth middleware applied?", mode: "brief" });
  assert.equal(result.ok, true);
  assert(result.results.length > 0);
  assert.equal(result.results[0].file, "src/auth/middleware.ts");
  assert.equal(result.stats.snippets_returned > 0, true);
  assert.equal(typeof result.stats.estimated_tokens_saved, "number");
});

test("smartContext explain mode includes summary", async () => {
  const result = await smartContext({ workspaceRoot, query: "where is auth middleware applied?", mode: "explain" });
  assert.equal(result.ok, true);
  assert.match(result.summary, /auth|middleware/i);
});

test("smartContext rejects invalid mode", async () => {
  const result = await smartContext({ workspaceRoot, query: "auth", mode: "wide" });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_mode");
});

test("smartContext returns empty results for no match", async () => {
  const result = await smartContext({ workspaceRoot, query: "nonexistent payment webhook" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.results, []);
});
