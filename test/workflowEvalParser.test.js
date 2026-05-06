import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseTranscript, locateTranscript } from "../scripts/workflow-eval-parser.js";

async function writeFixture(name, lines) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-"));
  const file = path.join(dir, `${name}.jsonl`);
  await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return { dir, file };
}

test("parseTranscript sums usage across assistant messages", async () => {
  const { file } = await writeFixture("s1", [
    { type: "user", message: { content: "hi" } },
    { type: "assistant", message: { role: "assistant", model: "claude-opus-4-7", content: [{ type: "text", text: "hello" }], usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { role: "assistant", model: "claude-opus-4-7", content: [{ type: "text", text: "world" }], usage: { input_tokens: 5, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 130 } } }
  ]);
  const out = await parseTranscript(file);
  assert.deepEqual(out.usage_totals, { input_tokens: 105, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 130 });
  assert.equal(out.turn_count, 2);
  assert.equal(out.model_id, "claude-opus-4-7");
});

test("parseTranscript counts tool calls by name", async () => {
  const { file } = await writeFixture("s2", [
    { type: "assistant", message: { role: "assistant", model: "x", content: [{ type: "tool_use", name: "Read" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { role: "assistant", model: "x", content: [{ type: "tool_use", name: "Read" }, { type: "tool_use", name: "Grep" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { role: "assistant", model: "x", content: [{ type: "tool_use", name: "smart_context" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  ]);
  const out = await parseTranscript(file);
  assert.deepEqual(out.tool_calls, { Read: 2, Grep: 1, smart_context: 1 });
});

test("parseTranscript ignores non-assistant entries and malformed lines", async () => {
  const { file } = await writeFixture("s3", [
    { type: "user", message: { content: "x" } },
    { type: "permission-mode", permissionMode: "default" },
    { type: "attachment", attachment: { hookName: "SessionStart" } }
  ]);
  const out = await parseTranscript(file);
  assert.deepEqual(out.usage_totals, { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  assert.equal(out.turn_count, 0);
});

test("parseTranscript skips lines that fail JSON.parse without throwing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-"));
  const file = path.join(dir, "broken.jsonl");
  await fs.writeFile(file, '{"type":"user"}\nNOT JSON\n{"type":"assistant","message":{"role":"assistant","model":"m","content":[{"type":"text"}],"usage":{"input_tokens":7,"output_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n', "utf8");
  const out = await parseTranscript(file);
  assert.equal(out.usage_totals.input_tokens, 7);
  assert.equal(out.turn_count, 1);
});

test("parseTranscript counts usage once per message.id, but keeps tool_use across content-block entries", async () => {
  // Claude Code transcripts split one assistant message into multiple "assistant" entries —
  // each entry = one content block (thinking, tool_use, text), all sharing the same message.id and usage.
  const sharedUsage = { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const { file } = await writeFixture("dedup", [
    { type: "assistant", message: { id: "msg_A", role: "assistant", model: "m", content: [{ type: "thinking" }], usage: sharedUsage } },
    { type: "assistant", message: { id: "msg_A", role: "assistant", model: "m", content: [{ type: "tool_use", name: "Grep" }], usage: sharedUsage } },
    { type: "assistant", message: { id: "msg_A", role: "assistant", model: "m", content: [{ type: "tool_use", name: "Grep" }], usage: sharedUsage } },
    { type: "assistant", message: { id: "msg_B", role: "assistant", model: "m", content: [{ type: "tool_use", name: "Read" }], usage: { input_tokens: 5, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  ]);
  const out = await parseTranscript(file);
  assert.equal(out.turn_count, 2);
  assert.deepEqual(out.usage_totals, { input_tokens: 15, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
  assert.deepEqual(out.tool_calls, { Grep: 2, Read: 1 });
});

test("parseTranscript normalizes MCP smart_context tool name", async () => {
  const { file } = await writeFixture("mcp-name", [
    { type: "assistant", message: { id: "m1", role: "assistant", model: "m", content: [{ type: "tool_use", name: "mcp__plugin_smart-context_smart-context-local__smart_context" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "assistant", message: { id: "m2", role: "assistant", model: "m", content: [{ type: "tool_use", name: "mcp__plugin_smart-context_smart-context-local__smart_context_explain" }], usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  ]);
  const out = await parseTranscript(file);
  assert.equal(out.tool_calls.smart_context, 1);
  assert.equal(out.tool_calls.smart_context_explain, 1);
});

test("locateTranscript scans projects dir to find the sessionId", async () => {
  const projects = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-projects-"));
  const sub = path.join(projects, "C--whatever");
  await fs.mkdir(sub);
  await fs.writeFile(path.join(sub, "abc-123.jsonl"), "", "utf8");
  const found = await locateTranscript(projects, "abc-123");
  assert.ok(found.endsWith("abc-123.jsonl"));
});

test("locateTranscript returns null when sessionId not found", async () => {
  const projects = await fs.mkdtemp(path.join(os.tmpdir(), "wfe-projects-"));
  const found = await locateTranscript(projects, "nope");
  assert.equal(found, null);
});
