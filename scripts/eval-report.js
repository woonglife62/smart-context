function pct(x) { return `${Math.round(x * 100)}%`; }
function fixed(x, n = 2) { return Number(x).toFixed(n); }

export function renderJson(payload) {
  return JSON.stringify(payload, null, 2);
}

export function renderConsoleSummary(payload) {
  const r = payload.metrics.ranking.overall;
  const t = payload.metrics.tokens;
  const c = payload.metrics.consistency;
  const l = payload.metrics.latency;
  const issues = payload.issues || [];
  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const i of issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
  return [
    "SMART CONTEXT EVAL — " + payload.timestamp.slice(0, 10),
    `top-1: ${pct(r.top1_rate)}   top-3: ${pct(r.top3_rate)}   MRR: ${fixed(r.mrr)}`,
    `tokens B1/B2 ratio: ${fixed(t.avg_b1_over_b2)}`,
    `consistency: ${c.set_equal_count}/${c.total} identical`,
    `warm p50: ${l.warm_p50_rg} ms (rg) / ${l.warm_p50_node} ms (node)`,
    `issues: P0=${counts.P0}  P1=${counts.P1}  P2=${counts.P2}`,
    `report: docs/eval/${payload.timestamp.slice(0,10)}-results.md`
  ].join("\n");
}

function renderRankingTable(byCategory) {
  const rows = ["| category | n | top-1 | top-3 | MRR |", "|---|---|---|---|---|"];
  for (const [cat, m] of Object.entries(byCategory)) {
    rows.push(`| ${cat} | ${m.n} | ${pct(m.top1_rate)} | ${pct(m.top3_rate)} | ${fixed(m.mrr)} |`);
  }
  return rows.join("\n");
}

function renderIssues(issues) {
  if (!issues.length) return "_No issues found._";
  return issues.map((i) => `- **${i.severity}** — ${i.title}\n  - Evidence: ${i.evidence.join("; ")}\n  - Hypothesis: ${i.hypothesis}\n  - Fix: ${i.fix_proposal}\n  - Classification: ${i.classification}`).join("\n");
}

export function renderMarkdown(payload) {
  const r = payload.metrics.ranking.overall;
  const t = payload.metrics.tokens;
  const c = payload.metrics.consistency;
  const l = payload.metrics.latency;
  const date = payload.timestamp.slice(0, 10);
  return `# Smart Context — Eval Report (${date})

## TL;DR

- Top-1 hit rate: ${pct(r.top1_rate)} (${r.top1_rate >= 0.75 ? "OK" : "below 75%"})
- Top-3 hit rate: ${pct(r.top3_rate)}
- MRR: ${fixed(r.mrr)}
- Token B1/B2 ratio: ${fixed(t.avg_b1_over_b2)} (${t.avg_b1_over_b2 >= 1.3 ? "overstated" : t.avg_b1_over_b2 <= 0.7 ? "understated" : "OK"})
- Consistency: ${c.set_equal_count}/${c.total} identical (3 reruns each)
- Warm p50: ${l.warm_p50_rg} ms (rg) / ${l.warm_p50_node} ms (node)

## Environment

- Node: ${payload.env.node}
- OS: ${payload.env.os}
- ripgrep: ${payload.env.rg}
- HEAD SHA: ${payload.env.head_sha}

## Ranking

${renderRankingTable(payload.metrics.ranking.by_category)}

## Token Savings

- B1 / B2 average: ${fixed(t.avg_b1_over_b2)}
- B1 / B3 average: ${fixed(t.avg_b1_over_b3)}
- Per-query detail: see results.json \`metrics.tokens.per_query\`

## Consistency

- Set-equality across 3 runs: ${c.set_equal_count}/${c.total}
- Order-equality across 3 runs: ${c.order_equal_count}/${c.total}

## Latency

- Warm p50 (rg / node): ${l.warm_p50_rg} ms / ${l.warm_p50_node} ms
- Warm p95 (rg / node): ${l.warm_p95_rg} ms / ${l.warm_p95_node} ms
- MCP round-trip overhead: ${l.mcp_overhead_ms} ms

## Issues

${renderIssues(payload.issues || [])}

## Reproduction

\`\`\`bash
node scripts/eval.js
node scripts/eval.js --baseline=docs/eval/${date}-results.json
\`\`\`
`;
}
