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
