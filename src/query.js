import crypto from "node:crypto";

const STOP_WORDS = new Set(["the", "and", "for", "with", "where", "what", "when", "how", "why", "is", "are", "was", "were", "in", "on", "to", "of"]);

export function extractKeywords(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
}

export function hashQuery(query) {
  return crypto.createHash("sha256").update(String(query)).digest("hex").slice(0, 12);
}
