# Smart Context

Smart Context is a local Claude Code plugin that exposes a `smart_context` MCP tool for efficient codebase discovery.

It replaces repeated file discovery loops with one ranked response containing relevant files, snippets, reasons, and approximate savings statistics.

## Install For Development

```bash
npm install
npm test
```

In Claude Code, add this repository as a local plugin using Claude Code's plugin workflow, then restart Claude Code. The plugin declares the local MCP server in `.claude-plugin/plugin.json`.

## Tool

`smart_context` accepts:

```json
{
  "query": "where is auth middleware applied?",
  "mode": "brief",
  "paths": ["src"],
  "max_tokens": 4000
}
```

Modes:

- `brief`: compact ranked snippets
- `explain`: brief results plus a short relevance summary
- `pack`: wider context for planning or multi-file edits

## Privacy

The MVP runs locally and does not send code, prompts, snippets, model responses, or API keys to external services. Logs are written under `.smart-context/logs/` and contain only aggregate stats plus a short query hash.

Logs do not store full prompts, query text, code snippets, model responses, secrets, or environment variables.

## Savings

Savings numbers are approximate. They compare a simple baseline for separate discovery calls against the approximate tokens returned by `smart_context`.

## Development

```bash
npm run test:unit
npm run test:integration
npm test
npm run start:mcp
```
