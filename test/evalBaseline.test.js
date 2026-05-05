import { test } from "node:test";
import assert from "node:assert/strict";
import { computeB1, computeB2, computeB3, ratios } from "../scripts/eval-baseline.js";

test("computeB1 mirrors src/searchEngine baseline formula", () => {
  assert.equal(computeB1({ files_scanned: 4, estimated_tokens_returned: 200 }), 4 * 900);
  assert.equal(computeB1({ files_scanned: 20, estimated_tokens_returned: 200 }), 8 * 900);
  assert.equal(computeB1({ files_scanned: 4, estimated_tokens_returned: 5000 }), 5000);
});

test("computeB2 = glob + grep + top-3 read", () => {
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
