# Smart Context Claude Code Plugin Design

## Purpose

Build a Claude Code plugin that reduces code exploration cost by replacing repeated `Glob`, `Grep`, and `Read` loops with one efficient local context tool.

The MVP focuses only on high-efficiency file discovery and snippet retrieval. It should feel active inside Claude Code after plugin installation and restart, similar to a plugin agent/tool that Claude can use during normal coding sessions.

## Goals

- Provide a Claude Code plugin that exposes a local `smart_context` tool.
- Help Claude find relevant files, symbols, and code snippets with fewer tool calls and fewer returned tokens.
- Support multiple output depths so simple searches stay cheap and harder tasks can request more context.
- Log local, privacy-preserving usage statistics for savings analysis.
- Keep the core search engine reusable so Codex or other clients can be added in future versions without changing the search engine API.

## Non-Goals

- Do not implement OpenAI, Anthropic, or multi-provider model routing in the MVP.
- Do not implement automatic code edits or batch editing.
- Do not build a cloud dashboard, account system, billing, or telemetry service.
- Do not add a `/stats` slash command in the MVP.
- Do not build an embedding or vector index in the MVP.

## User Experience

After installation and Claude Code restart, the plugin provides an always-available smart context capability. Claude can invoke it when it needs to explore a codebase before answering, planning, or editing.

The intended behavior is:

1. User asks Claude Code a coding question or implementation request.
2. Claude decides it needs project context.
3. Claude calls `smart_context` instead of doing several separate search and read calls.
4. The tool returns ranked files, snippets, short reasons, and savings statistics.
5. Claude uses that compact context to continue the task.

The user does not need to call a wrapper CLI for normal use.

## Architecture

```text
Claude Code Plugin
  .claude-plugin/plugin.json
  agents/smart-context-agent.md
  mcp/smart-context-server.js
  package.json
  README.md

Local MCP Server
  tool: smart_context
  tool: smart_context_explain
  log writer

Search Engine
  ripgrep/glob scanner
  candidate ranker
  snippet extractor
  token budget limiter
  mode selector
```

The Claude Code plugin package is the user-facing integration. The MCP server is the local execution boundary. The search engine is ordinary Node.js code exposed through a stable internal API so other adapters can reuse it in future versions.

## Plugin Components

### Plugin Metadata

The plugin metadata declares the plugin name, version, description, and local MCP server command. It should be minimal and avoid permissions that are not needed for local search.

### Agent Instructions

The plugin includes an agent instruction file that tells Claude when to prefer `smart_context`.

Claude should use `smart_context` for:

- Locating relevant implementation files.
- Finding where a feature, route, model, service, middleware, or config is defined.
- Gathering context before editing multiple files.
- Answering questions that require cross-file code discovery.

Claude should still use normal reads when it already knows the exact file and needs full-file context.

### MCP Server

The MCP server exposes local tools and runs in the user's workspace context. It performs no network calls.

MVP tools:

- `smart_context`: main search and snippet tool.
- `smart_context_explain`: optional helper that explains tool modes and expected inputs.

## `smart_context` Input

```json
{
  "query": "where is auth middleware applied?",
  "mode": "brief",
  "paths": ["src", "app"],
  "exclude": ["node_modules", ".git", "dist"],
  "max_tokens": 4000
}
```

Required fields:

- `query`: natural-language or keyword search request.

Optional fields:

- `mode`: one of `brief`, `explain`, or `pack`. Defaults to `brief`.
- `paths`: workspace-relative directories or files to search. Defaults to the workspace root.
- `exclude`: glob-like exclusions. Defaults include `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, and common lock/cache directories.
- `max_tokens`: approximate output token budget. Defaults to a conservative budget for `brief`.

The tool rejects absolute paths and any path that resolves outside the workspace root.

## Output Modes

### `brief`

Default mode. Returns ranked file hits, short reasons, and compact snippets. This mode optimizes for minimal token use.

### `explain`

Returns the same ranked snippets as `brief`, plus a short summary explaining why the selected files look relevant.

### `pack`

Returns a wider context pack for tasks that are likely to require planning or edits. This can include more snippets per file and more surrounding lines, but still respects `max_tokens`.

## `smart_context` Output

```json
{
  "summary": "Auth middleware is registered in src/server.ts and implemented in src/auth/middleware.ts.",
  "results": [
    {
      "file": "src/server.ts",
      "score": 0.92,
      "reason": "Registers auth middleware before routes",
      "snippets": [
        {
          "start": 24,
          "end": 38,
          "code": "..."
        }
      ]
    }
  ],
  "stats": {
    "files_scanned": 184,
    "matches_considered": 43,
    "snippets_returned": 6,
    "estimated_tokens_returned": 2200,
    "estimated_tokens_saved": 4800
  }
}
```

`summary` is required for `explain` and `pack`, and optional for `brief`.

`results` are sorted by descending score. Each result includes a workspace-relative file path, score, reason, and one or more snippets with line numbers.

`stats` are returned for every successful call.

## Search And Ranking

The MVP does not use embeddings. It uses deterministic local search:

- Extract keywords from `query`.
- Search with `ripgrep` when available.
- Fall back to a pure Node.js scanner if `ripgrep` is unavailable.
- Score path, filename, and extension matches.
- Score match density in file contents.
- Prefer implementation files over test files by default.
- Increase test file priority when the query mentions tests, specs, failures, mocks, or fixtures.
- Add weight for snippets near imports, exports, functions, classes, routes, schemas, and configuration keys.
- Deduplicate overlapping snippets.
- Trim lower-ranked snippets until the output fits the approximate token budget.

This approach is intentionally simple, inspectable, and cheap.

## Savings Estimate

Savings are estimates, not billing-grade accounting.

The tool compares:

- A baseline estimate for typical separate discovery calls, such as globbing, grepping, and reading several candidate files.
- The approximate tokens actually returned by `smart_context`.

The result is reported as `estimated_tokens_saved`.

The estimate should be clearly labeled as approximate in README and tool descriptions.

## Logging

The tool writes JSONL logs under:

```text
.smart-context/logs/YYYY-MM-DD.jsonl
```

Each line records:

- timestamp
- mode
- searched path count
- files scanned
- matches considered
- snippets returned
- estimated tokens returned
- estimated tokens saved
- error code, if any

Logs must not store:

- full user prompts
- full query text
- code snippets
- model responses
- secrets or environment variables

The query is represented only by a short hash for deduplication.

## Privacy And Security

- All MVP work runs locally.
- No code, prompt, snippet, model response, or API key is sent to an external service.
- The tool does not require OpenAI, Anthropic, or other provider credentials.
- The tool refuses to read outside the workspace root.
- Default excludes prevent scanning dependencies, build artifacts, git internals, and common generated output.
- Errors should mention the failed operation and safe remediation, without dumping sensitive content.

## Error Handling

The tool returns structured errors for:

- missing or empty `query`
- invalid `mode`
- invalid `max_tokens`
- path outside workspace
- no readable search paths
- scanner failure
- output budget too small to return useful context

When no matches are found, the tool returns an empty `results` array plus stats and a short suggestion to broaden the query or paths.

## Testing

### Unit Tests

Cover:

- query keyword extraction
- candidate ranking
- snippet extraction
- snippet deduplication
- token budget trimming
- path validation
- default excludes

### MCP Integration Tests

Cover:

- input schema validation
- successful `brief`, `explain`, and `pack` calls
- structured error responses
- logging without prompt or snippet content

### Fixture Repository Tests

Use a small fixture project with routes, middleware, services, tests, and config files. Verify example queries such as:

- "where is auth middleware applied?"
- "find the user creation flow"
- "which tests cover login failure?"

## Acceptance Criteria

- Claude Code can install the plugin and start the local MCP server.
- `smart_context` returns ranked snippets for a fixture repo.
- `brief`, `explain`, and `pack` modes produce different output depths.
- The tool respects workspace boundaries and default excludes.
- The tool records privacy-preserving JSONL stats.
- Tests cover ranking, snippet extraction, path safety, MCP schema behavior, and logging.
- Documentation explains that savings numbers are approximate.

## Future Work

- Add `/smart-context-stats` or similar slash command.
- Add a batch edit tool after search behavior is stable.
- Add optional model routing across providers.
- Add an adapter for Codex.
- Add optional persistent indexing for large repositories.
- Add user-configurable ranking profiles.
