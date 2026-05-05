# Smart Context

Smart Context is a local Claude Code plugin that exposes a `smart_context` MCP tool for efficient codebase discovery.

It replaces repeated file discovery loops with one ranked response containing relevant files, snippets, reasons, and approximate savings statistics.

## Privacy

The MVP runs locally and does not send code, prompts, snippets, model responses, or API keys to external services. Logs are written under `.smart-context/logs/` and contain only aggregate stats plus a short query hash.

## Modes

- `brief`: compact ranked snippets
- `explain`: brief results plus a short relevance summary
- `pack`: wider context for planning or multi-file edits

## Savings

Savings numbers are approximate. They compare a simple baseline for separate discovery calls against the approximate tokens returned by `smart_context`.

## Development

```bash
npm install
npm test
npm run start:mcp
```
