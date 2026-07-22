# OwnLoop Run finalization and recovery

This boundary seals accepted baseline/reconciliation evidence into one terminal Run state.

- Final manifests contain controlled reconciliation metadata only and are materialized through OL-010.
- Manifest bytes are prepared outside SQLite; the Run reference is linked inside the finalization transaction.
- Final snapshot and terminal Events use contiguous Run sequences.
- Missing evidence produces explicit `Partial`, `Failed`, or `Abandoned` outcomes rather than inferred completeness.
- Startup recovery is explicit and bounded. It never invokes or resumes Claude Code.
- Raw Git output, content, repository roots, commit IDs, prompts, source identifiers, exceptions, and stacks are excluded from manifests, Events, evidence messages, and safe results.
