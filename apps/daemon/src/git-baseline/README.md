# OwnLoop Git baseline capture

OL-008 captures one privacy-bounded, read-only Git baseline per Task Run.

Git and filesystem observation occurs before the SQLite transaction. Only deterministic hashes, controlled metadata, bounded untracked-entry records, and one synthetic `snapshot.baseline_captured` Event are persisted.

Raw diffs, raw status output, sensitive filenames, file content, Git stderr, and absolute repository paths never appear in safe results, evidence-gap details, or Event payloads.

A partial baseline records one evidence gap but does not change the active Task Run lifecycle status. Terminal `Partial` remains an OL-011 finalization decision.

## Read-only execution guarantees

- Git is invoked without a shell and always receives fixed read-only command families.
- Repository-local fsmonitor and untracked-cache acceleration are disabled for capture commands so hidden background helpers cannot change the observation boundary.
- Output size and command duration are bounded.
- Raw diff and status bytes are streamed into SHA-256 and discarded.
- Symlinks are never followed for content hashing; only the link-target string may be hashed.
- Sensitive untracked paths are persisted as path digests only and their content is never read.

## Transaction and lifecycle guarantees

Baseline rows, ordered untracked-entry rows, Workspace Git-identity upgrade, write-once Task Run baseline fields, one optional evidence gap, the synthetic baseline Event, Event deduplication, and Run sequence allocation commit in one SQLite transaction.

A failed transaction leaves no baseline, evidence gap, Event, deduplication row, Workspace upgrade, Task Run update, or sequence gap.

Baseline/Event foreign keys use Task Run cascade semantics, so deleting a Run cannot be blocked by its own synthetic baseline Event. Reprocessing a Run with an existing baseline performs no Git work, consumes no sequence, and increments no evidence counter.

The capture path never runs a Git mutation command, merges Workspaces, follows symlinks for content reads, performs post-tool reconciliation, or terminally finalizes a Run.
