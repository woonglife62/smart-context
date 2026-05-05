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
