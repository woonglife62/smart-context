import fs from "node:fs/promises";
import path from "node:path";

const TOP3 = 3;

export function computeB1({ files_scanned, estimated_tokens_returned }) {
  return Math.max(estimated_tokens_returned, Math.min(files_scanned, 8) * 900);
}

export function computeB2({ matched_files, sizesByFile, glob_tokens, grep_tokens }) {
  const top = matched_files.slice(0, TOP3);
  const readTokens = top.reduce((sum, f) => sum + Math.ceil((sizesByFile[f] || 0) / 4), 0);
  return glob_tokens + grep_tokens + readTokens;
}

export function computeB3({ matched_files, sizesByFile, glob_tokens, grep_tokens }) {
  const readTokens = matched_files.reduce((sum, f) => sum + Math.ceil((sizesByFile[f] || 0) / 4), 0);
  return glob_tokens + grep_tokens + readTokens;
}

export function ratios({ b1, b2, b3 }) {
  return {
    b1_over_b2: b2 === 0 ? Infinity : b1 / b2,
    b1_over_b3: b3 === 0 ? Infinity : b1 / b3
  };
}

export async function readFileSizes(workspaceRoot, relativeFiles) {
  const out = {};
  for (const rel of relativeFiles) {
    try {
      const stat = await fs.stat(path.join(workspaceRoot, rel));
      out[rel] = stat.size;
    } catch {
      out[rel] = 0;
    }
  }
  return out;
}

export function fixedGlobGrepTokens() {
  return { glob_tokens: 200, grep_tokens: 400 };
}

export function computeAllBaselines({ stats, results, sizesByFile }) {
  const matched_files = results.map((r) => r.file);
  const fixed = fixedGlobGrepTokens();
  const b1 = computeB1({ files_scanned: stats.files_scanned, estimated_tokens_returned: stats.estimated_tokens_returned });
  const b2 = computeB2({ matched_files, sizesByFile, ...fixed });
  const b3 = computeB3({ matched_files, sizesByFile, ...fixed });
  return { b1, b2, b3, ...ratios({ b1, b2, b3 }) };
}
