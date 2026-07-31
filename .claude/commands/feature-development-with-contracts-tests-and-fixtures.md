---
name: feature-development-with-contracts-tests-and-fixtures
description: Workflow command scaffold for feature-development-with-contracts-tests-and-fixtures in OWNLOOP.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-contracts-tests-and-fixtures

Use this workflow when working on **feature-development-with-contracts-tests-and-fixtures** in `OWNLOOP`.

## Goal

Implements a new Codex feature by adding contract/types, fixtures, and tests, then exposing and exporting the new surface.

## Common Files

- `packages/contracts/src/*.ts`
- `packages/test-fixtures/src/*.ts`
- `packages/contracts/tests/*.test.ts`
- `packages/event-model/tests/*.test.ts`
- `packages/contracts/src/index.ts`
- `packages/test-fixtures/src/index.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add new contract/type file(s) in packages/contracts/src/
- Add corresponding fixtures in packages/test-fixtures/src/
- Write tests in packages/contracts/tests/ or packages/event-model/tests/
- Expose or export the new contract/fixture in an index file

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.