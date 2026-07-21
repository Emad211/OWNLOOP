# OwnLoop lifecycle resolution

This directory owns the transactional mapping from durable prepared ingress receipts to OwnLoop's Workspace, Agent Conversation, and Task Run aggregates.

## Critical path

```text
pending prepared receipt
→ provisional Workspace
→ Conversation create/infer/reactivate/end
→ Run create/associate/finalize/abandon
→ one receipt lifecycle resolution
→ receipt processed or failed
```

All aggregate mutations, the lifecycle-resolution row, and the receipt status change commit in one SQLite transaction.

Processing the same receipt again returns its stored resolution and does not replay lifecycle transitions.

## Provisional Workspace identity

Before OL-008 performs Git discovery, a Workspace is identified explicitly through:

- the prepared receipt's canonical Workspace path;
- `repositoryRoot` equal to that path provisionally;
- no Git remote;
- a non-reversible `path-sha256:` digest;
- `identityBasis = canonical_path_v1`.

This is not a Git baseline claim. Existing pre-migration rows remain `legacy`, and later Git work may upgrade the identity basis through a controlled migration/transition.

## Conversation lifecycle

Conversation identity is `(source, sourceSessionId)`.

- Missing `SessionStart` may be recovered through an inferred active Conversation.
- `SessionStart` creates or reactivates a Conversation.
- A source session cannot move to another Workspace.
- Non-start activity on an Ended Conversation fails safely until a later `SessionStart` reactivates it.
- `SessionEnd` closes the Conversation, abandons Capturing Runs, and preserves Finalizing Runs.

## Task Run lifecycle

- Every distinct `UserPromptSubmit` receipt starts a sequential Run.
- A new prompt abandons the prior Capturing Run with `superseded_by_prompt`.
- Tool receipts associate with the latest Capturing or Finalizing Run.
- `Stop` and `StopFailure` move a Capturing Run into Finalizing and remain idempotent for an already-Finalizing Run.
- Completed, Partial, and Failed finalization outcomes remain outside OL-006.

Only the canonical redacted payload is parsed. The processor extracts the minimum safe lifecycle fields and never accesses unredacted source content.

## Durable resolution contract

Each ingress receipt has at most one `receipt_lifecycle_resolutions` row containing only safe IDs and controlled values:

- outcome: `applied`, `associated`, or `failed`;
- lifecycle action;
- optional stable diagnostic code;
- resolution timestamp.

Failed resolutions may omit aggregate IDs when safe resolution was impossible. Non-failed resolutions require a valid Workspace and Conversation relationship; Run-level actions require a valid Run relationship.

Resolution rows are immutable.

## Explicit non-ownership

OL-006 does not create or own:

- normalized Events;
- Event deduplication records;
- per-Run sequence allocation;
- Git repository discovery, baseline, status, diff, or reconciliation;
- final snapshots or Completed/Partial finalization;
- automatic stale recovery transitions;
- artifacts;
- background workers;
- Hook transport;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

Stale Capturing and Finalizing Runs are only discoverable here; recovery policy belongs to OL-011.
