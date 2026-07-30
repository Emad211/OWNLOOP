# ADR-0027: Package a Per-User Windows Runtime and Safely Install Claude Code Hooks

**Status:** Proposed
**Date:** 2026-07-26
**Decision owner:** Project founder
**Related documents:**

- `docs/product/BACKLOG_v0.1.0.md`
- `docs/architecture/C4.md`
- `docs/adr/0007-fail-open-command-hook-adapter.md`
- `docs/adr/0013-deterministic-run-finalization-and-crash-recovery.md`
- `docs/adr/0014-deterministic-raw-replay-projection-and-local-viewer.md`
- `docs/adr/0025-local-settings-and-privacy-controls.md`
- `docs/adr/0026-sanitized-diagnostics-and-evidence-quality-dashboard.md`
- GitHub Issue #71

---

## Context

OwnLoop now contains the accepted modules required for a trustworthy local product vertical slice:

- authenticated fail-open Claude Code ingestion;
- append-only persistence, Task Run lifecycle, Git baseline and reconciliation;
- deterministic finalization and crash-recovery primitives;
- content-addressed artifacts, Raw Replay, verification Evidence, Evidence Graph, Candidate generation and validation;
- finite Ownership Moments, append-only interactions, enriched Build Replay;
- settings, privacy controls, explicit deletion, and sanitized diagnostics.

The repository still lacks a production composition root and an installation boundary. `apps/daemon/src/index.ts` is a placeholder bootstrap, while accepted processors are exercised directly by tests. The Hook Adapter also deliberately defers token, port, and daemon lifecycle orchestration to a future installer.

The v0.1 backlog requires one founder-target installation path, safe Hook installation/removal, defined daemon start/stop behavior, data-preserving uninstall choice, and startup compatibility checks.

The founder target is native Windows 10/11 x64 with Git for Windows and Claude Code. Anthropic's current settings hierarchy places per-user settings at `~/.claude/settings.json`; project and managed-policy locations must remain untouched by this installer.

## Decision

OwnLoop v0.1 will ship one per-user Windows installation path.

```text
verified release package
+ immutable versioned application bytes
+ separate durable data/config/run roots
+ production daemon composition
+ serialized bounded runtime pump
+ stable secret-free Hook launcher
+ exact user-settings merge/removal
→ locally runnable OwnLoop v0.1
```

The release supports native Windows 10/11 x64, PowerShell 5.1+, Node.js 24.18.0, pnpm 11.4.0 for packaging, and Claude Code with Git for Windows available.

No MSI/MSIX, Windows Service, Task Scheduler, startup autorun, admin/system-wide installation, auto-update, WSL package, Linux/macOS package, cloud state, telemetry, account system, or second listener is introduced.

## Release and install identity

The application release identity becomes `0.1.0`.

One strict release manifest binds:

- application, daemon runtime, Hook Adapter and web versions;
- Hook Adapter contract version;
- expected SQLite schema version 18;
- platform `win32`, architecture `x64`, Node 24.18.0 and packaging pnpm 11.4.0;
- install-layout version;
- canonical package file paths, sizes and SHA-256 digests;
- a canonical manifest fingerprint.

The package builder verifies all staged bytes after creation. Runtime startup verifies the installed manifest before opening persistence, artifacts, listener, or pump.

Package paths are relative, canonical, sorted, unique, traversal-free, and never symlinks. Extra executable-critical files, missing files, digest disagreement, unsupported platform/runtime, newer incompatible layout, or newer database schema fail closed.

## Per-user layout

The default root is `%LOCALAPPDATA%\OwnLoop`:

```text
app\0.1.0\
bin\
config\
data\
run\
install-manifest.json
```

Application bytes are immutable and versioned. Durable SQLite and artifacts live under `data`; installation credentials live under `config`; ephemeral process state lives under `run`; stable launchers live under `bin`.

Application, configuration, data and runtime roots are absolute, canonical and protected against symlink/reparse-point traversal and unsafe overlap. The installer stages and verifies a release before atomically moving it into the version directory.

Updates and reinstall preserve `data` by default. Installation never resets or copies user data into the application directory.

## Installation credentials

The installer generates one installation token and one ingress HMAC key from at least 32 random bytes each and stores them only in a dedicated per-user secrets document.

The document receives a current-user-only Windows ACL. Startup rejects malformed credentials or a secrets file whose effective access boundary cannot be established.

Credentials never enter:

- Claude settings or backups;
- install or release manifests;
- runtime state;
- process arguments;
- stdout/stderr, ordinary logs or diagnostics;
- URLs or browser storage.

Existing valid credentials survive reinstall/update. Uninstall removes installation credentials even when durable data is preserved. OL-023 provider keys remain process-memory-only and are not added to installation secrets.

## Production composition root

The daemon runtime will:

1. validate release, installation and runtime configuration;
2. open v18 persistence;
3. create the content-addressed artifact store under the durable data root;
4. create one `LocalSettingsService`;
5. compose the accepted ingress/replay/settings/diagnostics server with the packaged web root;
6. bind to `127.0.0.1` on an ephemeral port;
7. publish sanitized runtime state atomically;
8. run accepted startup recovery;
9. start a serialized bounded runtime pump;
10. shut down gracefully and remove only runtime state owned by its exact instance.

Runtime state contains only controlled versions, instance ID, PID, process-start identity, loopback port, state and timestamps. It contains no credential, provider configuration, analyzed path, prompt, source identifier or user data.

PID alone is never trusted because Windows can reuse PIDs. Status and stop operations bind runtime state to exact instance/version/process-start identity and an authenticated runtime endpoint.

## Serialized runtime pump

Earlier ADRs intentionally provided explicit processors without timers. OL-025 is the accepted production orchestration point deferred by those decisions and by the C4 architecture.

The pump is one non-overlapping in-process loop. It uses bounded stage batches, an idle delay, no busy spin and no arbitrary job payload. It calls only accepted processor APIs in dependency order:

1. lifecycle resolution;
2. Event normalization;
3. missing Git baseline capture;
4. eligible Git reconciliation;
5. eligible Run finalization;
6. change classification;
7. verification extraction;
8. Evidence Graph construction;
9. semantic-input construction;
10. provider Candidate generation only when OL-023 returns a complete enabled memory-only configuration;
11. deterministic Candidate validation.

Startup invokes explicit stale-Run recovery before ordinary finalization work.

Each cycle isolates controlled stage failure so a failure does not terminate the daemon or alter fail-open Hook behavior. Provider-disabled state performs no provider call. Provider failure does not affect Raw Replay and can be retried only through existing bounded/idempotent generation semantics on a later cycle.

The pump never performs retention cleanup, Run deletion, diagnostic export, update checking, installation or Hook-file mutation.

Shutdown stops new cycles, aborts in-flight provider work, waits within a bounded grace period, closes the listener and persistence, and removes exact owned runtime state.

## Runtime control

The existing listener adds authenticated:

```text
GET  /v1/runtime/status
POST /v1/runtime/shutdown
```

Status returns controlled instance/version/port/pump/compatibility state only. Shutdown requires the exact current instance ID, acknowledges before graceful close and rejects mismatches without side effects.

Both routes are no-store/nosniff and accept no query-controlled expansion. No restart, update, install or credential endpoint is added.

Stable commands provide install, start, status, open, stop, Hook install/status/remove and uninstall with explicit preserve/remove-data choices.

## Claude Hook installation

The installer targets only the user's `~/.claude/settings.json` equivalent and installs exactly the nine accepted Hook events.

Claude settings contain a stable OwnLoop launcher path only. They contain no token, port, HMAC key, project path or versioned app path.

The stable launcher reads protected credentials and sanitized runtime state, validates compatibility, injects port/token only into the short-lived Hook Adapter environment and invokes the exact installed adapter. It preserves the adapter's silent exit-0/no-output/no-retry/fail-open contract for stopped daemon, stale state, malformed input, incompatibility, timeout and delivery failure.

Settings mutation:

- parses a bounded ordinary JSON object with duplicate-key detection;
- preserves unknown top-level settings and all non-OwnLoop Hooks;
- adds at most one exact OwnLoop entry per event;
- is idempotent;
- backs up before each mutation;
- writes through temporary file plus atomic replace;
- rejects ambiguous modified OwnLoop entries;
- removes only exact entries recorded by the installation manifest;
- leaves the original untouched on corruption or unsupported structure.

No credential enters settings or backups.

## Start, stop and browser open

Start verifies package/runtime compatibility before listener creation, rejects a live compatible instance, removes only proven stale runtime metadata, launches detached under the current user and waits for authenticated status within a bound.

Stop uses authenticated graceful shutdown and exact instance identity. It never terminates a process solely because a PID matches and has no force-kill mode in v1.

Open launches only the exact `http://127.0.0.1:<validated-port>/` viewer URL. No arbitrary URL or shell interpolation is accepted.

## Uninstall and data choice

Uninstall removes exact OwnLoop Hook entries, gracefully stops the matching daemon, removes launchers/application/runtime/install metadata and removes installation credentials.

Durable data is handled by one explicit mutually exclusive choice:

- preserve data, which is the default and fail-closed behavior;
- remove data, requiring exact installation-ID confirmation and canonical overlap/reparse checks.

Uninstall never removes another Hook, Claude settings themselves, a project repository, Node, pnpm, Claude Code, Git or another OwnLoop installation. Partial failure is reported as repair-needed and never as success.

## Package builder

The package builder runs after frozen installation, validates exact Node/pnpm, runs workspace builds, creates isolated production deployments for daemon and Hook Adapter, includes the web build and launchers, excludes development/source/test/local-data/credential/cache content, computes the canonical release manifest and verifies every staged byte.

An install directory and optional deterministic `.tar.gz` archive are produced without a post-install network download.

## Consequences

### Positive

- the accepted modules become one runnable local product;
- Hook setup contains no embedded credential and preserves existing Claude configuration;
- app updates and uninstall can preserve durable user data;
- startup and stop are identity- and version-bound rather than PID-only;
- provider calls remain disabled by default;
- package and installed bytes are verifiable;
- process orchestration is explicit, bounded and testable.

### Negative

- v0.1 supports only one Windows installation path;
- Node 24.18.0 remains an external runtime prerequisite;
- no service/autorun means the user explicitly starts OwnLoop;
- a process crash can leave stale runtime metadata that must be verified and repaired;
- installer complexity includes safe JSON merge, ACL and filesystem boundaries;
- production orchestration increases the integration-test surface.

## Alternatives rejected

### Windows Service or Task Scheduler

Rejected because it broadens privileges, lifecycle and uninstall risk for the prototype.

### Store token in Claude settings or user environment

Rejected because settings/backups and inherited environments are broader durable credential surfaces.

### Kill by PID during stop

Rejected because PID reuse can terminate an unrelated process and bypass graceful cleanup.

### Modify project settings

Rejected because installation is machine/user-specific and must not modify repositories or shared team configuration.

### Skip runtime pump and package only the HTTP server

Rejected because installed ingestion would persist pending receipts without producing the accepted lifecycle, Evidence and Replay outputs.

### Bundle a new job system

Rejected because accepted processors and bounded eligible-list APIs already provide deterministic idempotent work discovery.

### Persist provider keys

Rejected because OL-023 deliberately keeps provider credentials in daemon memory only.

---

## Validation

This decision is accepted when Issue #71 release-contract, manifest-integrity, production-composition, pump-ordering/failure-isolation, startup/recovery, runtime-control, credential/ACL, safe-Hook-merge, installed-adapter, package, start/stop/open, reinstall/update, uninstall/data-choice, privacy and full-regression tests pass.

## Reversibility

Other platforms, native bundled Node, MSI/MSIX, code signing, service/autorun, auto-update, keychain integration, force-stop, system-wide installation or remote access require later accepted decisions.