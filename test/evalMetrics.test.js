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
