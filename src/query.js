import crypto from "node:crypto";

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "where", "what", "when", "how", "why",
  "is", "are", "was", "were", "in", "on", "to", "of",
  // Code-intent describers: tell us HOW the user wants to find, not WHAT we're searching for.
  // Keeping them as keywords makes them match every code file (every file has functions, classes...).
  "function", "class", "method", "definition", "implementation"
]);

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
  const tryAdd = (word) => {
    if (word.length < 4) return;
    if (STOP_WORDS.has(word)) return;
    if (seen.has(word)) return;
    seen.add(word);
    result.push(word);
  };

  for (const original of rawTokens) {
    tryAdd(original.toLowerCase());
    // Split the original (mixed-case) token to detect camelCase/snake/kebab
    const subs = splitSubTokens(original);
    if (subs.length > 1) {
      for (const sub of subs) tryAdd(sub);
    }
  }

  return result;
}

export function hashQuery(query) {
  return crypto.createHash("sha256").update(String(query)).digest("hex").slice(0, 12);
}
