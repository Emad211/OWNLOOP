# ADR-0011: Reconcile Git State With Evidence-Bounded Attribution

**Status:** Proposed  
**Date:** 2026-07-21  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0009-transactional-event-normalization-and-sequencing.md`
- `docs/adr/0010-privacy-bounded-deterministic-git-baseline.md`
- GitHub issue #23

---

## Context

OwnLoop now has:

- lifecycle-resolved Task Runs;
- append-only sequenced source Events;
- one privacy-bounded Git baseline per Run.

The next requirement is to observe actual repository state after meaningful agent boundaries and connect that evidence to the Run timeline.

Tool intent is not proof of repository state. A successful Write/Edit/Bash Hook can describe an operation that:

- made no change;
- changed additional files indirectly;
- changed files outside the described tool input;
- operated on a repository that was already dirty;
- raced with another process.

Repository reconciliation therefore observes Git state independently of tool descriptions.

The central correctness risk is over-attribution. A current dirty path is not automatically an agent-created change. If the baseline already contained changes, current `git status` can include pre-existing work that OwnLoop cannot separate path-by-path because OL-008 intentionally stores deterministic fingerprints rather than raw tracked-path snapshots or source content.

The Git porcelain v2 format is stable for machine parsing, but tracked-entry output order is not defined. OwnLoop must parse the format conservatively and sort controlled records before persistence.

---

## Decision

OwnLoop will capture one immutable reconciliation snapshot for each eligible normalized trigger Event:

- `tool.batch_completed`;
- `run.stop_observed`;
- `run.stop_failed`.

The reconciliation path is:

```text
eligible Run-level trigger Event
→ bounded read-only Git observation
→ parse current porcelain-v2 status
→ compare current fingerprint with baseline
→ assign evidence-bounded attribution
→ persist reconciliation, changed-path metadata, evidence, and Events atomically
```

No lifecycle state is changed by OL-009.

## Eligible boundary semantics

Trigger mapping:

| Trigger Event | Boundary |
|---|---|
| `tool.batch_completed` | `tool_batch` |
| `run.stop_observed` | `stop` |
| `run.stop_failed` | `stop_failure` |

Each trigger Event may own at most one reconciliation.

A trigger must:

- have a non-null Run and sequence;
- belong to the same Run, Conversation, and Workspace as the reconciliation;
- have one of the controlled Event types above.

A non-eligible or conversation-level Event is rejected without Git execution.

## Current Git observation

OL-009 reuses the OL-008 read-only Git runner and bounded working-tree observation.

It also obtains one current machine status snapshot:

```text
git -C <repository-root> status --porcelain=v2 -z --untracked-files=all --no-renames
```

Reasons for `--no-renames`:

- removes repository/user rename-detection configuration from the boundary;
- avoids similarity-threshold ambiguity;
- makes rename behavior conservative and explainable as deletion/addition observations;
- simplifies strict bounded parsing.

Raw status bytes are held only long enough to parse controlled path metadata and are then released. They are never persisted, logged, returned, or included in Event payloads.

## Porcelain-v2 parser

OL-009 supports:

- ordinary tracked record `1`;
- unmerged record `u`;
- untracked record `?`.

Unexpected headers are ignored only when they begin with `#` and conform to the extensible header rule. Unsupported data records, malformed fields, invalid UTF-8, missing NUL terminators, absolute paths, traversal, or malformed status codes produce controlled partial diagnostic `invalid_status_output`.

Git does not define tracked-entry output order. Parsed entries are sorted by controlled path identity and metadata before persistence and Event generation.

## Changed-path privacy policy

For each status path OwnLoop computes:

```text
SHA-256("ownloop-reconciliation-path-v1\0" + normalized-relative-path)
```

Stored fields:

- path identity SHA-256;
- nullable safe relative path;
- controlled change kind;
- staged boolean;
- unstaged boolean;
- sensitivity;
- attribution.

Sensitive path recognition reuses ADR-0010 policy.

For a sensitive path:

- relative path is null;
- path identity remains available;
- no content is read;
- no filename appears in results, evidence, or Event payloads.

OL-009 does not read tracked file content and does not persist raw diffs.

## Change-kind policy

Controlled kinds:

- `created`;
- `modified`;
- `deleted`;
- `type_changed`;
- `unmerged`.

For ordinary porcelain records, staged and unstaged status codes are interpreted independently. The summary change kind uses conservative precedence:

```text
unmerged
→ deleted
→ created
→ type_changed
→ modified
```

Untracked records map to `created` with staged false and unstaged true.

Rename detection is disabled, so a rename may appear as controlled deletion and creation observations.

## Attribution policy

Attribution is a persisted controlled contract:

- `run_relative`;
- `observed_only`;
- `unavailable`.

### Run-relative

`run_relative` is permitted only when:

- baseline outcome is captured;
- baseline has zero staged, unstaged, and untracked state;
- current observation is complete;
- both working-tree fingerprints are reliable.

In this case current status entries are evidence of changes relative to a clean Run baseline.

### Observed-only

`observed_only` is used when:

- baseline is captured but was already dirty or contained untracked entries;
- current observation is complete.

These entries describe current repository state only. They are not claims that the agent created the changes.

### Unavailable

`unavailable` is used when:

- baseline is missing;
- baseline is partial;
- current observation is partial;
- reliable comparison is unavailable.

OwnLoop may retain controlled observed status entries, but downstream UI or replay must not attribute them to the Run.

## Baseline comparison

Controlled values:

- `unchanged`;
- `changed`;
- `unavailable`.

When baseline and current reliable fingerprints exist:

- equality means `unchanged`;
- inequality means `changed`.

Otherwise comparison is unavailable.

When comparison is unchanged, OL-009 emits only the reconciliation summary Event and no file Events. This prevents repeated pre-existing dirty paths from appearing as new Run changes.

When comparison is changed or unavailable, controlled status entries may produce file observation Events carrying the reconciliation attribution.

## Entry limits

Maximum parsed status entries:

```text
2,000
```

Exceeding the limit produces partial diagnostic `status_entry_limit_exceeded`.

OwnLoop may persist the first deterministic 2,000 controlled entries, but must expose partial outcome and must not claim completeness.

## Persistence model

Migration v6 adds:

- `git_reconciliations`;
- `git_reconciliation_entries`;
- immutable update triggers;
- indexes for Run, trigger Event, capture time, and entry path identity.

Migrations 1–5 remain unchanged.

### Reconciliation row

One row per trigger Event stores:

- aggregate ownership;
- baseline reference when available;
- trigger and summary Event references;
- boundary;
- captured/partial outcome and controlled diagnostic;
- attribution and baseline comparison;
- canonical repository root;
- current controlled Git hashes and dirty flags;
- controlled entry counts;
- capture timestamp.

### Entry rows

Each entry stores:

- zero-based deterministic index;
- unique file Event reference;
- path identity SHA-256;
- nullable safe relative path;
- change kind;
- staged/unstaged booleans;
- sensitivity;
- attribution.

Repository reads verify entry count and contiguous indices.

Rows are immutable.

## Reconciliation Events

Each reconciliation appends one summary Event:

```text
git.diff_computed
```

The summary is Run-level and receives the next Run sequence.

Controlled payload:

- reconciliation ID;
- boundary;
- outcome;
- diagnostic code;
- attribution;
- baseline comparison;
- HEAD-changed boolean or null;
- staged/unstaged dirty booleans;
- controlled change counts.

No repository path, commit ID, Git hash, raw output, filename, diff, or content is included.

When baseline comparison is not unchanged, each stored changed-path entry appends one:

```text
file.change_observed
```

Controlled payload:

- reconciliation ID;
- path identity SHA-256;
- nullable safe relative path;
- change kind;
- staged/unstaged booleans;
- attribution.

Sensitive paths have null relative path.

## Sequence and deduplication

Events are emitted in this order:

1. summary Event;
2. file Events in deterministic entry order.

All receive contiguous Run sequences inside one transaction.

Deduplication keys:

```text
v1:git-reconciliation:<trigger-event-id>:summary
v1:git-reconciliation:<trigger-event-id>:entry:<entry-index>
```

The trigger Event ID is a safe internal identifier; no source session ID, path, content, or fingerprint is embedded.

## Evidence gaps

A partial reconciliation inserts one controlled evidence gap and increments the Run evidence count once.

The Run lifecycle status remains unchanged.

Evidence details are null. Controlled messages do not contain paths, hashes, Git output, filenames, exceptions, or stacks.

## Atomicity

Git/filesystem observation occurs outside SQLite.

The persistence transaction includes:

- summary Event;
- optional file Events;
- Event deduplication rows;
- reconciliation row;
- reconciliation entry rows;
- optional evidence gap;
- evidence counter;
- sequence allocation.

Any failure rolls back all writes and leaves no sequence gap.

## Idempotency

`trigger_event_id` is unique.

Reprocessing an existing reconciliation:

- returns the persisted safe result and Event IDs;
- performs no Git command;
- appends no Event;
- consumes no sequence;
- increments no evidence gap.

## API boundary

OL-009 exposes explicit asynchronous APIs:

- reconcile one eligible trigger Event;
- get a reconciliation and ordered entries/Event IDs;
- list unreconciled eligible trigger Event IDs;
- reconcile a bounded batch sequentially.

Maximum batch:

```text
25 trigger Events
```

No worker, timer, startup scan, or scheduler is added.

Safe results contain only internal IDs, controlled outcome/diagnostic/attribution/comparison values, Event IDs, controlled counts, and timestamp.

## Alternatives considered

### Treat every current status path as an agent change

Rejected because a dirty baseline contains pre-existing work.

### Store raw status or diff

Rejected because they can contain proprietary code, secrets, personal data, and sensitive filenames.

### Enable rename detection

Rejected for v0.1 because similarity heuristics and repository configuration reduce determinism. Conservative add/delete observations are safer.

### Emit file Events when the fingerprint is unchanged

Rejected because unchanged dirty baseline paths would be repeatedly presented as new changes.

### Reconcile inside the Hook request

Rejected because Git/filesystem work would extend Hook latency and hold the capture critical path.

### Mutate lifecycle during reconciliation

Rejected because repository evidence and lifecycle boundaries are separate concerns. OL-011 owns finalization.

## Consequences

### Positive

- actual repository state is separated from tool claims;
- attribution strength is explicit and evidence-bounded;
- clean baselines support strong Run-relative changed-path claims;
- dirty baselines remain useful without false attribution;
- sensitive paths remain private;
- Event ordering and persistence are deterministic and idempotent.

### Negative

- exact tracked-path delta from a dirty baseline is unavailable;
- conservative rename handling creates add/delete pairs;
- large status sets may become partial;
- each changed path creates an Event and database row;
- synchronous persistence briefly blocks the daemon event loop.

## Accepted risks

- observed-only entries can contain pre-existing paths but are explicitly labeled;
- unavailable attribution may still retain controlled path observations;
- repository state may change after reconciliation; later snapshots represent later boundaries rather than updating prior immutable records.

## Implementation constraints

OL-009 must not implement:

- Git mutation;
- raw Git output persistence;
- lifecycle transitions;
- final snapshot or terminal finalization;
- Workspace merging;
- artifact storage;
- background workers/schedulers;
- Hook transport changes;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or user authentication.

## Validation

The decision is validated when tests prove:

- migration v6 constraints and immutability;
- strict porcelain-v2 parsing and deterministic sort;
- evidence-bounded attribution;
- unchanged suppression of file Events;
- all three trigger boundaries;
- contiguous sequence allocation and rollback;
- idempotent reprocessing;
- privacy-safe Event/result/evidence surfaces;
- file-backed durability;
- standard quality gates.

## Reversibility

Reconciliation schema and attribution policy are versioned. Adding exact dirty-baseline path deltas, rename inference, raw artifacts, or different trigger boundaries requires a new or superseding ADR.

## References

- Git status porcelain format: <https://git-scm.com/docs/git-status>
- Git diff: <https://git-scm.com/docs/git-diff>
