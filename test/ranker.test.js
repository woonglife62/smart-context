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

test("rankMatches deprioritizes markdown files vs equivalent code files", () => {
  const lines = ["import auth from \"./auth\";", "function authMiddleware() {}"];
  const matches = [
    {
      filePath: "/x/code.js",
      relativeFile: "src/code.js",
      lines,
      matches: [
        { line: 0, text: lines[0] },
        { line: 1, text: lines[1] }
      ]
    },
    {
      filePath: "/x/notes.md",
      relativeFile: "docs/notes.md",
      lines,
      matches: [
        { line: 0, text: lines[0] },
        { line: 1, text: lines[1] }
      ]
    }
  ];
  const ranked = rankMatches("/x", matches, ["auth"], "auth middleware");
  assert.equal(ranked[0].file, "src/code.js");
  const codeEntry = ranked.find((entry) => entry.file === "src/code.js");
  const mdEntry = ranked.find((entry) => entry.file === "docs/notes.md");
  assert.ok(codeEntry.score > mdEntry.score, "code score should beat markdown score");
});

test("rankMatches deprioritizes .txt files like markdown", () => {
  const lines = ["function authMiddleware() {}"];
  const matches = [
    {
      filePath: "/x/notes.txt",
      relativeFile: "notes.txt",
      lines,
      matches: [{ line: 0, text: lines[0] }]
    }
  ];
  const ranked = rankMatches("/x", matches, ["auth"], "auth middleware");
  // 0 path matches (notes.txt has no "auth"), density 2, symbol (function) 2, non-test 2 = 6 -> *0.5 = 3
  assert.equal(ranked[0].score, 3);
});

test("rankMatches finds createUser.ts via expanded camelCase keywords", async () => {
  const { extractKeywords } = await import("../src/query.js");
  const keywords = extractKeywords("user create");
  // keywords should include "user" and "create" as sub-tokens
  const lines = ['export async function createUser(req, res) {'];
  const matches = [
    {
      filePath: "/x/users/createUser.ts",
      relativeFile: "users/createUser.ts",
      lines,
      matches: [{ line: 0, text: lines[0] }]
    }
  ];
  const ranked = rankMatches("/x", matches, keywords, "user create");
  assert.ok(ranked.length > 0);
  assert.ok(ranked[0].score > 0, `score should be > 0, got ${ranked[0].score}`);
  // path "users/createUser.ts" contains "user" and "create" — both from keyword expansion
  assert.ok(ranked[0].score >= 8, `expected path score boost from 'user'+'create' keywords, got ${ranked[0].score}`);
});
