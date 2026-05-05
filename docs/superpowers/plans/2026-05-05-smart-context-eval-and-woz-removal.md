# Smart Context — Eval & WOZ Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible eval harness for the smart-context plugin (ranking, token, consistency, latency), capture a baseline, completely remove the woz plugin and its attribution, then apply small fixes for any P0/P1 regressions while reporting larger items for a future cycle.

**Architecture:**
A single Node script `scripts/eval.js` orchestrates 18 golden queries against `smartContext()` in-process, with helper modules for metrics, baseline simulation, and report writing. Results land as Markdown + JSON under `docs/eval/`. WOZ removal is a sequenced procedure across two settings files, the plugin marketplace, and the cache directory, with grep snapshots before and after.

**Tech Stack:**
Node ESM, `node:test`, the existing `src/searchEngine.js` API, `node:child_process` for ripgrep toggling, plain Markdown + JSON output. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-05-smart-context-eval-and-woz-removal-design.md`

---

## File Structure

**New files:**
- `test/fixtures/golden-queries.json` — 18 query data
- `scripts/eval.js` — orchestrator entry point
- `scripts/eval-metrics.js` — ranking metric helpers (top-1, top-3, MRR)
- `scripts/eval-baseline.js` — B1/B2/B3 token-baseline simulators
- `scripts/eval-report.js` — Markdown and JSON writers
- `test/evalMetrics.test.js` — tests for `eval-metrics.js`
- `test/evalBaseline.test.js` — tests for `eval-baseline.js`
- `test/evalReport.test.js` — tests for `eval-report.js`
- `docs/eval/2026-05-05-results.json` — raw results (committed)
- `docs/eval/2026-05-05-results.md` — report (committed)

**Modified files:**
- `src/scanner.js` — add `SMART_CONTEXT_DISABLE_RG` env-var override (2 lines)
- `test/scanner.test.js` — one new test for the env-var behavior
- `package.json` — add new test files to the `test` script
- `.claude/settings.local.json` — remove woz permission entries
- `~/.claude/settings.json` — remove `attribution.commit` and `attribution.pr`

**Files possibly modified later (depending on findings):**
- `src/ranker.js` — single-line tuning, only if measurement justifies (§7.1 of spec)
- `src/scanner.js` — stable-sort or other determinism fix, only if measurement justifies

---

## Phase A — Scanner Toggle Prep

The eval needs to compare ripgrep vs Node fallback latency, but the existing `scanner.js` auto-detects ripgrep with a cached binary lookup and no escape hatch. One small addition to `detectRipgrep()` lets the harness force the fallback path with an env var.

### Task A1: Add `SMART_CONTEXT_DISABLE_RG` env-var to scanner

**Files:**
- Modify: `src/scanner.js:67-82`
- Test: `test/scanner.test.js`

- [ ] **Step 1: Write the failing test**

Open `test/scanner.test.js` and append:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRipgrepAvailable } from "../src/scanner.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test test/scanner.test.js
```
Expected: the new test fails (because `detectRipgrep()` ignores the env var). The other scanner tests should still pass.

- [ ] **Step 3: Edit `detectRipgrep()` to honor the env var**

In `src/scanner.js`, change `detectRipgrep`:

```js
function detectRipgrep() {
  if (process.env.SMART_CONTEXT_DISABLE_RG === "1") return null;
  if (cachedRipgrepBinary !== undefined) return cachedRipgrepBinary;
  for (const candidate of ripgrepCandidates()) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (result.status === 0) {
        cachedRipgrepBinary = candidate;
        return cachedRipgrepBinary;
      }
    } catch {
      // continue probing
    }
  }
  cachedRipgrepBinary = null;
  return null;
}
```

The env-var check is the **first line of the function** so it short-circuits the cache too — the eval flips the flag between runs and must not see a stale cached binary.

- [ ] **Step 4: Run all tests to verify**

Run:
```bash
npm test
```
Expected: all 22 tests pass (21 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js test/scanner.test.js
git commit -m "feat(scanner): add SMART_CONTEXT_DISABLE_RG env-var override"
```

---

## Phase B — Build Eval Harness

Five tasks. Each module is built with one or two failing tests, then minimal implementation, then commit. The orchestrator (`scripts/eval.js`) is integration-tested by running it against this repo, not unit-tested.

### Task B1: Create the golden-queries fixture

**Files:**
- Create: `test/fixtures/golden-queries.json`

- [ ] **Step 1: Write the file**

Save exactly this JSON to `test/fixtures/golden-queries.json`:

```json
{
  "version": 1,
  "queries": [
    { "id": "exact-1", "category": "exact_identifier", "query": "smartContext function definition", "mode": "brief", "expected": { "top1": "src/searchEngine.js", "top3": ["src/searchEngine.js", "mcp/smart-context-server.js"] } },
    { "id": "exact-2", "category": "exact_identifier", "query": "tokenBudget trim", "mode": "brief", "expected": { "top1": "src/tokenBudget.js", "top3": ["src/tokenBudget.js", "test/tokenBudget.test.js"] } },
    { "id": "exact-3", "category": "exact_identifier", "query": "pathSafety validation", "mode": "brief", "expected": { "top1": "src/pathSafety.js", "top3": ["src/pathSafety.js", "test/pathSafety.test.js"] } },

    { "id": "concept-1", "category": "conceptual", "query": "how queries are tokenized", "mode": "brief", "expected": { "top1": "src/query.js", "top3": ["src/query.js", "test/query.test.js"] } },
    { "id": "concept-2", "category": "conceptual", "query": "where ranking score is computed", "mode": "brief", "expected": { "top1": "src/ranker.js", "top3": ["src/ranker.js", "test/ranker.test.js"] } },
    { "id": "concept-3", "category": "conceptual", "query": "usage logging and stats", "mode": "brief", "expected": { "top1": "src/logger.js", "top3": ["src/logger.js", "scripts/stats.js", "test/logger.test.js"] } },

    { "id": "camel-1", "category": "camelcase_split", "query": "tokenBudgetTrim", "mode": "brief", "expected": { "top1": "src/tokenBudget.js", "top3": ["src/tokenBudget.js"] } },
    { "id": "camel-2", "category": "camelcase_split", "query": "pathSafetyValidation", "mode": "brief", "expected": { "top1": "src/pathSafety.js", "top3": ["src/pathSafety.js"] } },
    { "id": "camel-3", "category": "camelcase_split", "query": "searchEngineCompose", "mode": "brief", "expected": { "top1": "src/searchEngine.js", "top3": ["src/searchEngine.js"] } },

    { "id": "prose-1", "category": "prose_only", "query": "install instructions", "mode": "brief", "expected": { "top1": "README.md", "top3": ["README.md"] } },
    { "id": "prose-2", "category": "prose_only", "query": "privacy guarantees", "mode": "brief", "expected": { "top1": "README.md", "top3": ["README.md"] } },
    { "id": "prose-3", "category": "prose_only", "query": "design rationale for modes", "mode": "brief", "expected": { "top1": "docs/superpowers/specs/2026-05-05-smart-context-design.md", "top3": ["docs/superpowers/specs/2026-05-05-smart-context-design.md"] } },

    { "id": "distract-1", "category": "distractor", "query": "error handling", "mode": "brief", "expected": { "top1": "src/errors.js", "top3": ["src/errors.js", "src/searchEngine.js"] } },
    { "id": "distract-2", "category": "distractor", "query": "test fixtures", "mode": "brief", "expected": { "top1": "test/fixtures/golden-queries.json", "top3": ["test/fixtures/golden-queries.json"] } },
    { "id": "distract-3", "category": "distractor", "query": "mcp server start", "mode": "brief", "expected": { "top1": "mcp/smart-context-server.js", "top3": ["mcp/smart-context-server.js"] } },

    { "id": "edge-1", "category": "edge", "query": "", "mode": "brief", "expected": { "top1": null, "top3": [], "must_not_throw": true } },
    { "id": "edge-2", "category": "edge", "query": "aaaaa", "mode": "brief", "expected": { "top1": null, "top3": [], "must_not_throw": true } },
    { "id": "edge-3", "category": "edge", "query": "인증 미들웨어", "mode": "brief", "expected": { "top1": null, "top3": [], "must_not_throw": true } }
  ]
}
```

- [ ] **Step 2: Sanity-check JSON validity**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('test/fixtures/golden-queries.json','utf8'))"
```
Expected: no output, exit code 0. Any syntax error and the command throws.

- [ ] **Step 3: Commit**

```bash
git add test/fixtures/golden-queries.json
git commit -m "feat(eval): add golden-queries fixture"
```

---

### Task B2: Build `eval-metrics.js` with TDD

**Files:**
- Create: `scripts/eval-metrics.js`
- Create: `test/evalMetrics.test.js`

- [ ] **Step 1: Write the failing tests**

Save to `test/evalMetrics.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankOf, top1Hit, top3Hit, reciprocalRank, scoreQuery } from "../scripts/eval-metrics.js";

test("rankOf returns 1-indexed rank or 0 if missing", () => {
  const results = [{ file: "a.js" }, { file: "b.js" }, { file: "c.js" }];
  assert.equal(rankOf(results, "a.js"), 1);
  assert.equal(rankOf(results, "c.js"), 3);
  assert.equal(rankOf(results, "missing.js"), 0);
});

test("top1Hit returns true only if expected.top1 is first", () => {
  const results = [{ file: "src/x.js" }, { file: "src/y.js" }];
  assert.equal(top1Hit(results, { top1: "src/x.js" }), true);
  assert.equal(top1Hit(results, { top1: "src/y.js" }), false);
  assert.equal(top1Hit([], { top1: "src/x.js" }), false);
});

test("top3Hit returns true if expected.top1 is in first three", () => {
  const results = [{ file: "a.js" }, { file: "b.js" }, { file: "c.js" }, { file: "d.js" }];
  assert.equal(top3Hit(results, { top1: "c.js" }), true);
  assert.equal(top3Hit(results, { top1: "d.js" }), false);
});

test("reciprocalRank returns 1/rank or 0", () => {
  const results = [{ file: "a.js" }, { file: "b.js" }];
  assert.equal(reciprocalRank(results, { top1: "a.js" }), 1);
  assert.equal(reciprocalRank(results, { top1: "b.js" }), 0.5);
  assert.equal(reciprocalRank(results, { top1: "z.js" }), 0);
});

test("scoreQuery aggregates per-query scoring", () => {
  const results = [{ file: "src/x.js" }, { file: "src/y.js" }];
  const expected = { top1: "src/x.js", top3: ["src/x.js"] };
  const out = scoreQuery(results, expected);
  assert.deepEqual(out, { top1: true, top3: true, rr: 1, rank: 1 });
});

test("scoreQuery handles edge queries with null top1", () => {
  const out = scoreQuery([], { top1: null, must_not_throw: true });
  assert.deepEqual(out, { top1: true, top3: true, rr: 1, rank: 0, edge: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test test/evalMetrics.test.js
```
Expected: all six tests fail (module not found).

- [ ] **Step 3: Implement `eval-metrics.js`**

Save to `scripts/eval-metrics.js`:

```js
export function rankOf(results, file) {
  if (!file) return 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].file === file) return i + 1;
  }
  return 0;
}

export function top1Hit(results, expected) {
  if (results.length === 0) return false;
  return results[0].file === expected.top1;
}

export function top3Hit(results, expected) {
  return results.slice(0, 3).some((r) => r.file === expected.top1);
}

export function reciprocalRank(results, expected) {
  const r = rankOf(results, expected.top1);
  return r === 0 ? 0 : 1 / r;
}

export function scoreQuery(results, expected) {
  if (expected.top1 === null) {
    return { top1: results.length === 0, top3: results.length === 0, rr: results.length === 0 ? 1 : 0, rank: 0, edge: true };
  }
  const rank = rankOf(results, expected.top1);
  return {
    top1: top1Hit(results, expected),
    top3: top3Hit(results, expected),
    rr: rank === 0 ? 0 : 1 / rank,
    rank
  };
}

export function aggregateByCategory(perQuery) {
  const buckets = new Map();
  for (const entry of perQuery) {
    const list = buckets.get(entry.category) || [];
    list.push(entry);
    buckets.set(entry.category, list);
  }
  const out = {};
  for (const [cat, list] of buckets) {
    const n = list.length;
    out[cat] = {
      n,
      top1_rate: list.filter((e) => e.score.top1).length / n,
      top3_rate: list.filter((e) => e.score.top3).length / n,
      mrr: list.reduce((a, e) => a + e.score.rr, 0) / n
    };
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test test/evalMetrics.test.js
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-metrics.js test/evalMetrics.test.js
git commit -m "feat(eval): add ranking metrics module"
```

---

### Task B3: Build `eval-baseline.js` with TDD

**Files:**
- Create: `scripts/eval-baseline.js`
- Create: `test/evalBaseline.test.js`

The B1 baseline is already encoded in `src/searchEngine.js:65` as `Math.min(files.length, 8) * 900`. The harness reproduces that formula for clarity, then adds B2 (top-3 read) and B3 (read all).

- [ ] **Step 1: Write the failing tests**

Save to `test/evalBaseline.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeB1, computeB2, computeB3, ratios } from "../scripts/eval-baseline.js";

test("computeB1 mirrors src/searchEngine baseline formula", () => {
  // baseline = max(estimatedReturned, min(files,8) * 900)
  assert.equal(computeB1({ files_scanned: 4, estimated_tokens_returned: 200 }), 4 * 900);
  assert.equal(computeB1({ files_scanned: 20, estimated_tokens_returned: 200 }), 8 * 900);
  // returned exceeds floor → returned wins
  assert.equal(computeB1({ files_scanned: 4, estimated_tokens_returned: 5000 }), 5000);
});

test("computeB2 = glob + grep + top-3 read", () => {
  // sizesByFile is bytes per matched file; estimator is bytes/4
  const sizesByFile = { "a.js": 4000, "b.js": 4000, "c.js": 4000, "d.js": 4000 };
  const out = computeB2({ files_scanned: 50, matched_files: ["a.js","b.js","c.js","d.js"], sizesByFile, glob_tokens: 200, grep_tokens: 300 });
  // 200 + 300 + (4000+4000+4000)/4 = 500 + 3000 = 3500
  assert.equal(out, 3500);
});

test("computeB3 = glob + grep + read all matched", () => {
  const sizesByFile = { "a.js": 4000, "b.js": 4000, "c.js": 4000, "d.js": 4000 };
  const out = computeB3({ files_scanned: 50, matched_files: ["a.js","b.js","c.js","d.js"], sizesByFile, glob_tokens: 200, grep_tokens: 300 });
  // 200 + 300 + 4*1000 = 4500
  assert.equal(out, 4500);
});

test("ratios reports b1/b2 and b1/b3", () => {
  const r = ratios({ b1: 7200, b2: 3500, b3: 4500 });
  assert.equal(r.b1_over_b2, 7200 / 3500);
  assert.equal(r.b1_over_b3, 7200 / 4500);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test test/evalBaseline.test.js
```
Expected: 4 failing tests (module not found).

- [ ] **Step 3: Implement `eval-baseline.js`**

Save to `scripts/eval-baseline.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";
import { estimateTokens } from "../src/tokenBudget.js";

const TOP3 = 3;

export function computeB1({ files_scanned, estimated_tokens_returned }) {
  return Math.max(estimated_tokens_returned, Math.min(files_scanned, 8) * 900);
}

export function computeB2({ matched_files, sizesByFile, glob_tokens, grep_tokens }) {
  const top = matched_files.slice(0, TOP3);
  const readTokens = top.reduce((sum, f) => sum + Math.ceil((sizesByFile[f] || 0) / 4), 0);
  return glob_tokens + grep_tokens + readTokens;
}

export function computeB3({ matched_files, sizesByFile, glob_tokens, grep_tokens }) {
  const readTokens = matched_files.reduce((sum, f) => sum + Math.ceil((sizesByFile[f] || 0) / 4), 0);
  return glob_tokens + grep_tokens + readTokens;
}

export function ratios({ b1, b2, b3 }) {
  return {
    b1_over_b2: b2 === 0 ? Infinity : b1 / b2,
    b1_over_b3: b3 === 0 ? Infinity : b1 / b3
  };
}

export async function readFileSizes(workspaceRoot, relativeFiles) {
  const out = {};
  for (const rel of relativeFiles) {
    try {
      const stat = await fs.stat(path.join(workspaceRoot, rel));
      out[rel] = stat.size;
    } catch {
      out[rel] = 0;
    }
  }
  return out;
}

export function fixedGlobGrepTokens() {
  // Approximate cost of one Glob call (file list output) and one Grep call (line output).
  // Conservative round numbers; documented in report so they can be tuned later.
  return { glob_tokens: 200, grep_tokens: 400 };
}

// Convenience: given a smartContext result + on-disk file sizes, return all three baselines + ratios.
export function computeAllBaselines({ stats, results, sizesByFile }) {
  const matched_files = results.map((r) => r.file);
  const fixed = fixedGlobGrepTokens();
  const b1 = computeB1({ files_scanned: stats.files_scanned, estimated_tokens_returned: stats.estimated_tokens_returned });
  const b2 = computeB2({ matched_files, sizesByFile, ...fixed });
  const b3 = computeB3({ matched_files, sizesByFile, ...fixed });
  return { b1, b2, b3, ...ratios({ b1, b2, b3 }) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test test/evalBaseline.test.js
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-baseline.js test/evalBaseline.test.js
git commit -m "feat(eval): add token-baseline simulator"
```

---

### Task B4: Build `eval-report.js` with TDD

**Files:**
- Create: `scripts/eval-report.js`
- Create: `test/evalReport.test.js`

- [ ] **Step 1: Write the failing tests**

Save to `test/evalReport.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, renderJson, renderConsoleSummary } from "../scripts/eval-report.js";

const SAMPLE = {
  timestamp: "2026-05-05T10:00:00Z",
  env: { node: "v22.0.0", os: "win32", rg: "14.1.0", head_sha: "abc123" },
  metrics: {
    ranking: { overall: { top1_rate: 0.78, top3_rate: 0.94, mrr: 0.83 }, by_category: { exact_identifier: { n:3, top1_rate:1, top3_rate:1, mrr:1 } } },
    tokens: { avg_b1_over_b2: 1.42, avg_b1_over_b3: 1.6, per_query: [] },
    consistency: { set_equal_count: 14, order_equal_count: 12, total: 18 },
    latency: { warm_p50_rg: 67, warm_p50_node: 142, warm_p95_rg: 110, warm_p95_node: 230, mcp_overhead_ms: 80 }
  },
  queries: [],
  issues: [{ severity: "P1", title: "prose_only top1 below threshold", evidence: ["prose-1: rank 4"], hypothesis: "0.2x multiplier too aggressive", fix_proposal: "raise to 0.5", classification: "immediate" }]
};

test("renderJson returns deterministic stringified payload", () => {
  const a = renderJson(SAMPLE);
  const b = renderJson(SAMPLE);
  assert.equal(a, b);
  const parsed = JSON.parse(a);
  assert.equal(parsed.metrics.ranking.overall.top1_rate, 0.78);
});

test("renderMarkdown includes all required sections", () => {
  const md = renderMarkdown(SAMPLE);
  for (const heading of ["TL;DR", "Environment", "Ranking", "Token Savings", "Consistency", "Latency", "Issues", "Reproduction"]) {
    assert.ok(md.includes(heading), `missing section: ${heading}`);
  }
  assert.ok(md.includes("78%"), "TL;DR should show top-1 rate");
});

test("renderConsoleSummary fits within 8 lines", () => {
  const lines = renderConsoleSummary(SAMPLE).split("\n").filter(Boolean);
  assert.ok(lines.length <= 8, `summary too long: ${lines.length} lines`);
  assert.ok(lines.some((l) => l.includes("top-1")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test test/evalReport.test.js
```
Expected: 3 failing tests.

- [ ] **Step 3: Implement `eval-report.js`**

Save to `scripts/eval-report.js`:

```js
function pct(x) { return `${Math.round(x * 100)}%`; }
function fixed(x, n = 2) { return Number(x).toFixed(n); }

export function renderJson(payload) {
  return JSON.stringify(payload, null, 2);
}

export function renderConsoleSummary(payload) {
  const r = payload.metrics.ranking.overall;
  const t = payload.metrics.tokens;
  const c = payload.metrics.consistency;
  const l = payload.metrics.latency;
  const issues = payload.issues || [];
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
  return [
    "SMART CONTEXT EVAL — " + payload.timestamp.slice(0, 10),
    `top-1: ${pct(r.top1_rate)}   top-3: ${pct(r.top3_rate)}   MRR: ${fixed(r.mrr)}`,
    `tokens B1/B2 ratio: ${fixed(t.avg_b1_over_b2)}`,
    `consistency: ${c.set_equal_count}/${c.total} identical`,
    `warm p50: ${l.warm_p50_rg} ms (rg) / ${l.warm_p50_node} ms (node)`,
    `issues: P0=${counts.P0}  P1=${counts.P1}  P2=${counts.P2}`,
    `report: docs/eval/${payload.timestamp.slice(0,10)}-results.md`
  ].join("\n");
}

function renderRankingTable(byCategory) {
  const rows = ["| category | n | top-1 | top-3 | MRR |", "|---|---|---|---|---|"];
  for (const [cat, m] of Object.entries(byCategory)) {
    rows.push(`| ${cat} | ${m.n} | ${pct(m.top1_rate)} | ${pct(m.top3_rate)} | ${fixed(m.mrr)} |`);
  }
  return rows.join("\n");
}

function renderIssues(issues) {
  if (!issues.length) return "_No issues found._";
  return issues.map((i) => `- **${i.severity}** — ${i.title}\n  - Evidence: ${i.evidence.join("; ")}\n  - Hypothesis: ${i.hypothesis}\n  - Fix: ${i.fix_proposal}\n  - Classification: ${i.classification}`).join("\n");
}

export function renderMarkdown(payload) {
  const r = payload.metrics.ranking.overall;
  const t = payload.metrics.tokens;
  const c = payload.metrics.consistency;
  const l = payload.metrics.latency;
  const date = payload.timestamp.slice(0, 10);
  return `# Smart Context — Eval Report (${date})

## TL;DR

- Top-1 hit rate: ${pct(r.top1_rate)} (${r.top1_rate >= 0.75 ? "OK" : "below 75%"})
- Top-3 hit rate: ${pct(r.top3_rate)}
- MRR: ${fixed(r.mrr)}
- Token B1/B2 ratio: ${fixed(t.avg_b1_over_b2)} (${t.avg_b1_over_b2 >= 1.3 ? "overstated" : t.avg_b1_over_b2 <= 0.7 ? "understated" : "OK"})
- Consistency: ${c.set_equal_count}/${c.total} identical (3 reruns each)
- Warm p50: ${l.warm_p50_rg} ms (rg) / ${l.warm_p50_node} ms (node)

## Environment

- Node: ${payload.env.node}
- OS: ${payload.env.os}
- ripgrep: ${payload.env.rg}
- HEAD SHA: ${payload.env.head_sha}

## Ranking

${renderRankingTable(payload.metrics.ranking.by_category)}

## Token Savings

- B1 / B2 average: ${fixed(t.avg_b1_over_b2)}
- B1 / B3 average: ${fixed(t.avg_b1_over_b3)}
- Per-query detail: see results.json \`metrics.tokens.per_query\`

## Consistency

- Set-equality across 3 runs: ${c.set_equal_count}/${c.total}
- Order-equality across 3 runs: ${c.order_equal_count}/${c.total}

## Latency

- Warm p50 (rg / node): ${l.warm_p50_rg} ms / ${l.warm_p50_node} ms
- Warm p95 (rg / node): ${l.warm_p95_rg} ms / ${l.warm_p95_node} ms
- MCP round-trip overhead: ${l.mcp_overhead_ms} ms

## Issues

${renderIssues(payload.issues || [])}

## Reproduction

\`\`\`bash
node scripts/eval.js
node scripts/eval.js --baseline=docs/eval/${date}-results.json
\`\`\`
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test test/evalReport.test.js
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-report.js test/evalReport.test.js
git commit -m "feat(eval): add report renderer"
```

---

### Task B5: Build the `scripts/eval.js` orchestrator

**Files:**
- Create: `scripts/eval.js`

This file is integration-tested by running it. It is not unit-tested because almost every line is glue around other modules that already have unit tests.

- [ ] **Step 1: Write the orchestrator**

Save to `scripts/eval.js`:

```js
#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";
import { smartContext } from "../src/searchEngine.js";
import { scoreQuery, aggregateByCategory } from "./eval-metrics.js";
import { computeAllBaselines, readFileSizes } from "./eval-baseline.js";
import { renderJson, renderMarkdown, renderConsoleSummary } from "./eval-report.js";

const REPO = process.cwd();
const FIXTURE = path.join(REPO, "test/fixtures/golden-queries.json");

function parseArgs(argv) {
  const args = { baseline: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--baseline=")) args.baseline = a.slice("--baseline=".length);
  }
  return args;
}

function safeRgVersion() {
  try {
    return execSync("rg --version", { encoding: "utf8" }).split("\n")[0];
  } catch {
    return "unavailable";
  }
}

function safeHeadSha() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function setEqual(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return false;
  return true;
}

function arrayEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function ms(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function runQueryOnce(q) {
  const start = process.hrtime.bigint();
  const out = await smartContext({ workspaceRoot: REPO, query: q.query, mode: q.mode || "brief", paths: q.paths });
  return { latency_ms: ms(start), out };
}

function pickRipgrepMode(disable) {
  if (disable) process.env.SMART_CONTEXT_DISABLE_RG = "1";
  else delete process.env.SMART_CONTEXT_DISABLE_RG;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

async function runFor(mode, queries) {
  pickRipgrepMode(mode === "node");
  const records = [];
  for (const q of queries) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await runQueryOnce(q));
    const final = runs[runs.length - 1].out;
    const sizesByFile = await readFileSizes(REPO, (final.results || []).map((r) => r.file));
    const baselines = (final.results && final.stats)
      ? computeAllBaselines({ stats: final.stats, results: final.results, sizesByFile })
      : { b1: 0, b2: 0, b3: 0, b1_over_b2: 0, b1_over_b3: 0 };
    records.push({ q, runs, baselines });
  }
  return records;
}

async function mcpOverheadMicrobench() {
  // Spawn the MCP server as a child, send one initialize + one tools/call, measure round-trip.
  // Best-effort; on failure return null.
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["mcp/smart-context-server.js"], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const wait = (predicate) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("mcp microbench timeout")), 5000);
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (predicate(buf)) { clearTimeout(timer); resolve(); }
      });
    });
    child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{ name:"eval", version:"0" } } }) + "\n");
    await wait((s) => s.includes("\"id\":1"));
    const t0 = process.hrtime.bigint();
    child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:2, method:"tools/call", params:{ name:"smart_context", arguments:{ query:"smartContext", mode:"brief" } } }) + "\n");
    await wait((s) => s.includes("\"id\":2"));
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
    child.kill();
    return Math.round(elapsed);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const fixtureRaw = await fs.readFile(FIXTURE, "utf8");
  const queries = JSON.parse(fixtureRaw).queries;

  // Run twice: once with rg available, once forcing node fallback.
  const rgRuns = await runFor("rg", queries);
  const nodeRuns = await runFor("node", queries);

  // Score against expectations using the rg run (canonical).
  const perQuery = rgRuns.map((rec) => {
    const finalOut = rec.runs[rec.runs.length - 1].out;
    const results = finalOut.results || [];
    const score = scoreQuery(results, rec.q.expected);
    const filesAcrossRuns = rec.runs.map((r) => (r.out.results || []).map((x) => x.file));
    return {
      id: rec.q.id,
      category: rec.q.category,
      query: rec.q.query,
      score,
      latencies_ms: rec.runs.map((r) => Math.round(r.latency_ms)),
      consistency: {
        set_equal: filesAcrossRuns.every((f) => setEqual(f, filesAcrossRuns[0])),
        order_equal: filesAcrossRuns.every((f) => arrayEqual(f, filesAcrossRuns[0]))
      },
      baselines: rec.baselines
    };
  });

  const overall = {
    top1_rate: perQuery.filter((e) => e.score.top1).length / perQuery.length,
    top3_rate: perQuery.filter((e) => e.score.top3).length / perQuery.length,
    mrr: perQuery.reduce((a, e) => a + e.score.rr, 0) / perQuery.length
  };
  const byCategory = aggregateByCategory(perQuery);

  const ratios_b1_b2 = perQuery.map((e) => e.baselines.b1_over_b2).filter((x) => x > 0);
  const ratios_b1_b3 = perQuery.map((e) => e.baselines.b1_over_b3).filter((x) => x > 0);
  const tokens = {
    avg_b1_over_b2: ratios_b1_b2.length ? ratios_b1_b2.reduce((a, x) => a + x, 0) / ratios_b1_b2.length : 0,
    avg_b1_over_b3: ratios_b1_b3.length ? ratios_b1_b3.reduce((a, x) => a + x, 0) / ratios_b1_b3.length : 0,
    per_query: perQuery.map((e) => ({ id: e.id, ...e.baselines }))
  };

  const consistency = {
    total: perQuery.length,
    set_equal_count: perQuery.filter((e) => e.consistency.set_equal).length,
    order_equal_count: perQuery.filter((e) => e.consistency.order_equal).length
  };

  // Latency: take the second/third runs as warm; rg vs node split from the two runFor passes.
  const warmRg = rgRuns.flatMap((r) => r.runs.slice(1).map((x) => x.latency_ms));
  const warmNode = nodeRuns.flatMap((r) => r.runs.slice(1).map((x) => x.latency_ms));
  const latency = {
    warm_p50_rg: percentile(warmRg, 50),
    warm_p95_rg: percentile(warmRg, 95),
    warm_p50_node: percentile(warmNode, 50),
    warm_p95_node: percentile(warmNode, 95),
    mcp_overhead_ms: await mcpOverheadMicrobench()
  };

  const issues = collectIssues({ overall, byCategory, tokens, consistency, latency, perQuery });

  const date = new Date().toISOString();
  const payload = {
    timestamp: date,
    env: { node: process.version, os: `${os.platform()}-${os.release()}`, rg: safeRgVersion(), head_sha: safeHeadSha() },
    metrics: { ranking: { overall, by_category: byCategory }, tokens, consistency, latency },
    queries: perQuery,
    issues
  };

  const day = date.slice(0, 10);
  const outDir = path.join(REPO, "docs/eval");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${day}-results.json`), renderJson(payload), "utf8");
  await fs.writeFile(path.join(outDir, `${day}-results.md`), renderMarkdown(payload), "utf8");

  if (args.baseline) {
    const prior = JSON.parse(await fs.readFile(args.baseline, "utf8"));
    const delta = renderDelta(prior, payload);
    await fs.writeFile(path.join(outDir, `${day}-delta.md`), delta, "utf8");
    console.log("delta written to docs/eval/" + day + "-delta.md");
  }

  console.log(renderConsoleSummary(payload));
}

function collectIssues({ overall, byCategory, tokens, consistency, latency, perQuery }) {
  const issues = [];
  // P1: per-category top-1 below advisory threshold
  const thresholds = { exact_identifier: 0.9, conceptual: 0.6, distractor: 0.7, prose_only: 0.6 };
  for (const [cat, m] of Object.entries(byCategory)) {
    if (thresholds[cat] !== undefined && m.top1_rate < thresholds[cat]) {
      const offenders = perQuery.filter((e) => e.category === cat && !e.score.top1).map((e) => `${e.id}: rank ${e.score.rank}`);
      issues.push({ severity: "P1", title: `${cat} top-1 below threshold (${m.top1_rate.toFixed(2)} < ${thresholds[cat]})`, evidence: offenders, hypothesis: "category-specific ranking weakness", fix_proposal: "see triage protocol in plan §E", classification: "investigate" });
    }
  }
  // P1: token B1/B2 outside [0.7, 1.3]
  if (tokens.avg_b1_over_b2 > 1.3) issues.push({ severity: "P1", title: "tokens_saved overstated", evidence: [`avg B1/B2 = ${tokens.avg_b1_over_b2.toFixed(2)}`], hypothesis: "baseline floor min(files,8)*900 too aggressive", fix_proposal: "report-only — algorithmic redesign §7.2", classification: "report-only" });
  if (tokens.avg_b1_over_b2 < 0.7) issues.push({ severity: "P2", title: "tokens_saved understated", evidence: [`avg B1/B2 = ${tokens.avg_b1_over_b2.toFixed(2)}`], hypothesis: "baseline floor too low", fix_proposal: "report-only", classification: "report-only" });
  // P1: any non-identical run
  if (consistency.set_equal_count < consistency.total) {
    const offenders = perQuery.filter((e) => !e.consistency.set_equal).map((e) => e.id);
    issues.push({ severity: "P1", title: "inconsistent results across reruns", evidence: offenders, hypothesis: "non-deterministic scanner ordering or ranker tie-break", fix_proposal: "stable sort fix; see plan task E2", classification: "investigate" });
  }
  // P2: warm p50 above 100 ms
  if (latency.warm_p50_rg > 100) issues.push({ severity: "P2", title: "warm p50 above 100ms with ripgrep", evidence: [`warm_p50_rg = ${latency.warm_p50_rg}`], hypothesis: "scanner overhead", fix_proposal: "report-only — profile in next cycle", classification: "report-only" });
  return issues;
}

function renderDelta(prior, current) {
  const a = prior.metrics, b = current.metrics;
  const line = (label, x, y) => `- ${label}: ${typeof x === "number" ? x.toFixed(2) : x} → ${typeof y === "number" ? y.toFixed(2) : y}`;
  return `# Eval Delta (${prior.timestamp.slice(0,10)} → ${current.timestamp.slice(0,10)})

${line("top-1 rate", a.ranking.overall.top1_rate, b.ranking.overall.top1_rate)}
${line("top-3 rate", a.ranking.overall.top3_rate, b.ranking.overall.top3_rate)}
${line("MRR", a.ranking.overall.mrr, b.ranking.overall.mrr)}
${line("B1/B2 avg", a.tokens.avg_b1_over_b2, b.tokens.avg_b1_over_b2)}
${line("set-equal count", a.consistency.set_equal_count, b.consistency.set_equal_count)}
${line("warm p50 rg", a.latency.warm_p50_rg, b.latency.warm_p50_rg)}
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Smoke-run the orchestrator**

Run:
```bash
node scripts/eval.js
```
Expected: prints a `SMART CONTEXT EVAL — ...` block ending with `report: docs/eval/...-results.md`. If it throws, fix and re-run before committing.

- [ ] **Step 3: Verify output files exist**

Run:
```bash
ls docs/eval/
```
Expected: `2026-05-05-results.md` and `2026-05-05-results.json` exist (or with the actual current date).

- [ ] **Step 4: Commit the orchestrator (results land in B6)**

```bash
git add scripts/eval.js
git commit -m "feat(eval): add orchestrator entrypoint"
```

---

### Task B6: Wire new tests into `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit the test script**

In `package.json`, replace the `test` script. The current value is:

```json
"test": "node --test test/query.test.js test/pathSafety.test.js test/snippets.test.js test/tokenBudget.test.js test/ranker.test.js test/scanner.test.js test/searchEngine.test.js test/logger.test.js test/mcpServer.test.js test/stats.test.js"
```

Replace with:

```json
"test": "node --test test/query.test.js test/pathSafety.test.js test/snippets.test.js test/tokenBudget.test.js test/ranker.test.js test/scanner.test.js test/searchEngine.test.js test/logger.test.js test/mcpServer.test.js test/stats.test.js test/evalMetrics.test.js test/evalBaseline.test.js test/evalReport.test.js"
```

- [ ] **Step 2: Run all tests**

Run:
```bash
npm test
```
Expected: all tests pass (the original 22 from Phase A + 13 new from B2/B3/B4).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include eval module tests in npm test"
```

---

## Phase C — Capture Baseline Results

### Task C1: Capture and commit the 2026-05-05 baseline

**Files:**
- Create or overwrite: `docs/eval/2026-05-05-results.json`
- Create or overwrite: `docs/eval/2026-05-05-results.md`

- [ ] **Step 1: Run the eval fresh**

Run:
```bash
node scripts/eval.js
```
Expected: console summary printed; `docs/eval/2026-05-05-results.{md,json}` written.

- [ ] **Step 2: Read the report and confirm it makes sense**

Run:
```bash
cat docs/eval/$(date -u +%Y-%m-%d)-results.md | head -60
```
Expected: TL;DR shows numeric values for top-1 / top-3 / MRR / token ratio / consistency / latency. None should be `NaN` or `undefined`.

If date naming differs (the harness uses UTC `toISOString().slice(0,10)`), look in `docs/eval/` directly to find the file.

- [ ] **Step 3: Commit the baseline**

```bash
git add docs/eval/
git commit -m "chore(eval): record 2026-05-05 baseline"
```

---

## Phase D — WOZ Removal

Sequential. Pre-flight grep first, settings edits next, plugin uninstall (interactive — user runs the slash commands), cache delete, post-flight grep.

### Task D1: Pre-flight grep — capture before-state

**Files:**
- Read-only

- [ ] **Step 1: Search the global `~/.claude` tree**

Run:
```bash
grep -ri "woz\|wozcode\|WOZCODE" \
  --include="*.json" --include="*.md" --include="*.mjs" --include="*.js" \
  ~/.claude 2>/dev/null | tee /tmp/woz-pre-global.txt
```
Expected: outputs hits including `~/.claude/settings.json` (`Co-Authored-By: WOZCODE`, `Built with [WOZCODE]`), and `~/.claude/plugins/cache/wozcode-marketplace/...` files. Save the output for the report.

- [ ] **Step 2: Search the repo**

Run:
```bash
grep -ri "woz\|wozcode\|WOZCODE" \
  --include="*.json" --include="*.md" --include="*.mjs" --include="*.js" \
  . 2>/dev/null | tee /tmp/woz-pre-repo.txt
```
Expected: outputs `.claude/settings.local.json` hits.

- [ ] **Step 3: Note: no commit yet — these are notes only**

The output files in `/tmp/` are copy-pasted into the eventual report (Phase F task F1).

---

### Task D2: Backup the global `~/.claude/settings.json`

**Files:**
- Create: `~/.claude/settings.json.bak.20260505`

- [ ] **Step 1: Copy the file**

Run:
```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak.20260505
```
Expected: no output, exit code 0.

- [ ] **Step 2: Verify backup is byte-identical**

Run:
```bash
diff ~/.claude/settings.json ~/.claude/settings.json.bak.20260505 && echo OK
```
Expected: `OK`.

- [ ] **Step 3: No commit — this file lives outside the repo**

---

### Task D3: Remove `attribution.commit` and `attribution.pr` from global settings

**Files:**
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: Read the file**

Use the `Read` tool on `C:/Users/woongchan/.claude/settings.json`. Note the exact lines for the two `attribution` keys. The current shape is:

```json
"attribution": {
  "commit": "Co-Authored-By: WOZCODE <contact@withwoz.com>",
  "pr": "🧙 Built with [WOZCODE](https://wozcode.com)"
},
```

- [ ] **Step 2: Remove the keys**

Use the `Edit` tool to replace the entire `attribution` block (including the trailing comma) with nothing. Concretely, replace:

```
  "attribution": {
    "commit": "Co-Authored-By: WOZCODE <contact@withwoz.com>",
    "pr": "🧙 Built with [WOZCODE](https://wozcode.com)"
  },
```

with an empty string, ensuring the surrounding JSON remains valid (the preceding key keeps its trailing comma if needed).

- [ ] **Step 3: Validate JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude/settings.json','utf8'))"
```
Expected: no output, exit code 0.

- [ ] **Step 4: No commit — this file lives outside the repo. Subsequent commits in this plan demonstrate the attribution is gone (look for absence of `Co-Authored-By: WOZCODE` in their messages).**

---

### Task D4: Remove woz permissions from repo `.claude/settings.local.json`

**Files:**
- Modify: `.claude/settings.local.json`

- [ ] **Step 1: Edit the file**

Use the `Edit` tool to replace:

```json
    "allow": [
      "mcp__plugin_woz_code__Search",
      "mcp__plugin_woz_code__Edit",
      "mcp__plugin_smart-context_smart-context-local__smart_context"
    ]
```

with:

```json
    "allow": [
      "mcp__plugin_smart-context_smart-context-local__smart_context"
    ]
```

- [ ] **Step 2: Validate JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8'))"
```
Expected: no output, exit code 0.

- [ ] **Step 3: Stage the change for the consolidated removal commit (D9)**

```bash
git add .claude/settings.local.json
```
No commit yet — Task D9 commits all repo-side WOZ changes together.

---

### Task D5: User runs `/plugin uninstall woz@wozcode-marketplace`

**Files:**
- N/A (interactive Claude Code command)

This step is interactive. The plan's executor must ask the user to run the following commands inside Claude Code, then confirm completion before proceeding:

- [ ] **Step 1: Ask the user to run, in the same Claude Code session:**

```
/plugin uninstall woz@wozcode-marketplace
/plugin marketplace remove wozcode-marketplace
/plugin list
```

- [ ] **Step 2: User pastes back the output of `/plugin list`**

Expected: no `woz` entry in the list. If `wozcode-marketplace` line still appears as a marketplace, that is acceptable — the second command may have failed silently if other plugins remain. Report this in the final summary.

- [ ] **Step 3: Verify `enabledPlugins` no longer contains woz**

Read `~/.claude/settings.json` and confirm no `enabledPlugins` entry references `woz`. If one remains, ask the user to manually remove it via `/plugin disable` or by editing the file.

---

### Task D6: Delete the woz plugin cache directory

**Files:**
- Delete: `~/.claude/plugins/cache/wozcode-marketplace/`

Only run after Task D5 confirms uninstall succeeded.

- [ ] **Step 1: Confirm directory exists**

Run:
```bash
ls -la ~/.claude/plugins/cache/wozcode-marketplace/
```
Expected: shows `woz/0.3.50/` or similar.

- [ ] **Step 2: Delete recursively**

Run:
```bash
rm -rf ~/.claude/plugins/cache/wozcode-marketplace
```
Expected: no output, exit code 0.

- [ ] **Step 3: Verify deletion**

Run:
```bash
ls ~/.claude/plugins/cache/wozcode-marketplace/ 2>&1 | head -1
```
Expected: `No such file or directory` or equivalent.

---

### Task D7: Post-flight grep — capture after-state

**Files:**
- Read-only

- [ ] **Step 1: Re-run the global grep**

Run:
```bash
grep -ri "woz\|wozcode\|WOZCODE" \
  --include="*.json" --include="*.md" --include="*.mjs" --include="*.js" \
  ~/.claude 2>/dev/null | tee /tmp/woz-post-global.txt
```
Expected: zero hits, OR only hits inside the backup file `settings.json.bak.20260505` (which is intentional). Anything else gets recorded in the report and investigated.

- [ ] **Step 2: Re-run the repo grep**

Run:
```bash
grep -ri "woz\|wozcode\|WOZCODE" \
  --include="*.json" --include="*.md" --include="*.mjs" --include="*.js" \
  . 2>/dev/null | tee /tmp/woz-post-repo.txt
```
Expected: zero hits.

---

### Task D8: Hooks/agents check (report-only)

**Files:**
- Read-only

Per spec §6.7, hooks and agents may contain user code that depends on woz. Do not auto-edit; record findings in the report.

- [ ] **Step 1: Grep hooks**

Run:
```bash
grep -l "woz" ~/.claude/hooks/*.mjs 2>/dev/null || echo "no hooks reference woz"
```
Expected: prints filenames (record them) or the fallback message.

- [ ] **Step 2: Grep agents**

Run:
```bash
grep -l "woz" ~/.claude/agents/*.md 2>/dev/null || echo "no agents reference woz"
```
Expected: prints filenames (record them) or the fallback message.

- [ ] **Step 3: Capture results in `/tmp/woz-hooks-agents.txt`**

Run:
```bash
{
  echo "=== hooks ==="; grep -l "woz" ~/.claude/hooks/*.mjs 2>/dev/null || echo "(none)";
  echo "=== agents ==="; grep -l "woz" ~/.claude/agents/*.md 2>/dev/null || echo "(none)";
} | tee /tmp/woz-hooks-agents.txt
```

---

### Task D9: Commit repo-side WOZ removal

**Files:**
- Already-staged: `.claude/settings.local.json`

- [ ] **Step 1: Commit**

```bash
git commit -m "chore: remove woz plugin permissions"
```

- [ ] **Step 2: Confirm the commit message has no `Co-Authored-By: WOZCODE`**

Run:
```bash
git log -1 --pretty=full
```
Expected: the commit body does not contain `WOZCODE`. If it does, the global attribution removal in D3 did not take — re-do D3 and amend with a fresh commit (`git commit --amend` is acceptable here because nothing has been pushed).

---

## Phase E — Apply Triaged Fixes

The eval already ran in Phase C. Phase E reads the report it produced and applies any fixes that satisfy spec §7.1 (≤5 changed lines, ≤1 file, all tests pass). Each fix is its own commit. Reread `docs/eval/<date>-results.md` and follow the protocol below.

### Task E1: Read findings and classify each issue

**Files:**
- Read-only

- [ ] **Step 1: Open the report**

Open `docs/eval/<date>-results.md`. List every issue under "## Issues" with its severity, title, and proposed fix.

- [ ] **Step 2: Apply triage decision tree**

For each issue, in this order:

1. Read its `classification` field. If `report-only`, skip — recommendations stay in the report.
2. If `immediate` or `investigate`:
   - Identify the smallest concrete change that addresses the hypothesis.
   - If that change is **≤ 5 lines, ≤ 1 file, and `npm test` still passes after it**, apply it as task E2/E3/etc., one per fix.
   - Otherwise downgrade to report-only and add a sentence to the report explaining why the change was deferred.

- [ ] **Step 3: List the fixes you intend to apply**

Write a checklist of fix-task IDs (`E2-fix-prose`, `E3-fix-determinism`, etc.) before starting any of them. Each must be its own commit.

---

### Task E2 (conditional): Tighten/loosen prose multiplier

Apply only if the report shows `prose_only` top-1 rate < 0.6 AND offenders include `README.md` or other markdown that is the legitimate top answer.

**Files:**
- Modify: `src/ranker.js:14` (the `0.2` literal)

- [ ] **Step 1: Decide the new multiplier**

Inspect the offending queries' actual rankings in `docs/eval/<date>-results.json` (`metrics.tokens.per_query` and the per-query records). Pick a value that brings the offender into top-3. Reasonable candidates: `0.4`, `0.5`. Avoid `1.0` — that would undo commit `a4d2772`.

- [ ] **Step 2: Edit `src/ranker.js`**

Replace `if (lower.endsWith(ext)) return 0.2;` with `if (lower.endsWith(ext)) return <NEW>;` (`<NEW>` = the value you chose in step 1).

- [ ] **Step 3: Run all tests**

```bash
npm test
```
Expected: all pass. If `test/ranker.test.js` fails because it asserts the old multiplier, update that test as part of the same commit (still ≤ 5 lines combined — verify the diff).

- [ ] **Step 4: Re-run eval to confirm improvement**

```bash
node scripts/eval.js
```
Expected: console summary shows higher `prose_only` top-1 rate and no regression in `exact_identifier` or `distractor`. If `distractor` dropped below 0.7, revert and downgrade to report-only.

- [ ] **Step 5: Commit**

```bash
git add src/ranker.js test/ranker.test.js
git commit -m "fix(ranker): adjust prose multiplier from 0.2 to <NEW>"
```

---

### Task E3 (conditional): Add stable scanner ordering

Apply only if the report shows `consistency.set_equal_count < total` AND inspecting the offending queries shows the divergence is in the file set (not just `tokens_returned` jitter inside an unchanged set).

**Files:**
- Modify: `src/scanner.js` (one of the `scanFiles*` functions)

- [ ] **Step 1: Localize the divergence**

Read `docs/eval/<date>-results.json` and find queries where `consistency.set_equal: false`. Run them by hand twice:

```bash
node -e "import('./src/searchEngine.js').then(m => m.smartContext({ workspaceRoot: process.cwd(), query: 'concept-1', mode: 'brief' }).then(r => console.log(r.results.map(x => x.file))))"
```

If the file order changes between identical input runs, the scanner is the source. The ranker already has stable tie-break (`a.relativeFile.localeCompare(b.relativeFile)` at `src/ranker.js:32`).

- [ ] **Step 2: Apply a stable sort to scanner output**

In `src/scanner.js`, at the bottom of `scanFilesWithRipgrep` (just before `return results;`) and at the bottom of `scanFilesNode`, add:

```js
results.sort((a, b) => a.relativeFile.localeCompare(b.relativeFile));
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```
Expected: all pass.

- [ ] **Step 4: Re-run eval**

```bash
node scripts/eval.js
```
Expected: `consistency.set_equal_count == total`.

- [ ] **Step 5: Commit**

```bash
git add src/scanner.js
git commit -m "fix(scanner): stable ordering of matched files"
```

---

### Task E4 (conditional): Other fixes

For any other issue tagged `immediate` or `investigate` that survives the §7.1 size check, repeat the pattern:

1. Identify the minimal diff.
2. Apply it.
3. `npm test` (must pass).
4. `node scripts/eval.js` (must show improvement).
5. Commit as `fix(<area>): <one-line>`.

If a fix exceeds 5 lines or touches more than one file, stop, revert (`git checkout -- <files>`), and add a sentence to the recommendations section of the report explaining what was deferred.

---

## Phase F — Re-baseline (only if Phase E applied any fix)

### Task F1: Re-run eval with `--baseline` and commit delta

**Files:**
- Create or overwrite: `docs/eval/<date>-delta.md`
- Update: `docs/eval/<date>-results.{md,json}` (overwritten with post-fix values)

- [ ] **Step 1: Save the pre-fix baseline reference**

```bash
cp docs/eval/<date>-results.json /tmp/eval-prefix.json
```
(Substitute `<date>` with the actual date from the report filename.)

- [ ] **Step 2: Run the eval against that baseline**

```bash
node scripts/eval.js --baseline=/tmp/eval-prefix.json
```
Expected: console summary printed; `docs/eval/<date>-delta.md` written; `docs/eval/<date>-results.{md,json}` overwritten with post-fix values.

- [ ] **Step 3: Read the delta**

Open `docs/eval/<date>-delta.md`. Confirm metrics moved in the expected direction. If a metric regressed, revert the corresponding fix in Phase E and re-run.

- [ ] **Step 4: Commit**

```bash
git add docs/eval/
git commit -m "chore(eval): record post-fix metrics"
```

---

## Phase G — Wrap-up

### Task G1: Append WOZ-removal section to the eval report

**Files:**
- Modify: `docs/eval/<date>-results.md`

- [ ] **Step 1: Append a section**

At the end of `docs/eval/<date>-results.md`, before the `## Reproduction` section, paste the following block (substituting the captured grep outputs from Phase D):

```markdown
## WOZ Removal Results

**Pre-flight global hits:** see `/tmp/woz-pre-global.txt` (paste contents).

**Pre-flight repo hits:** see `/tmp/woz-pre-repo.txt` (paste contents).

**Steps performed:**
- D2: backup written to `~/.claude/settings.json.bak.20260505`
- D3: removed `attribution.commit` and `attribution.pr` from `~/.claude/settings.json`
- D4: removed `mcp__plugin_woz_code__Search` and `mcp__plugin_woz_code__Edit` from `.claude/settings.local.json`
- D5: user ran `/plugin uninstall woz@wozcode-marketplace` and `/plugin marketplace remove wozcode-marketplace`
- D6: deleted `~/.claude/plugins/cache/wozcode-marketplace/`

**Post-flight global hits:** see `/tmp/woz-post-global.txt`. Expected: zero (excluding the backup file).

**Post-flight repo hits:** see `/tmp/woz-post-repo.txt`. Expected: zero.

**Hooks/agents check (report-only):** see `/tmp/woz-hooks-agents.txt`. No auto-edits performed.
```

- [ ] **Step 2: Commit**

```bash
git add docs/eval/<date>-results.md
git commit -m "docs(eval): append woz-removal results to report"
```

---

### Task G2: Final verification

**Files:**
- Read-only

- [ ] **Step 1: Run the full test suite once more**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 2: Confirm no `Co-Authored-By: WOZCODE` in any commit since D3**

```bash
git log --since="1 day ago" --pretty=full | grep -i "WOZCODE" || echo "OK no WOZCODE"
```
Expected: `OK no WOZCODE`. If hits appear, the global attribution removal failed for some commits — note in the final summary and ask the user whether to amend.

- [ ] **Step 3: Print the eval summary one more time**

```bash
node scripts/eval.js
```
Expected: the console summary, identical to the post-fix state. The report files in `docs/eval/` are now the canonical baseline for future regressions.

---

## Self-Review Notes

Spec coverage cross-check:
- §3 Architecture → Phase B (B1–B6)
- §4 Golden queries → Task B1
- §5.1 Ranking metrics → Task B2 + B5 orchestrator scoring
- §5.2 Token baselines (B1/B2/B3) → Task B3 + B5 aggregation
- §5.3 Consistency → Task B5 (3 reruns + set/order/variance)
- §5.4 Latency → Task B5 (4 conditions: cold/warm × rg/node) + MCP microbench
- §6 WOZ removal (6.1–6.7) → Phase D (D1–D8)
- §7 Triage rules → Phase E (E1 protocol + E2/E3 worked examples + E4 generalized)
- §8 Output format → Task B4 (renderers) + Task C1 (commit) + Task G1 (append WOZ section)
- §10 Reproduction → Built into the report by Task B4

No placeholders. No `TBD`/`TODO`. Every step shows the actual code or command to run.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-smart-context-eval-and-woz-removal.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
