function isTestQuery(query) {
  return /\b(test|tests|spec|failure|mock|fixture)\b/i.test(query);
}

function isTestFile(file) {
  return /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./.test(file);
}

export function rankMatches(workspaceRoot, matches, keywords, query) {
  const wantsTests = isTestQuery(query);
  return matches
    .map((entry) => {
      const pathText = entry.relativeFile.toLowerCase();
      const pathScore = keywords.filter((keyword) => pathText.includes(keyword)).length * 4;
      const densityScore = entry.matches.length * 2;
      const symbolScore = entry.matches.filter((match) => /\b(import|export|function|class|const|app\.|router\.)\b/.test(match.text)).length * 2;
      const testScore = isTestFile(entry.relativeFile) ? (wantsTests ? 6 : -3) : 2;
      const score = pathScore + densityScore + symbolScore + testScore;
      return { ...entry, file: entry.relativeFile, score };
    })
    .sort((a, b) => b.score - a.score || a.relativeFile.localeCompare(b.relativeFile));
}
