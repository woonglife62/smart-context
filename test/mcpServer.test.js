import test from "node:test";
import assert from "node:assert/strict";
import { smartContextTool, explainTool } from "../mcp/smart-context-server.js";

test("explainTool describes modes", async () => {
  const result = await explainTool();
  assert.match(result.content[0].text, /brief/);
  assert.match(result.content[0].text, /pack/);
});

test("smartContextTool returns MCP text content", async () => {
  const result = await smartContextTool({
    workspaceRoot: "test/fixtures/sample-project",
    query: "where is auth middleware applied?",
    mode: "brief"
  });
  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /src\/auth\/middleware.ts/);
});
