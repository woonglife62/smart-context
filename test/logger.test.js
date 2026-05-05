import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { writeUsageLog } from "../src/logger.js";

const workspaceRoot = path.resolve("test/fixtures/sample-project");

test("writeUsageLog stores stats without query or snippets", async () => {
  await fs.rm(path.join(workspaceRoot, ".smart-context"), { recursive: true, force: true });
  await writeUsageLog(workspaceRoot, {
    query_hash: "abc123",
    mode: "brief",
    searched_path_count: 1,
    stats: {
      files_scanned: 3,
      matches_considered: 2,
      snippets_returned: 1,
      estimated_tokens_returned: 100,
      estimated_tokens_saved: 200
    }
  });

  const logDir = path.join(workspaceRoot, ".smart-context", "logs");
  const files = await fs.readdir(logDir);
  const content = await fs.readFile(path.join(logDir, files[0]), "utf8");
  assert.match(content, /"query_hash":"abc123"/);
  assert.doesNotMatch(content, /auth middleware/);
  assert.doesNotMatch(content, /"code"\s*:\s*"/);
});
