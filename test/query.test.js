import test from "node:test";
import assert from "node:assert/strict";
import { extractKeywords, hashQuery } from "../src/query.js";

test("extractKeywords removes short words and normalizes case", () => {
  const kws = extractKeywords("Where is auth middleware applied in server routes?");
  // Stop words (Where, is, in) and short tokens are dropped; everything else is lowercased.
  for (const k of ["auth", "middleware", "applied", "server", "routes"]) {
    assert.ok(kws.includes(k), `expected '${k}' in ${JSON.stringify(kws)}`);
  }
  assert.ok(!kws.includes("where"), "stop word 'where' should be removed");
});

test("extractKeywords drops code-intent describers (function, class, method, definition, implementation)", () => {
  const kws = extractKeywords("smartContext function definition");
  assert.ok(kws.includes("smartcontext"), "search term must remain");
  assert.ok(!kws.includes("function"), "intent describer 'function' should be filtered");
  assert.ok(!kws.includes("definition"), "intent describer 'definition' should be filtered");
});


test("extractKeywords preserves code-like tokens and includes sub-tokens", () => {
  const kws = extractKeywords("find createUser and auth.middleware.ts");
  // original whole tokens (lowercased)
  assert.ok(kws.includes("find"), "should include 'find'");
  assert.ok(kws.includes("createuser"), "should include 'createuser'");
  assert.ok(kws.includes("auth.middleware.ts"), "should include 'auth.middleware.ts'");
  // camelCase sub-tokens from createUser
  assert.ok(kws.includes("create"), "should include camelCase sub-token 'create'");
  assert.ok(kws.includes("user"), "should include camelCase sub-token 'user'");
});

test("extractKeywords splits camelCase identifiers into sub-tokens", () => {
  const kws = extractKeywords("find createUser and authMiddleware.ts");
  assert.ok(kws.includes("createuser"), "full camel token");
  assert.ok(kws.includes("create"), "camel sub-token create");
  assert.ok(kws.includes("user"), "camel sub-token user");
  assert.ok(kws.includes("authmiddleware.ts"), "full dot token");
  assert.ok(kws.includes("auth"), "camel sub-token auth");
  assert.ok(kws.includes("middleware"), "camel sub-token middleware");
});

test("extractKeywords splits snake_case and kebab-case identifiers", () => {
  const kws = extractKeywords("create_user getUserProfile");
  assert.ok(kws.includes("create"), "snake sub-token create");
  assert.ok(kws.includes("user"), "snake sub-token user");
  assert.ok(kws.includes("getuserprofile"), "full camel token");
  assert.ok(kws.includes("profile"), "camel sub-token profile");
});

test("extractKeywords deduplicates tokens", () => {
  const kws = extractKeywords("auth authMiddleware");
  const authCount = kws.filter((k) => k === "auth").length;
  assert.equal(authCount, 1, "auth should appear only once");
});

test("hashQuery returns stable short hashes without exposing text", () => {
  assert.equal(hashQuery("auth middleware"), hashQuery("auth middleware"));
  assert.match(hashQuery("auth middleware"), /^[a-f0-9]{12}$/);
});
