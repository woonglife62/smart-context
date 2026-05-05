#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";
import { smartContext } from "../src/searchEngine.js";
import { scoreQuery, aggregateByCategory } from "./eval-metrics.js";
import { computeAllBaselines, readFileSizes } from "./eval-baseline.js";
import { renderJson, renderMarkdown, renderConsoleSummary } from "./eval-report.js";

const REPO = process.cwd();
const FIXTURE = path.join(REPO, "test/fixtures/golden-queries.json");

function parseArgs(argv) {
  const args = { baseline: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--baseline=")) args.baseline = a.slice("--baseline=".length);
  }
  return args;
}

function safeRgVersion() {
  try {
    return execSync("rg --version", { encoding: "utf8" }).split("\n")[0];
  } catch {
    return "unavailable";
  }
}

function safeHeadSha() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function setEqual(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return false;
  return true;
}

function arrayEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function ms(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function runQueryOnce(q) {
  const start = process.hrtime.bigint();
  const out = await smartContext({ workspaceRoot: REPO, query: q.query, mode: q.mode || "brief", paths: q.paths });
  return { latency_ms: ms(start), out };
}

function pickRipgrepMode(disable) {
  if (disable) process.env.SMART_CONTEXT_DISABLE_RG = "1";
  else delete process.env.SMART_CONTEXT_DISABLE_RG;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

async function runFor(mode, queries) {
  pickRipgrepMode(mode === "node");
  const records = [];
  for (const q of queries) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await runQueryOnce(q));
    const final = runs[runs.length - 1].out;
    const sizesByFile = await readFileSizes(REPO, (final.results || []).map((r) => r.file));
    const baselines = (final.results && final.stats)
      ? computeAllBaselines({ stats: final.stats, results: final.results, sizesByFile })
      : { b1: 0, b2: 0, b3: 0, b1_over_b2: 0, b1_over_b3: 0 };
    records.push({ q, runs, baselines });
  }
  return records;
}

async function mcpOverheadMicrobench() {
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, ["mcp/smart-context-server.js"], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const wait = (predicate) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("mcp microbench timeout")), 5000);
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (predicate(buf)) { clearTimeout(timer); resolve(); }
      });
    });
    child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2024-11-05", capabilities:{}, clientInfo:{ name:"eval", version:"0" } } }) + "\n");
    await wait((s) => s.includes("\"id\":1"));
    const t0 = process.hrtime.bigint();
    child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:2, method:"tools/call", params:{ name:"smart_context", arguments:{ query:"smartContext", mode:"brief" } } }) + "\n");
    await wait((s) => s.includes("\"id\":2"));
    const elapsed = Number(process.hrtime.bigint() - t0) / 1e6;
    child.kill();
    return Math.round(elapsed);
  } catch {
    return null;
  }
}

function collectIssues({ overall, byCategory, tokens, consistency, latency, perQuery }) {
  const issues = [];
  const thresholds = { exact_identifier: 0.9, conceptual: 0.6, distractor: 0.7, prose_only: 0.6 };
  for (const [cat, m] of Object.entries(byCategory)) {
    if (thresholds[cat] !== undefined && m.top1_rate < thresholds[cat]) {
      const offenders = perQuery.filter((e) => e.category === cat && !e.score.top1).map((e) => `${e.id}: rank ${e.score.rank}`);
      issues.push({ severity: "P1", title: `${cat} top-1 below threshold (${m.top1_rate.toFixed(2)} < ${thresholds[cat]})`, evidence: offenders, hypothesis: "category-specific ranking weakness", fix_proposal: "see triage protocol in plan §E", classification: "investigate" });
    }
  }
  if (tokens.avg_b1_over_b2 > 1.3) issues.push({ severity: "P1", title: "tokens_saved overstated", evidence: [`avg B1/B2 = ${tokens.avg_b1_over_b2.toFixed(2)}`], hypothesis: "baseline floor min(files,8)*900 too aggressive", fix_proposal: "report-only — algorithmic redesign §7.2", classification: "report-only" });
  if (tokens.avg_b1_over_b2 < 0.7) issues.push({ severity: "P2", title: "tokens_saved understated", evidence: [`avg B1/B2 = ${tokens.avg_b1_over_b2.toFixed(2)}`], hypothesis: "baseline floor too low", fix_proposal: "report-only", classification: "report-only" });
  if (consistency.set_equal_count < consistency.total) {
    const offenders = perQuery.filter((e) => !e.consistency.set_equal).map((e) => e.id);
    issues.push({ severity: "P1", title: "inconsistent results across reruns", evidence: offenders, hypothesis: "non-deterministic scanner ordering or ranker tie-break", fix_proposal: "stable sort fix; see plan task E2", classification: "investigate" });
  }
  if (latency.warm_p50_rg > 100) issues.push({ severity: "P2", title: "warm p50 above 100ms with ripgrep", evidence: [`warm_p50_rg = ${latency.warm_p50_rg}`], hypothesis: "scanner overhead", fix_proposal: "report-only — profile in next cycle", classification: "report-only" });
  return issues;
}

function renderDelta(prior, current) {
  const a = prior.metrics, b = current.metrics;
  const line = (label, x, y) => `- ${label}: ${typeof x === "number" ? x.toFixed(2) : x} → ${typeof y === "number" ? y.toFixed(2) : y}`;
  return `# Eval Delta (${prior.timestamp.slice(0,10)} → ${current.timestamp.slice(0,10)})

${line("top-1 rate", a.ranking.overall.top1_rate, b.ranking.overall.top1_rate)}
${line("top-3 rate", a.ranking.overall.top3_rate, b.ranking.overall.top3_rate)}
${line("MRR", a.ranking.overall.mrr, b.ranking.overall.mrr)}
${line("B1/B2 avg", a.tokens.avg_b1_over_b2, b.tokens.avg_b1_over_b2)}
${line("set-equal count", a.consistency.set_equal_count, b.consistency.set_equal_count)}
${line("warm p50 rg", a.latency.warm_p50_rg, b.latency.warm_p50_rg)}
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const fixtureRaw = await fs.readFile(FIXTURE, "utf8");
  const queries = JSON.parse(fixtureRaw).queries;

  const rgRuns = await runFor("rg", queries);
  const nodeRuns = await runFor("node", queries);

  const perQuery = rgRuns.map((rec) => {
    const finalOut = rec.runs[rec.runs.length - 1].out;
    const results = finalOut.results || [];
    const score = scoreQuery(results, rec.q.expected);
    const filesAcrossRuns = rec.runs.map((r) => (r.out.results || []).map((x) => x.file));
    return {
      id: rec.q.id,
      category: rec.q.category,
      query: rec.q.query,
      score,
      latencies_ms: rec.runs.map((r) => Math.round(r.latency_ms)),
      consistency: {
        set_equal: filesAcrossRuns.every((f) => setEqual(f, filesAcrossRuns[0])),
        order_equal: filesAcrossRuns.every((f) => arrayEqual(f, filesAcrossRuns[0]))
      },
      baselines: rec.baselines
    };
  });

  const overall = {
    top1_rate: perQuery.filter((e) => e.score.top1).length / perQuery.length,
    top3_rate: perQuery.filter((e) => e.score.top3).length / perQuery.length,
    mrr: perQuery.reduce((a, e) => a + e.score.rr, 0) / perQuery.length
  };
  const byCategory = aggregateByCategory(perQuery);

  const ratios_b1_b2 = perQuery.map((e) => e.baselines.b1_over_b2).filter((x) => x > 0 && Number.isFinite(x));
  const ratios_b1_b3 = perQuery.map((e) => e.baselines.b1_over_b3).filter((x) => x > 0 && Number.isFinite(x));
  const tokens = {
    avg_b1_over_b2: ratios_b1_b2.length ? ratios_b1_b2.reduce((a, x) => a + x, 0) / ratios_b1_b2.length : 0,
    avg_b1_over_b3: ratios_b1_b3.length ? ratios_b1_b3.reduce((a, x) => a + x, 0) / ratios_b1_b3.length : 0,
    per_query: perQuery.map((e) => ({ id: e.id, ...e.baselines }))
  };

  const consistency = {
    total: perQuery.length,
    set_equal_count: perQuery.filter((e) => e.consistency.set_equal).length,
    order_equal_count: perQuery.filter((e) => e.consistency.order_equal).length
  };

  const warmRg = rgRuns.flatMap((r) => r.runs.slice(1).map((x) => x.latency_ms));
  const warmNode = nodeRuns.flatMap((r) => r.runs.slice(1).map((x) => x.latency_ms));
  const latency = {
    warm_p50_rg: percentile(warmRg, 50),
    warm_p95_rg: percentile(warmRg, 95),
    warm_p50_node: percentile(warmNode, 50),
    warm_p95_node: percentile(warmNode, 95),
    mcp_overhead_ms: await mcpOverheadMicrobench()
  };

  const issues = collectIssues({ overall, byCategory, tokens, consistency, latency, perQuery });

  const date = new Date().toISOString();
  const payload = {
    timestamp: date,
    env: { node: process.version, os: `${os.platform()}-${os.release()}`, rg: safeRgVersion(), head_sha: safeHeadSha() },
    metrics: { ranking: { overall, by_category: byCategory }, tokens, consistency, latency },
    queries: perQuery,
    issues
  };

  const day = date.slice(0, 10);
  const outDir = path.join(REPO, "docs/eval");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${day}-results.json`), renderJson(payload), "utf8");
  await fs.writeFile(path.join(outDir, `${day}-results.md`), renderMarkdown(payload), "utf8");

  if (args.baseline) {
    const prior = JSON.parse(await fs.readFile(args.baseline, "utf8"));
    const delta = renderDelta(prior, payload);
    await fs.writeFile(path.join(outDir, `${day}-delta.md`), delta, "utf8");
    console.log("delta written to docs/eval/" + day + "-delta.md");
  }

  console.log(renderConsoleSummary(payload));
}

main().catch((e) => { console.error(e); process.exit(1); });
