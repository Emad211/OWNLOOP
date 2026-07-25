# Moment interactions

This module owns OL-021's explicit durable interaction boundary.

## Input boundary

A caller supplies one strict `MomentInteractionRequestV1` for an exact Run, validation ID, and deterministic OL-020 Moment display ID. Before any write, the processor regenerates the exact validation projection and verifies the Moment source index, source Candidate fingerprint, type, Evidence membership, and Check-choice membership.

## Persistence semantics

- every intentional action appends one immutable `moment_interactions` row;
- exact retries reuse the same interaction ID and return the original receipt;
- conflicting reuse of an interaction ID is rejected;
- acknowledgement, Decision/Risk response, Check answer, and usefulness actions atomically create one immutable `ownership_records` row;
- Moment and Evidence views create no Ownership Record;
- current state is derived from append-only history using `created_at ASC, interaction_id ASC`;
- recent response history is bounded, while total counts remain exact;
- direct mutation/deletion is rejected while full Task Run deletion cascades normally.

An Ownership Record carries only `interaction_recorded` and `noComprehensionClaim: true`. It never asserts understanding, correctness, agreement, authorship, safety, learning, or legal ownership.

## Explicit non-ownership

The module does not read repository/source content, invoke a provider, generate or validate Candidates, mutate the Evidence Graph, create artifacts, accept free-form text, manage accounts, use browser storage, or run background work.
