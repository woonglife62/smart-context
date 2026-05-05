export function rankOf(results, file) {
  if (!file) return 0;
  for (let i = 0; i < results.length; i++) {
    if (results[i].file === file) return i + 1;
  }
  return 0;
}

export function top1Hit(results, expected) {
  if (results.length === 0) return false;
  return results[0].file === expected.top1;
}

export function top3Hit(results, expected) {
  return results.slice(0, 3).some((r) => r.file === expected.top1);
}

export function reciprocalRank(results, expected) {
  const r = rankOf(results, expected.top1);
  return r === 0 ? 0 : 1 / r;
}

export function scoreQuery(results, expected) {
  if (expected.top1 === null) {
    return { top1: results.length === 0, top3: results.length === 0, rr: results.length === 0 ? 1 : 0, rank: 0, edge: true };
  }
  const rank = rankOf(results, expected.top1);
  return {
    top1: top1Hit(results, expected),
    top3: top3Hit(results, expected),
    rr: rank === 0 ? 0 : 1 / rank,
    rank
  };
}

export function aggregateByCategory(perQuery) {
  const buckets = new Map();
  for (const entry of perQuery) {
    const list = buckets.get(entry.category) || [];
    list.push(entry);
    buckets.set(entry.category, list);
  }
  const out = {};
  for (const [cat, list] of buckets) {
    const n = list.length;
    out[cat] = {
      n,
      top1_rate: list.filter((e) => e.score.top1).length / n,
      top3_rate: list.filter((e) => e.score.top3).length / n,
      mrr: list.reduce((a, e) => a + e.score.rr, 0) / n
    };
  }
  return out;
}
