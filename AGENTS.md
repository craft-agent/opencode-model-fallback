# AGENTS

opencode-model-fallback is an OpenCode 2 plugin package: the model fallback
(hooks that choose and move models on a limit), plus the starter's tool layer
(tools, grants and settings), which works in the same plugin. Releases are
GitHub Releases tagged `v<version>`; consumers pin the npm version.

## Layout

- `src/project.ts` — the package's identity: name, tool ID prefix, setting
  prefix and toolsets.
- `src/core/` — the tool contract and the tools. Each tool is a spec with a
  Zod v4 argument schema, an output schema, a toolset and a write class;
  `execute` gets a `ToolContext`.
- `src/entry/` — what the plugin builds on: settings, permissions, prompts
  and grants handling shared by the tools.
- `src/opencode/` — the OpenCode 2 plugin, which turns the specs into
  OpenCode's tools and skills.
- `docs/conventions.md` — the rules every tool follows, and the model
  fallback's own rules ("The model fallback"): its terms, names, settings,
  defaults, state, notices, the OpenCode versions it runs on, and tests.
- Tests sit beside the code they test (`*.test.ts`, `bun test`).

## Rules

- **Every tool follows [`docs/conventions.md`](docs/conventions.md)**, and the
  model fallback follows its own part of it. A change to a convention changes
  that file first, with its reason.
- **`src/core/` knows no harness, no caller and no project.** No harness,
  product or machine names, paths or session conventions in code,
  descriptions or messages; the project's names reach it only through the
  plugin. It uses `node:*` modules only, never a runtime's own globals,
  so it runs on Node and Bun.

- **Tool IDs are a public interface.** Permission rules and skills key on them
  (`<prefix>_<domain>_<verb>`); renaming one is a breaking change.
- **A tool's write class is its contract with OpenCode.** The class decides
  whether the plugin asks for permission before a call, so it must be the
  strictest class the tool's arguments can reach. `read_only` registers no
  write tool; the class is never the boundary.
- **Every program a tool runs goes through one runner**, which fixes a
  non-interactive environment and maps failures to error codes.
- **Every commit stays small.** The pre-commit hook rejects a commit over 500
  reviewable changed lines; split the change instead of raising the limit.

## Commands

- `pnpm test`, `pnpm run typecheck`, `pnpm run format`, `pnpm run format:check`
- Single file: `bun test <path>`
- `pnpm run build && pnpm run smoke`
