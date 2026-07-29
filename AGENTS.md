# OwnLoop agent instructions

These instructions apply to the entire repository.

## Product boundary

OwnLoop is a local-first Human Ownership Layer for AI-generated software. Accepted direction is defined by the product scope, dependency-ordered backlog, and ADR-0001 through ADR-0027.

Read the relevant documents before changing code. Do not silently reinterpret an accepted decision. Architectural changes require an ADR.

## Development policy

- Work on exactly one issue and keep the Pull Request independently reviewable.
- Do not modify unrelated files or add speculative behavior.
- Never commit secrets, credentials, `.env` contents, databases, raw Git output, prepared artifact bytes, source content, machine roots, provider responses, exception messages, or stacks.
- Do not weaken strict contracts, canonical identities, Evidence ownership, artifact verification, migration history, transactionality, idempotency, append-only history, bounded reads, or fail-closed read-back.
- A recorded interaction proves only that the explicit action was stored. It does not prove comprehension, correctness, agreement, authorship, safety, or legal ownership.
- Provider confidence and importance remain proposal/ranking signals, never proof.

## Technical baseline

- Node.js 24.18.0
- TypeScript 6.0.3 strict mode
- pnpm 11.4.0
- Zod 4.4.3
- built-in `node:sqlite`
- local SHA-256 content-addressed artifact storage
- Vitest, GitHub Actions, Biome

No new runtime dependency is authorized for OL-025.

## OL-025 placement

- release, installation, runtime-state, runtime-control, compatibility, and Hook-installation contracts belong in `packages/contracts/src/local-installation.ts`;
- the serialized bounded production pump, accepted processor composition, startup recovery, runtime state, status/shutdown routes, and installed daemon entrypoint belong in `apps/daemon/src/runtime/`;
- the deterministic package builder, per-user installer, safe Claude settings merge/removal, runtime client, stable launchers, CLI, ACL boundary, and uninstall transaction belong in `tools/local-installer/`;
- the fail-open Hook Adapter remains in `tools/hook-adapter/` and receives port/token only through its short-lived process environment;
- architecture policy belongs in ADR-0027.

Do not add a migration, second listener, Windows Service, scheduled task, startup autorun, admin/system-wide install, registry dependency, auto-update, remote bind, CORS, persisted provider key, browser storage, cloud state, analytics, telemetry, billing, accounts, or new production dependency.

## Installation and runtime invariants

- Support exactly native Windows 10/11 x64, PowerShell 5.1+, Node.js 24.18.0, and packaging pnpm 11.4.0.
- Keep immutable application bytes under `app/0.1.0`, stable launchers under `bin`, credentials under `config`, durable SQLite/artifacts under `data`, and ephemeral process state under `run`.
- Treat all injected paths as untrusted. Require absolute canonical non-overlapping layout paths and reject symlinks, junctions/reparse points, traversal, unexpected entries, and ambiguous partial installations before mutation.
- Verify every packaged and installed file by canonical path, size, SHA-256, and manifest fingerprint.
- Never trust PID alone. Bind status and shutdown to install ID, instance ID, PID, process-start identity, version tuple, loopback port, and an authenticated status response.
- Publish runtime state only after a real `127.0.0.1` bind. Runtime state contains no credential, analyzed path, prompt, source identifier, provider configuration, or user data.
- Run stale-Run recovery before starting the ordinary pump.
- Keep the pump single-process, serialized, non-overlapping, bounded, idle-delay based, abortable, and limited to accepted processors in dependency order.
- Provider-disabled state must make zero provider transport calls. Candidate validation remains able to process prior pending generations.
- Installation credentials are generated once from at least 32 random bytes each, stored only in `config/secrets-v1.json`, and protected by a verified current-user-only ACL. Provider keys remain memory-only.
- Claude settings contain only the stable Hook launcher command. They contain no port, token, HMAC key, project path, provider state, or versioned executable path.
- Hook merge/removal must preserve unknown settings and non-OwnLoop Hooks, detect duplicate JSON keys, reject ambiguous OwnLoop-like entries, back up before mutation, and remove only exact records bound to the fixed installed launcher.
- Start succeeds only after authenticated exact healthy status is observed. Stop succeeds only after strict shutdown acknowledgement and removal of the exact runtime state. No force-kill mode exists.
- Browser open accepts only `http://127.0.0.1:<validated-port>/` returned by verified status.
- Reinstall preserves credentials and durable data. Uninstall requires an explicit preserve/remove-data choice; data removal additionally requires exact install-ID confirmation.
- The Hook launcher is silent, no-output, no-retry, bounded, and fail-open for every stopped, stale, malformed, incompatible, timeout, or delivery-failure state.

## Quality gates

Before completion run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm package:windows
```

Focused OL-025 tests must prove strict contracts and extra-field rejection; deterministic manifest integrity; exact compatibility; real persistence/artifact/server composition; state-after-bind and startup rollback; authenticated runtime control; PID-reuse/stale-state handling; deterministic pump order, failure isolation, later-cycle recovery, provider abort, and bounded shutdown; real Hook-to-validation pipeline; startup stale-Run recovery; provider-disabled zero calls; secret generation and ACL verification; package exclusions; fresh/reinstall/interrupted-staging/ambiguous-layout behavior; exact nine-Hook merge, backup, repair, and removal; silent installed launcher behavior; start/status/open/stop; uninstall rollback and explicit data choice; clean Windows package smoke; and full repository regression.

Never claim a check passed unless it completed successfully. A mock package-builder test is not a substitute for a real frozen-install package build and Windows smoke run.

## Git and Pull Request discipline

- Base implementation on `agent/ol-025-windows-installation` from the exact OL-024 merge commit `e0088aba9e45b51905903d3ed4d41a37bed71497`.
- Make focused commits and leave the final diff free of transfer/export workflows and payload fragments.
- Do not push directly to `main`.
- Keep PR #72 draft until clean-checkout CI, package smoke, privacy audit, and final review pass.
- Merge only with the exact reviewed head SHA.

## Current phase restriction

The active issue is `OL-025: Package Windows installation and Claude Code Hook setup` (#71).

OL-025 is complete only when the accepted modules run as one verified per-user Windows product without weakening local privacy, fail-open Hook behavior, evidence integrity, exact identity binding, data preservation, or deterministic processing. WSL/macOS/Linux packages, MSI/MSIX, bundled Node, code signing, keychain integration, service/autorun, force-stop, auto-update, remote access, and multi-user behavior remain deferred.
