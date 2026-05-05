export const MODES = new Set(["brief", "explain", "pack"]);

export const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".smart-context",
  ".cache",
  "tmp",
  ".worktrees",
  ".omc",
  ".claude"
];

export const DEFAULT_BUDGETS = {
  brief: 2500,
  explain: 4000,
  pack: 8000
};

export const MAX_TOKEN_BUDGET = 30000;
