import { describe, expect, it } from "vitest";

import { canonicalCandidateMomentBatch, parseCanonicalCandidateMomentBatch } from "./artifact.js";
import { decisionCandidate } from "./test-fixture.js";

describe("Candidate batch artifact", () => {
  it("round-trips canonical validated bytes including a zero-Candidate batch", () => {
    const prepared = canonicalCandidateMomentBatch({ schemaVersion: 1, candidates: [] });
    expect(parseCanonicalCandidateMomentBatch(prepared.bytes)).toEqual(prepared);
  });

  it("enforces the v0.1 product maximum independently from OL-016", () => {
    expect(() =>
      canonicalCandidateMomentBatch({
        schemaVersion: 1,
        candidates: Array.from({ length: 8 }, decisionCandidate),
      }),
    ).toThrow();
  });

  it("rejects non-canonical persisted bytes", () => {
    const text = JSON.stringify({ candidates: [], schemaVersion: 1 }, null, 2);
    expect(() => parseCanonicalCandidateMomentBatch(new TextEncoder().encode(text))).toThrow();
  });
});
