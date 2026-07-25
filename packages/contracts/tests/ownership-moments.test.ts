import { OwnershipMomentsProjectionV1Schema } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

const unavailable = {
  ok: true,
  schemaVersion: 1,
  projectionVersion: "0.1.0",
  runId: "run-1",
  outcome: "not_available",
  diagnosticCode: "validation_not_available",
  limitations: [],
  finalizationId: null,
  generationId: null,
  validationId: null,
  validationKey: null,
  sourceCandidateArtifactId: null,
  sourceCandidateFingerprint: null,
  reportArtifactId: null,
  reportFingerprint: null,
  evidenceGraphArtifactId: null,
  evidenceGraphInputFingerprint: null,
  sourceVersions: null,
  policyVersions: null,
  selectedCount: 0,
  moments: [],
} as const;

describe("Ownership Moment contracts", () => {
  it("accepts an explicit not-available read-only projection", () => {
    expect(OwnershipMomentsProjectionV1Schema.parse(unavailable)).toEqual(unavailable);
  });

  it("rejects extra fields and unavailable projections with output", () => {
    expect(() =>
      OwnershipMomentsProjectionV1Schema.parse({ ...unavailable, providerResponse: "hidden" }),
    ).toThrow();
    expect(() =>
      OwnershipMomentsProjectionV1Schema.parse({
        ...unavailable,
        sourceCandidateArtifactId: "candidate-1",
      }),
    ).toThrow();
  });
});
