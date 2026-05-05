# Smart Context — Evaluation & WOZ Removal Design

**Date:** 2026-05-05
**Status:** Approved (brainstorm complete, awaiting plan)
**Repo:** smart-context plugin (this working directory)

## 1. Goal

Two coupled deliverables in one cycle:

1. **Evaluate** the smart-context plugin across ranking quality, token-savings calibration, and result consistency, with secondary spot-checks on speed and robustness. Produce a reproducible benchmark harness and a baseline report so future regressions are detectable.
2. **Completely remove** the wozcode plugin and its attribution from this working environment.

The user explicitly chose, during brainstorming:

- Eval dimensions: **ranking quality (A)**, **token efficiency (B)**, **consistency (E)**.
- WOZ removal scope: **full** — this repo's permissions, global commit/PR attribution, plugin uninstall, cache cleanup.
- Output mode: **report + apply small fixes immediately**, but keep large changes report-only and defer to a future cycle.

## 2. Non-Goals

- External-corpus evaluation (multiple repos cloned for benchmarking). Deferred until self-eval demonstrates issues that warrant the cost.
- Memory profiling, dependency security audit, full PII review of logs. Deferred.
- Algorithmic redesign of the ranker, scanner, or scoring formula. Out of scope; report-only.
- Adding new MCP tools, modes, or features. Out of scope.
- Modifying any other globally-installed Claude Code plugin besides woz.

## 3. Architecture (Eval Harness)

```
test/fixtures/golden-queries.json   ─┐
                                     ├─→  scripts/eval.js  ─→  docs/eval/2026-05-05-results.json
src/searchEngine.js  (in-process)   ─┘                     ─→  docs/eval/2026-05-05-results.md
                                                           ─→  console summary
```

**Files introduced:**

- `scripts/eval.js` — runner. Reads queries, drives `smartContext()` in-process, computes metrics, writes JSON + Markdown.
- `test/fixtures/golden-queries.json` — golden query data. New file, ~18 entries (see §4).
- `docs/eval/2026-05-05-results.md` — human-readable report.
- `docs/eval/2026-05-05-results.json` — machine-readable raw results.

**Why in-process:** MCP stdio round-trip adds ~50–200 ms of noise that masks ranker/scanner latency. The harness therefore calls `smartContext()` directly. MCP overhead is captured separately in a single-query microbench so the report can state "MCP overhead = X ms".

**Determinism controls:** Each query runs **3 times** to measure consistency. Cold vs. warm is distinguished (first run = cold). Ripgrep on/off is exercised by toggling whatever scanner-fallback flag exists or by unsetting `PATH`-resolved `rg` before the run.

**`--baseline=<path>` flag:** Optional CLI flag that, when set, loads a prior `results.json` and emits a delta table (per-metric before/after) in the console summary and Markdown report. Used in §7.4 post-fix re-runs and for any future regression check.

## 4. Golden Query Set

**18 queries total: 6 categories, 3 queries each.** Each entry has: `id`, `query`, `mode`, `paths` (optional), `expected.top1` (file path), `expected.top3` (set of file paths), `intent_tag`.

| Category | Intent | Example queries | Expected top-1 |
|---|---|---|---|
| **exact_identifier** | Function/variable name lookup | `smartContext function definition` | `src/searchEngine.js` |
| | | `tokenBudget trim` | `src/tokenBudget.js` |
| | | `pathSafety validation` | `src/pathSafety.js` |
| **conceptual** | Noun-phrase about behavior | `how queries are tokenized` | `src/query.js` |
| | | `where ranking score is computed` | `src/ranker.js` |
| | | `usage logging and stats` | `src/logger.js` |
| **camelcase_split** | Single token; success requires splitter | `tokenBudgetTrim` | `src/tokenBudget.js` |
| | | `pathSafetyValidation` | `src/pathSafety.js` |
| | | `searchEngineCompose` | `src/searchEngine.js` |
| **prose_only** | Markdown is the right answer | `install instructions` | `README.md` |
| | | `privacy guarantees` | `README.md` |
| | | `design rationale for modes` | `docs/superpowers/specs/2026-05-05-smart-context-design.md` |
| **distractor** | Common terms that exist in many files; tests prose-vs-code discrimination | `error handling` | `src/errors.js` (not README) |
| | | `test fixtures` | `test/fixtures/...` (not bench.js) |
| | | `mcp server start` | `mcp/smart-context-server.js` |
| **edge** | Robustness — must not throw | `""` (empty) | error or empty result, no throw |
| | | `aaaaa` (no match) | empty result, no throw |
| | | `인증 미들웨어` (Korean) | empty/best-effort, no throw |

**Reference targets (advisory thresholds, not hard gates):** exact_identifier ≥ 0.9, conceptual ≥ 0.6, distractor ≥ 0.7, prose_only ≥ 0.6 on top-1. Violations register as P1 issues.

**Rationale for category mix:**

- Two recent commits are explicitly under suspicion: `a4d2772` (deprioritize markdown) and `36a06f4` (prose multiplier 0.2x) — `prose_only` and `distractor` categories test these.
- One recent commit is explicitly under verification: `8580ec1` (camelCase/snake_case/kebab-case split) — `camelcase_split` category tests this.
- 6×3 is the smallest sample that still gives per-category signal (3 datapoints lets one outlier not dominate).

## 5. Metrics

### 5.1 Ranking quality

- **top-1 hit rate** — `expected.top1 === actual.top1` rate
- **top-3 hit rate** — `expected.top1 ∈ actual.top3` rate
- **MRR** — `mean(1/rank(expected.top1))`; 0 if not in results
- All four scores reported per category in addition to overall

### 5.2 Token-savings calibration

The current code computes `estimated_tokens_saved = baseline − returned`. The baseline encoded in the source is taken at face value (B1) and compared against two simulated baselines:

- **B1** — value the current code reports
- **B2 (conservative)** — `tokens(Glob 1×) + tokens(Grep 1×) + tokens(Read top-3 matched files)`. Mirrors what an experienced operator typically does.
- **B3 (optimistic)** — `tokens(Glob 1×) + tokens(Grep 1×) + tokens(Read all matched files)`. Mirrors what a novice operator does.

Token estimation re-uses whatever estimator `src/tokenBudget.js` already exposes; if none is exported, the harness uses `Math.ceil(byteCount / 4)` as a transparent placeholder and notes the choice in the report.

**Verdicts:**

- B1 / B2 ≥ 1.3 → **overstated savings** → P1
- B1 / B2 ≤ 0.7 → **understated savings** → P2
- 0.7 < B1 / B2 < 1.3 → OK

### 5.3 Consistency

Already-observed signal: `query_hash=b2ba8487d678` returns `tokens_returned` ∈ {918, 1065, 1069} across runs in the existing `.smart-context/logs/2026-05-05.jsonl`.

- Each query run **3 times back-to-back** with no tree mutations between runs
- **set-equality** — top-10 file set identical across runs
- **order-equality** — top-10 array identical across runs
- **tokens_returned variance** — sample std dev across the 3 runs

Anything less than 100% set-equality is a **P1 issue**. The report localizes the divergence to scanner / ranker / snippets where possible by re-running with a stable scan order forced.

### 5.4 Latency

- `process.hrtime.bigint()` wall-clock around `smartContext()`
- Each query under 4 conditions: (cold|warm) × (rg|node-fallback)
- Reported: per-query ms, 18-query p50/p95
- **MCP round-trip microbench** — single representative query through the actual MCP server; reported as a one-liner ("MCP overhead = X ms")
- **Reference threshold:** warm p50 ≤ 100 ms on this repo. Higher → P2.

## 6. WOZ Removal Procedure

Sequence is load-bearing — caches deleted before uninstall would break the uninstall flow.

### 6.1 Pre-flight grep

```
grep -ri "woz\|wozcode\|WOZCODE" \
  --include="*.json" --include="*.md" --include="*.mjs" --include="*.js" \
  ~/.claude  "<repo root>"
```

Captured into the report as the "before" snapshot. Used to scope §6.7.

### 6.2 Global attribution removal (`~/.claude/settings.json`)

- Backup file to `settings.json.bak.20260505` first
- Delete `attribution.commit` key (not blank — remove)
- Delete `attribution.pr` key
- Verify with an empty test commit on a throwaway branch: `Co-Authored-By: WOZCODE` line must be absent. Soft-reset the test commit afterward.

### 6.3 Repo permissions (`.claude/settings.local.json`)

- Remove `mcp__plugin_woz_code__Search`
- Remove `mcp__plugin_woz_code__Edit`
- Keep `mcp__plugin_smart-context_smart-context-local__smart_context`

### 6.4 Plugin uninstall

- `/plugin uninstall woz@wozcode-marketplace`
- Optional: `/plugin marketplace remove wozcode-marketplace` if no other plugins draw from it
- Verify: `/plugin list` shows no woz; `~/.claude/settings.json#enabledPlugins` no longer lists woz

### 6.5 Cache cleanup

- Delete `~/.claude/plugins/cache/wozcode-marketplace/`
- Only after §6.4 succeeds

### 6.6 Post-flight grep

Re-run §6.1 grep. Hits remaining must be 0; any remaining are listed in the report individually.

### 6.7 Global hooks/agents check

- grep `~/.claude/hooks/*.mjs` for `woz`
- grep `~/.claude/agents/*.md` for `woz`
- Any matches are **reported only**, not auto-edited — they may be intentional user code.

## 7. Fix Triage Rules

### 7.1 Apply immediately (each as its own commit)

- WOZ removal steps that are file edits (§6.2 attribution, §6.3 permissions). §6.4 plugin uninstall and §6.5 cache delete are interactive shell/CC operations the user is asked to run; §6.1/§6.6/§6.7 are read-only greps that produce report content, not commits.
- Single-line ranker tuning if measurement directly indicates regression (e.g., bumping the prose multiplier from 0.2 to a measured-better value)
- Adding stable tie-break to ranker if non-determinism is localized there (one line)
- Obvious crash-class bug (uncaught throw on edge query, NaN in tokens)
- Documentation accuracy fixes (README out of sync with shipped behavior)
- The eval harness itself (new file, no regression risk)

**Hard rule:** ≤ 5 changed lines, ≤ 1 file touched, all 21 existing tests still pass. If any of those three is violated, the fix becomes report-only.

### 7.2 Report-only (recommendations, no code change this cycle)

- Algorithmic score-formula redesign
- New features (embedding cache, new modes, new metrics)
- Refactors > 5 lines
- Dependency additions
- Semantic mode-meaning changes
- Tool schema / API surface changes

### 7.3 Gray zone

A fix that is > 5 lines but is fixing an unambiguous crash-class bug is permitted, with two extra constraints: each fix lives in its own commit, and `npm test` is re-run between commits.

### 7.4 Post-fix re-baseline

If any §7.1 fix is applied, the eval harness is re-run and the report includes a "before / after" table for each affected metric.

## 8. Output Format

### 8.1 `docs/eval/2026-05-05-results.md`

Sections in order:

1. **TL;DR** — top-1 rate, B1/B2 ratio, consistency count, warm p50, woz status — 5 lines max
2. **Environment** — Node version, OS, ripgrep version, repo HEAD SHA
3. **Metric tables** — ranking by category; tokens B1/B2/B3; consistency; latency; MCP overhead one-liner
4. **Issues** — sorted by severity. Each entry: title, evidence (query IDs and measurements), hypothesis, recommended fix, classification (§7.1 or §7.2)
5. **Applied fixes** — commit SHA + one-line description + before/after metric for each
6. **Recommendations** — §7.2 items deferred to next cycle
7. **WOZ removal results** — §6.1 vs §6.6 grep diff, per-step outcomes
8. **Reproduction** — single command to regenerate results

### 8.2 `docs/eval/2026-05-05-results.json`

```json
{
  "timestamp": "...",
  "env": { "node": "...", "os": "...", "rg": "...", "head_sha": "..." },
  "metrics": {
    "ranking": { "overall": {...}, "by_category": {...} },
    "tokens": { "b1_over_b2": 1.42, "per_query": [...] },
    "consistency": { "set_equal_count": 14, "order_equal_count": 12, "per_query_variance": [...] },
    "latency": { "warm_p50_rg": 67, "warm_p50_node": 142, ... }
  },
  "queries": [ { "id": "...", "runs": [...], "expected": {...}, "scored": {...} } ],
  "issues": [ { "severity": "P1", "title": "...", "evidence": [...], "fix_proposal": "..." } ]
}
```

### 8.3 Console summary (printed by `eval.js` on exit)

```
SMART CONTEXT EVAL — 2026-05-05
top-1: 14/18 (78%)   top-3: 17/18 (94%)   MRR: 0.83
tokens B1/B2 ratio: 1.42  (overstated)
consistency: 14/18 identical  (4 with variance)
warm p50: 67 ms (rg) / 142 ms (node)
issues: P0=0  P1=3  P2=2
report: docs/eval/2026-05-05-results.md
```

### 8.4 Commit strategy

Each is a separate commit, in order:

1. `feat(eval): add golden-query harness` — `scripts/eval.js`, `test/fixtures/golden-queries.json`
2. `chore(eval): record 2026-05-05 baseline` — `docs/eval/2026-05-05-results.{md,json}`
3. `chore: remove woz attribution and permissions` — settings changes from §6.2, §6.3
4. (zero or more) `fix(<area>): <one-line>` — each §7.1 fix
5. (only if any §7.4 happened) `chore(eval): record post-fix metrics` — updated results

## 9. Risks

- §6.2 changes the global `~/.claude/settings.json`, which affects every project's future commits/PRs — not just this repo. The user confirmed this scope explicitly, but the backup `settings.json.bak.20260505` is the rollback path.
- The token-baseline simulator (§5.2 B2/B3) requires a token estimator. If `src/tokenBudget.js` exposes one, harness uses it; if not, harness uses `bytes/4` and labels the choice. This is a known approximation, not a defect.
- Self-eval on this repo only. Findings may not generalize to larger repos. Acknowledged in §2 (Non-Goals).
- `/plugin uninstall` and `/plugin marketplace remove` are interactive operations the user must run inside Claude Code; the spec describes them but the implementation step that touches them is the user's action, not a script.

## 10. Reproduction

```bash
# 1. Run eval (writes results.{md,json}, prints console summary)
node scripts/eval.js

# 2. Re-run after any code change to compare against baseline
node scripts/eval.js --baseline=docs/eval/2026-05-05-results.json
```

`--baseline` flag is part of the harness scope; produces a delta table.

## 11. Approval

Brainstorm sections 1–6 approved verbally during the design conversation on 2026-05-05. Spec written, awaiting user review.
