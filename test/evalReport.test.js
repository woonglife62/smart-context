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
