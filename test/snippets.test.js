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
