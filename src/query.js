import crypto from "node:crypto";

const STOP_WORDS = new Set(["the", "and", "for", "with", "where", "what", "when", "how", "why", "is", "are", "was", "were", "in", "on", "to", "of"]);

function splitSubTokens(token) {
  // Split camelCase boundaries then split on _, -, and . (strips extensions too)
  const camelSplit = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ");
  const parts = [];
  for (const part of camelSplit) {
    for (const sub of part.split(/[_\-.]+/)) {
      if (sub) parts.push(sub.toLowerCase());
    }
  }
  return parts;
}

export function extractKeywords(query) {
  // Keep original case for camelCase splitting; lowercase happens per-token
  const rawTokens = String(query)
    .split(/[^a-z0-9_.-]+/gi)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  const seen = new Set();
  const result = [];

  for (const original of rawTokens) {
    const lower = original.toLowerCase();
    if (!STOP_WORDS.has(lower)) {
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(lower);
      }
    }
    // Split the original (mixed-case) token to detect camelCase/snake/kebab
    const subs = splitSubTokens(original);
    if (subs.length > 1) {
      for (const sub of subs) {
        if (sub.length >= 4 && !STOP_WORDS.has(sub) && !seen.has(sub)) {
          seen.add(sub);
          result.push(sub);
        }
      }
    }
  }

  return result;
}

export function hashQuery(query) {
  return crypto.createHash("sha256").update(String(query)).digest("hex").slice(0, 12);
}
