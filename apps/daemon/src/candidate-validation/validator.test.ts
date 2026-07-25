import { DeterministicEvidenceGraphV1Schema } from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import { buildCandidateValidationReport } from "./validator.js";
import {
  CHANGE_CANDIDATE,
  CHANGE_EVIDENCE,
  CHECK_CANDIDATE,
  DECISION_CANDIDATE,
  FINALIZATION_EVIDENCE,
  GAP_EVIDENCE,
  LABEL_EVIDENCE,
  RISK_CANDIDATE,
  RUN_EVIDENCE,
  candidateBatch,
  validatorInput,
} from "./test-fixture.js";

function item(result: ReturnType<typeof buildCandidateValidationReport>, index: number) {
  const value = result.value.items[index];
  if (value === undefined) throw new Error("missing item");
  return value;
}

describe("Candidate validation", () => {
  it("selects supported Candidates with deterministic integer ranking", () => {
    const first = buildCandidateValidationReport(
      validatorInput([CHANGE_CANDIDATE, DECISION_CANDIDATE, RISK_CANDIDATE, CHECK_CANDIDATE]),
    );
    const second = buildCandidateValidationReport(
      validatorInput([CHANGE_CANDIDATE, DECISION_CANDIDATE, RISK_CANDIDATE, CHECK_CANDIDATE]),
    );
    expect(first.canonicalJson).toBe(second.canonicalJson);
    expect(first.value.counts).toEqual({
      source: 4,
      rejected: 0,
      valid: 4,
      selected: 4,
      duplicate: 0,
      unselected: 0,
    });
    expect(first.value.selectedSourceIndexes).toHaveLength(4);
    expect(first.value.items.every((entry) => Number.isInteger(entry.score?.total))).toBe(true);
  });

  it("rejects unsupported absence, semantic prose, contradiction, and missing evidence", () => {
    const absence = {
      ...RISK_CANDIDATE,
      title: "No tests failed",
      claim: "No tests failed",
    };
    const semantic = {
      ...CHANGE_CANDIDATE,
      title: "Behavior file modified performance improved",
      claim: "Behavior file modified performance improved",
    };
    const contradiction = {
      ...CHANGE_CANDIDATE,
      title: "Behavior file deleted",
      claim: "Behavior file deleted",
    };
    const missing = {
      ...CHANGE_CANDIDATE,
      evidenceIds: [`ev_${"f".repeat(48)}`],
    };
    const result = buildCandidateValidationReport(
      validatorInput(candidateBatch([absence, semantic, contradiction, missing]).candidates),
    );
    expect(item(result, 0).reasons).toContain("unsupported_absence_claim");
    expect(item(result, 1).reasons).toContain("unsupported_claim_language");
    expect(item(result, 2).reasons).toContain("deterministic_contradiction");
    expect(item(result, 3).reasons).toContain("missing_evidence");
    expect(result.value.counts.selected).toBe(0);
  });

  it("groups same-type support duplicates without merging prose", () => {
    const duplicate = {
      ...CHANGE_CANDIDATE,
      title: "Behavior file updated",
      claim: "Behavior file updated",
      confidenceBasisPoints: 5000,
    };
    const result = buildCandidateValidationReport(
      validatorInput([CHANGE_CANDIDATE, duplicate, CHECK_CANDIDATE]),
    );
    expect(result.value.counts.duplicate).toBe(1);
    expect(item(result, 0).decision).toBe("valid_unselected");
    expect(item(result, 0).reasons).toEqual(["duplicate_candidate"]);
    expect(item(result, 0).representativeSourceIndex).toBe(1);
    expect(item(result, 1).decision).toBe("valid_selected");
    expect(item(result, 2).decision).toBe("valid_selected");
  });

  it("propagates a partial graph without inventing absence", () => {
    const result = buildCandidateValidationReport(validatorInput([CHANGE_CANDIDATE], "partial"));
    expect(result.value.outcome).toBe("partial");
    expect(result.value.limitations).toEqual(["source_graph_partial"]);
    expect(result.value.counts.selected).toBe(1);
  });

  it("distinguishes type-changed facts from ordinary modifications", () => {
    const input = validatorInput([]);
    const graphValue = structuredClone(input.evidenceGraph);
    const node = graphValue.nodes.find((entry) => entry.evidenceId === CHANGE_EVIDENCE);
    if (node === undefined) throw new Error("changed-file node missing");
    node.metadata.changeKind = "type_changed";
    const graph = DeterministicEvidenceGraphV1Schema.parse(graphValue);
    const candidate = {
      ...CHANGE_CANDIDATE,
      title: "File type changed",
      claim: "File type changed",
      evidenceIds: [CHANGE_EVIDENCE],
    };
    const result = buildCandidateValidationReport({
      ...input,
      candidateBatch: candidateBatch([candidate]),
      evidenceGraph: graph,
    });
    expect(item(result, 0).decision).toBe("valid_selected");
    expect(item(result, 0).reasons).toEqual([]);
  });

  it("does not infer terminal failure from a failed test assertion", () => {
    const result = buildCandidateValidationReport(validatorInput([RISK_CANDIDATE]));
    expect(item(result, 0).decision).toBe("valid_selected");
    expect(
      item(result, 0).facts.some(
        (fact) =>
          fact.kind === "verification_status" &&
          fact.verificationKind === "test" &&
          fact.observedStatus === "failed",
      ),
    ).toBe(true);
    expect(item(result, 0).facts.some((fact) => fact.kind === "terminal_status")).toBe(false);
  });

  it("rejects conflicting graph facts even when one matches the claim", () => {
    const input = validatorInput([]);
    const graphValue = structuredClone(input.evidenceGraph);
    const finalization = graphValue.nodes.find(
      (entry) => entry.evidenceId === FINALIZATION_EVIDENCE,
    );
    if (finalization === undefined) throw new Error("finalization node missing");
    finalization.metadata.terminalStatus = "Failed";
    const graph = DeterministicEvidenceGraphV1Schema.parse(graphValue);
    const candidate = {
      ...RISK_CANDIDATE,
      title: "Run failed",
      claim: "Run failed",
      evidenceIds: [RUN_EVIDENCE, FINALIZATION_EVIDENCE],
    };
    const result = buildCandidateValidationReport({
      ...input,
      candidateBatch: candidateBatch([candidate]),
      evidenceGraph: graph,
    });
    expect(item(result, 0).reasons).toContain("conflicting_evidence");
    expect(item(result, 0).decision).toBe("rejected");
  });

  it("does not expand a generic Run citation into sibling gap evidence", () => {
    const candidate = {
      ...RISK_CANDIDATE,
      title: "Evidence gap",
      claim: "Evidence gap",
      evidenceIds: [RUN_EVIDENCE],
    };
    const result = buildCandidateValidationReport(validatorInput([candidate]));
    expect(item(result, 0).expandedEvidenceIds).not.toContain(GAP_EVIDENCE);
    expect(item(result, 0).reasons).toContain("type_evidence_mismatch");
    expect(item(result, 0).decision).toBe("rejected");
  });

  it("requires a classification label to resolve through its changed-file chain", () => {
    const input = validatorInput([]);
    const graphValue = structuredClone(input.evidenceGraph);
    graphValue.edges = graphValue.edges.filter(
      (edge) => edge.type !== "classification_assigned_label",
    );
    graphValue.edgeTypeCounts = graphValue.edgeTypeCounts.filter(
      (entry) => entry.kind !== "classification_assigned_label",
    );
    const graph = DeterministicEvidenceGraphV1Schema.parse(graphValue);
    const candidate = {
      ...CHANGE_CANDIDATE,
      title: "Behavior file modified",
      claim: "Behavior file modified",
      evidenceIds: [LABEL_EVIDENCE],
    };
    const result = buildCandidateValidationReport({
      ...input,
      candidateBatch: candidateBatch([candidate]),
      evidenceGraph: graph,
    });
    expect(item(result, 0).reasons).toContain("type_evidence_mismatch");
    expect(item(result, 0).decision).toBe("rejected");
  });
});
