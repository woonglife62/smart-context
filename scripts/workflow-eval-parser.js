import fs from "node:fs/promises";
import path from "node:path";

function normalizeToolName(name) {
  if (typeof name !== "string") return name;
  if (name.endsWith("__smart_context")) return "smart_context";
  if (name.endsWith("__smart_context_explain")) return "smart_context_explain";
  return name;
}

export async function parseTranscript(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const totals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const tool_calls = {};
  const seenIds = new Set();
  let turn_count = 0;
  let model_id = null;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const message = entry.message;
    if (!message || message.role !== "assistant") continue;
    if (!model_id && message.model) model_id = message.model;
    const isFirstSeen = !message.id || !seenIds.has(message.id);
    if (message.id) seenIds.add(message.id);
    if (isFirstSeen) {
      const usage = message.usage;
      if (usage) {
        totals.input_tokens += usage.input_tokens || 0;
        totals.output_tokens += usage.output_tokens || 0;
        totals.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
        totals.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
        turn_count += 1;
      }
    }
    const content = Array.isArray(message.content) ? message.content : [];
    for (const item of content) {
      if (item?.type === "tool_use" && item.name) {
        const key = normalizeToolName(item.name);
        tool_calls[key] = (tool_calls[key] || 0) + 1;
      }
    }
  }
  return { usage_totals: totals, tool_calls, turn_count, model_id };
}

export async function locateTranscript(projectsDir, sessionId) {
  let entries;
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}
