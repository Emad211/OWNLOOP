# OwnLoop

> Your coding agent writes the code. You keep the understanding.

OwnLoop is an early-stage, local-first human ownership layer for AI-assisted software development.

The project observes a coding-agent Task Run, captures verifiable changes and evidence, and turns only the most meaningful changes, decisions, risks, and understanding checks into a finite Build Replay and evidence-backed Ownership Moments.

## Current status

- Stage: v0.1 deterministic Candidate validation and selection
- Product scope: proposed v0.1
- First coding-agent adapter: Claude Code
- First project languages: JavaScript and TypeScript
- Runtime model: local single-user prototype
- Repository state: trustworthy deterministic evidence foundation, strict Candidate contracts, privacy-bounded semantic input, explicit provider-backed Candidate proposal generation, and deterministic Candidate validation in development

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

The shared packages provide strict ingress, Event, Raw Replay, change-classification, verification-evidence, Evidence Graph, Candidate Moment, reduced semantic-analysis input, Candidate-generation provenance, and Candidate-validation report contracts. The daemon modules expose authenticated ingress, evidence capture, finalization, replay projection, contained same-origin static delivery, deterministic evidence processors, Run-scoped evidence resolution, privacy-bounded semantic-input preparation, explicit provider-backed Candidate generation/read-back, and deterministic Candidate validation/read-back. The Claude Code hook adapter remains fail-open and outside the agent critical path.

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
```

Candidate generation is an explicit, disabled-by-default proposal boundary. Provider output is never treated as evidence. OL-019 resolves Evidence IDs against the exact Evidence Graph, rejects unsupported or contradictory proposals, groups deterministic duplicates, and ranks at most seven finite selections before OL-020 renders any Ownership Moment.

## Contribution state

The project is currently maintained by a one-person team. Architecture and scope changes should be recorded through ADRs. Implementation work should follow the dependency order in the v0.1.0 backlog.

## Current milestone

OL-019 validates one verified OL-018 Candidate batch against the exact OL-015 Evidence Graph. It resolves graph-owned Evidence IDs, recognizes only a finite controlled fact grammar, rejects unsupported semantics, contradictions, and absence claims, groups deterministic duplicates, computes integer evidence-dominant ranking components, and selects at most seven source Candidates. The validation report contains no Candidate prose and is persisted as a sensitive OL-010 artifact with immutable migration-v16 provenance. Rendering and user interaction remain deferred to later milestones.
