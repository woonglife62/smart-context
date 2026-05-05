export function extractSnippet(lines, zeroBasedMatchLine, radius = 2) {
  const startIndex = Math.max(0, zeroBasedMatchLine - radius);
  const endIndex = Math.min(lines.length - 1, zeroBasedMatchLine + radius);
  return {
    start: startIndex + 1,
    end: endIndex + 1,
    code: lines.slice(startIndex, endIndex + 1).join("\n")
  };
}

export function dedupeSnippets(snippets) {
  const sorted = [...snippets].sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = [];
  for (const snippet of sorted) {
    const overlaps = kept.some((existing) => snippet.start <= existing.end && snippet.end >= existing.start);
    if (!overlaps) kept.push(snippet);
  }
  return kept;
}
