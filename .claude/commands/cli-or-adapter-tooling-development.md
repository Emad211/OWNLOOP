---
name: cli-or-adapter-tooling-development
description: Workflow command scaffold for cli-or-adapter-tooling-development in OWNLOOP.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /cli-or-adapter-tooling-development

Use this workflow when working on **cli-or-adapter-tooling-development** in `OWNLOOP`.

## Goal

Creates or extends a CLI or adapter tool, including configuration, implementation, and tests.

## Common Files

- `tools/codex-hook-adapter/package.json`
- `tools/codex-hook-adapter/tsconfig.json`
- `tools/codex-hook-adapter/src/*.ts`
- `tools/codex-hook-adapter/src/index.ts`
- `tools/codex-hook-adapter/*.test.ts`
- `tools/codex-hook-adapter/README.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add or update package.json and tsconfig.json in the tool workspace
- Implement core logic in src/*.ts
- Add CLI entrypoint in src/index.ts
- Write tests in *.test.ts
- Document the tool in README.md

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.