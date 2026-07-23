import {
  DeterministicEvidenceGraphV1Schema,
  EvidenceResolutionV1Schema,
} from "../src/evidence-graph.js";
import { describe, expect, it } from "vitest";

const fingerprint = "a".repeat(64);

describe("Evidence Graph contracts", () => {
  it("accepts a strict empty unavailable graph and rejects forbidden fields", () => {
    const value = {
      schemaVersion: 1,
      builderVersion: "0.1.0",
      taxonomyVersion: "ownloop-evidence-graph-v1",
      runId: "run-1",
      finalizationId: "finalization-1",
      classificationArtifactId: "classification-1",
      classificationInputFingerprint: fingerprint,
      verificationArtifactId: "verification-1",
      verificationInputFingerprint: fingerprint,
      sourceEventCount: 0,
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: [],
      inputFingerprint: fingerprint,
      nodes: [],
      edges: [],
      nodeKindCounts: [],
      edgeTypeCounts: [],
    } as const;
    expect(DeterministicEvidenceGraphV1Schema.parse(value)).toEqual(value);
    expect(
      DeterministicEvidenceGraphV1Schema.safeParse({ ...value, repositoryRoot: "/private" })
        .success,
    ).toBe(false);
  });

  it("rejects dangling edges and accepts strict Run-scoped resolution", () => {
    const node = {
      evidenceId: `ev_${"1".repeat(48)}`,
      kind: "run",
      locator: { kind: "run", runId: "run-1" },
      metadata: { outcome: "Completed", terminalStatus: "Completed" },
    } as const;
    const invalid = {
      schemaVersion: 1,
      builderVersion: "0.1.0",
      taxonomyVersion: "ownloop-evidence-graph-v1",
      runId: "run-1",
      finalizationId: "finalization-1",
      classificationArtifactId: "classification-1",
      classificationInputFingerprint: fingerprint,
      verificationArtifactId: "verification-1",
      verificationInputFingerprint: fingerprint,
      sourceEventCount: 0,
      outcome: "complete",
      diagnosticCode: null,
      limitations: [],
      inputFingerprint: fingerprint,
      nodes: [node],
      edges: [
        {
          edgeId: `ed_${"2".repeat(48)}`,
          type: "run_contains",
          sourceEvidenceId: node.evidenceId,
          targetEvidenceId: `ev_${"3".repeat(48)}`,
        },
      ],
      nodeKindCounts: [{ kind: "run", count: 1 }],
      edgeTypeCounts: [{ kind: "run_contains", count: 1 }],
    } as const;
    expect(DeterministicEvidenceGraphV1Schema.safeParse(invalid).success).toBe(false);

    expect(
      EvidenceResolutionV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        runId: "run-1",
        evidenceId: node.evidenceId,
        nodeKind: "run",
        graphOutcome: "complete",
        limitations: [],
        anchor: { kind: "run", sectionId: "run-summary", sourceId: "run-1" },
      }),
    ).toBeTruthy();
  });
});
