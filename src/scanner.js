import fs from "node:fs/promises";
import path from "node:path";
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

export async function scanFiles(workspaceRoot, files, keywords) {
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
