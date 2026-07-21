# Git reconciliation

OL-009 observes repository state at normalized tool-batch, Stop, and StopFailure boundaries.
It uses bounded, shell-free, read-only Git commands; parses porcelain v2 status into controlled
metadata; compares the current deterministic fingerprint with the OL-008 baseline; and persists
summary/file Events atomically with explicit attribution.

Attribution is deliberately evidence-bounded:

- `run_relative` requires a complete clean baseline and complete current observation;
- `observed_only` describes current state when the captured baseline was already dirty;
- `unavailable` is used for missing or partial evidence.

A second status checkpoint is compared with the fingerprint capture so repository changes between
observation and attribution become controlled partial evidence rather than a false ownership claim.

Raw status/diff bytes and tracked file content are never persisted. Sensitive paths retain only a
versioned path identity digest and have a null relative path.
