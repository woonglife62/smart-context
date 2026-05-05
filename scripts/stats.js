import fs from "node:fs/promises";
import path from "node:path";

const asJson = process.argv.includes("--json");
const cwd = process.cwd();
const logDir = path.join(cwd, ".smart-context", "logs");

let files;
try {
  files = await fs.readdir(logDir);
} catch {
  console.log("no usage logs yet");
  process.exit(0);
}

const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort();
if (jsonlFiles.length === 0) {
  console.log("no usage logs yet");
  process.exit(0);
}

let totalCalls = 0;
let totalTokensReturned = 0;
let totalTokensSaved = 0;
let errorCount = 0;
let oldest = null;
let newest = null;
const modeCounts = {};

for (const file of jsonlFiles) {
  const content = await fs.readFile(path.join(logDir, file), "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    totalCalls++;
    totalTokensReturned += evt.estimated_tokens_returned ?? 0;
    totalTokensSaved += evt.estimated_tokens_saved ?? 0;
    if (evt.error_code) errorCount++;
    const mode = evt.mode || "unknown";
    modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
    const ts = evt.timestamp;
    if (ts) {
      if (!oldest || ts < oldest) oldest = ts;
      if (!newest || ts > newest) newest = ts;
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ totalCalls, totalTokensReturned, totalTokensSaved, errorCount, modeCounts, oldest, newest }, null, 2));
} else {
  console.log(`total calls        : ${totalCalls}`);
  console.log(`tokens returned    : ${totalTokensReturned}`);
  console.log(`tokens saved       : ${totalTokensSaved}`);
  console.log(`errors             : ${errorCount}`);
  console.log(`oldest log         : ${oldest ?? "n/a"}`);
  console.log(`newest log         : ${newest ?? "n/a"}`);
  console.log("--- per mode ---");
  for (const [mode, count] of Object.entries(modeCounts).sort()) {
    console.log(`  ${mode}             : ${count}`);
  }
}
