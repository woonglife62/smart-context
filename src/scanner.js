import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DEFAULT_EXCLUDES } from "./config.js";

const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md", ".yml", ".yaml", ".html", ".css", ".py", ".go", ".rs", ".java", ".cs"]);

function isExcluded(filePath, exclude) {
  const normalized = filePath.split(path.sep).join("/");
  return exclude.some((part) => normalized.includes(`/${part}/`) || normalized.endsWith(`/${part}`));
}

async function walk(root, dir, exclude, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (isExcluded(fullPath, exclude)) continue;
    if (entry.isDirectory()) {
      await walk(root, fullPath, exclude, out);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(fullPath);
    }
  }
}

export async function listTextFiles(workspaceRoot, searchPaths, exclude = DEFAULT_EXCLUDES) {
  const files = [];
  for (const searchPath of searchPaths) {
    const stat = await fs.stat(searchPath);
    if (stat.isDirectory()) {
      await walk(workspaceRoot, searchPath, exclude, files);
    } else if (stat.isFile() && TEXT_EXTENSIONS.has(path.extname(searchPath))) {
      files.push(searchPath);
    }
  }
  return [...new Set(files)];
}

export async function scanFilesNode(workspaceRoot, files, keywords) {
  const matches = [];
  for (const filePath of files) {
    const text = await fs.readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const fileMatches = [];
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      if (keywords.some((keyword) => lower.includes(keyword))) {
        fileMatches.push({ line: index, text: line });
      }
    });
    if (fileMatches.length > 0) {
      matches.push({ filePath, relativeFile: path.relative(workspaceRoot, filePath).split(path.sep).join("/"), lines, matches: fileMatches });
    }
  }
  return matches;
}

let cachedRipgrepBinary;

function ripgrepCandidates() {
  if (process.platform === "win32") {
    return ["rg", "rg.exe", "C:/ProgramData/chocolatey/bin/rg.exe"];
  }
  return ["rg"];
}

function detectRipgrep() {
  if (cachedRipgrepBinary !== undefined) return cachedRipgrepBinary;
  for (const candidate of ripgrepCandidates()) {
    try {
      const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
      if (result.status === 0) {
        cachedRipgrepBinary = candidate;
        return cachedRipgrepBinary;
      }
    } catch {
      // continue probing
    }
  }
  cachedRipgrepBinary = null;
  return null;
}

export function isRipgrepAvailable() {
  return detectRipgrep() !== null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(keywords) {
  const escaped = keywords.map(escapeRegex);
  return `(${escaped.join("|")})`;
}

function spawnRipgrep(binary, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      // rg exit codes: 0 matches, 1 no matches, 2 error
      if (code === 0 || code === 1) resolve({ stdout, stderr });
      else reject(new Error(`ripgrep exited with code ${code}: ${stderr}`));
    });
  });
}

export async function scanFilesWithRipgrep(workspaceRoot, files, keywords) {
  if (files.length === 0 || keywords.length === 0) return [];
  const binary = detectRipgrep();
  if (!binary) throw new Error("ripgrep not available");

  const fileSet = new Set(files.map((f) => path.resolve(f)));
  const pattern = buildPattern(keywords);
  const args = ["--json", "--no-heading", "--line-number", "--color", "never", "-i", "-e", pattern, ...files];
  const { stdout } = await spawnRipgrep(binary, args);

  // Map filePath -> { lines: string[]?, matches: Array }
  const perFile = new Map();
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine) continue;
    let evt;
    try {
      evt = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (evt.type !== "match") continue;
    const data = evt.data;
    const pathText = data?.path?.text;
    if (!pathText) continue;
    const absPath = path.resolve(pathText);
    if (!fileSet.has(absPath)) continue;
    const lineNumber = (data.line_number ?? 1) - 1; // 0-indexed for parity with Node version
    // rg may return text or bytes; prefer text
    let lineText = data?.lines?.text ?? "";
    if (lineText.endsWith("\n")) lineText = lineText.slice(0, -1);
    if (lineText.endsWith("\r")) lineText = lineText.slice(0, -1);
    let entry = perFile.get(absPath);
    if (!entry) {
      entry = { filePath: absPath, matches: [] };
      perFile.set(absPath, entry);
    }
    entry.matches.push({ line: lineNumber, text: lineText });
  }

  // Read full file lines for each matched file (needed for snippets later)
  const results = [];
  for (const [absPath, entry] of perFile) {
    let lines = [];
    try {
      const text = await fs.readFile(absPath, "utf8");
      lines = text.split(/\r?\n/);
    } catch {
      continue;
    }
    results.push({
      filePath: absPath,
      relativeFile: path.relative(workspaceRoot, absPath).split(path.sep).join("/"),
      lines,
      matches: entry.matches
    });
  }
  return results;
}

export async function scanFiles(workspaceRoot, files, keywords) {
  if (isRipgrepAvailable()) {
    try {
      return await scanFilesWithRipgrep(workspaceRoot, files, keywords);
    } catch {
      // fall through to Node fallback on any rg failure
    }
  }
  return scanFilesNode(workspaceRoot, files, keywords);
}
