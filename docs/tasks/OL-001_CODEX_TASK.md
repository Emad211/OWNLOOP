# OL-001 Codex Task Brief

**Issue:** #2 — Bootstrap the TypeScript monorepo  
**Base branch:** `agent/session-lifecycle-and-v0.1-plan`  
**Suggested work branch:** `codex/ol-001-bootstrap`  
**Task type:** Repository bootstrap only

## Objective

Create the smallest maintainable TypeScript workspace that proves OwnLoop can support:

- a local daemon process;
- a local React web UI;
- a buildable future agent hook adapter;
- shared runtime contracts and event-model packages;
- deterministic lint, typecheck, test, build, and CI commands.

Do not implement any product behavior.

## Mandatory reading order

Before editing files, read:

1. `AGENTS.md`
2. `docs/product/PROJECT_SCOPE.md`
3. `docs/adr/0001-human-ownership-layer.md`
4. `docs/adr/0002-local-first-claude-code-first-mvp.md`
5. `docs/adr/0003-event-schema-and-task-run-lifecycle.md`
6. `docs/architecture/C4_ARCHITECTURE.md`
7. `docs/planning/V0.1.0_BACKLOG.md`
8. GitHub issue #2

Then briefly restate the task boundary before implementation.

## Fixed technical choices

Use the following baseline unless a real compatibility problem is demonstrated:

- Node.js `24.18.0` LTS, pinned in `.nvmrc` and `package.json#engines`
- pnpm `11.4.0`, pinned in `package.json#packageManager`
- TypeScript `6.x` in strict mode
- pnpm workspaces
- React + Vite for `apps/web`
- Vitest for unit tests
- GitHub Actions for continuous integration

Choose one formatter/linter strategy with the smallest practical dependency surface. Do not install overlapping formatters or overlapping linters.

## Required repository structure

```text
apps/
├── daemon/
│   ├── package.json
│   ├── src/
│   └── tsconfig.json
└── web/
    ├── package.json
    ├── src/
    └── tsconfig.json
packages/
├── contracts/
│   ├── package.json
│   ├── src/
│   └── tsconfig.json
├── event-model/
│   ├── package.json
│   ├── src/
│   └── tsconfig.json
└── test-fixtures/
    ├── package.json
    ├── src/
    └── tsconfig.json
tools/
└── hook-adapter/
    ├── package.json
    ├── src/
    └── tsconfig.json
```

Packages may contain minimal placeholder exports only where needed to prove workspace wiring. Placeholder code must not simulate future product behavior.

## Required root files

At minimum, create and configure:

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `.nvmrc`
- `.gitignore`
- a strict shared TypeScript configuration
- formatter/linter configuration
- Vitest configuration if needed
- `.github/workflows/ci.yml`
- README setup and verification instructions

## Required commands

The repository root must provide working commands for:

```bash
pnpm dev
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` may start the daemon and web app concurrently, but keep the implementation simple and cross-platform.

## Minimal runtime behavior

### `apps/daemon`

A minimal local process that starts successfully and prints a stable startup message. It must not open a database, call an AI provider, ingest events, or access a repository.

### `apps/web`

A minimal React page that renders:

- the product name `OwnLoop`;
- a clear `v0.1 bootstrap` or equivalent development-state label;
- no mock dashboard or speculative product UI.

### `tools/hook-adapter`

A buildable CLI entry point that prints a non-functional placeholder message when invoked. It must not register, read, or process Codex or Claude hooks.

### shared packages

Prove at least one workspace import from an application into a shared package. Keep exported values neutral and infrastructure-oriented.

## Tests

Add only useful bootstrap tests, for example:

- a shared package export can be imported;
- a stable neutral function or constant behaves as expected;
- the web bootstrap component renders its fixed heading if a DOM test setup is already justified.

Do not add meaningless tests solely to increase test count.

## Continuous integration

GitHub Actions must run on pull requests and pushes to `main`:

1. checkout;
2. set up Node.js 24;
3. enable/install the pinned pnpm version;
4. install with a frozen lockfile;
5. run formatting check;
6. run lint;
7. run typecheck;
8. run tests;
9. run build.

Use dependency caching only when it remains easy to understand and maintain.

## Explicitly out of scope

Do not add:

- SQLite, Drizzle, Prisma, migrations, or persistence;
- Fastify endpoints or an HTTP ingestion API;
- Codex, Claude Code, or GitHub integration;
- hook lifecycle logic;
- event schemas beyond neutral placeholder package wiring;
- AI SDKs or model-provider dependencies;
- authentication, accounts, analytics, billing, telemetry, or cloud services;
- Docker, Kubernetes, Terraform, deployment configuration, or release automation;
- component libraries or design systems;
- state-management libraries;
- speculative abstractions for future phases.

## Acceptance criteria

- [ ] Node.js and pnpm versions are pinned.
- [ ] All workspaces use TypeScript strict mode.
- [ ] The daemon starts without product behavior.
- [ ] The web application starts and renders the minimal bootstrap page.
- [ ] The hook adapter builds as a CLI without hook behavior.
- [ ] Workspace imports function correctly.
- [ ] Root formatting, lint, typecheck, test, and build commands pass.
- [ ] CI runs the same quality gates.
- [ ] The lockfile is committed.
- [ ] README includes exact local setup and verification commands.
- [ ] No out-of-scope dependencies or capabilities are introduced.

## Required final report from Codex

Return:

1. Summary of the chosen workspace/tooling design.
2. Exact files created or modified.
3. Direct dependencies introduced and why each is needed.
4. Commands executed with pass/fail results.
5. Any command not executed and the exact reason.
6. Known limitations.
7. Confirmation that no product behavior, hooks, AI, database, cloud, auth, or telemetry was implemented.

## Copy-paste Codex prompt

```text
Implement GitHub issue #2 (OL-001) in repository Emad211/OWNLOOP.

Base your work on branch `agent/session-lifecycle-and-v0.1-plan` and create an isolated worktree/branch named `codex/ol-001-bootstrap` if the Codex client does not already isolate the task.

First read `AGENTS.md` and `docs/tasks/OL-001_CODEX_TASK.md`, then read the product scope and ADRs listed there. Restate the task boundary before changing files.

Implement only the TypeScript monorepo bootstrap described in the task brief. Do not implement event ingestion, hooks, SQLite, AI calls, Ownership Moments, Build Replay, authentication, cloud services, analytics, telemetry, deployment, or speculative product abstractions.

Use Node.js 24.18.0 LTS, pnpm 11.4.0, TypeScript 6 strict mode, React + Vite for the local web app, Vitest for tests, and GitHub Actions for CI. Keep dependencies minimal and pin direct dependencies. Commit the lockfile.

Run and report `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Do not claim a check passed unless it was run. Leave the worktree clean and provide a concise review summary with files, dependencies, checks, limitations, and confirmation that the scope restrictions were respected.
```
