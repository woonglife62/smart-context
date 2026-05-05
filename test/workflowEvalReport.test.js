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
