# OwnLoop

> Your coding agent writes the code. You keep the understanding.

OwnLoop is an early-stage, local-first human ownership layer for AI-assisted software development.

The project observes a coding-agent Task Run, captures verifiable changes and evidence, and turns only the most meaningful changes, decisions, risks, and understanding checks into a finite Build Replay and evidence-backed Ownership Moments.

## Current status

- Stage: v0.1 deterministic enriched Build Replay
- Product scope: proposed v0.1
- First coding-agent adapter: Claude Code
- First project languages: JavaScript and TypeScript
- Runtime model: local single-user prototype
- Repository state: trustworthy deterministic evidence foundation, finite validated Ownership Moments, durable append-only local interaction history, and deterministic enriched Build Replay in development

## Local setup

Prerequisites:

- Node.js `24.18.0` (also pinned in `.nvmrc` and `package.json#engines`)
- pnpm `11.4.0` (also pinned in `package.json#packageManager`)

Install the exact package-manager version and dependencies:

```bash
corepack enable
corepack prepare pnpm@11.4.0 --activate
pnpm install --frozen-lockfile
```

Start the daemon bootstrap and React development viewer together:

```bash
pnpm dev
```

The React page renders the Raw Replay connection shell. Authenticated Run data is available when a
caller constructs the existing loopback server with persistence, the OL-010 artifact store, and the
optional built web root. Production startup configuration remains explicit; the daemon entrypoint does
not invent database, token, artifact-root, listener, or provider settings.

## Verification

Run the same quality gates used by continuous integration:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm format` to apply formatting.

The shared packages provide strict ingress, Event, Raw Replay, change-classification, verification-evidence, Evidence Graph, Candidate Moment, semantic-input, Candidate-generation, Candidate-validation, Ownership-Moment projection, Moment-interaction, and enriched Build Replay contracts. The daemon exposes authenticated ingress, deterministic evidence processing, selected-Moment projection, append-only interaction persistence tied to exact verified validations and Moments, and a read-only enriched Build Replay composition. The React viewer renders provider proposals separately from persisted support, hydrates recorded interaction state from the local daemon, and never treats a stored action as proof of comprehension or ownership. The Claude Code hook adapter remains fail-open and outside the agent critical path.

## Design principles

- Evidence before explanation
- AI proposes; deterministic systems verify
- Local-first privacy
- Finite experience rather than infinite engagement
- OwnLoop remains outside the coding agent's critical path in v0.1
- Zero moments is a valid outcome

## Documentation

### Product

- [Project Scope](docs/product/PROJECT_SCOPE.md)
- [v0.1.0 Backlog](docs/product/BACKLOG_v0.1.0.md)

### Architecture Decision Records

- [ADR-0001: Human Ownership Layer](docs/adr/0001-human-ownership-layer.md)
- [ADR-0002: Local-First Claude-Code-First MVP](docs/adr/0002-local-first-claude-code-first-mvp.md)
- [ADR-0003: Event Schema and Task-Run Lifecycle](docs/adr/0003-event-schema-and-session-lifecycle.md)
- [ADR-0014: Deterministic Raw Replay and Local Viewer](docs/adr/0014-deterministic-raw-replay-projection-and-local-viewer.md)
- [ADR-0015: Deterministic Evidence-Backed Change Classification](docs/adr/0015-deterministic-evidence-backed-change-classification.md)
- [ADR-0016: Deterministic Verification Evidence Extraction](docs/adr/0016-deterministic-verification-evidence-extraction.md)
- [ADR-0017: Deterministic Locally Resolvable Evidence Graph](docs/adr/0017-deterministic-locally-resolvable-evidence-graph.md)
- [ADR-0018: Strict Evidence-Backed Candidate-Moment Contracts](docs/adr/0018-strict-evidence-backed-candidate-moment-contracts.md)
- [ADR-0019: Deterministic Reduced Semantic-Analysis Input](docs/adr/0019-deterministic-reduced-semantic-analysis-input.md)
- [ADR-0020: Provider-Backed Candidate Generation Boundary](docs/adr/0020-provider-backed-candidate-generation-boundary.md)
- [ADR-0021: Deterministic Candidate Validation and Selection](docs/adr/0021-deterministic-candidate-validation-and-selection.md)
- [ADR-0022: Read-Only Finite Ownership Moment Projection](docs/adr/0022-read-only-finite-ownership-moment-projection.md)
- [ADR-0023: Append-Only Moment Interactions and Ownership Records](docs/adr/0023-append-only-moment-interactions-and-ownership-records.md)
- [ADR-0024: Deterministic Enriched Build Replay](docs/adr/0024-deterministic-enriched-build-replay.md)

### Architecture

- [C4 Architecture Model](docs/architecture/C4.md)

## Planned first vertical slice

```text
Claude Code hook
→ local ingestion
→ append-only event storage
→ Task Run lifecycle
→ Git baseline and final reconciliation
→ deterministic raw replay
→ deterministic file/change evidence
→ deterministic verification evidence
→ deterministic locally resolvable Evidence Graph
→ strict evidence-backed Candidate Moment contract
→ deterministic reduced and redacted semantic-analysis input
→ explicit provider-backed Candidate proposal generation
→ deterministic Candidate validation, deduplication, ranking, and finite selection
→ read-only finite Ownership Moment projection and local Evidence navigation
→ append-only Moment interactions and bounded no-comprehension records
→ deterministic enriched Build Replay
```

Candidate generation is an explicit, disabled-by-default proposal boundary. Provider output is never treated as evidence. OL-019 validates and finitely selects source Candidates; OL-020 joins only that verified selection and renders proposal wording separately from deterministic support. OL-021 records only explicit actions against exact displayed Moments as append-only local history. A stored action attests to recording, not comprehension, correctness, agreement, authorship, safety, or legal ownership.

## Contribution state

The project is currently maintained by a one-person team. Architecture and scope changes should be recorded through ADRs. Implementation work should follow the dependency order in the v0.1.0 backlog.

## Current milestone

OL-022 composes one terminal Run into a finite deterministic enriched Build Replay by joining only verified OL-012 Raw Replay facts, the exact current-policy OL-020 selected-Moment projection, and exact OL-021 interaction state. The projection displays the original redacted goal, terminal status, explicit limitations, only Moment-linked changed files, selected changes/decisions/risks/checks, observed verification, Evidence gaps, and recorded activity. Provider proposal wording, deterministic support, and recorded review activity remain separate. No migration, replay cache/artifact, generated narrative, repository/source read, interaction write, model call, or browser storage is introduced.
