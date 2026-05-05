import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveSearchPaths } from "../src/pathSafety.js";

const root = path.resolve("test/fixtures/sample-project");

test("resolveSearchPaths defaults to workspace root", () => {
  assert.deepEqual(resolveSearchPaths(root, undefined), [root]);
});

test("resolveSearchPaths accepts workspace-relative paths", () => {
  assert.deepEqual(resolveSearchPaths(root, ["src"]), [path.join(root, "src")]);
});

test("resolveSearchPaths rejects absolute paths", () => {
  assert.throws(() => resolveSearchPaths(root, [path.resolve("/")]), /absolute paths are not allowed/);
});

test("resolveSearchPaths rejects traversal outside workspace", () => {
  assert.throws(() => resolveSearchPaths(root, ["../outside"]), /outside the workspace/);
});
