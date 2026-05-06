const PROSE_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const DEFINITION_RE = /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|def|func|fn)\s+([A-Za-z_$][\w$]*)/i;

function isTestQuery(query) {
  return /\b(test|tests|spec|failure|mock|fixture)\b/i.test(query);
}

function isTestFile(file) {
  return /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./.test(file);
}

function isProseFile(relativeFile) {
  const lower = relativeFile.toLowerCase();
  for (const ext of PROSE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function proseMultiplier(relativeFile) {
  return isProseFile(relativeFile) ? 0.2 : 1;
}

function definitionMatches(line, keywords) {
  const m = line.match(DEFINITION_RE);
  if (!m) return false;
  const name = m[1].toLowerCase();
  return keywords.some((k) => name.includes(k) || k.includes(name));
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
      const definitionScore = isProseFile(entry.relativeFile)
        ? 0
        : entry.matches.filter((match) => definitionMatches(match.text, keywords)).length * 5;
      const rawScore = pathScore + densityScore + symbolScore + testScore + definitionScore;
      const score = rawScore * proseMultiplier(entry.relativeFile);
      return { ...entry, file: entry.relativeFile, score };
    })
    .sort((a, b) => b.score - a.score || a.relativeFile.localeCompare(b.relativeFile));
}
