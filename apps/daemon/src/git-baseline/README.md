# OwnLoop Git baseline capture

OL-008 captures one privacy-bounded, read-only Git baseline per Task Run.

Git and filesystem observation occurs before the SQLite transaction. Only deterministic hashes, controlled metadata, bounded untracked-entry records, and one synthetic `snapshot.baseline_captured` Event are persisted.

Raw diffs, raw status output, sensitive filenames, file content, Git stderr, and absolute repository paths never appear in safe results, evidence-gap details, or Event payloads.

A partial baseline records one evidence gap but does not change the active Task Run lifecycle status. Terminal `Partial` remains an OL-011 finalization decision.

The capture path never runs a Git mutation command and never follows symlinks for content hashing.
