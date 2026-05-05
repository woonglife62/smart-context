import path from "node:path";
import { SmartContextError } from "./errors.js";

export function resolveSearchPaths(workspaceRoot, paths) {
  const root = path.resolve(workspaceRoot);
  const requested = paths && paths.length > 0 ? paths : ["."];

  return requested.map((entry) => {
    if (path.isAbsolute(entry)) {
      throw new SmartContextError("invalid_path", "absolute paths are not allowed", { path: entry });
    }

    const resolved = path.resolve(root, entry);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SmartContextError("invalid_path", "path resolves outside the workspace", { path: entry });
    }
    return resolved;
  });
}
