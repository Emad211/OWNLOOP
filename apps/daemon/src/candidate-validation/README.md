# Candidate validation boundary

OL-019 deterministically validates one verified OL-018 Candidate batch against the exact OL-015 Evidence Graph. It resolves Evidence IDs, applies a conservative controlled-fact grammar, rejects unsupported absence and contradictions, groups deterministic duplicates, computes integer ranking components, and selects at most seven source Candidates.

## Validation policy

Candidate type, interaction shape, Evidence identifiers, and bounded fields are parsed through the strict OL-016 runtime contract before validation. Evidence is expanded only through controlled OL-015 relationships; a generic Run citation does not implicitly include sibling gaps or unrelated facts. Duplicate grouping preserves the original Candidate prose and records one representative source index rather than merging or rewriting provider output.

Selection is deterministic and evidence-dominant. At most seven distinct supported source Candidates are selected; zero selected Candidates remains a valid result. Provider confidence and importance affect only bounded integer ranking and are never treated as proof.

The validation report contains no Candidate text, path, command, source content, prompt, provider response, or artifact storage metadata. OL-020 may join selected source indexes with the separately verified Candidate artifact.

This module performs no provider/model/network call, embedding, repository/source read, Event emission, background processing, scheduling, or UI work.
