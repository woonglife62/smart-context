#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { smartContext } from "../src/searchEngine.js";

export async function smartContextTool(args) {
  const result = await smartContext({
    workspaceRoot: args.workspaceRoot || process.cwd(),
    query: args.query,
    mode: args.mode,
    paths: args.paths,
    exclude: args.exclude,
    max_tokens: args.max_tokens
  });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

export async function explainTool() {
  return {
    content: [
      {
        type: "text",
        text: "smart_context modes: brief returns compact ranked snippets, explain adds a short relevance summary, pack returns wider context for planning or multi-file edits. Savings stats are approximate."
      }
    ]
  };
}

export function createServer() {
  const server = new McpServer({ name: "smart-context-local", version: "0.1.0" });

  server.tool(
    "smart_context",
    {
      workspaceRoot: z.string().optional(),
      query: z.string(),
      mode: z.enum(["brief", "explain", "pack"]).optional(),
      paths: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      max_tokens: z.number().int().optional()
    },
    smartContextTool
  );

  server.tool("smart_context_explain", {}, explainTool);

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
