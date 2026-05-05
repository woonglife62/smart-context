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
