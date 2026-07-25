import {
  CANDIDATE_GENERATION_SCHEMA_VERSION,
  CANDIDATE_MOMENT_SCHEMA_VERSION,
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  EVIDENCE_GRAPH_BUILDER_VERSION,
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_GRAPH_TAXONOMY_VERSION,
  type MomentInteractionRecordV1,
  type MomentInteractionStateV1,
  type OwnershipMomentsProjectionV1,
  OwnershipMomentsProjectionV1Schema,
  type OwnershipRecordV1,
} from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

import {
  MomentInteractionError,
  readMomentInteractionState,
  recordMomentInteraction,
} from "./processor.js";

const runId = "run-1";
const validationId = `val_${"b".repeat(48)}`;
const momentId = `mom_${"c".repeat(48)}`;
const candidateFingerprint = `sha256:${"d".repeat(64)}`;
const evidenceId = `ev_${"e".repeat(48)}`;
const score = {
  evidenceStrength: 100,
  urgency: 0,
  completenessAdjustment: 0,
  providerImportanceSignal: 1,
  providerConfidenceSignal: 1,
  attentionPenalty: 1,
  total: 101,
} as const;

const projection: OwnershipMomentsProjectionV1 = {
  ok: true,
  schemaVersion: 1,
  projectionVersion: "0.1.0",
  runId,
  outcome: "ready",
  diagnosticCode: "completed",
  limitations: [],
  finalizationId: "finalization-1",
  generationId: `gen_${"a".repeat(48)}`,
  validationId,
  validationKey: `vkey_${"f".repeat(48)}`,
  sourceCandidateArtifactId: "candidate-artifact",
  sourceCandidateFingerprint: `sha256:${"1".repeat(64)}`,
  reportArtifactId: "report-artifact",
  reportFingerprint: `sha256:${"2".repeat(64)}`,
  evidenceGraphArtifactId: "graph-artifact",
  evidenceGraphInputFingerprint: "3".repeat(64),
  sourceVersions: {
    evidenceGraphSchemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
    evidenceGraphBuilderVersion: EVIDENCE_GRAPH_BUILDER_VERSION,
    evidenceGraphTaxonomyVersion: EVIDENCE_GRAPH_TAXONOMY_VERSION,
    candidateMomentSchemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
    candidateGenerationSchemaVersion: CANDIDATE_GENERATION_SCHEMA_VERSION,
  },
  policyVersions: {
    validatorVersion: CANDIDATE_VALIDATOR_VERSION,
    supportPolicyVersion: CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
    contradictionPolicyVersion: CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
    absencePolicyVersion: CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
    duplicatePolicyVersion: CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
    rankingPolicyVersion: CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
    selectionPolicyVersion: CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  },
  selectedCount: 1,
  moments: [
    {
      displayId: momentId,
      selectedRank: 1,
      sourceIndex: 0,
      sourceCandidateFingerprint: candidateFingerprint,
      candidate: {
        type: "change",
        title: "Behavior changed",
        claim: "Behavior file modified",
        importance: "high",
        confidenceBasisPoints: 8000,
        evidenceIds: [evidenceId],
        suggestedInteraction: { kind: "acknowledge" },
      },
      expandedEvidenceIds: [],
      facts: [{ kind: "change_kind", value: "modified", evidenceIds: [evidenceId] }],
      score,
      evidenceIds: [evidenceId],
    },
  ],
};

function fakeDependencies(projectionValue: OwnershipMomentsProjectionV1 = projection) {
  const interactions = new Map<string, MomentInteractionRecordV1>();
  const records = new Map<string, OwnershipRecordV1>();
  const sourceMoment = projectionValue.moments[0];
  if (sourceMoment === undefined) throw new Error("Projection Moment is missing.");
  const repository = {
    getInteraction(id: string) {
      return interactions.get(id) ?? null;
    },
    insertInteraction(value: MomentInteractionRecordV1) {
      interactions.set(value.interactionId, value);
    },
    insertOwnershipRecord(value: OwnershipRecordV1) {
      records.set(value.interactionId, value);
    },
    getOwnershipRecordForInteraction(id: string) {
      return records.get(id) ?? null;
    },
    listStates() {
      if (interactions.size === 0) return [];
      const values = [...interactions.values()].toSorted((a, b) =>
        a.createdAt === b.createdAt
          ? a.interactionId.localeCompare(b.interactionId)
          : a.createdAt.localeCompare(b.createdAt),
      );
      let acknowledgement: boolean | null = null;
      let decisionResponse: "confirm" | "revise" | "uncertain" | null = null;
      let riskResponse: "acknowledge" | "mitigate" | "dismiss" | null = null;
      let checkChoiceId: string | null = null;
      let usefulness: "useful" | "not_useful" | "unset" = "unset";
      let views = 0;
      let evidenceViews = 0;
      for (const value of values) {
        switch (value.action.kind) {
          case "moment_viewed":
            views += 1;
            break;
          case "evidence_viewed":
            evidenceViews += 1;
            break;
          case "acknowledgement_set":
            acknowledgement = value.action.value;
            break;
          case "decision_response_set":
            decisionResponse = value.action.value;
            break;
          case "risk_response_set":
            riskResponse = value.action.value;
            break;
          case "check_answer_set":
            checkChoiceId = value.action.choiceId;
            break;
          case "usefulness_set":
            usefulness = value.action.value;
            break;
        }
      }
      const state: MomentInteractionStateV1 = {
        momentId: sourceMoment.displayId,
        sourceIndex: sourceMoment.sourceIndex,
        sourceCandidateFingerprint: sourceMoment.sourceCandidateFingerprint,
        momentType: sourceMoment.candidate.type,
        viewCount: views,
        evidenceViewCount: evidenceViews,
        acknowledgement,
        decisionResponse,
        riskResponse,
        checkChoiceId,
        usefulness,
        latestInteractionAt: values.at(-1)?.createdAt ?? null,
        interactionCount: values.length,
        ownershipRecordCount: records.size,
      };
      return [state];
    },
    listDistinctEvidenceIds() {
      return [
        ...new Set(
          [...interactions.values()]
            .filter((value) => value.action.kind === "evidence_viewed")
            .map((value) =>
              value.action.kind === "evidence_viewed" ? value.action.evidenceId : "",
            ),
        ),
      ].filter(Boolean);
    },
    listDistinctCheckChoiceIds() {
      return [
        ...new Set(
          [...interactions.values()]
            .filter((value) => value.action.kind === "check_answer_set")
            .map((value) =>
              value.action.kind === "check_answer_set" ? value.action.choiceId : "",
            ),
        ),
      ].filter(Boolean);
    },
    listRecentInteractions(_runId: string, _validationId: string, limit: number) {
      return [...interactions.values()]
        .toSorted((left, right) =>
          left.createdAt === right.createdAt
            ? left.interactionId.localeCompare(right.interactionId)
            : left.createdAt.localeCompare(right.createdAt),
        )
        .slice(-limit);
    },
    listRecentOwnershipRecords(_runId: string, _validationId: string, limit: number) {
      return [...records.values()]
        .toSorted((left, right) =>
          left.createdAt === right.createdAt
            ? left.recordId.localeCompare(right.recordId)
            : left.createdAt.localeCompare(right.createdAt),
        )
        .slice(-limit);
    },
    countInteractions() {
      return interactions.size;
    },
    countOwnershipRecords() {
      return records.size;
    },
  };
  const repositories = { momentInteractions: repository };
  const persistence = {
    taskRuns: { get: () => ({ runId }) },
    momentInteractions: repository,
    withTransaction<T>(operation: (value: typeof repositories) => T): T {
      return operation(repositories);
    },
  };
  return {
    dependencies: { persistence, artifactStore: {} } as never,
    interactions,
    records,
  };
}

const projectionReader = async () => projection;
const clock = () => new Date("2026-07-25T15:00:00.000Z");

describe("Moment interaction processor", () => {
  it("appends a qualifying interaction and returns deterministic current state", async () => {
    const context = fakeDependencies();
    const receipt = await recordMomentInteraction(
      context.dependencies,
      runId,
      momentId,
      {
        schemaVersion: 1,
        interactionId: `ix_${"1".repeat(48)}`,
        validationId,
        action: { kind: "acknowledgement_set", value: true },
      },
      { projectionReader, clock },
    );
    expect(receipt).toMatchObject({
      idempotentReplay: false,
      actionKind: "acknowledgement_set",
      state: { acknowledgement: true, interactionCount: 1, ownershipRecordCount: 1 },
    });
    expect(context.records.size).toBe(1);
    expect(context.records.values().next().value).toMatchObject({
      assertionCode: "interaction_recorded",
      noComprehensionClaim: true,
      valueCode: "acknowledged",
    });
  });

  it("replays the same canonical request and rejects conflicting ID reuse", async () => {
    const context = fakeDependencies();
    const request = {
      schemaVersion: 1,
      interactionId: `ix_${"2".repeat(48)}`,
      validationId,
      action: { kind: "moment_viewed" },
    } as const;
    await recordMomentInteraction(context.dependencies, runId, momentId, request, {
      projectionReader,
      clock,
    });
    const replay = await recordMomentInteraction(context.dependencies, runId, momentId, request, {
      projectionReader,
      clock: () => new Date(Number.NaN),
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.createdAt).toBe("2026-07-25T15:00:00.000Z");
    expect(context.interactions.size).toBe(1);
    await expect(
      recordMomentInteraction(
        context.dependencies,
        runId,
        momentId,
        { ...request, action: { kind: "usefulness_set", value: "useful" } },
        { projectionReader, clock },
      ),
    ).rejects.toBeInstanceOf(MomentInteractionError);
  });

  it("rejects an idempotent replay when persisted action bytes disagree", async () => {
    const context = fakeDependencies();
    const request = {
      schemaVersion: 1,
      interactionId: `ix_${"f".repeat(48)}`,
      validationId,
      action: { kind: "moment_viewed" },
    } as const;
    await recordMomentInteraction(context.dependencies, runId, momentId, request, {
      projectionReader,
      clock,
    });
    const stored = context.interactions.get(request.interactionId);
    if (stored === undefined) throw new Error("Stored interaction is missing.");
    context.interactions.set(request.interactionId, {
      ...stored,
      action: { kind: "usefulness_set", value: "useful" },
    });
    await expect(
      recordMomentInteraction(context.dependencies, runId, momentId, request, {
        projectionReader,
        clock,
      }),
    ).rejects.toMatchObject({ code: "interaction_conflict" });
  });

  it("rejects foreign Evidence and incompatible finite actions without appending", async () => {
    const context = fakeDependencies();
    await expect(
      recordMomentInteraction(
        context.dependencies,
        runId,
        momentId,
        {
          schemaVersion: 1,
          interactionId: `ix_${"3".repeat(48)}`,
          validationId,
          action: { kind: "evidence_viewed", evidenceId: `ev_${"9".repeat(48)}` },
        },
        { projectionReader, clock },
      ),
    ).rejects.toMatchObject({ code: "action_not_allowed" });
    await expect(
      recordMomentInteraction(
        context.dependencies,
        runId,
        momentId,
        {
          schemaVersion: 1,
          interactionId: `ix_${"4".repeat(48)}`,
          validationId,
          action: { kind: "decision_response_set", value: "confirm" },
        },
        { projectionReader, clock },
      ),
    ).rejects.toMatchObject({ code: "action_not_allowed" });
    expect(context.interactions.size).toBe(0);
  });

  it("accepts every finite type-specific action and creates only bounded qualifying records", async () => {
    const variants = [
      {
        suffix: "5",
        candidate: {
          type: "decision",
          title: "Decision observed",
          claim: "Decision observed",
          importance: "medium",
          confidenceBasisPoints: 7000,
          evidenceIds: [evidenceId],
          suggestedInteraction: {
            kind: "decision_response",
            prompt: "Confirm decision",
            options: ["confirm", "revise", "uncertain"],
          },
        },
        action: { kind: "decision_response_set", value: "revise" },
        expectedValue: "revise",
      },
      {
        suffix: "6",
        candidate: {
          type: "risk",
          title: "Risk observed",
          claim: "Risk observed",
          importance: "critical",
          confidenceBasisPoints: 9000,
          evidenceIds: [evidenceId],
          suggestedInteraction: {
            kind: "risk_response",
            prompt: "Respond to risk",
            options: ["acknowledge", "mitigate", "dismiss"],
          },
        },
        action: { kind: "risk_response_set", value: "mitigate" },
        expectedValue: "mitigate",
      },
      {
        suffix: "7",
        candidate: {
          type: "check",
          title: "Check observed",
          claim: "Check observed",
          importance: "low",
          confidenceBasisPoints: 6000,
          evidenceIds: [evidenceId],
          suggestedInteraction: {
            kind: "check_answer",
            question: "Choose one",
            choices: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" },
            ],
          },
        },
        action: { kind: "check_answer_set", choiceId: "yes" },
        expectedValue: "yes",
      },
    ] as const;

    const baseMoment = projection.moments[0];
    if (baseMoment === undefined) throw new Error("Base Moment is missing.");
    for (const variant of variants) {
      const variantMoment = {
        ...baseMoment,
        displayId: `mom_${variant.suffix.repeat(48)}`,
        sourceCandidateFingerprint: `sha256:${variant.suffix.repeat(64)}`,
        candidate: variant.candidate,
      };
      const variantProjection = OwnershipMomentsProjectionV1Schema.parse({
        ...projection,
        moments: [variantMoment],
      });
      const context = fakeDependencies(variantProjection);
      const receipt = await recordMomentInteraction(
        context.dependencies,
        runId,
        variantMoment.displayId,
        {
          schemaVersion: 1,
          interactionId: `ix_${variant.suffix.repeat(48)}`,
          validationId,
          action: variant.action,
        },
        { projectionReader: async () => variantProjection, clock },
      );
      expect(receipt.ownershipRecordId).toMatch(/^or_[0-9a-f]{48}$/u);
      expect(context.records.values().next().value).toMatchObject({
        valueCode: variant.expectedValue,
        noComprehensionClaim: true,
      });
    }

    const context = fakeDependencies();
    await recordMomentInteraction(
      context.dependencies,
      runId,
      momentId,
      {
        schemaVersion: 1,
        interactionId: `ix_${"8".repeat(48)}`,
        validationId,
        action: { kind: "evidence_viewed", evidenceId },
      },
      { projectionReader, clock },
    );
    expect(context.records.size).toBe(0);
    const useful = await recordMomentInteraction(
      context.dependencies,
      runId,
      momentId,
      {
        schemaVersion: 1,
        interactionId: `ix_${"9".repeat(48)}`,
        validationId,
        action: { kind: "usefulness_set", value: "not_useful" },
      },
      { projectionReader, clock },
    );
    expect(useful.state).toMatchObject({ evidenceViewCount: 1, usefulness: "not_useful" });
    expect(context.records.size).toBe(1);
  });

  it("uses interaction ID as the deterministic timestamp tie-break and bounds recent history", async () => {
    const context = fakeDependencies();
    for (const [suffix, value] of [
      ["a", true],
      ["b", false],
    ] as const) {
      await recordMomentInteraction(
        context.dependencies,
        runId,
        momentId,
        {
          schemaVersion: 1,
          interactionId: `ix_${suffix.repeat(48)}`,
          validationId,
          action: { kind: "acknowledgement_set", value },
        },
        { projectionReader, clock },
      );
    }
    for (let index = 0; index < 101; index += 1) {
      await recordMomentInteraction(
        context.dependencies,
        runId,
        momentId,
        {
          schemaVersion: 1,
          interactionId: `ix_${index.toString(16).padStart(48, "0")}`,
          validationId,
          action: { kind: "moment_viewed" },
        },
        { projectionReader, clock },
      );
    }
    const state = await readMomentInteractionState(context.dependencies, runId, validationId, {
      projectionReader,
    });
    expect(state).toMatchObject({
      totalInteractionCount: 103,
      interactionHistoryTruncated: true,
      states: [{ acknowledgement: false, viewCount: 101, interactionCount: 103 }],
    });
    expect(state.recentInteractions).toHaveLength(100);
  });

  it("returns zero state for selected Moments with no persisted history", async () => {
    const context = fakeDependencies();
    const state = await readMomentInteractionState(context.dependencies, runId, validationId, {
      projectionReader,
    });
    expect(state.states).toEqual([
      expect.objectContaining({
        momentId,
        viewCount: 0,
        interactionCount: 0,
        usefulness: "unset",
      }),
    ]);
  });
});
