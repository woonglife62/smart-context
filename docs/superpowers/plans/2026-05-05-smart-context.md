# Smart Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that exposes a local `smart_context` MCP tool for low-token codebase discovery.

**Architecture:** The plugin is a small Node.js package. Claude Code loads plugin metadata and a local MCP server; the MCP server delegates to a reusable search engine that validates workspace paths, scans files, ranks candidates, extracts snippets, enforces token budgets, and writes privacy-preserving JSONL stats.

**Tech Stack:** Node.js ESM, built-in `node:test`, MCP SDK, `zod` for schema validation, optional `rg` executable with a Node.js fallback scanner.

---

## File Structure

- Create: `package.json` - Node package scripts, dependencies, and package metadata.
- Create: `.gitignore` - ignore dependencies, logs, build output, and temporary files.
- Create: `.claude-plugin/plugin.json` - Claude Code plugin metadata and local MCP server command.
- Create: `agents/smart-context-agent.md` - agent instructions that tell Claude when to use `smart_context`.
- Create: `README.md` - install, usage, privacy, and approximate savings notes.
- Create: `src/config.js` - constants for modes, excludes, budgets, and scoring.
- Create: `src/errors.js` - structured error helper functions.
- Create: `src/pathSafety.js` - workspace-relative path validation.
- Create: `src/query.js` - query keyword extraction and query hashing.
- Create: `src/scanner.js` - file listing and text scanning with safe excludes.
- Create: `src/ranker.js` - deterministic scoring and result ordering.
- Create: `src/snippets.js` - line-window extraction and overlap deduplication.
- Create: `src/tokenBudget.js` - approximate token counting and trimming.
- Create: `src/logger.js` - privacy-preserving JSONL stats writer.
- Create: `src/searchEngine.js` - stable internal API used by MCP tools.
- Create: `mcp/smart-context-server.js` - MCP server entrypoint exposing `smart_context` and `smart_context_explain`.
- Create: `test/fixtures/sample-project/...` - tiny fixture repository.
- Create: `test/*.test.js` - unit and integration tests.

## Task 1: Project Skeleton And Package Scripts

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.claude-plugin/plugin.json`
- Create: `agents/smart-context-agent.md`
- Create: `README.md`

- [x] **Step 1: Create package metadata**

Create `package.json`:

```json
{
  "name": "smart-context-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Claude Code plugin with a local smart_context MCP tool for efficient code discovery.",
  "bin": {
    "smart-context-mcp": "./mcp/smart-context-server.js"
  },
  "scripts": {
    "test": "node --test",
    "test:unit": "node --test test/query.test.js test/pathSafety.test.js test/snippets.test.js test/tokenBudget.test.js test/ranker.test.js",
    "test:integration": "node --test test/searchEngine.test.js test/logger.test.js test/mcpServer.test.js",
    "start:mcp": "node mcp/smart-context-server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {}
}
```

- [x] **Step 2: Add ignore rules**

A `.gitignore` already exists at the repo root containing `.worktrees/`. APPEND new lines (do not overwrite). Final contents must be:

```gitignore
.worktrees/
node_modules/
.smart-context/
coverage/
dist/
build/
.DS_Store
*.log
```

- [x] **Step 3: Add plugin metadata**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "smart-context",
  "version": "0.1.0",
  "description": "Efficient local code discovery for Claude Code.",
  "author": "local",
  "mcpServers": {
    "smart-context-local": {
      "command": "node",
      "args": ["mcp/smart-context-server.js"]
    }
  }
}
```

- [x] **Step 4: Add agent instructions**

Create `agents/smart-context-agent.md`:

```markdown
---
name: smart-context
description: Prefer the smart_context tool for cross-file code discovery before planning or editing.
tools: ["smart_context", "smart_context_explain"]
---

Use `smart_context` when you need to locate relevant implementation files, routes, services, middleware, schemas, config, tests, or call sites across a project.

Prefer `smart_context` over repeated glob, grep, and read calls when the exact file is not already known.

Use `mode: "brief"` for ordinary discovery, `mode: "explain"` when the user asks where something lives or why files matter, and `mode: "pack"` before multi-file planning or edits.

Use normal file reads when the exact file is already known and full-file context is required.
```

- [x] **Step 5: Add README**

Create `README.md`:

```markdown
# Smart Context

Smart Context is a local Claude Code plugin that exposes a `smart_context` MCP tool for efficient codebase discovery.

It replaces repeated file discovery loops with one ranked response containing relevant files, snippets, reasons, and approximate savings statistics.

## Privacy

The MVP runs locally and does not send code, prompts, snippets, model responses, or API keys to external services. Logs are written under `.smart-context/logs/` and contain only aggregate stats plus a short query hash.

## Modes

- `brief`: compact ranked snippets
- `explain`: brief results plus a short relevance summary
- `pack`: wider context for planning or multi-file edits

## Savings

Savings numbers are approximate. They compare a simple baseline for separate discovery calls against the approximate tokens returned by `smart_context`.

## Development

```bash
npm install
npm test
npm run start:mcp
```
```

- [x] **Step 6: Run package script smoke test**

Run: `npm test`

Expected: Node reports no tests found or exits successfully after test files are added in later tasks. If `npm install` has not been run, run `npm install` first.

- [x] **Step 7: Commit**

```bash
git add package.json .gitignore .claude-plugin/plugin.json agents/smart-context-agent.md README.md
git commit -m "chore: scaffold smart context plugin"
```

## Task 2: Config, Errors, Query Parsing, And Path Safety

**Files:**
- Create: `src/config.js`
- Create: `src/errors.js`
- Create: `src/query.js`
- Create: `src/pathSafety.js`
- Create: `test/query.test.js`
- Create: `test/pathSafety.test.js`

- [x] **Step 1: Write query tests**

Create `test/query.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { extractKeywords, hashQuery } from "../src/query.js";

test("extractKeywords removes short words and normalizes case", () => {
  assert.deepEqual(
    extractKeywords("Where is auth middleware applied in server routes?"),
    ["auth", "middleware", "applied", "server", "routes"]
  );
});

test("extractKeywords preserves code-like tokens", () => {
  assert.deepEqual(
    extractKeywords("find createUser and auth.middleware.ts"),
    ["find", "createuser", "auth.middleware.ts"]
  );
});

test("hashQuery returns stable short hashes without exposing text", () => {
  assert.equal(hashQuery("auth middleware"), hashQuery("auth middleware"));
  assert.match(hashQuery("auth middleware"), /^[a-f0-9]{12}$/);
});
```

- [x] **Step 2: Write path safety tests**

Create `test/pathSafety.test.js`:

```js
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
```

- [x] **Step 3: Run tests to verify failure**

Run: `node --test test/query.test.js test/pathSafety.test.js`

Expected: FAIL with module-not-found errors for `src/query.js` and `src/pathSafety.js`.

- [x] **Step 4: Implement config**

Create `src/config.js`:

```js
export const MODES = new Set(["brief", "explain", "pack"]);

export const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".smart-context",
  ".cache",
  "tmp"
];

export const DEFAULT_BUDGETS = {
  brief: 2500,
  explain: 4000,
  pack: 8000
};

export const MAX_TOKEN_BUDGET = 30000;
```

- [x] **Step 5: Implement errors**

Create `src/errors.js`:

```js
export class SmartContextError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SmartContextError";
    this.code = code;
    this.details = details;
  }
}

export function structuredError(error) {
  if (error instanceof SmartContextError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  }
  return { ok: false, error: { code: "internal_error", message: error.message || "Unexpected error", details: {} } };
}
```

- [x] **Step 6: Implement query helpers**

Create `src/query.js`:

```js
import crypto from "node:crypto";

const STOP_WORDS = new Set(["the", "and", "for", "with", "where", "what", "when", "how", "why", "is", "are", "was", "were", "in", "on", "to", "of"]);

export function extractKeywords(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

export function hashQuery(query) {
  return crypto.createHash("sha256").update(String(query)).digest("hex").slice(0, 12);
}
```

- [x] **Step 7: Implement path safety**

Create `src/pathSafety.js`:

```js
import path from "node:path";
import { SmartContextError } from "./errors.js";

export function resolveSearchPaths(workspaceRoot, paths) {
  const root = path.resolve(workspaceRoot);
  const requested = paths && paths.length > 0 ? paths : ["."];

  return requested.map((entry) => {
    if (path.isAbsolute(entry)) {
      throw new SmartContextError("invalid_path", "absolute paths are not allowed", { path: entry });
    }

    const resolved = path.resolve(root, entry);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SmartContextError("invalid_path", "path resolves outside the workspace", { path: entry });
    }
    return resolved;
  });
}
```

- [x] **Step 8: Run tests to verify pass**

Run: `node --test test/query.test.js test/pathSafety.test.js`

Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add src/config.js src/errors.js src/query.js src/pathSafety.js test/query.test.js test/pathSafety.test.js
git commit -m "feat: add query and path safety helpers"
```

## Task 3: Snippet Extraction And Token Budgeting

**Files:**
- Create: `src/snippets.js`
- Create: `src/tokenBudget.js`
- Create: `test/snippets.test.js`
- Create: `test/tokenBudget.test.js`

- [x] **Step 1: Write snippet tests**

Create `test/snippets.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { extractSnippet, dedupeSnippets } from "../src/snippets.js";

const lines = ["a", "b", "function auth() {", "  return true;", "}", "c", "d"];

test("extractSnippet returns line-numbered window", () => {
  assert.deepEqual(extractSnippet(lines, 2, 1), {
    start: 2,
    end: 4,
    code: "b\nfunction auth() {\n  return true;"
  });
});

test("dedupeSnippets removes overlapping snippets", () => {
  const snippets = [
    { start: 1, end: 3, code: "a\nb\nc" },
    { start: 2, end: 4, code: "b\nc\nd" },
    { start: 6, end: 7, code: "f\ng" }
  ];
  assert.deepEqual(dedupeSnippets(snippets), [
    { start: 1, end: 3, code: "a\nb\nc" },
    { start: 6, end: 7, code: "f\ng" }
  ]);
});
```

- [x] **Step 2: Write token budget tests**

Create `test/tokenBudget.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, trimToBudget } from "../src/tokenBudget.js";

test("estimateTokens approximates one token per four chars", () => {
  assert.equal(estimateTokens("12345678"), 2);
});

test("trimToBudget removes low ranked snippets first", () => {
  const results = [
    { file: "a.js", score: 0.9, reason: "high", snippets: [{ start: 1, end: 1, code: "x".repeat(80) }] },
    { file: "b.js", score: 0.1, reason: "low", snippets: [{ start: 1, end: 1, code: "y".repeat(400) }] }
  ];
  const trimmed = trimToBudget(results, 40);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].file, "a.js");
});
```

- [x] **Step 3: Run tests to verify failure**

Run: `node --test test/snippets.test.js test/tokenBudget.test.js`

Expected: FAIL with module-not-found errors.

- [x] **Step 4: Implement snippets**

Create `src/snippets.js`:

```js
export function extractSnippet(lines, zeroBasedMatchLine, radius = 2) {
  const startIndex = Math.max(0, zeroBasedMatchLine - radius);
  const endIndex = Math.min(lines.length - 1, zeroBasedMatchLine + radius);
  return {
    start: startIndex + 1,
    end: endIndex + 1,
    code: lines.slice(startIndex, endIndex + 1).join("\n")
  };
}

export function dedupeSnippets(snippets) {
  const sorted = [...snippets].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = [];
  for (const snippet of sorted) {
    const overlaps = kept.some((existing) => snippet.start <= existing.end && snippet.end >= existing.start);
    if (!overlaps) kept.push(snippet);
  }
  return kept;
}
```

- [x] **Step 5: Implement token budget**

Create `src/tokenBudget.js`:

```js
export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function estimateResultTokens(results) {
  return estimateTokens(JSON.stringify(results));
}

export function trimToBudget(results, maxTokens) {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const result of sorted) {
    const candidate = [...kept, result];
    if (estimateResultTokens(candidate) <= maxTokens || kept.length === 0) {
      kept.push(result);
    }
  }
  return kept;
}
```

- [x] **Step 6: Run tests to verify pass**

Run: `node --test test/snippets.test.js test/tokenBudget.test.js`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/snippets.js src/tokenBudget.js test/snippets.test.js test/tokenBudget.test.js
git commit -m "feat: add snippet and token budget helpers"
```

## Task 4: Scanner, Ranking, And Fixture Repository

**Files:**
- Create: `src/scanner.js`
- Create: `src/ranker.js`
- Create: `test/ranker.test.js`
- Create: `test/fixtures/sample-project/src/server.ts`
- Create: `test/fixtures/sample-project/src/auth/middleware.ts`
- Create: `test/fixtures/sample-project/src/users/createUser.ts`
- Create: `test/fixtures/sample-project/test/login.test.ts`

- [x] **Step 1: Create fixture files**

Create `test/fixtures/sample-project/src/server.ts`:

```ts
import { authMiddleware } from "./auth/middleware";
import { createUser } from "./users/createUser";

export function configureServer(app) {
  app.use(authMiddleware);
  app.post("/users", createUser);
}
```

Create `test/fixtures/sample-project/src/auth/middleware.ts`:

```ts
export function authMiddleware(req, res, next) {
  if (!req.headers.authorization) {
    res.status(401).send({ error: "missing authorization" });
    return;
  }
  next();
}
```

Create `test/fixtures/sample-project/src/users/createUser.ts`:

```ts
export async function createUser(req, res) {
  const user = { id: "user_123", email: req.body.email };
  res.status(201).send(user);
}
```

Create `test/fixtures/sample-project/test/login.test.ts`:

```ts
import { authMiddleware } from "../src/auth/middleware";

test("login failure returns 401 without authorization", () => {
  const res = { status: () => res, send: () => undefined };
  authMiddleware({ headers: {} }, res, () => undefined);
});
```

- [x] **Step 2: Write ranking tests**

Create `test/ranker.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { listTextFiles, scanFiles } from "../src/scanner.js";
import { rankMatches } from "../src/ranker.js";

const root = path.resolve("test/fixtures/sample-project");

test("listTextFiles excludes dependencies and returns source files", async () => {
  const files = await listTextFiles(root, [root], []);
  assert(files.some((file) => file.endsWith("src/server.ts")));
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
```

- [x] **Step 3: Run tests to verify failure**

Run: `node --test test/ranker.test.js`

Expected: FAIL with module-not-found errors.

- [x] **Step 4: Implement scanner**

Create `src/scanner.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EXCLUDES } from "./config.js";

const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".yml", ".yaml", ".html", ".css", ".py", ".go", ".rs", ".java", ".cs"]);

function isExcluded(filePath, exclude) {
  const normalized = filePath.split(path.sep).join("/");
  return exclude.some((part) => normalized.includes(`/${part}/`) || normalized.endsWith(`/${part}`));
}

async function walk(root, dir, exclude, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (isExcluded(fullPath, exclude)) continue;
    if (entry.isDirectory()) {
      await walk(root, fullPath, exclude, out);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
}

export async function listTextFiles(workspaceRoot, searchPaths, exclude = DEFAULT_EXCLUDES) {
  const files = [];
  for (const searchPath of searchPaths) {
    const stat = await fs.stat(searchPath);
    if (stat.isDirectory()) {
      await walk(workspaceRoot, searchPath, exclude, files);
    } else if (stat.isFile() && TEXT_EXTENSIONS.has(path.extname(searchPath))) {
      files.push(searchPath);
    }
  }
  return [...new Set(files)];
}

export async function scanFiles(workspaceRoot, files, keywords) {
  const matches = [];
  for (const filePath of files) {
    const text = await fs.readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const fileMatches = [];
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      if (keywords.some((keyword) => lower.includes(keyword))) {
        fileMatches.push({ line: index, text: line });
      }
    });
    if (fileMatches.length > 0) {
      matches.push({ filePath, relativeFile: path.relative(workspaceRoot, filePath).split(path.sep).join("/"), lines, matches: fileMatches });
    }
  }
  return matches;
}
```

- [x] **Step 5: Implement ranker**

Create `src/ranker.js`:

```js
function isTestQuery(query) {
  return /\b(test|tests|spec|failure|mock|fixture)\b/i.test(query);
}

function isTestFile(file) {
  return /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./.test(file);
}

export function rankMatches(workspaceRoot, matches, keywords, query) {
  const wantsTests = isTestQuery(query);
  return matches
    .map((entry) => {
      const pathText = entry.relativeFile.toLowerCase();
      const pathScore = keywords.filter((keyword) => pathText.includes(keyword)).length * 4;
      const densityScore = entry.matches.length * 2;
      const symbolScore = entry.matches.filter((match) => /\b(import|export|function|class|const|app\.|router\.)\b/.test(match.text)).length * 2;
      const testScore = isTestFile(entry.relativeFile) ? (wantsTests ? 6 : -3) : 2;
      const score = pathScore + densityScore + symbolScore + testScore;
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score || a.relativeFile.localeCompare(b.relativeFile));
}
```

- [x] **Step 6: Run tests to verify pass**

Run: `node --test test/ranker.test.js`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/scanner.js src/ranker.js test/ranker.test.js test/fixtures/sample-project
git commit -m "feat: add scanner and ranking"
```

## Task 5: Search Engine API

**Files:**
- Create: `src/searchEngine.js`
- Create: `test/searchEngine.test.js`

- [x] **Step 1: Write search engine tests**

Create `test/searchEngine.test.js`:

```js
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
```

- [x] **Step 2: Run tests to verify failure**

Run: `node --test test/searchEngine.test.js`

Expected: FAIL with module-not-found error for `src/searchEngine.js`.

- [x] **Step 3: Implement search engine**

Create `src/searchEngine.js`:

```js
import { DEFAULT_BUDGETS, DEFAULT_EXCLUDES, MAX_TOKEN_BUDGET, MODES } from "./config.js";
import { SmartContextError, structuredError } from "./errors.js";
import { resolveSearchPaths } from "./pathSafety.js";
import { extractKeywords } from "./query.js";
import { listTextFiles, scanFiles } from "./scanner.js";
import { rankMatches } from "./ranker.js";
import { dedupeSnippets, extractSnippet } from "./snippets.js";
import { estimateResultTokens, trimToBudget } from "./tokenBudget.js";

function validateInput(input) {
  if (!input.query || String(input.query).trim().length === 0) {
    throw new SmartContextError("invalid_query", "query is required");
  }
  const mode = input.mode || "brief";
  if (!MODES.has(mode)) {
    throw new SmartContextError("invalid_mode", "mode must be one of brief, explain, or pack", { mode });
  }
  const maxTokens = input.max_tokens ?? DEFAULT_BUDGETS[mode];
  if (!Number.isInteger(maxTokens) || maxTokens < 200 || maxTokens > MAX_TOKEN_BUDGET) {
    throw new SmartContextError("invalid_max_tokens", "max_tokens must be an integer between 200 and 30000", { max_tokens: maxTokens });
  }
  return { mode, maxTokens };
}

function reasonFor(entry) {
  if (entry.relativeFile.includes("middleware")) return "Matches middleware-related query terms";
  if (entry.relativeFile.includes("test")) return "Matches test-related query terms";
  return "Contains query terms in relevant code";
}

function buildResults(ranked, mode) {
  const radius = mode === "pack" ? 4 : 2;
  const limit = mode === "pack" ? 8 : 5;
  return ranked.slice(0, limit).map((entry) => ({
    file: entry.relativeFile,
    score: Number((entry.score / 20).toFixed(2)),
    reason: reasonFor(entry),
    snippets: dedupeSnippets(entry.matches.map((match) => extractSnippet(entry.lines, match.line, radius))).slice(0, mode === "pack" ? 4 : 2)
  }));
}

function buildSummary(results) {
  if (results.length === 0) return "No matching files were found. Broaden the query or search paths.";
  const files = results.slice(0, 3).map((result) => result.file).join(", ");
  return `Most relevant files: ${files}.`;
}

export async function smartContext(input) {
  try {
    const { mode, maxTokens } = validateInput(input);
    const workspaceRoot = input.workspaceRoot || process.cwd();
    const keywords = extractKeywords(input.query);
    if (keywords.length === 0) throw new SmartContextError("invalid_query", "query must include at least one searchable keyword");

    const searchPaths = resolveSearchPaths(workspaceRoot, input.paths);
    const files = await listTextFiles(workspaceRoot, searchPaths, input.exclude || DEFAULT_EXCLUDES);
    const matches = await scanFiles(workspaceRoot, files, keywords);
    const ranked = rankMatches(workspaceRoot, matches, keywords, input.query);
    const untrimmed = buildResults(ranked, mode);
    const results = trimToBudget(untrimmed, maxTokens);
    const estimatedReturned = estimateResultTokens(results);
    const baseline = Math.max(estimatedReturned, Math.min(files.length, 8) * 900);

    const response = {
      ok: true,
      results,
      stats: {
        files_scanned: files.length,
        matches_considered: matches.reduce((count, entry) => count + entry.matches.length, 0),
        snippets_returned: results.reduce((count, result) => count + result.snippets.length, 0),
        estimated_tokens_returned: estimatedReturned,
        estimated_tokens_saved: Math.max(0, baseline - estimatedReturned)
      }
    };
    if (mode !== "brief") response.summary = buildSummary(results);
    return response;
  } catch (error) {
    return structuredError(error);
  }
}
```

- [x] **Step 4: Run tests to verify pass**

Run: `node --test test/searchEngine.test.js`

Expected: PASS.

- [x] **Step 5: Run all unit tests**

Run: `npm run test:unit`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/searchEngine.js test/searchEngine.test.js
git commit -m "feat: add smart context search engine"
```

## Task 6: Privacy-Preserving Logger

**Files:**
- Create: `src/logger.js`
- Create: `test/logger.test.js`
- Modify: `src/searchEngine.js`

- [x] **Step 1: Write logger tests**

Create `test/logger.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { writeUsageLog } from "../src/logger.js";

const workspaceRoot = path.resolve("test/fixtures/sample-project");

test("writeUsageLog stores stats without query or snippets", async () => {
  await fs.rm(path.join(workspaceRoot, ".smart-context"), { recursive: true, force: true });
  await writeUsageLog(workspaceRoot, {
    query_hash: "abc123",
    mode: "brief",
    searched_path_count: 1,
    stats: {
      files_scanned: 3,
      matches_considered: 2,
      snippets_returned: 1,
      estimated_tokens_returned: 100,
      estimated_tokens_saved: 200
    }
  });

  const logDir = path.join(workspaceRoot, ".smart-context", "logs");
  const files = await fs.readdir(logDir);
  const content = await fs.readFile(path.join(logDir, files[0]), "utf8");
  assert.match(content, /"query_hash":"abc123"/);
  assert.doesNotMatch(content, /auth middleware/);
  assert.doesNotMatch(content, /code/);
});
```

- [x] **Step 2: Run test to verify failure**

Run: `node --test test/logger.test.js`

Expected: FAIL with module-not-found error.

- [x] **Step 3: Implement logger**

Create `src/logger.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function writeUsageLog(workspaceRoot, event) {
  const logDir = path.join(workspaceRoot, ".smart-context", "logs");
  await fs.mkdir(logDir, { recursive: true });
  const filePath = path.join(logDir, `${dateStamp()}.jsonl`);
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    query_hash: event.query_hash,
    mode: event.mode,
    searched_path_count: event.searched_path_count,
    files_scanned: event.stats?.files_scanned ?? 0,
    matches_considered: event.stats?.matches_considered ?? 0,
    snippets_returned: event.stats?.snippets_returned ?? 0,
    estimated_tokens_returned: event.stats?.estimated_tokens_returned ?? 0,
    estimated_tokens_saved: event.stats?.estimated_tokens_saved ?? 0,
    error_code: event.error_code || null
  });
  await fs.appendFile(filePath, `${line}\n`, "utf8");
}
```

- [x] **Step 4: Modify search engine to log success and errors**

Update `src/searchEngine.js` imports:

```js
import { writeUsageLog } from "./logger.js";
import { hashQuery } from "./query.js";
```

Inside `smartContext`, after `const workspaceRoot = input.workspaceRoot || process.cwd();`, add:

```js
const queryHash = hashQuery(input.query);
```

Before returning the success response, add:

```js
await writeUsageLog(workspaceRoot, {
  query_hash: queryHash,
  mode,
  searched_path_count: searchPaths.length,
  stats: response.stats
});
```

In the catch block, replace `return structuredError(error);` with:

```js
const structured = structuredError(error);
if (input.workspaceRoot) {
  await writeUsageLog(input.workspaceRoot, {
    query_hash: input.query ? hashQuery(input.query) : "missing",
    mode: input.mode || "brief",
    searched_path_count: Array.isArray(input.paths) ? input.paths.length : 1,
    stats: {},
    error_code: structured.error.code
  }).catch(() => undefined);
}
return structured;
```

- [x] **Step 5: Run tests to verify pass**

Run: `node --test test/logger.test.js test/searchEngine.test.js`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/logger.js src/searchEngine.js test/logger.test.js
git commit -m "feat: add privacy preserving usage logs"
```

## Task 7: MCP Server Tools

**Files:**
- Create: `mcp/smart-context-server.js`
- Create: `test/mcpServer.test.js`

- [x] **Step 1: Write MCP helper test**

Create `test/mcpServer.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { smartContextTool, explainTool } from "../mcp/smart-context-server.js";

test("explainTool describes modes", async () => {
  const result = await explainTool();
  assert.match(result.content[0].text, /brief/);
  assert.match(result.content[0].text, /pack/);
});

test("smartContextTool returns MCP text content", async () => {
  const result = await smartContextTool({
    workspaceRoot: "test/fixtures/sample-project",
    query: "where is auth middleware applied?",
    mode: "brief"
  });
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /src\/auth\/middleware.ts/);
});
```

- [x] **Step 2: Run test to verify failure**

Run: `node --test test/mcpServer.test.js`

Expected: FAIL with module-not-found error.

- [x] **Step 3: Implement MCP server**

Create `mcp/smart-context-server.js`:

```js
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { smartContext } from "../src/searchEngine.js";

export async function smartContextTool(args) {
  const result = await smartContext({
    workspaceRoot: args.workspaceRoot || process.cwd(),
    query: args.query,
    mode: args.mode,
    paths: args.paths,
    exclude: args.exclude,
    max_tokens: args.max_tokens
  });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

export async function explainTool() {
  return {
    content: [
      {
        type: "text",
        text: "smart_context modes: brief returns compact ranked snippets, explain adds a short relevance summary, pack returns wider context for planning or multi-file edits. Savings stats are approximate."
      }
    ]
  };
}

export function createServer() {
  const server = new McpServer({ name: "smart-context-local", version: "0.1.0" });

  server.tool(
    "smart_context",
    {
      workspaceRoot: z.string().optional(),
      query: z.string(),
      mode: z.enum(["brief", "explain", "pack"]).optional(),
      paths: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      max_tokens: z.number().int().optional()
    },
    smartContextTool
  );

  server.tool("smart_context_explain", {}, explainTool);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [x] **Step 4: Run MCP tests**

Run: `node --test test/mcpServer.test.js`

Expected: PASS.

- [x] **Step 5: Run integration tests**

Run: `npm run test:integration`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add mcp/smart-context-server.js test/mcpServer.test.js
git commit -m "feat: expose smart context mcp tools"
```

## Task 8: Documentation And Verification Pass

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-05-smart-context-design.md` only if implementation discoveries require clarification.

- [x] **Step 1: Update README with install and usage details**

Replace `README.md` with:

```markdown
# Smart Context

Smart Context is a local Claude Code plugin that exposes a `smart_context` MCP tool for efficient codebase discovery.

It replaces repeated file discovery loops with one ranked response containing relevant files, snippets, reasons, and approximate savings statistics.

## Install For Development

```bash
npm install
npm test
```

In Claude Code, add this repository as a local plugin using Claude Code's plugin workflow, then restart Claude Code. The plugin declares the local MCP server in `.claude-plugin/plugin.json`.

## Tool

`smart_context` accepts:

```json
{
  "query": "where is auth middleware applied?",
  "mode": "brief",
  "paths": ["src"],
  "max_tokens": 4000
}
```

Modes:

- `brief`: compact ranked snippets
- `explain`: brief results plus a short relevance summary
- `pack`: wider context for planning or multi-file edits

## Privacy

The MVP runs locally and does not send code, prompts, snippets, model responses, or API keys to external services. Logs are written under `.smart-context/logs/` and contain only aggregate stats plus a short query hash.

Logs do not store full prompts, query text, code snippets, model responses, secrets, or environment variables.

## Savings

Savings numbers are approximate. They compare a simple baseline for separate discovery calls against the approximate tokens returned by `smart_context`.

## Development

```bash
npm run test:unit
npm run test:integration
npm test
npm run start:mcp
```
```

- [x] **Step 2: Run all tests**

Run: `npm test`

Expected: PASS for all test files.

- [x] **Step 3: Run MCP server smoke command**

Run: `node mcp/smart-context-server.js`

Expected: process starts and waits on stdio without throwing. Stop it with `Ctrl+C` after confirming it starts.

- [x] **Step 4: Check privacy log content**

Run: `Get-Content -Raw test\\fixtures\\sample-project\\.smart-context\\logs\\*.jsonl`

Expected: JSONL contains `query_hash`, counts, and savings numbers. It does not contain raw query text or code snippets.

- [x] **Step 5: Check git status**

Run: `git status --short`

Expected: only intended files changed.

- [x] **Step 6: Commit**

```bash
git add README.md docs/superpowers/specs/2026-05-05-smart-context-design.md
git commit -m "docs: document smart context usage"
```

## Self-Review Notes

- Spec coverage: The plan covers plugin metadata, agent instructions, MCP tools, local search, path safety, modes, ranking, snippets, token budgets, logging, privacy, errors, tests, and documentation.
- Scope check: The plan intentionally excludes model routing, batch edits, cloud dashboard, telemetry, slash stats commands, and vector indexing.
- Type consistency: The public search API is `smartContext(input)`, the MCP tool is `smart_context`, and output stats use the exact names from the design spec.
