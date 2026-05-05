# Smart Context — Workflow Token-Cost Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transcript-parsing aggregator that, given a `runs.csv` of (task_id, with_session_id, without_session_id, quality) rows, computes per-task and aggregate token-cost metrics (with vs without smart_context) and writes a Markdown + JSON report. Also ship a user-facing playbook with 5 fixed tasks and a run protocol.

**Architecture:** ES-module Node script. Four files in `scripts/` (entry + parser + metrics + report) with three matching test files using `node:test`. Input is `docs/eval/workflow/runs.csv`; output is `docs/eval/workflow/<date>-results.{md,json}`. Transcript files are located by scanning `~/.claude/projects/<encoded>/<sessionId>.jsonl`.

**Tech Stack:** Node ESM, `node:test`, `node:fs/promises`, no new npm deps.

**Reference spec:** `docs/superpowers/specs/2026-05-05-smart-context-workflow-eval-design.md`

---

## File Structure

**New files:**
- `scripts/workflow-eval.js` — entry: parse args, read CSV, drive parser/metrics/report, write outputs.
- `scripts/workflow-eval-parser.js` — transcript jsonl → `{ usage_totals, tool_calls, turn_count, model_id }`.
- `scripts/workflow-eval-metrics.js` — per-task scoring + aggregation + validity rules.
- `scripts/workflow-eval-report.js` — `renderJson`, `renderMarkdown`, `renderConsoleSummary`.
- `test/workflowEvalParser.test.js`
- `test/workflowEvalMetrics.test.js`
- `test/workflowEvalReport.test.js`
- `docs/eval/workflow/2026-05-05-tasks.md` — playbook (5 tasks + protocol + result template).
- `docs/eval/workflow/runs.csv` — header-only initially; user appends rows.

**Modified files:**
- `package.json` — append three new test files to the `test` script.

**Files NOT modified:**
- Any `src/*.js` — eval is read-only with respect to the production code.

---

## Phase A — Build the aggregator (TDD)

### Task A1: Build `workflow-eval-parser.js` with TDD

**Files:**
- Create: `scripts/workflow-eval-parser.js`
- Create: `test/workflowEvalParser.test.js`

The parser reads a transcript `.jsonl` file and aggregates assistant-side token usage and tool calls. The actual transcript shape (verified against a real session at `~/.claude/projects/C--Users-woongchan-OneDrive----New-project-2/`):

- Each line is a JSON object.
- Assistant messages: `{ type: "assistant", message: { role: "assistant", model: "claude-...", content: [...], usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, ... } } }`
- `message.content` is an array of items; tool calls are items with `{ type: "tool_use", name: "Read"|"Grep"|"Glob"|"smart_context"|... }`.

- [ ] **Step 1: Write the failing tests**

Save to `test/workflowEvalParser.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseTranscript, locateTranscript } from "../scripts/workflow-eval-parser.js";

async function writeFixture(name, lines) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-"));
  const file = path.join(dir, `${name}.jsonl`);
  await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return { dir, file };
}

test("parseTranscript sums usage across assistant messages", async () => {
  const { file } = await writeFixture("s1", [
    { type: "user", message: { content: "hi" } },
    { type: "assistant", message: { role: "assistant", model: "claude-opus-4-7", content: [{ type: "text", text: "hello" }], usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { role: "assistant", model: "claude-opus-4-7", content: [{ type: "text", text: "world" }], usage: { input_tokens: 5, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 130 } } }
  ]);
  const out = await parseTranscript(file);
  assert.deepEqual(out.usage_totals, { input_tokens: 105, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 130 });
  assert.equal(out.turn_count, 2);
  assert.equal(out.model_id, "claude-opus-4-7");
});

test("parseTranscript counts tool calls by name", async () => {
  const { file } = await writeFixture("s2", [
    { type: "assistant", message: { role: "assistant", model: "x", content: [{ type: "tool_use", name: "Read" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { role: "assistant", model: "x", content: [{ type: "tool_use", name: "Read" }, { type: "tool_use", name: "Grep" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { role: "assistant", model: "x", content: [{ type: "tool_use", name: "smart_context" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  ]);
  const out = await parseTranscript(file);
  assert.deepEqual(out.tool_calls, { Read: 2, Grep: 1, smart_context: 1 });
});

test("parseTranscript ignores non-assistant entries and malformed lines", async () => {
  const { file } = await writeFixture("s3", [
    { type: "user", message: { content: "x" } },
    { type: "permission-mode", permissionMode: "default" },
    { type: "attachment", attachment: { hookName: "SessionStart" } }
  ]);
  const out = await parseTranscript(file);
  assert.deepEqual(out.usage_totals, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  assert.equal(out.turn_count, 0);
});

test("parseTranscript skips lines that fail JSON.parse without throwing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-"));
  const file = path.join(dir, "broken.jsonl");
  await fs.writeFile(file, '{"type":"user"}\nNOT JSON\n{"type":"assistant","message":{"role":"assistant","model":"m","content":[{"type":"text"}],"usage":{"input_tokens":7,"output_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n', "utf8");
  const out = await parseTranscript(file);
  assert.equal(out.usage_totals.input_tokens, 7);
  assert.equal(out.turn_count, 1);
});

test("locateTranscript scans projects dir to find the sessionId", async () => {
  const projects = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-projects-"));
  const sub = path.join(projects, "C--whatever");
  await fs.mkdir(sub);
  await fs.writeFile(path.join(sub, "abc-123.jsonl"), "", "utf8");
  const found = await locateTranscript(projects, "abc-123");
  assert.ok(found.endsWith("abc-123.jsonl"));
});

test("locateTranscript returns null when sessionId not found", async () => {
  const projects = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-projects-"));
  const found = await locateTranscript(projects, "nope");
  assert.equal(found, null);
});
```

- [ ] **Step 2: Run, see failures**

```bash
node --test test/workflowEvalParser.test.js
```
Expected: 6 failing tests (module not found).

- [ ] **Step 3: Implement the parser**

Save to `scripts/workflow-eval-parser.js`:

```js
import fs from "node:fs/promises";
import path from "node:path";

export async function parseTranscript(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const totals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const tool_calls = {};
  let turn_count = 0;
  let model_id = null;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const message = entry.message;
    if (!message || message.role !== "assistant") continue;
    if (!model_id && message.model) model_id = message.model;
    const usage = message.usage;
    if (usage) {
      totals.input_tokens += usage.input_tokens || 0;
      totals.output_tokens += usage.output_tokens || 0;
      totals.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
      totals.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
      turn_count += 1;
    }
    const content = Array.isArray(message.content) ? message.content : [];
    for (const item of content) {
      if (item?.type === "tool_use" && item.name) {
        tool_calls[item.name] = (tool_calls[item.name] || 0) + 1;
      }
    }
  }
  return { usage_totals: totals, tool_calls, turn_count, model_id };
}

export async function locateTranscript(projectsDir, sessionId) {
  let entries;
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests, all pass**

```bash
node --test test/workflowEvalParser.test.js
```
Expected: 6/6 pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```
Expected: all pre-existing tests still pass. (The new file is not yet wired into `npm test` — that's task A6.)

- [ ] **Step 6: Commit**

```bash
git add scripts/workflow-eval-parser.js test/workflowEvalParser.test.js
git commit -m "feat(workflow-eval): add transcript parser"
```

---

### Task A2: Build `workflow-eval-metrics.js` with TDD

**Files:**
- Create: `scripts/workflow-eval-metrics.js`
- Create: `test/workflowEvalMetrics.test.js`

This module turns parsed sessions into per-task metrics, applies validity rules, and aggregates.

- [ ] **Step 1: Write the failing tests**

Save to `test/workflowEvalMetrics.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBillable, scoreTask, aggregateTasks, qualityRank, isValidPair } from "../scripts/workflow-eval-metrics.js";

test("computeBillable applies 1.25x cache_creation and 0.1x cache_read", () => {
  const u = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000 };
  // 100 + 50 + 1.25*200 + 0.1*1000 = 100+50+250+100 = 500
  assert.equal(computeBillable(u), 500);
});

test("qualityRank orders 정답 > 부분정답 > 거부됨 > 틀림", () => {
  assert.ok(qualityRank("정답") > qualityRank("부분정답"));
  assert.ok(qualityRank("부분정답") > qualityRank("거부됨"));
  assert.ok(qualityRank("거부됨") > qualityRank("틀림"));
  assert.equal(qualityRank("unknown"), 0);
});

test("isValidPair flags cache_read > output as invalid", () => {
  const withSession = { usage_totals: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 200 }, tool_calls: {}, turn_count: 1 };
  const withoutSession = { usage_totals: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, tool_calls: {}, turn_count: 1 };
  const out = isValidPair({ withSession, withoutSession, quality_with: "정답", quality_without: "정답" });
  assert.equal(out.valid, false);
  assert.ok(out.reason.includes("cache"));
});

test("isValidPair flags quality regression as invalid", () => {
  const session = { usage_totals: { input_tokens: 1, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, tool_calls: {}, turn_count: 1 };
  const out = isValidPair({ withSession: session, withoutSession: session, quality_with: "틀림", quality_without: "정답" });
  assert.equal(out.valid, false);
  assert.ok(out.reason.includes("quality"));
});

test("isValidPair returns valid=true when fresh and quality OK", () => {
  const session = { usage_totals: { input_tokens: 100, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, tool_calls: {}, turn_count: 1 };
  const out = isValidPair({ withSession: session, withoutSession: session, quality_with: "정답", quality_without: "정답" });
  assert.equal(out.valid, true);
});

test("scoreTask computes savings and tool-call breakdown", () => {
  const withS = { usage_totals: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, tool_calls: { smart_context: 1, Read: 1 }, turn_count: 3 };
  const withoutS = { usage_totals: { input_tokens: 400, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, tool_calls: { Glob: 2, Grep: 3, Read: 4 }, turn_count: 8 };
  const out = scoreTask({ task_id: "wf-1", withSession: withS, withoutSession: withoutS, quality_with: "정답", quality_without: "정답" });
  assert.equal(out.with_billable, 300);
  assert.equal(out.without_billable, 600);
  assert.equal(out.savings, 0.5);
  assert.deepEqual(out.with_tool_calls, { smart_context: 1, other: 1 });
  assert.equal(out.without_tool_calls.Read, 4);
  assert.equal(out.valid, true);
});

test("aggregateTasks computes median, win count, regressions", () => {
  const tasks = [
    { task_id: "a", savings: 0.3, valid: true, quality_with: "정답", quality_without: "정답" },
    { task_id: "b", savings: -0.1, valid: true, quality_with: "정답", quality_without: "정답" },
    { task_id: "c", savings: 0.2, valid: true, quality_with: "정답", quality_without: "정답" },
    { task_id: "d", savings: 0.5, valid: false, quality_with: "틀림", quality_without: "정답" },
    { task_id: "e", savings: 0.0, valid: true, quality_with: "정답", quality_without: "정답" }
  ];
  const out = aggregateTasks(tasks);
  // valid tasks only: a(0.3), b(-0.1), c(0.2), e(0.0) → sorted -0.1, 0.0, 0.2, 0.3 → median = (0.0+0.2)/2 = 0.1
  assert.equal(Math.round(out.median_savings * 100) / 100, 0.1);
  assert.equal(out.win_count, 2); // a, c
  assert.equal(out.quality_regression_count, 1); // d
});
```

- [ ] **Step 2: Run, see failures**

```bash
node --test test/workflowEvalMetrics.test.js
```
Expected: 7 failing tests (module not found).

- [ ] **Step 3: Implement metrics**

Save to `scripts/workflow-eval-metrics.js`:

```js
const QUALITY_ORDER = { "정답": 4, "부분정답": 3, "거부됨": 2, "틀림": 1 };

export function qualityRank(q) {
  return QUALITY_ORDER[q] || 0;
}

export function computeBillable(usage) {
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    1.25 * (usage.cache_creation_input_tokens || 0) +
    0.1 * (usage.cache_read_input_tokens || 0)
  );
}

export function isValidPair({ withSession, withoutSession, quality_with, quality_without }) {
  for (const [name, s] of [["with", withSession], ["without", withoutSession]]) {
    const u = s.usage_totals;
    if ((u.cache_read_input_tokens || 0) > (u.output_tokens || 0)) {
      return { valid: false, reason: `cache contamination in ${name}-session` };
    }
  }
  if (qualityRank(quality_with) < qualityRank(quality_without)) {
    return { valid: false, reason: "quality regression (with < without)" };
  }
  return { valid: true, reason: null };
}

function splitWithToolCalls(tool_calls) {
  const sc = tool_calls.smart_context || 0;
  let other = 0;
  for (const [name, count] of Object.entries(tool_calls)) {
    if (name !== "smart_context") other += count;
  }
  return { smart_context: sc, other };
}

export function scoreTask({ task_id, withSession, withoutSession, quality_with, quality_without }) {
  const validity = isValidPair({ withSession, withoutSession, quality_with, quality_without });
  const with_billable = computeBillable(withSession.usage_totals);
  const without_billable = computeBillable(withoutSession.usage_totals);
  const savings = without_billable === 0 ? 0 : (without_billable - with_billable) / without_billable;
  return {
    task_id,
    with_billable,
    without_billable,
    savings,
    with_tool_calls: splitWithToolCalls(withSession.tool_calls),
    without_tool_calls: { ...withoutSession.tool_calls },
    with_turns: withSession.turn_count,
    without_turns: withoutSession.turn_count,
    quality_with,
    quality_without,
    valid: validity.valid,
    valid_reason: validity.reason
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function aggregateTasks(tasks) {
  const valid = tasks.filter((t) => t.valid);
  const median_savings = median(valid.map((t) => t.savings));
  const win_count = valid.filter((t) => t.savings > 0).length;
  const quality_regression_count = tasks.filter((t) => qualityRank(t.quality_with) < qualityRank(t.quality_without)).length;
  return { median_savings, win_count, valid_count: valid.length, total_count: tasks.length, quality_regression_count };
}
```

- [ ] **Step 4: Run tests, all pass**

```bash
node --test test/workflowEvalMetrics.test.js
```
Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/workflow-eval-metrics.js test/workflowEvalMetrics.test.js
git commit -m "feat(workflow-eval): add metrics and validity rules"
```

---

### Task A3: Build `workflow-eval-report.js` with TDD

**Files:**
- Create: `scripts/workflow-eval-report.js`
- Create: `test/workflowEvalReport.test.js`

- [ ] **Step 1: Write the failing tests**

Save to `test/workflowEvalReport.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderJson, renderMarkdown, renderConsoleSummary } from "../scripts/workflow-eval-report.js";

const SAMPLE = {
  timestamp: "2026-05-05T12:00:00Z",
  model_id: "claude-opus-4-7",
  metrics: { median_savings: 0.22, win_count: 4, valid_count: 5, total_count: 5, quality_regression_count: 0 },
  tasks: [
    { task_id: "wf-1", with_billable: 8200, without_billable: 12500, savings: 0.34, with_tool_calls: { smart_context: 1, other: 1 }, without_tool_calls: { Glob: 2, Grep: 3, Read: 4 }, with_turns: 3, without_turns: 8, quality_with: "정답", quality_without: "정답", valid: true, valid_reason: null }
  ],
  caveats: ["Sample size: 5 tasks × 1 trial each."]
};

test("renderJson is deterministic and parses", () => {
  const a = renderJson(SAMPLE);
  const b = renderJson(SAMPLE);
  assert.equal(a, b);
  assert.equal(JSON.parse(a).metrics.median_savings, 0.22);
});

test("renderMarkdown contains required sections", () => {
  const md = renderMarkdown(SAMPLE);
  for (const heading of ["TL;DR", "Per-task table", "Token breakdown", "Notes & caveats", "Reproduction"]) {
    assert.ok(md.includes(heading), `missing: ${heading}`);
  }
  assert.ok(md.includes("22%"));
  assert.ok(md.includes("claude-opus-4-7"));
});

test("renderConsoleSummary fits in 6 lines", () => {
  const lines = renderConsoleSummary(SAMPLE).split("\n").filter(Boolean);
  assert.ok(lines.length <= 6, `too long: ${lines.length}`);
  assert.ok(lines.some((l) => l.includes("median savings")));
});

test("renderMarkdown surfaces invalid pairs in Notes section", () => {
  const payload = { ...SAMPLE, tasks: [{ ...SAMPLE.tasks[0], valid: false, valid_reason: "quality regression (with < without)" }] };
  const md = renderMarkdown(payload);
  assert.ok(md.includes("quality regression"));
});
```

- [ ] **Step 2: Run, see failures**

```bash
node --test test/workflowEvalReport.test.js
```
Expected: 4 failing tests.

- [ ] **Step 3: Implement renderer**

Save to `scripts/workflow-eval-report.js`:

```js
function pct(x) { return `${Math.round(x * 100)}%`; }
function fmt(x) { return Math.round(Number(x)).toLocaleString("en-US"); }

export function renderJson(payload) {
  return JSON.stringify(payload, null, 2);
}

export function renderConsoleSummary(payload) {
  const m = payload.metrics;
  return [
    "WORKFLOW EVAL — " + payload.timestamp.slice(0, 10),
    `median savings: ${pct(m.median_savings)}   win: ${m.win_count}/${m.valid_count}   quality regressions: ${m.quality_regression_count}`,
    `model: ${payload.model_id}`,
    `report: docs/eval/workflow/${payload.timestamp.slice(0, 10)}-results.md`
  ].join("\n");
}

function renderToolCalls(tc) {
  if (!tc) return "—";
  return Object.entries(tc).map(([k, v]) => `${k}×${v}`).join(", ") || "—";
}

function renderTaskTable(tasks) {
  const head = ["| task | with bill | without bill | savings | with tools | without tools | quality | valid |",
                "|---|---|---|---|---|---|---|---|"];
  const rows = tasks.map((t) => `| ${t.task_id} | ${fmt(t.with_billable)} | ${fmt(t.without_billable)} | ${pct(t.savings)} | ${renderToolCalls(t.with_tool_calls)} | ${renderToolCalls(t.without_tool_calls)} | ${t.quality_with}/${t.quality_without} | ${t.valid ? "✓" : "✗ " + (t.valid_reason || "")} |`);
  return [...head, ...rows].join("\n");
}

function renderTokenBreakdown(tasks) {
  const valid = tasks.filter((t) => t.valid);
  if (!valid.length) return "_(no valid pairs)_";
  return `- with avg billable: ${fmt(valid.reduce((a, t) => a + t.with_billable, 0) / valid.length)}\n- without avg billable: ${fmt(valid.reduce((a, t) => a + t.without_billable, 0) / valid.length)}`;
}

function renderNotes(tasks) {
  const lines = [];
  for (const t of tasks) {
    if (!t.valid) lines.push(`- **${t.task_id}** invalid: ${t.valid_reason}`);
    if (t.valid && (t.with_tool_calls?.smart_context || 0) === 0) lines.push(`- **${t.task_id}** with-session never invoked smart_context (Claude chose other tools)`);
  }
  return lines.length ? lines.join("\n") : "_All pairs valid; smart_context invoked in every with-session._";
}

export function renderMarkdown(payload) {
  const m = payload.metrics;
  const date = payload.timestamp.slice(0, 10);
  return `# Smart Context — Workflow Eval Report (${date})

## TL;DR

- Median savings: ${pct(m.median_savings)}
- Win count: ${m.win_count}/${m.valid_count} valid pairs
- Quality regressions: ${m.quality_regression_count}
- Model: ${payload.model_id}

## Per-task table

${renderTaskTable(payload.tasks)}

## Token breakdown

${renderTokenBreakdown(payload.tasks)}

## Notes & caveats

${renderNotes(payload.tasks)}

### Boilerplate caveats

${(payload.caveats || []).map((c) => `- ${c}`).join("\n")}

## Reproduction

\`\`\`bash
node scripts/workflow-eval.js
\`\`\`
`;
}
```

- [ ] **Step 4: Run tests, all pass**

```bash
node --test test/workflowEvalReport.test.js
```
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/workflow-eval-report.js test/workflowEvalReport.test.js
git commit -m "feat(workflow-eval): add report renderer"
```

---

### Task A4: Build `workflow-eval.js` orchestrator

**Files:**
- Create: `scripts/workflow-eval.js`

This entry point is integration-tested by running it. No unit test.

- [ ] **Step 1: Write the orchestrator**

Save to `scripts/workflow-eval.js`:

```js
#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseTranscript, locateTranscript } from "./workflow-eval-parser.js";
import { scoreTask, aggregateTasks } from "./workflow-eval-metrics.js";
import { renderJson, renderMarkdown, renderConsoleSummary } from "./workflow-eval-report.js";

const REPO = process.cwd();
const RUNS_CSV = path.join(REPO, "docs/eval/workflow/runs.csv");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

function parseArgs(argv) {
  const args = { outputDate: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--output-date=")) args.outputDate = a.slice("--output-date=".length);
  }
  return args;
}

function parseCsvRow(line) {
  const cells = line.split(",").map((s) => s.trim());
  return cells;
}

async function readRuns() {
  const raw = await fs.readFile(RUNS_CSV, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) throw new Error("runs.csv has no data rows. Header expected on line 1, data from line 2.");
  const header = parseCsvRow(lines[0]);
  const expected = ["task_id", "with_session_id", "without_session_id", "quality_with", "quality_without", "notes"];
  for (const k of expected) {
    if (!header.includes(k)) throw new Error(`runs.csv missing column: ${k}. Header: ${header.join(",")}`);
  }
  const idx = Object.fromEntries(expected.map((k) => [k, header.indexOf(k)]));
  return lines.slice(1).map((l) => {
    const cells = parseCsvRow(l);
    return {
      task_id: cells[idx.task_id],
      with_session_id: cells[idx.with_session_id],
      without_session_id: cells[idx.without_session_id],
      quality_with: cells[idx.quality_with],
      quality_without: cells[idx.quality_without],
      notes: cells[idx.notes] || ""
    };
  });
}

async function loadSession(sessionId) {
  const file = await locateTranscript(PROJECTS_DIR, sessionId);
  if (!file) throw new Error(`transcript not found for sessionId: ${sessionId} under ${PROJECTS_DIR}`);
  return parseTranscript(file);
}

async function main() {
  const args = parseArgs(process.argv);
  const runs = await readRuns();

  const tasks = [];
  let firstModelId = null;
  for (const run of runs) {
    const withSession = await loadSession(run.with_session_id);
    const withoutSession = await loadSession(run.without_session_id);
    if (!firstModelId) firstModelId = withSession.model_id || withoutSession.model_id;
    tasks.push(scoreTask({
      task_id: run.task_id,
      withSession,
      withoutSession,
      quality_with: run.quality_with,
      quality_without: run.quality_without
    }));
  }

  const metrics = aggregateTasks(tasks);
  const date = args.outputDate || new Date().toISOString().slice(0, 10);
  const payload = {
    timestamp: new Date().toISOString(),
    model_id: firstModelId || "unknown",
    metrics,
    tasks,
    caveats: [
      "Sample size: 5 tasks × 1 trial each. Trends, not proofs.",
      "Single evaluator; quality judgment is the user's.",
      "Single repo; results may differ on larger codebases.",
      "Model/version dependent; rerun on Claude version changes."
    ]
  };

  const outDir = path.join(REPO, "docs/eval/workflow");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${date}-results.json`), renderJson(payload), "utf8");
  await fs.writeFile(path.join(outDir, `${date}-results.md`), renderMarkdown(payload), "utf8");

  console.log(renderConsoleSummary(payload));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Smoke-run with no runs.csv (expect a clean error)**

```bash
node scripts/workflow-eval.js
```
Expected: prints `runs.csv` not found error and exits 1. (We'll create the file in Phase B; this confirms the orchestrator's error path is sane.)

If the error message says `ENOENT` and includes the path, that's correct. If something else is thrown, fix the issue and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/workflow-eval.js
git commit -m "feat(workflow-eval): add aggregator entrypoint"
```

---

### Task A5: Wire new tests into `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit the test script**

Current value (after Phase B6 of the prior plan):

```json
"test": "node --test test/query.test.js test/pathSafety.test.js test/snippets.test.js test/tokenBudget.test.js test/ranker.test.js test/scanner.test.js test/searchEngine.test.js test/logger.test.js test/mcpServer.test.js test/stats.test.js test/evalMetrics.test.js test/evalBaseline.test.js test/evalReport.test.js"
```

Replace with (append three new test files):

```json
"test": "node --test test/query.test.js test/pathSafety.test.js test/snippets.test.js test/tokenBudget.test.js test/ranker.test.js test/scanner.test.js test/searchEngine.test.js test/logger.test.js test/mcpServer.test.js test/stats.test.js test/evalMetrics.test.js test/evalBaseline.test.js test/evalReport.test.js test/workflowEvalParser.test.js test/workflowEvalMetrics.test.js test/workflowEvalReport.test.js"
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```
Expected: all tests pass — 46 pre-existing + 6 + 7 + 4 = 63 tests minimum.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include workflow-eval tests in npm test"
```

---

## Phase B — Build the user playbook

### Task B1: Create the tasks playbook

**Files:**
- Create: `docs/eval/workflow/2026-05-05-tasks.md`

- [ ] **Step 1: Write the playbook**

Save to `docs/eval/workflow/2026-05-05-tasks.md`:

```markdown
# Workflow Token-Cost Eval — 2026-05-05 Playbook

This is your runbook. Follow it once per task (5 tasks). Each task = 2 fresh Claude Code sessions (one with smart-context plugin enabled, one without). Total time: 50–120 minutes.

## Tasks

### wf-1 — lookup
```
Where is `smartContext` defined and what does its `baseline` calculation use? Show the relevant lines.
```
**Success:** Answer cites `src/searchEngine.js:50-65` and reproduces `Math.max(estimatedReturned, Math.min(files.length, 8) * 900)`.

### wf-2 — trace
```
Trace what happens when `smart_context` receives `{ query: '' }`. Walk through the call path until an error is returned.
```
**Success:** Answer covers `validateInput` throwing `invalid_query`, the catch block in `smartContext`, and `structuredError` returning the response.

### wf-3 — code-gen
```
Add one new unit test in `test/tokenBudget.test.js` for `trimToBudget`: case where all results already fit under maxTokens. The test should pass.
```
**Success:** A new test is appended; `npm test` passes; the test exercises the all-fit branch (no trimming).

**Cleanup:** after both sessions complete, run `git checkout -- test/tokenBudget.test.js`.

### wf-4 — list
```
List every file that reads from or writes to `.smart-context/logs/`. Brief one-line description per file.
```
**Success:** Answer mentions both `src/logger.js` (writes) and `scripts/stats.js` (reads). README mention is acceptable.

### wf-5 — conceptual
```
Explain the difference between modes `brief`, `explain`, and `pack` in this plugin. Where in the code do these differences manifest?
```
**Success:** Answer cites `src/config.js` (MODES, DEFAULT_BUDGETS), `src/searchEngine.js:33-42` (radius/limit per mode), and `src/searchEngine.js:78` (summary toggle).

## Order (counterbalances first-run learning effect)

| Task | First | Second |
|---|---|---|
| wf-1 | with | without |
| wf-2 | without | with |
| wf-3 | with | without |
| wf-4 | without | with |
| wf-5 | with | without |

## Per-session protocol

1. **Confirm config**:
   - Run `/plugin list`.
   - For "with" runs: `smart-context@smart-context-local` must be enabled. If not: `/plugin enable smart-context@smart-context-local && /reload-plugins`.
   - For "without" runs: it must be disabled. If not: `/plugin disable smart-context@smart-context-local && /reload-plugins`.
2. **Start a fresh session.** Kill Claude Code and restart, or open a new terminal. `/clear` is not enough.
3. **Paste the task prompt above, verbatim.** No follow-ups, no nudges.
4. **Note quality** as one of: `정답`, `부분정답`, `틀림`, `거부됨`.
5. **End the session.** Capture the sessionId:
   ```bash
   ls -t ~/.claude/projects/C--Users-woongchan-OneDrive----New-project-2/ | head -1
   ```
   The first line (without `.jsonl`) is the sessionId.
6. **Toggle plugin state** for the second run, then repeat 2–5.
7. **For wf-3 only:** `git checkout -- test/tokenBudget.test.js` after both sessions.
8. **Append to `runs.csv`:**
   ```
   wf-1,<with_sid>,<without_sid>,정답,정답,
   ```

## Cache hygiene

A truly fresh session has `cache_read_input_tokens` totals far below `output_tokens`. The aggregator validates this; pairs that fail are flagged and you re-run them.

## When all 5 tasks are done

```bash
node scripts/workflow-eval.js
```

This reads `runs.csv`, looks up each transcript, computes metrics, and writes `docs/eval/workflow/<date>-results.{md,json}`.

Then commit:

```bash
git add docs/eval/workflow/runs.csv docs/eval/workflow/<date>-results.md docs/eval/workflow/<date>-results.json
git commit -m "chore(eval): record 2026-05-05 workflow runs and results"
```

## Reading the result

| median savings | win count | reading |
|---|---|---|
| ≥ 30% | ≥ 4/5 | clear effect — recommend smart_context |
| 10–30% | 3–4/5 | weak effect — beneficial in some task shapes |
| −10–10% | 2–3/5 | inconclusive — noise; consider re-measuring |
| < −10% | ≤ 2/5 | adverse — investigate |

If `quality_regression_count > 0`, the savings number is suspect — Claude with the tool gave a worse answer somewhere. The table tells you which task.
```

- [ ] **Step 2: Confirm the file is committable Markdown**

```bash
head -5 docs/eval/workflow/2026-05-05-tasks.md
```
Expected: starts with `# Workflow Token-Cost Eval — 2026-05-05 Playbook`.

- [ ] **Step 3: Commit later (with B2)**

Stage:
```bash
git add docs/eval/workflow/2026-05-05-tasks.md
```

No commit yet; B2 will commit both new files together.

---

### Task B2: Create `runs.csv` (header only)

**Files:**
- Create: `docs/eval/workflow/runs.csv`

- [ ] **Step 1: Write the header**

Save to `docs/eval/workflow/runs.csv`:

```
task_id,with_session_id,without_session_id,quality_with,quality_without,notes
```

That single line is the entire file. Trailing newline is fine.

- [ ] **Step 2: Verify the orchestrator now produces a different error**

```bash
node scripts/workflow-eval.js
```
Expected: error message `runs.csv has no data rows. ...` (the orchestrator now reads the header but finds no data). This confirms the CSV is being parsed.

- [ ] **Step 3: Commit playbook + csv together**

```bash
git add docs/eval/workflow/runs.csv
git commit -m "feat(workflow-eval): add tasks playbook and empty runs.csv"
```

(`docs/eval/workflow/2026-05-05-tasks.md` was already staged in Task B1.)

---

## Phase C — User runs the eval (manual)

The remaining work is user-driven and documented inside the playbook. There are no more code tasks. The plan ends here for the implementer.

After Phase A + B commits land, the user follows `docs/eval/workflow/2026-05-05-tasks.md`:

1. Runs 10 sessions (5 tasks × 2 conditions each), capturing sessionIds into `runs.csv`.
2. Runs `node scripts/workflow-eval.js`.
3. Reads `docs/eval/workflow/<date>-results.md`.
4. Commits the filled `runs.csv` and the generated `results.{md,json}` per the playbook's final step.

If this run reveals new issues to fix in smart-context, those go into a separate brainstorm/plan cycle (per spec §1, this eval is report-only).

---

## Self-Review Notes

Spec coverage:
- §3 Architecture → Phase A (parser, metrics, report, orchestrator) + Phase B (playbook, csv).
- §4 Task Suite (5 tasks with success criteria) → Task B1.
- §5 Run Protocol (per-task steps, order, cache hygiene, time budget) → Task B1 (playbook).
- §6 Metrics (billable formula, per-task fields, aggregate fields, validity rules, soft-noted) → Task A2 (computeBillable, scoreTask, isValidPair, aggregateTasks).
- §7 Output Format (md sections, json shape, console summary, commits) → Task A3 (renderJson/renderMarkdown/renderConsoleSummary) + Task A4 (orchestrator wiring) + B1 (playbook documents the user's commit step).
- §8 Interpretation Guide → Task B1 (playbook reproduces the table).
- §9 Caveats → Task A4 (orchestrator includes the boilerplate).
- §10 Reproduction → Task B1 (playbook documents `node scripts/workflow-eval.js`).

No placeholders, no TBD/TODO. Every step shows actual code or commands.

Type consistency check:
- `parseTranscript` returns `{ usage_totals, tool_calls, turn_count, model_id }` — used everywhere consistently.
- `scoreTask` consumes `withSession` / `withoutSession` (parsed objects) and returns the per-task shape that `renderMarkdown` displays.
- `aggregateTasks` reads `tasks[].savings`, `.valid`, `.quality_with`, `.quality_without` — names match across modules.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-smart-context-workflow-eval.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
