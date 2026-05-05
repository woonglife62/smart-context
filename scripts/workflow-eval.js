#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseTranscript, locateTranscript } from "./workflow-eval-parser.js";
import { scoreTask, aggregateTasks } from "./workflow-eval-metrics.js";
import { renderJson, renderMarkdown, renderConsoleSummary } from "./workflow-eval-report.js";

const REPO = process.cwd();
const RUNS_CSV = path.join(REPO, "docs/eval/workflow/runs.csv");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

function parseArgs(argv) {
  const args = { outputDate: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--output-date=")) args.outputDate = a.slice("--output-date=".length);
  }
  return args;
}

function parseCsvRow(line) {
  const cells = line.split(",").map((s) => s.trim());
  return cells;
}

async function readRuns() {
  const raw = await fs.readFile(RUNS_CSV, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) throw new Error("runs.csv has no data rows. Header expected on line 1, data from line 2.");
  const header = parseCsvRow(lines[0]);
  const expected = ["task_id", "with_session_id", "without_session_id", "quality_with", "quality_without", "notes"];
  for (const k of expected) {
    if (!header.includes(k)) throw new Error(`runs.csv missing column: ${k}. Header: ${header.join(",")}`);
  }
  const idx = Object.fromEntries(expected.map((k) => [k, header.indexOf(k)]));
  return lines.slice(1).map((l) => {
    const cells = parseCsvRow(l);
    return {
      task_id: cells[idx.task_id],
      with_session_id: cells[idx.with_session_id],
      without_session_id: cells[idx.without_session_id],
      quality_with: cells[idx.quality_with],
      quality_without: cells[idx.quality_without],
      notes: cells[idx.notes] || ""
    };
  });
}

async function loadSession(sessionId) {
  const file = await locateTranscript(PROJECTS_DIR, sessionId);
  if (!file) throw new Error(`transcript not found for sessionId: ${sessionId} under ${PROJECTS_DIR}`);
  return parseTranscript(file);
}

async function main() {
  const args = parseArgs(process.argv);
  const runs = await readRuns();

  const tasks = [];
  let firstModelId = null;
  for (const run of runs) {
    const withSession = await loadSession(run.with_session_id);
    const withoutSession = await loadSession(run.without_session_id);
    if (!firstModelId) firstModelId = withSession.model_id || withoutSession.model_id;
    tasks.push(scoreTask({
      task_id: run.task_id,
      withSession,
      withoutSession,
      quality_with: run.quality_with,
      quality_without: run.quality_without
    }));
  }

  const metrics = aggregateTasks(tasks);
  const date = args.outputDate || new Date().toISOString().slice(0, 10);
  const payload = {
    timestamp: new Date().toISOString(),
    model_id: firstModelId || "unknown",
    metrics,
    tasks,
    caveats: [
      "Sample size: 5 tasks × 1 trial each. Trends, not proofs.",
      "Single evaluator; quality judgment is the user's.",
      "Single repo; results may differ on larger codebases.",
      "Model/version dependent; rerun on Claude version changes."
    ]
  };

  const outDir = path.join(REPO, "docs/eval/workflow");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${date}-results.json`), renderJson(payload), "utf8");
  await fs.writeFile(path.join(outDir, `${date}-results.md`), renderMarkdown(payload), "utf8");

  console.log(renderConsoleSummary(payload));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
