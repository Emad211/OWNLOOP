# OwnLoop

> Your coding agent writes the code. You keep the understanding.

OwnLoop is an early-stage, local-first human ownership layer for AI-assisted software development.

The project observes a coding-agent Task Run, captures verifiable changes and evidence, and turns only the most meaningful changes, decisions, risks, and understanding checks into a finite Build Replay and evidence-backed Ownership Moments.

## Current status

- Stage: v0.1 Windows local runtime, packaging, Claude Code integration, and first-class Codex integration under certification
- Product scope: proposed v0.1
- Coding-agent sources: Claude Code and Codex, with source-specific strict ingestion and provider-neutral downstream evidence
- First project languages: JavaScript and TypeScript
- Runtime model: local single-user prototype
- Repository state: the accepted evidence, Moment, interaction, replay, privacy, diagnostics, installer, Claude Code, and Codex layers are composed into one verified per-user Windows runtime

Claude Code remains the first certified source. Codex contracts, adapter, authenticated ingress, installation, trust/policy diagnostics, CLI, Windows package, and provider-neutral evidence pipeline are implemented. OL-027 remains open until a real local Codex CLI run completes the prompt-to-Git-to-Replay acceptance path; Desktop, IDE/app-server, `codex exec`, and subagent surface parity are not inferred from shared configuration.

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

The development command starts the daemon and React viewer workspaces. The production entrypoint is reserved for an installed, manifest-verified Windows layout and never invents credentials, data paths, release identity, or provider settings.

## Windows v0.1 package and installation

The supported founder path is native Windows 10/11 x64 with PowerShell 5.1 or newer, Node.js exactly `24.18.0`, and Git for Windows. Claude Code and Codex are current-user integrations. WSL, macOS, Linux, ARM64, MSI/MSIX, services, scheduled tasks, admin/system-wide installation, and auto-update are not part of the current Windows installer.

From a frozen clean checkout, build and verify the release directory:

```powershell
pnpm package:windows
Set-Location .\dist\ownloop-windows-0.1.0
node.exe .\installer\dist\cli.js install
```

The install response returns the non-secret `installId` needed only when explicitly removing durable data. Stable commands are then available through:

```powershell
$ownloop = "$env:LOCALAPPDATA\OwnLoop\bin\ownloop.cmd"

& $ownloop start
& $ownloop status
& $ownloop open
& $ownloop stop
& $ownloop hooks status
& $ownloop codex hooks status
& $ownloop codex doctor
& $ownloop uninstall --preserve-data
```

Permanent data removal is a separate explicit operation:

```powershell
& $ownloop uninstall --remove-data --confirm <installId>
```

The generic Hook commands reconcile both current-user integrations:

```powershell
& $ownloop hooks install
& $ownloop hooks status
& $ownloop hooks remove
```

Codex-only reconciliation is also available and does not modify Claude Code settings:

```powershell
& $ownloop codex hooks install
& $ownloop codex hooks status
& $ownloop codex hooks remove
```

The installer modifies only the current user's exact OwnLoop entries, preserves unrelated settings and Hooks, and stores no credential, daemon port, project path, transcript content, or versioned application path in either agent configuration. Application bytes, credentials, durable data, and runtime state remain separated under `%LOCALAPPDATA%\OwnLoop`.

Codex Hook trust remains owned by Codex. OwnLoop never writes or forges trusted hashes, bypasses managed policy, edits project-local or managed Hooks, or claims a client surface is active without observed events. See the [Codex installation, status, trust, and troubleshooting guide](docs/guides/codex-hooks-installation-status-and-troubleshooting.md).

## Verification

Run the same quality gates used by continuous integration:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Build and execute the native Windows package acceptance path with:

```powershell
pnpm package:windows
```

Use `pnpm format` to apply formatting.

The shared packages provide strict multi-agent ingress, Event, Raw Replay, change-classification, verification-evidence, Evidence Graph, Candidate Moment, semantic-input, Candidate-generation, Candidate-validation, Ownership-Moment projection, Moment-interaction, enriched Build Replay, and local-settings/privacy contracts. The daemon exposes authenticated Claude and Codex ingress, deterministic evidence processing, selected-Moment projection, append-only interaction persistence tied to exact verified validations and Moments, read-only enriched Build Replay composition, compare-and-swap public settings, memory-only provider-secret handling, explicit retention/deletion actions, bounded custom secret-field redaction, source-aware process-lifetime diagnostic counts, Codex capability diagnostics, and a read-only diagnostics/evidence-quality projection with ephemeral sanitized bundle export. The React viewer renders provider proposals separately from persisted support, hydrates recorded interaction state and settings from the local daemon, and never treats a stored action as proof of comprehension or ownership. Both agent adapters remain fail-open and outside the coding agent critical path.

## Design principles

- Evidence before explanation
- AI proposes; deterministic systems verify
- Local-first privacy
- Finite experience rather than infinite engagement
- OwnLoop remains outside the coding agent's critical path in v0.1
- Zero moments is a valid outcome
- Source events remain observations; Git and deterministic analyzers remain evidence authorities
- Trust and agent permissions remain owned by the coding agent and user

## Documentation

### Product

- [Project Scope](docs/product/PROJECT_SCOPE.md)
- [v0.1.0 Backlog](docs/product/BACKLOG_v0.1.0.md)

### Guides

- [Codex Hooks: Installation, Status, Trust, and Troubleshooting](docs/guides/codex-hooks-installation-status-and-troubleshooting.md)

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
- [ADR-0025: Local Settings and Privacy Controls](docs/adr/0025-local-settings-and-privacy-controls.md)
- [ADR-0026: Sanitized Diagnostics and Evidence-Quality Dashboard](docs/adr/0026-sanitized-diagnostics-and-evidence-quality-dashboard.md)
- [ADR-0027: Per-User Windows Runtime and Claude Code Hooks](docs/adr/0027-windows-local-installation-runtime-and-hook-orchestration.md)
- [ADR-0028: Codex Lifecycle-Hook Adapter and Multi-Agent Source Boundary](docs/adr/0028-codex-lifecycle-hook-adapter-and-multi-agent-source-boundary.md)
- [ADR-0029: Provider-Neutral Codex Event Taxonomy](docs/adr/0029-codex-provider-neutral-event-taxonomy.md)

### Research

- [Codex Lifecycle-Hook Integration Research — July 2026](docs/research/codex-lifecycle-hook-integration-2026-07.md)

### Architecture

- [C4 Architecture Model](docs/architecture/C4.md)

## Implemented vertical slice

```text
Claude Code or Codex source hook
→ source-specific fail-open local adapter
→ authenticated loopback ingestion
→ strict redaction and append-only event storage
→ provider-neutral Task Run lifecycle
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
→ local settings, privacy controls, explicit retention, and Run deletion
→ sanitized diagnostics and evidence-quality dashboard
→ verified per-user Windows runtime, package, and current-user Hook installation
```

Candidate generation is an explicit, disabled-by-default proposal boundary. Provider output is never treated as evidence. OL-019 validates and finitely selects source Candidates; OL-020 joins only that verified selection and renders proposal wording separately from deterministic support. OL-021 records only explicit actions against exact displayed Moments as append-only local history. A stored action attests to recording, not comprehension, correctness, agreement, authorship, safety, or legal ownership.

## Contribution state

The project is currently maintained by a one-person team. Architecture and scope changes should be recorded through ADRs. Implementation work should follow the dependency order in the v0.1.0 backlog.

## Current milestone

OL-025 completed the verified per-user Windows runtime and installer. OL-027 extends that accepted boundary with an isolated Codex adapter, exact current-user `hooks.json` ownership, stable launcher, trust and managed-policy diagnostics, source capability projection, Codex-only CLI repair flows, deterministic package inclusion, and multi-agent evidence processing.

The remaining OL-027 acceptance item is real-client certification: a real local Codex CLI prompt must traverse official lifecycle Hooks, create one trustworthy Task Run, reconcile a real Git change, and produce source-accurate Replay/evidence without leaking credentials or reading transcript/rollout history. Other Codex client surfaces remain independently unverified until observed.

Provider generation remains disabled by default and provider keys remain memory-only. No second listener, Windows Service, scheduled task, admin installation, auto-update, force-kill, CORS, cloud state, analytics, telemetry, billing, account system, automatic trust modification, managed Hook mutation, transcript/rollout parser, or project-local Codex installation is introduced.
