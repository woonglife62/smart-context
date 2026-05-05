export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function estimateResultTokens(results) {
  return estimateTokens(JSON.stringify(results));
}

export function trimToBudget(results, maxTokens) {
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const result of sorted) {
    const candidate = [...kept, result];
    if (estimateResultTokens(candidate) <= maxTokens || kept.length === 0) {
      kept.push(result);
    }
  }
  return kept;
}
