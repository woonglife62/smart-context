import { DEFAULT_BUDGETS, DEFAULT_EXCLUDES, MAX_TOKEN_BUDGET, MODES } from "./config.js";
import { SmartContextError, structuredError } from "./errors.js";
import { resolveSearchPaths } from "./pathSafety.js";
import { extractKeywords } from "./query.js";
import { listTextFiles, scanFiles } from "./scanner.js";
import { rankMatches } from "./ranker.js";
import { dedupeSnippets, extractSnippet } from "./snippets.js";
import { estimateResultTokens, trimToBudget } from "./tokenBudget.js";

function validateInput(input) {
  if (!input.query || String(input.query).trim().length === 0) {
    throw new SmartContextError("invalid_query", "query is required");
  }
  const mode = input.mode || "brief";
  if (!MODES.has(mode)) {
    throw new SmartContextError("invalid_mode", "mode must be one of brief, explain, or pack", { mode });
  }
  const maxTokens = input.max_tokens ?? DEFAULT_BUDGETS[mode];
  if (!Number.isInteger(maxTokens) || maxTokens < 200 || maxTokens > MAX_TOKEN_BUDGET) {
    throw new SmartContextError("invalid_max_tokens", "max_tokens must be an integer between 200 and 30000", { max_tokens: maxTokens });
  }
  return { mode, maxTokens };
}

function reasonFor(entry) {
  if (entry.relativeFile.includes("middleware")) return "Matches middleware-related query terms";
  if (entry.relativeFile.includes("test")) return "Matches test-related query terms";
  return "Contains query terms in relevant code";
}

function buildResults(ranked, mode) {
  const radius = mode === "pack" ? 4 : 2;
  const limit = mode === "pack" ? 8 : 5;
  return ranked.slice(0, limit).map((entry) => ({
    file: entry.relativeFile,
    score: Number((entry.score / 20).toFixed(2)),
    reason: reasonFor(entry),
    snippets: dedupeSnippets(entry.matches.map((match) => extractSnippet(entry.lines, match.line, radius))).slice(0, mode === "pack" ? 4 : 2)
  }));
}

function buildSummary(results) {
  if (results.length === 0) return "No matching files were found. Broaden the query or search paths.";
  const files = results.slice(0, 3).map((result) => result.file).join(", ");
  return `Most relevant files: ${files}.`;
}

export async function smartContext(input) {
  try {
    const { mode, maxTokens } = validateInput(input);
    const workspaceRoot = input.workspaceRoot || process.cwd();
    const keywords = extractKeywords(input.query);
    if (keywords.length === 0) throw new SmartContextError("invalid_query", "query must include at least one searchable keyword");

    const searchPaths = resolveSearchPaths(workspaceRoot, input.paths);
    const files = await listTextFiles(workspaceRoot, searchPaths, input.exclude || DEFAULT_EXCLUDES);
    const matches = await scanFiles(workspaceRoot, files, keywords);
    const ranked = rankMatches(workspaceRoot, matches, keywords, input.query);
    const untrimmed = buildResults(ranked, mode);
    const results = trimToBudget(untrimmed, maxTokens);
    const estimatedReturned = estimateResultTokens(results);
    const baseline = Math.max(estimatedReturned, Math.min(files.length, 8) * 900);

    const response = {
      ok: true,
      results,
      stats: {
        files_scanned: files.length,
        matches_considered: matches.reduce((count, entry) => count + entry.matches.length, 0),
        snippets_returned: results.reduce((count, result) => count + result.snippets.length, 0),
        estimated_tokens_returned: estimatedReturned,
        estimated_tokens_saved: Math.max(0, baseline - estimatedReturned)
      }
    };
    if (mode !== "brief") response.summary = buildSummary(results);
    return response;
  } catch (error) {
    return structuredError(error);
  }
}
