import { SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import { PersistenceError } from "../persistence/index.js";
import { parseCanonicalSemanticAnalysisInput } from "./artifact.js";
import { prepareDeterministicSemanticAnalysisInput } from "./reducer.js";
import {
  runEvidenceId,
  semanticInputFixture,
  unavailableSemanticInputFixture,
  verificationEvidenceId,
} from "./test-fixture.js";

describe("semantic-analysis input reducer", () => {
  it("produces deterministic evidence-addressed canonical bytes", () => {
    const input = semanticInputFixture();
    const first = prepareDeterministicSemanticAnalysisInput(input);
    const second = prepareDeterministicSemanticAnalysisInput(input);
    if (!("bytes" in first) || !("bytes" in second)) throw new Error("expected ready input");

    expect(first.bytes).toEqual(second.bytes);
    expect(first.value).toMatchObject({
      outcome: "ready",
      diagnosticCode: null,
      classificationArtifactId: "classification-1",
      classificationInputFingerprint: "a".repeat(64),
      sourceVersions: {
        changeClassification: { schemaVersion: 1 },
        verificationEvidence: { schemaVersion: 1 },
        evidenceGraph: { schemaVersion: 1 },
      },
      graphContext: { runEvidenceId },
      goal: { evidenceId: runEvidenceId },
      verificationExcerpts: [
        {
          evidenceId: verificationEvidenceId,
          verificationKind: "test",
          observedStatus: "passed",
        },
      ],
    });
    expect(first.value.goal?.text).toContain("[REDACTED_URL]");
    expect(first.value.goal?.text).toContain("package.json");
    expect(first.value.verificationExcerpts[0]?.text).toContain("[REDACTED_PATH]");
    expect(first.canonicalJson).not.toContain("/home/alice/project");
    expect(first.canonicalJson).not.toContain("secret=hidden");
    expect(parseCanonicalSemanticAnalysisInput(first.bytes)).toEqual(first.value);
  });

  it("returns unavailable without inventing evidence for an unavailable graph", () => {
    expect(prepareDeterministicSemanticAnalysisInput(unavailableSemanticInputFixture())).toEqual({
      outcome: "unavailable",
      diagnosticCode: "source_unavailable",
      limitations: [],
    });
  });

  it("rejects inconsistent classification and terminal source identity", () => {
    const fixture = semanticInputFixture();
    expect(() =>
      prepareDeterministicSemanticAnalysisInput({
        ...fixture,
        verification: {
          ...fixture.verification,
          classificationArtifactId: "classification-other",
        },
      }),
    ).toThrow(PersistenceError);
    expect(() =>
      prepareDeterministicSemanticAnalysisInput({
        ...fixture,
        finalization: { ...fixture.finalization, terminalStatus: "Failed" },
      }),
    ).toThrow(PersistenceError);
    expect(() =>
      prepareDeterministicSemanticAnalysisInput({
        ...fixture,
        evidenceGraph: {
          ...fixture.evidenceGraph,
          nodes: fixture.evidenceGraph.nodes.map((node) =>
            node.kind === "run"
              ? { ...node, metadata: { ...node.metadata, terminalStatus: "Failed" } }
              : node,
          ),
        },
      }),
    ).toThrow(PersistenceError);
  });

  it("applies deterministic priority truncation while retaining Run and finalization evidence", () => {
    const fixture = semanticInputFixture();
    const rules = Array.from({ length: 2_100 }, (_, index) => ({
      evidenceId: `ev_${(index + 100).toString(16).padStart(48, "0")}`,
      kind: "classification_rule" as const,
      locator: {
        kind: "classification_rule" as const,
        artifactId: "classification-1",
        ruleId: `rule.${index.toString().padStart(4, "0")}`,
      },
      metadata: {
        ruleId: `rule.${"x".repeat(110)}${index.toString().padStart(4, "0")}`,
        ruleEvidenceKind: "path_pattern" as const,
      },
    }));
    const crowded = {
      ...fixture,
      evidenceGraph: {
        ...fixture.evidenceGraph,
        nodes: [...fixture.evidenceGraph.nodes, ...rules],
      },
    };

    const first = prepareDeterministicSemanticAnalysisInput(crowded);
    const second = prepareDeterministicSemanticAnalysisInput(crowded);
    if (!("bytes" in first) || !("bytes" in second)) throw new Error("expected partial input");

    expect(first.bytes).toEqual(second.bytes);
    expect(first.bytes.byteLength).toBeLessThanOrEqual(SEMANTIC_ANALYSIS_MAX_ARTIFACT_BYTES);
    expect(first.value).toMatchObject({
      outcome: "partial",
      diagnosticCode: "budget_truncated",
      limitations: ["budget_truncated"],
    });
    expect(first.value.aggregates.droppedSummaryCount).toBeGreaterThan(0);
    expect(first.value.evidenceSummaries.some((summary) => summary.kind === "run")).toBe(true);
    expect(first.value.evidenceSummaries.some((summary) => summary.kind === "finalization")).toBe(
      true,
    );
  });

  it("excludes unknown-command output from model-visible excerpts", () => {
    const fixture = semanticInputFixture();
    const prepared = prepareDeterministicSemanticAnalysisInput({
      ...fixture,
      verification: {
        ...fixture.verification,
        commandObservations: fixture.verification.commandObservations.map((observation) => ({
          ...observation,
          kind: "unknown" as const,
          ruleId: "unknown.unsupported_command",
          toolFamily: "unknown" as const,
          status: "unknown" as const,
          verificationEventId: null,
          reducedOutputs: observation.reducedOutputs.map((output) => ({
            ...output,
            excerpt: "SHOULD_NOT_BE_MODEL_VISIBLE",
          })),
        })),
      },
    });
    if (!("bytes" in prepared)) throw new Error("expected prepared input");
    expect(prepared.value.verificationExcerpts).toEqual([]);
    expect(prepared.canonicalJson).not.toContain("SHOULD_NOT_BE_MODEL_VISIBLE");
  });
});
