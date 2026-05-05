function pct(x) { return `${Math.round(x * 100)}%`; }
function fmt(x) { return Math.round(Number(x)).toLocaleString("en-US"); }

export function renderJson(payload) {
  return JSON.stringify(payload, null, 2);
}

export function renderConsoleSummary(payload) {
  const m = payload.metrics;
  return [
    "WORKFLOW EVAL — " + payload.timestamp.slice(0, 10),
    `median savings: ${pct(m.median_savings)}   win: ${m.win_count}/${m.valid_count}   quality regressions: ${m.quality_regression_count}`,
    `model: ${payload.model_id}`,
    `report: docs/eval/workflow/${payload.timestamp.slice(0, 10)}-results.md`
  ].join("\n");
}

function renderToolCalls(tc) {
  if (!tc) return "—";
  return Object.entries(tc).map(([k, v]) => `${k}×${v}`).join(", ") || "—";
}

function renderTaskTable(tasks) {
  const head = ["| task | with bill | without bill | savings | with tools | without tools | quality | valid |",
                "|---|---|---|---|---|---|---|---|"];
  const rows = tasks.map((t) => `| ${t.task_id} | ${fmt(t.with_billable)} | ${fmt(t.without_billable)} | ${pct(t.savings)} | ${renderToolCalls(t.with_tool_calls)} | ${renderToolCalls(t.without_tool_calls)} | ${t.quality_with}/${t.quality_without} | ${t.valid ? "✓" : "✗ " + (t.valid_reason || "")} |`);
  return [...head, ...rows].join("\n");
}

function renderTokenBreakdown(tasks) {
  const valid = tasks.filter((t) => t.valid);
  if (!valid.length) return "_(no valid pairs)_";
  return `- with avg billable: ${fmt(valid.reduce((a, t) => a + t.with_billable, 0) / valid.length)}\n- without avg billable: ${fmt(valid.reduce((a, t) => a + t.without_billable, 0) / valid.length)}`;
}

function renderNotes(tasks) {
  const lines = [];
  for (const t of tasks) {
    if (!t.valid) lines.push(`- **${t.task_id}** invalid: ${t.valid_reason}`);
    if (t.valid && (t.with_tool_calls?.smart_context || 0) === 0) lines.push(`- **${t.task_id}** with-session never invoked smart_context (Claude chose other tools)`);
  }
  return lines.length ? lines.join("\n") : "_All pairs valid; smart_context invoked in every with-session._";
}

export function renderMarkdown(payload) {
  const m = payload.metrics;
  const date = payload.timestamp.slice(0, 10);
  return `# Smart Context — Workflow Eval Report (${date})

## TL;DR

- Median savings: ${pct(m.median_savings)}
- Win count: ${m.win_count}/${m.valid_count} valid pairs
- Quality regressions: ${m.quality_regression_count}
- Model: ${payload.model_id}

## Per-task table

${renderTaskTable(payload.tasks)}

## Token breakdown

${renderTokenBreakdown(payload.tasks)}

## Notes & caveats

${renderNotes(payload.tasks)}

### Boilerplate caveats

${(payload.caveats || []).map((c) => `- ${c}`).join("\n")}

## Reproduction

\`\`\`bash
node scripts/workflow-eval.js
\`\`\`
`;
}
