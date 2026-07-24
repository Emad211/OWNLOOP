# Candidate validation boundary

OL-019 deterministically validates one verified OL-018 Candidate batch against the exact OL-015 Evidence Graph. It resolves Evidence IDs, applies a conservative controlled-fact grammar, rejects unsupported absence and contradictions, groups deterministic duplicates, computes integer ranking components, and selects at most seven source Candidates.

The validation report contains no Candidate text, path, command, source content, prompt, provider response, or artifact storage metadata. OL-020 may join selected source indexes with the separately verified Candidate artifact.

This module performs no provider/model/network call, embedding, repository/source read, Event emission, background processing, scheduling, or UI work.
