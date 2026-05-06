const QUALITY_ORDER = { "정답": 4, "부분정답": 3, "거부됨": 2, "틀림": 1 };

export function qualityRank(q) {
  return QUALITY_ORDER[q] || 0;
}

export function computeBillable(usage) {
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    1.25 * (usage.cache_creation_input_tokens || 0) +
    0.1 * (usage.cache_read_input_tokens || 0)
  );
}

const CACHE_RATIO_LIMIT = 500;

export function isValidPair({ withSession, withoutSession, quality_with, quality_without }) {
  for (const [name, s] of [["with", withSession], ["without", withoutSession]]) {
    const u = s.usage_totals;
    const cr = u.cache_read_input_tokens || 0;
    const out = u.output_tokens || 0;
    if (out === 0 || cr > CACHE_RATIO_LIMIT * out) {
      return { valid: false, reason: `cache contamination in ${name}-session (cache_read/output ratio exceeds ${CACHE_RATIO_LIMIT}x)` };
    }
  }
  if (qualityRank(quality_with) < qualityRank(quality_without)) {
    return { valid: false, reason: "quality regression (with < without)" };
  }
  return { valid: true, reason: null };
}

function splitWithToolCalls(tool_calls) {
  const sc = tool_calls.smart_context || 0;
  let other = 0;
  for (const [name, count] of Object.entries(tool_calls)) {
    if (name !== "smart_context") other += count;
  }
  return { smart_context: sc, other };
}

export function scoreTask({ task_id, withSession, withoutSession, quality_with, quality_without }) {
  const validity = isValidPair({ withSession, withoutSession, quality_with, quality_without });
  const with_billable = computeBillable(withSession.usage_totals);
  const without_billable = computeBillable(withoutSession.usage_totals);
  const savings = without_billable === 0 ? 0 : (without_billable - with_billable) / without_billable;
  return {
    task_id,
    with_billable,
    without_billable,
    savings,
    with_tool_calls: splitWithToolCalls(withSession.tool_calls),
    without_tool_calls: { ...withoutSession.tool_calls },
    with_turns: withSession.turn_count,
    without_turns: withoutSession.turn_count,
    quality_with,
    quality_without,
    valid: validity.valid,
    valid_reason: validity.reason
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function aggregateTasks(tasks) {
  const valid = tasks.filter((t) => t.valid);
  const median_savings = median(valid.map((t) => t.savings));
  const win_count = valid.filter((t) => t.savings > 0).length;
  const quality_regression_count = tasks.filter((t) => qualityRank(t.quality_with) < qualityRank(t.quality_without)).length;
  return { median_savings, win_count, valid_count: valid.length, total_count: tasks.length, quality_regression_count };
}
