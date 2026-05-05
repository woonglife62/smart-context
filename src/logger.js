import fs from "node:fs/promises";
import path from "node:path";

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function writeUsageLog(workspaceRoot, event) {
  const logDir = path.join(workspaceRoot, ".smart-context", "logs");
  await fs.mkdir(logDir, { recursive: true });
  const filePath = path.join(logDir, `${dateStamp()}.jsonl`);
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    query_hash: event.query_hash,
    mode: event.mode,
    searched_path_count: event.searched_path_count,
    files_scanned: event.stats?.files_scanned ?? 0,
    matches_considered: event.stats?.matches_considered ?? 0,
    snippets_returned: event.stats?.snippets_returned ?? 0,
    estimated_tokens_returned: event.stats?.estimated_tokens_returned ?? 0,
    estimated_tokens_saved: event.stats?.estimated_tokens_saved ?? 0,
    error_code: event.error_code || null
  });
  await fs.appendFile(filePath, `${line}\n`, "utf8");
}
