import {
  MomentInteractionReceiptV1Schema,
  MomentInteractionRecordV1Schema,
  MomentInteractionRequestV1Schema,
  MomentInteractionStateResponseV1Schema,
  OwnershipRecordV1Schema,
} from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

const interactionId = `ix_${"a".repeat(48)}`;
const validationId = `val_${"b".repeat(48)}`;
const momentId = `mom_${"c".repeat(48)}`;
const fingerprint = `sha256:${"d".repeat(64)}`;
const createdAt = "2026-07-25T15:00:00.000Z";

const state = {
  momentId,
  sourceIndex: 0,
  sourceCandidateFingerprint: fingerprint,
  momentType: "change",
  viewCount: 1,
  evidenceViewCount: 0,
  acknowledgement: true,
  decisionResponse: null,
  riskResponse: null,
  checkChoiceId: null,
  usefulness: "unset",
  latestInteractionAt: createdAt,
  interactionCount: 1,
  ownershipRecordCount: 1,
} as const;

describe("Moment interaction contracts", () => {
  it("accepts every finite action and rejects extra or free-form fields", () => {
    const actions = [
      { kind: "moment_viewed" },
      { kind: "evidence_viewed", evidenceId: `ev_${"e".repeat(48)}` },
      { kind: "acknowledgement_set", value: true },
      { kind: "decision_response_set", value: "confirm" },
      { kind: "risk_response_set", value: "mitigate" },
      { kind: "check_answer_set", choiceId: "yes" },
      { kind: "usefulness_set", value: "not_useful" },
    ];
    for (const action of actions) {
      expect(
        MomentInteractionRequestV1Schema.parse({
          schemaVersion: 1,
          interactionId,
          validationId,
          action,
        }),
      ).toBeDefined();
    }
    expect(() =>
      MomentInteractionRequestV1Schema.parse({
        schemaVersion: 1,
        interactionId,
        validationId,
        action: { kind: "usefulness_set", value: "useful", note: "free text" },
      }),
    ).toThrow();
  });

  it("requires exact identifiers and canonical UTC timestamps", () => {
    expect(() =>
      MomentInteractionRequestV1Schema.parse({
        schemaVersion: 1,
        interactionId: "ix_short",
        validationId,
        action: { kind: "moment_viewed" },
      }),
    ).toThrow();
    for (const invalidTimestamp of ["2026-07-25T15:00:00Z", "2026-02-30T15:00:00.000Z"]) {
      expect(() =>
        MomentInteractionReceiptV1Schema.parse({
          ok: true,
          schemaVersion: 1,
          interactionId,
          runId: "run-1",
          validationId,
          momentId,
          actionKind: "acknowledgement_set",
          createdAt: invalidTimestamp,
          ownershipRecordId: `or_${"f".repeat(48)}`,
          idempotentReplay: false,
          state,
        }),
      ).toThrow();
    }
  });

  it("rejects persisted actions that do not match the Moment type", () => {
    expect(() =>
      MomentInteractionRecordV1Schema.parse({
        schemaVersion: 1,
        interactionId: `ix_${"c".repeat(48)}`,
        actor: "local_user",
        runId: "run-1",
        validationId,
        momentId,
        sourceIndex: 0,
        sourceCandidateFingerprint: fingerprint,
        momentType: "change",
        action: { kind: "decision_response_set", value: "confirm" },
        requestFingerprint: fingerprint,
        createdAt,
      }),
    ).toThrow();
  });

  it("allows Ownership Records to attest only a recorded finite interaction", () => {
    const record = {
      schemaVersion: 1,
      recordId: `or_${"f".repeat(48)}`,
      interactionId,
      actor: "local_user",
      runId: "run-1",
      validationId,
      momentId,
      sourceIndex: 0,
      sourceCandidateFingerprint: fingerprint,
      momentType: "change",
      recordKind: "acknowledgement_recorded",
      valueCode: "acknowledged",
      assertionCode: "interaction_recorded",
      noComprehensionClaim: true,
      createdAt,
    } as const;
    expect(OwnershipRecordV1Schema.parse(record)).toEqual(record);
    expect(() => OwnershipRecordV1Schema.parse({ ...record, understood: true })).toThrow();
    expect(() => OwnershipRecordV1Schema.parse({ ...record, valueCode: null })).toThrow();
    expect(() =>
      OwnershipRecordV1Schema.parse({
        ...record,
        recordKind: "feedback_recorded",
        valueCode: "confirm",
      }),
    ).toThrow();
    expect(() =>
      OwnershipRecordV1Schema.parse({
        ...record,
        momentType: "risk",
        recordKind: "response_recorded",
        valueCode: "confirm",
      }),
    ).toThrow();
  });

  it("rejects impossible state, receipt, and aggregate combinations", () => {
    const interaction = {
      schemaVersion: 1,
      interactionId,
      actor: "local_user",
      runId: "run-1",
      validationId,
      momentId,
      sourceIndex: 0,
      sourceCandidateFingerprint: fingerprint,
      momentType: "change",
      action: { kind: "acknowledgement_set", value: true },
      requestFingerprint: fingerprint,
      createdAt,
    } as const;
    const record = {
      schemaVersion: 1,
      recordId: `or_${"f".repeat(48)}`,
      interactionId,
      actor: "local_user",
      runId: "run-1",
      validationId,
      momentId,
      sourceIndex: 0,
      sourceCandidateFingerprint: fingerprint,
      momentType: "change",
      recordKind: "acknowledgement_recorded",
      valueCode: "acknowledged",
      assertionCode: "interaction_recorded",
      noComprehensionClaim: true,
      createdAt,
    } as const;
    const response = {
      ok: true,
      schemaVersion: 1,
      runId: "run-1",
      validationId,
      states: [state],
      totalInteractionCount: 1,
      totalOwnershipRecordCount: 1,
      recentInteractions: [interaction],
      recentOwnershipRecords: [record],
      interactionHistoryTruncated: false,
      ownershipRecordHistoryTruncated: false,
    } as const;
    expect(MomentInteractionStateResponseV1Schema.parse(response)).toBeDefined();
    expect(() =>
      MomentInteractionStateResponseV1Schema.parse({ ...response, totalInteractionCount: 2 }),
    ).toThrow();
    expect(() =>
      MomentInteractionStateResponseV1Schema.parse({
        ...response,
        states: [{ ...state, decisionResponse: "confirm" }],
      }),
    ).toThrow();
    expect(() =>
      MomentInteractionReceiptV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        interactionId,
        runId: "run-1",
        validationId,
        momentId,
        actionKind: "moment_viewed",
        createdAt,
        ownershipRecordId: record.recordId,
        idempotentReplay: false,
        state,
      }),
    ).toThrow();
    expect(() =>
      MomentInteractionReceiptV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        interactionId,
        runId: "run-1",
        validationId,
        momentId,
        actionKind: "decision_response_set",
        createdAt,
        ownershipRecordId: record.recordId,
        idempotentReplay: false,
        state,
      }),
    ).toThrow();
    expect(() =>
      MomentInteractionStateResponseV1Schema.parse({
        ...response,
        recentInteractions: [
          { ...interaction, interactionId: `ix_${"f".repeat(48)}` },
          interaction,
        ],
        totalInteractionCount: 2,
        states: [{ ...state, interactionCount: 2 }],
      }),
    ).toThrow();
  });
});
