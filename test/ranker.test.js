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
  // 0 path matches (notes.txt has no "auth"), density 2, symbol (function) 2, non-test 2 = 6 -> *0.2 = 1.2
  assert.ok(Math.abs(ranked[0].score - 1.2) < 0.01, `expected ~1.2 got ${ranked[0].score}`);
});

test("rankMatches gives a +5 definition bonus so the defining file beats the caller", () => {
  const definesLines = ["export function smartContext() {"];
  const callerLines = ["smartContext();", "smartContext();", "smartContext();"];
  const matches = [
    {
      filePath: "/x/defines.js",
      relativeFile: "defines.js",
      lines: definesLines,
      matches: [{ line: 0, text: definesLines[0] }]
    },
    {
      filePath: "/x/caller.js",
      relativeFile: "caller.js",
      lines: callerLines,
      matches: [
        { line: 0, text: callerLines[0] },
        { line: 1, text: callerLines[1] },
        { line: 2, text: callerLines[2] }
      ]
    }
  ];
  const ranked = rankMatches("/x", matches, ["smartcontext"], "smartContext function definition");
  assert.equal(ranked[0].file, "defines.js");
});

test("rankMatches definition bonus does not apply to prose files (.md/.txt)", () => {
  const codeLines = ["function authMiddleware() {}"];
  const proseLines = ["function authMiddleware() {}"];
  const matches = [
    {
      filePath: "/x/code.js",
      relativeFile: "src/code.js",
      lines: codeLines,
      matches: [{ line: 0, text: codeLines[0] }]
    },
    {
      filePath: "/x/notes.md",
      relativeFile: "docs/notes.md",
      lines: proseLines,
      matches: [{ line: 0, text: proseLines[0] }]
    }
  ];
  // Code-style query keeps prose multiplier at 0.2 so the def-bonus difference is visible.
  const ranked = rankMatches("/x", matches, ["auth"], "authMiddleware");
  const code = ranked.find((r) => r.file === "src/code.js");
  const md = ranked.find((r) => r.file === "docs/notes.md");
  // code: 0 path + 2 density + 2 symbol + 2 non-test + 5 def = 11, x1.0 = 11
  // md:   same raw 6 without the 5 def bonus, x0.2 = 1.2
  assert.ok(Math.abs(code.score - 11) < 0.01, `code expected 11 got ${code.score}`);
  assert.ok(Math.abs(md.score - 1.2) < 0.01, `md expected 1.2 (def bonus skipped) got ${md.score}`);
});

test("rankMatches gives prose files a heading-match bonus so the topical doc beats body-mention noise", () => {
  const targetLines = [
    "# Setup",
    "Some intro text.",
    "## Install",
    "Run npm install."
  ];
  const noiseLines = [
    "We mention install in passing here",
    "and discuss install briefly there",
    "and again install elsewhere",
    "more install talk"
  ];
  const matches = [
    {
      filePath: "/x/README.md",
      relativeFile: "README.md",
      lines: targetLines,
      matches: [
        { line: 2, text: targetLines[2] },
        { line: 3, text: targetLines[3] }
      ]
    },
    {
      filePath: "/x/notes.md",
      relativeFile: "docs/notes.md",
      lines: noiseLines,
      matches: noiseLines.map((line, i) => ({ line: i, text: line }))
    }
  ];
  const ranked = rankMatches("/x", matches, ["install"], "install instructions");
  // README has 1 heading match (## Install) → +20 heading bonus, beats noise's higher density.
  assert.equal(ranked[0].file, "README.md");
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
