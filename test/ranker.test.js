import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { listTextFiles, scanFiles } from "../src/scanner.js";
import { rankMatches } from "../src/ranker.js";

const root = path.resolve("test/fixtures/sample-project");

test("listTextFiles excludes dependencies and returns source files", async () => {
  const files = await listTextFiles(root, [root], []);
  assert(files.some((file) => file.endsWith("src/server.ts") || file.endsWith("src\\server.ts")));
});

test("rankMatches prefers implementation files for auth middleware", async () => {
  const files = await listTextFiles(root, [root], []);
  const matches = await scanFiles(root, files, ["auth", "middleware"]);
  const ranked = rankMatches(root, matches, ["auth", "middleware"], "auth middleware");
  assert.equal(ranked[0].file, "src/auth/middleware.ts");
});

test("rankMatches raises test files for test queries", async () => {
  const files = await listTextFiles(root, [root], []);
  const matches = await scanFiles(root, files, ["login", "failure"]);
  const ranked = rankMatches(root, matches, ["login", "failure"], "which tests cover login failure");
  assert.equal(ranked[0].file, "test/login.test.ts");
});
