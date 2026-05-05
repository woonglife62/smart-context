# Smart Context — Workflow Token-Cost Evaluation Design

**Date:** 2026-05-05
**Status:** Approved (brainstorm complete, awaiting plan)
**Repo:** smart-context plugin

## 1. Goal

Measure whether having the `smart_context` MCP tool available materially reduces the number of tokens Claude consumes while completing realistic coding tasks in this repo. The previous eval (`2026-05-05-smart-context-eval-and-woz-removal-design.md`) measured the *tool itself* on synthetic queries: ranking quality, baseline-token simulation, consistency, latency. This eval measures the *workflow*: cumulative input + output tokens an end-to-end Claude session uses to finish a task, with vs. without the tool.

User chose during brainstorming:
- Runtime: **Claude Code sessions** (not API SDK), because no API integration is in place.
- Task suite size: **5 tasks**, pre-curated for category diversity.
- Token capture: **transcript-file parsing** of `~/.claude/projects/.../<sessionId>.jsonl`.
- Output mode: **report-only**; the eval produces evidence, not code changes.

## 2. Non-Goals

- Statistical significance. With 5 tasks × 1 trial per condition, results are trends, not proofs. Documented as a caveat.
- API-SDK based ablation. Out of scope until API integration exists.
- Hook-based automatic capture (Stop hook). Over-engineered for a one-shot measurement.
- Modifying smart-context source as part of this eval. Findings flow into the next brainstorm cycle.
- Cross-repo measurement. Single-repo only (this repo).
- Multi-evaluator agreement on quality. Single evaluator (the user) judges quality.

## 3. Architecture

```
docs/eval/workflow/2026-05-05-tasks.md         (playbook + result template)
docs/eval/workflow/runs.csv                    (user appends one row per task pair)
                                                ↓
scripts/workflow-eval-aggregate.js  ──reads──→ ~/.claude/projects/<encoded>/<sessionId>.jsonl
                                                ↓
docs/eval/workflow/2026-05-05-results.json     (raw)
docs/eval/workflow/2026-05-05-results.md       (human report)
console summary
```

**Components:**

- **`docs/eval/workflow/2026-05-05-tasks.md`** — the user-facing playbook. Contains the 5 tasks (questions + success criteria) and the run-protocol checklist. Committed once.
- **`docs/eval/workflow/runs.csv`** — append-only record. Columns: `task_id, with_session_id, without_session_id, quality_with, quality_without, notes`. The user adds one row per completed pair. Committed at the end of measurement.
- **`scripts/workflow-eval-aggregate.js`** — reads `runs.csv`, locates each `sessionId.jsonl` under `~/.claude/projects/<encoded-repo-path>/`, parses the transcript, computes per-task and aggregate metrics, writes results.{md,json}, prints console summary.
- **`scripts/workflow-eval-aggregate.test.js`** — unit tests with small synthetic transcript fixtures: empty session, one assistant turn, multiple turns with mixed cache/non-cache usage. No real API calls.

**Transcript file lookup:**
The aggregator derives the encoded project path from `process.cwd()` at runtime (replacing path separators and special characters with the same encoding Claude Code uses), then probes `~/.claude/projects/<encoded>/<sessionId>.jsonl`. For this repo, the encoding produces `C--Users-woongchan-OneDrive----New-project-2`. If a sessionId cannot be located, the aggregator reports a clear error rather than silently producing wrong numbers.

**Why no subprocess for parsing:** transcript files are jsonl. `fs.readFile` + `String.prototype.split('\n').map(JSON.parse)` is sufficient.

## 4. Task Suite

Five tasks, each with a fixed prompt the user pastes into a fresh Claude Code session, plus a clear success criterion. The diversity covers the most common workflow shapes.

| ID | Intent | Task (paste verbatim) | Success criterion |
|---|---|---|---|
| **wf-1** | lookup | "Where is `smartContext` defined and what does its `baseline` calculation use? Show the relevant lines." | Answer cites `src/searchEngine.js:50-65` and reproduces the baseline formula `Math.max(estimatedReturned, Math.min(files.length, 8) * 900)` |
| **wf-2** | trace | "Trace what happens when `smart_context` receives `{ query: '' }`. Walk through the call path until an error is returned." | Answer covers `validateInput` throwing `invalid_query`, the catch block in `smartContext`, and `structuredError` returning the response |
| **wf-3** | code-gen | "Add one new unit test in `test/tokenBudget.test.js` for `trimToBudget`: case where all results already fit under maxTokens. The test should pass." | A new test is appended; `npm test` passes; the test exercises the all-fit branch (no trimming) |
| **wf-4** | list | "List every file that reads from or writes to `.smart-context/logs/`. Brief one-line description per file." | Answer mentions both `src/logger.js` (writes) and `scripts/stats.js` (reads). README mention is acceptable but not required. No fabricated files. |
| **wf-5** | conceptual | "Explain the difference between modes `brief`, `explain`, and `pack` in this plugin. Where in the code do these differences manifest?" | Answer cites `src/config.js` (MODES, DEFAULT_BUDGETS), `src/searchEngine.js:33-42` (radius/limit per mode), and `src/searchEngine.js:78` (summary toggle for non-brief modes) |

**Why this mix:**
- All five tasks are answerable from this repo without reading more than ~3 source files.
- Each can plausibly benefit from `smart_context` (it would surface the right files in one tool call instead of many Glob+Grep+Read).
- All have unambiguous success criteria so quality regression is detectable.
- wf-3 is a code-gen check; the others are read-only.

**wf-3 cleanup:** after both sessions complete, `git checkout -- test/tokenBudget.test.js` reverts the change so subsequent tasks (and the repo state) are unaffected.

## 5. Run Protocol

Two sessions per task: one with the smart-context plugin enabled, one with it disabled. Each session is a fresh Claude Code session.

### 5.1 Per-task steps

1. **Confirm config**: run `/plugin list` and verify the smart-context plugin is in the desired state for this run (enabled for "with" runs, disabled for "without"). Toggle with `/plugin enable smart-context@smart-context-local` or `/plugin disable smart-context@smart-context-local`, then `/reload-plugins`.
2. **Start a fresh session**. Either kill and restart Claude Code, or use a new terminal — `/clear` is not enough because prompt cache may persist.
3. **Paste the task prompt verbatim** from §4.
4. **Let Claude finish without follow-ups.** No clarifying questions, no nudges. The two conditions must receive identical input.
5. **Note the answer quality** in one of: `정답`, `부분정답`, `틀림`, `거부됨`.
6. **End the session.** Capture the sessionId of the latest jsonl file:
   ```bash
   ls -t ~/.claude/projects/C--Users-woongchan-OneDrive----New-project-2/ | head -1
   ```
   The first line (without the `.jsonl` extension) is the sessionId.
7. **Toggle plugin state** for the second run. Repeat steps 2–6.
8. **For wf-3 only:** `git checkout -- test/tokenBudget.test.js` to revert the code change.
9. **Append to `runs.csv`:** `wf-1,<with_sid>,<without_sid>,정답,정답,(optional notes)`.

### 5.2 Order

To minimize order effects (the second run can benefit from learning during the first), tasks alternate which condition runs first:

| Task | First | Second |
|---|---|---|
| wf-1 | with | without |
| wf-2 | without | with |
| wf-3 | with | without |
| wf-4 | without | with |
| wf-5 | with | without |

This counterbalances the order across the five tasks.

### 5.3 Cache hygiene

Claude Code caches prompts within a session. A truly fresh session shows `cache_read_input_tokens === 0` on its very first assistant turn. The aggregator validates this; pairs that fail this check are flagged `valid=false` and the user re-runs them.

### 5.4 Time budget

Per task: 5–12 minutes (paste → Claude answers → capture sessionId). Five tasks × two sessions = ten sessions = 50–120 minutes total.

## 6. Metrics

### 6.1 Token totals

Every assistant message in the transcript carries a `usage` object. The aggregator sums across all assistant messages in the session:

- **Total tokens** (intuitive comparison): `input + output + cache_creation + cache_read`
- **Billable tokens** (cost comparison): `input + output + 1.25 * cache_creation + 0.1 * cache_read`

The 1.25× and 0.1× multipliers reflect approximate Anthropic price ratios for cache writes (more expensive than fresh input) and cache reads (much cheaper). Both numbers are reported; **savings comparisons are computed on `billable`**.

### 6.2 Per-task fields

| Column | Meaning |
|---|---|
| `task_id` | wf-1 … wf-5 |
| `with_billable`, `without_billable` | billable totals |
| `savings` | `(without_billable − with_billable) / without_billable` (positive = with-condition is cheaper) |
| `with_tool_calls.smart_context` | count of smart_context tool uses in the with-session |
| `with_tool_calls.other` | count of Glob + Grep + Read tool uses |
| `without_tool_calls` | count of Glob + Grep + Read tool uses (smart_context not available) |
| `with_turns`, `without_turns` | assistant message counts |
| `quality_with`, `quality_without` | one of {정답, 부분정답, 틀림, 거부됨} |
| `valid` | `true` iff cache hygiene OK and no quality regression (see §6.4) |

### 6.3 Aggregate fields

- **`median_savings`** — median of `savings` across the 5 tasks. Used as the headline number; less sensitive to outliers than mean.
- **`win_count`** — number of tasks with `savings > 0`.
- **`quality_regression_count`** — number of tasks where `quality_with` is strictly worse than `quality_without`. If non-zero, the savings number must be interpreted with care.
- **`token_breakdown`** — input / output / cache_creation / cache_read averages for each condition. Useful when the "where did the difference come from" question matters.

### 6.4 Validity rules

A pair is `valid=false` if any of:

1. **Cache contamination (protocol violation):** total `cache_read_input_tokens` across the session exceeds total `output_tokens`. Some `cache_read` is normal (system-prompt caching is shared across fresh sessions), so the threshold compares to output volume — a session that re-used a prior task's full context would have anomalously high `cache_read`. If both sessions in the pair sit far below this threshold, both are fresh.
2. **Quality regression:** `quality_with` ranks below `quality_without` on the ordering `정답 > 부분정답 > 거부됨 > 틀림`. Saving tokens at the cost of correctness is not a win.

A `valid=false` pair is excluded from `median_savings` and `win_count`, but recorded in the report.

### 6.5 Soft-noted but valid

- **No smart_context use:** if `with_tool_calls.smart_context === 0`, the with-session did not actually exercise the tool. The pair is still valid (the comparison answers "does *having* the tool change behavior?"), but the report calls it out.

## 7. Output Format

### 7.1 `docs/eval/workflow/2026-05-05-results.md`

Sections in order:

1. **TL;DR** (≤ 5 lines) — median savings, win count, quality regressions, model used, date.
2. **Per-task table** — one row per task: id, intent, with billable, without billable, savings %, with-tool-call breakdown, without-tool-call breakdown, quality, validity.
3. **Token breakdown** — averages per condition for input/output/cache_creation/cache_read.
4. **Notes & caveats** — auto-generated for any `valid=false` pair, any task where smart_context was not invoked, any cache hygiene issue.
5. **Caveats (boilerplate)** — sample size, single evaluator, single repo, model/version dependence (per §8).
6. **Reproduction** — commands to re-run aggregation against an updated `runs.csv`.

### 7.2 `docs/eval/workflow/2026-05-05-results.json`

Machine-readable. Includes:

```json
{
  "timestamp": "...",
  "model_id": "...",
  "metrics": {
    "median_savings": 0.22,
    "win_count": 4,
    "quality_regression_count": 0,
    "token_breakdown": { "with": {...}, "without": {...} }
  },
  "tasks": [ { "task_id": "wf-1", "with_billable": 8214, ... } ],
  "caveats": [ "..." ]
}
```

### 7.3 Console summary

```
WORKFLOW EVAL — 2026-05-05
median savings: 22%   win: 4/5   quality regressions: 0
billable avg: with 9.1k / without 13.4k
report: docs/eval/workflow/2026-05-05-results.md
```

### 7.4 Commits

- `feat(eval): add workflow token-cost aggregator and tasks playbook` — script + tests + tasks.md + empty runs.csv with header.
- (after the user finishes the runs) `chore(eval): record 2026-05-05 workflow runs.csv`.
- `chore(eval): record 2026-05-05 workflow results` — generated md + json.

## 8. Interpretation Guide

The aggregator does not auto-decide the verdict. It produces evidence; the user reads §8 to interpret.

| median savings | win count | reading |
|---|---|---|
| ≥ 30% | ≥ 4/5 | clear effect — recommend smart_context |
| 10–30% | 3–4/5 | weak effect — beneficial in some task shapes |
| −10–10% | 2–3/5 | inconclusive — within noise; consider re-measuring |
| < −10% | ≤ 2/5 | adverse — tool availability is making things worse; investigate |

These are guidelines, not gates. The user weighs the table against the caveats.

### 8.1 When to re-run

- Two or more pairs are `valid=false` → measurement quality is too low.
- Variance is dominated by one outlier (e.g., a +60% on one task and ±10% on the other four) → re-measure that task at a different time or refine its prompt.
- `with_tool_calls.smart_context === 0` for ≥ 40% of pairs → the tool isn't being invoked, so the comparison is testing something else.

### 8.2 Pattern decoding

- **Consistent moderate savings on every task** — tool is steadily helpful.
- **Big savings on some, none on others** — the tool helps a specific intent (the table tells you which).
- **with-session uses *more* tokens** — smart_context responses themselves are bloated; consider tuning `max_tokens` per call site or shifting to `brief` mode by default.
- **High win count but quality regressions** — the tool's ranking weakness from the prior eval is leaking into real workflows. Bigger problem than savings.

## 9. Caveats Recorded in Every Report

- Sample size: 5 task × 1 trial. Trends, not proofs.
- Task dependence: results apply to this category mix; multi-file refactors or long code generation may differ.
- Single evaluator: quality judgment depends on one person.
- Single repo: small repo (≈ 30 source files). Larger repos may amplify or attenuate the effect.
- Model / version dependence: rerun on Claude version changes. The model id used appears in the report.

## 10. Reproduction

```bash
# After completing the runs and filling runs.csv:
node scripts/workflow-eval-aggregate.js
# Re-run after editing runs.csv:
node scripts/workflow-eval-aggregate.js --output-date=2026-05-05
```

The aggregator is deterministic given the inputs. It does not call any API.

## 11. Approval

Brainstorm sections 1–5 approved verbally on 2026-05-05. Spec written, awaiting user review.
