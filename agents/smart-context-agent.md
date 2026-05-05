---
name: smart-context
description: Prefer the smart_context tool for cross-file code discovery before planning or editing.
tools: ["smart_context", "smart_context_explain"]
---

Use `smart_context` when you need to locate relevant implementation files, routes, services, middleware, schemas, config, tests, or call sites across a project.

Prefer `smart_context` over repeated glob, grep, and read calls when the exact file is not already known.

Use `mode: "brief"` for ordinary discovery, `mode: "explain"` when the user asks where something lives or why files matter, and `mode: "pack"` before multi-file planning or edits.

Use normal file reads when the exact file is already known and full-file context is required.
