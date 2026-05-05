import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function runStats(cwd) {
  const result = spawnSync("node", [path.resolve("scripts/stats.js")], {
    cwd,
    encoding: "utf8",
    stdio: "pipe"
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

test("stats reports correct aggregates from sample log lines", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sc-stats-"));
  const logDir = path.join(dir, ".smart-context", "logs");
  await fs.mkdir(logDir, { recursive: true });

  const line1 = JSON.stringify({
    timestamp: "2026-01-01T00:00:00Z",
    query_hash: "abc",
    mode: "brief",
    searched_path_count: 1,
    files_scanned: 10,
    matches_considered: 5,
    snippets_returned: 2,
    estimated_tokens_returned: 300,
    estimated_tokens_saved: 700,
    error_code: null
  });
  const line2 = JSON.stringify({
    timestamp: "2026-01-02T00:00:00Z",
    query_hash: "def",
    mode: "pack",
    searched_path_count: 2,
    files_scanned: 20,
    matches_considered: 8,
    snippets_returned: 4,
    estimated_tokens_returned: 500,
    estimated_tokens_saved: 1500,
    error_code: null
  });

  await fs.writeFile(path.join(logDir, "2026-01-01.jsonl"), `${line1}\n`, "utf8");
  await fs.writeFile(path.join(logDir, "2026-01-02.jsonl"), `${line2}\n`, "utf8");

  const { stdout, status } = runStats(dir);
  assert.equal(status, 0, `stats.js exited non-zero: ${stdout}`);
  assert.match(stdout, /total calls\s*:\s*2/i);
  assert.match(stdout, /tokens returned\s*:\s*800/i);
  assert.match(stdout, /tokens saved\s*:\s*2200/i);
  assert.match(stdout, /brief\s*:\s*1/i);
  assert.match(stdout, /pack\s*:\s*1/i);
});

test("stats exits 0 with message when no logs exist", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sc-stats-empty-"));
  const { stdout, status } = runStats(dir);
  assert.equal(status, 0);
  assert.match(stdout, /no usage logs/i);
});
