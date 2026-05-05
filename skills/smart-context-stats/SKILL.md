---
name: smart-context-stats
description: Aggregate .smart-context/logs/*.jsonl and report total tokens saved, calls, and per-mode breakdowns.
allowed-tools: Bash(node *)
---

Run the stats aggregator and relay its output:

```bash
node <PLUGIN_ROOT>/scripts/stats.js
```

Replace `<PLUGIN_ROOT>` with the absolute path to the smart-context plugin directory.

Report the output verbatim to the user. If the script prints "no usage logs yet", tell the user that no smart_context calls have been logged yet and suggest they run a query first.
