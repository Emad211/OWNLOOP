import { z } from "zod";

import {
  CANDIDATE_DECISION_OPTIONS,
  CANDIDATE_RISK_OPTIONS,
  CandidateMomentChoiceIdSchema,
  CandidateMomentTypeSchema,
} from "./candidate-moment.js";
import { EvidenceIdSchema } from "./evidence-graph.js";
import { OwnershipMomentDisplayIdSchema } from "./ownership-moments.js";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const validationIdSchema = z.string().regex(/^val_[0-9a-f]{48}$/u);
const candidateFingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const utcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  }, "Timestamp must be a canonical UTC instant.");

export const MOMENT_INTERACTION_SCHEMA_VERSION = 1 as const;
export const MOMENT_INTERACTION_ACTOR = "local_user" as const;
export const MOMENT_INTERACTION_MAX_RECENT_ITEMS = 100;

export const MomentInteractionIdSchema = z.string().regex(/^ix_[0-9a-f]{48}$/u);
export type MomentInteractionId = z.infer<typeof MomentInteractionIdSchema>;

export const OwnershipRecordIdSchema = z.string().regex(/^or_[0-9a-f]{48}$/u);
export type OwnershipRecordId = z.infer<typeof OwnershipRecordIdSchema>;

export const MomentViewedActionV1Schema = z.strictObject({ kind: z.literal("moment_viewed") });
export const EvidenceViewedActionV1Schema = z.strictObject({
  kind: z.literal("evidence_viewed"),
  evidenceId: EvidenceIdSchema,
});
export const AcknowledgementSetActionV1Schema = z.strictObject({
  kind: z.literal("acknowledgement_set"),
  value: z.boolean(),
});
export const DecisionResponseSetActionV1Schema = z.strictObject({
  kind: z.literal("decision_response_set"),
  value: z.enum(CANDIDATE_DECISION_OPTIONS),
});
export const RiskResponseSetActionV1Schema = z.strictObject({
  kind: z.literal("risk_response_set"),
  value: z.enum(CANDIDATE_RISK_OPTIONS),
});
export const CheckAnswerSetActionV1Schema = z.strictObject({
  kind: z.literal("check_answer_set"),
  choiceId: CandidateMomentChoiceIdSchema,
});
export const UsefulnessSetActionV1Schema = z.strictObject({
  kind: z.literal("usefulness_set"),
  value: z.enum(["useful", "not_useful", "unset"]),
});

export const MomentInteractionActionV1Schema = z.discriminatedUnion("kind", [
  MomentViewedActionV1Schema,
  EvidenceViewedActionV1Schema,
  AcknowledgementSetActionV1Schema,
  DecisionResponseSetActionV1Schema,
  RiskResponseSetActionV1Schema,
  CheckAnswerSetActionV1Schema,
  UsefulnessSetActionV1Schema,
]);
export type MomentInteractionActionV1 = z.infer<typeof MomentInteractionActionV1Schema>;

export const MomentInteractionRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(MOMENT_INTERACTION_SCHEMA_VERSION),
  interactionId: MomentInteractionIdSchema,
  validationId: validationIdSchema,
  action: MomentInteractionActionV1Schema,
});
export type MomentInteractionRequestV1 = z.infer<typeof MomentInteractionRequestV1Schema>;

export const MomentInteractionRecordV1Schema = z
  .strictObject({
    schemaVersion: z.literal(MOMENT_INTERACTION_SCHEMA_VERSION),
    interactionId: MomentInteractionIdSchema,
    actor: z.literal(MOMENT_INTERACTION_ACTOR),
    runId: safeIdSchema,
    validationId: validationIdSchema,
    momentId: OwnershipMomentDisplayIdSchema,
    sourceIndex: z.number().int().min(0).max(6),
    sourceCandidateFingerprint: candidateFingerprintSchema,
    momentType: CandidateMomentTypeSchema,
    action: MomentInteractionActionV1Schema,
    requestFingerprint: candidateFingerprintSchema,
    createdAt: utcTimestampSchema,
  })
  .superRefine((record, context) => {
    const typeAgrees =
      record.action.kind === "moment_viewed" ||
      record.action.kind === "evidence_viewed" ||
      record.action.kind === "usefulness_set" ||
      (record.action.kind === "acknowledgement_set" && record.momentType === "change") ||
      (record.action.kind === "decision_response_set" && record.momentType === "decision") ||
      (record.action.kind === "risk_response_set" && record.momentType === "risk") ||
      (record.action.kind === "check_answer_set" && record.momentType === "check");
    if (!typeAgrees) {
      context.addIssue({
        code: "custom",
        path: ["action"],
        message: "Interaction action must agree with the Moment type.",
      });
    }
  });
export type MomentInteractionRecordV1 = z.infer<typeof MomentInteractionRecordV1Schema>;

export const OWNERSHIP_RECORD_KINDS = [
  "acknowledgement_recorded",
  "response_recorded",
  "answer_recorded",
  "feedback_recorded",
] as const;
export const OwnershipRecordKindSchema = z.enum(OWNERSHIP_RECORD_KINDS);
export type OwnershipRecordKind = z.infer<typeof OwnershipRecordKindSchema>;

export const OWNERSHIP_RECORD_VALUE_CODES = [
  "acknowledged",
  "unacknowledged",
  ...CANDIDATE_DECISION_OPTIONS,
  ...CANDIDATE_RISK_OPTIONS,
  "useful",
  "not_useful",
  "unset",
] as const;
export const OwnershipRecordValueCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]{0,63}$/u);
export type OwnershipRecordValueCode = z.infer<typeof OwnershipRecordValueCodeSchema>;

export const OwnershipRecordV1Schema = z
  .strictObject({
    schemaVersion: z.literal(MOMENT_INTERACTION_SCHEMA_VERSION),
    recordId: OwnershipRecordIdSchema,
    interactionId: MomentInteractionIdSchema,
    actor: z.literal(MOMENT_INTERACTION_ACTOR),
    runId: safeIdSchema,
    validationId: validationIdSchema,
    momentId: OwnershipMomentDisplayIdSchema,
    sourceIndex: z.number().int().min(0).max(6),
    sourceCandidateFingerprint: candidateFingerprintSchema,
    momentType: CandidateMomentTypeSchema,
    recordKind: OwnershipRecordKindSchema,
    valueCode: OwnershipRecordValueCodeSchema,
    assertionCode: z.literal("interaction_recorded"),
    noComprehensionClaim: z.literal(true),
    createdAt: utcTimestampSchema,
  })
  .superRefine((record, context) => {
    const valid =
      (record.recordKind === "acknowledgement_recorded" &&
        record.momentType === "change" &&
        (record.valueCode === "acknowledged" || record.valueCode === "unacknowledged")) ||
      (record.recordKind === "response_recorded" &&
        ((record.momentType === "decision" &&
          (CANDIDATE_DECISION_OPTIONS as readonly string[]).includes(record.valueCode)) ||
          (record.momentType === "risk" &&
            (CANDIDATE_RISK_OPTIONS as readonly string[]).includes(record.valueCode)))) ||
      (record.recordKind === "answer_recorded" &&
        record.momentType === "check" &&
        CandidateMomentChoiceIdSchema.safeParse(record.valueCode).success) ||
      (record.recordKind === "feedback_recorded" &&
        (record.valueCode === "useful" ||
          record.valueCode === "not_useful" ||
          record.valueCode === "unset"));
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["valueCode"],
        message: "Ownership Record kind and value must agree.",
      });
    }
  });
export type OwnershipRecordV1 = z.infer<typeof OwnershipRecordV1Schema>;

export const MomentInteractionStateV1Schema = z
  .strictObject({
    momentId: OwnershipMomentDisplayIdSchema,
    sourceIndex: z.number().int().min(0).max(6),
    sourceCandidateFingerprint: candidateFingerprintSchema,
    momentType: CandidateMomentTypeSchema,
    viewCount: z.number().int().min(0),
    evidenceViewCount: z.number().int().min(0),
    acknowledgement: z.boolean().nullable(),
    decisionResponse: z.enum(CANDIDATE_DECISION_OPTIONS).nullable(),
    riskResponse: z.enum(CANDIDATE_RISK_OPTIONS).nullable(),
    checkChoiceId: CandidateMomentChoiceIdSchema.nullable(),
    usefulness: z.enum(["useful", "not_useful", "unset"]),
    latestInteractionAt: utcTimestampSchema.nullable(),
    interactionCount: z.number().int().min(0),
    ownershipRecordCount: z.number().int().min(0),
  })
  .superRefine((state, context) => {
    const typeFieldsAgree =
      (state.momentType === "change" &&
        state.decisionResponse === null &&
        state.riskResponse === null &&
        state.checkChoiceId === null) ||
      (state.momentType === "decision" &&
        state.acknowledgement === null &&
        state.riskResponse === null &&
        state.checkChoiceId === null) ||
      (state.momentType === "risk" &&
        state.acknowledgement === null &&
        state.decisionResponse === null &&
        state.checkChoiceId === null) ||
      (state.momentType === "check" &&
        state.acknowledgement === null &&
        state.decisionResponse === null &&
        state.riskResponse === null);
    if (!typeFieldsAgree) {
      context.addIssue({
        code: "custom",
        message: "Moment type and current response fields must agree.",
      });
    }
    if (
      state.viewCount + state.evidenceViewCount > state.interactionCount ||
      state.ownershipRecordCount > state.interactionCount
    ) {
      context.addIssue({ code: "custom", message: "Moment interaction counts are inconsistent." });
    }
    if ((state.interactionCount === 0) !== (state.latestInteractionAt === null)) {
      context.addIssue({
        code: "custom",
        path: ["latestInteractionAt"],
        message: "Latest interaction timestamp must agree with the history count.",
      });
    }
  });
export type MomentInteractionStateV1 = z.infer<typeof MomentInteractionStateV1Schema>;

export const MomentInteractionReceiptV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(MOMENT_INTERACTION_SCHEMA_VERSION),
    interactionId: MomentInteractionIdSchema,
    runId: safeIdSchema,
    validationId: validationIdSchema,
    momentId: OwnershipMomentDisplayIdSchema,
    actionKind: z.enum([
      "moment_viewed",
      "evidence_viewed",
      "acknowledgement_set",
      "decision_response_set",
      "risk_response_set",
      "check_answer_set",
      "usefulness_set",
    ]),
    createdAt: utcTimestampSchema,
    ownershipRecordId: OwnershipRecordIdSchema.nullable(),
    idempotentReplay: z.boolean(),
    state: MomentInteractionStateV1Schema,
  })
  .superRefine((receipt, context) => {
    if (receipt.state.momentId !== receipt.momentId) {
      context.addIssue({ code: "custom", path: ["state"], message: "Receipt state must match." });
    }
    const actionTypeAgrees =
      receipt.actionKind === "moment_viewed" ||
      receipt.actionKind === "evidence_viewed" ||
      receipt.actionKind === "usefulness_set" ||
      (receipt.actionKind === "acknowledgement_set" && receipt.state.momentType === "change") ||
      (receipt.actionKind === "decision_response_set" && receipt.state.momentType === "decision") ||
      (receipt.actionKind === "risk_response_set" && receipt.state.momentType === "risk") ||
      (receipt.actionKind === "check_answer_set" && receipt.state.momentType === "check");
    if (!actionTypeAgrees) {
      context.addIssue({
        code: "custom",
        path: ["actionKind"],
        message: "Receipt action kind must agree with the Moment type.",
      });
    }
    const createsRecord =
      receipt.actionKind !== "moment_viewed" && receipt.actionKind !== "evidence_viewed";
    if (createsRecord !== (receipt.ownershipRecordId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["ownershipRecordId"],
        message: "Ownership Record identity must agree with the action kind.",
      });
    }
  });
export type MomentInteractionReceiptV1 = z.infer<typeof MomentInteractionReceiptV1Schema>;

function isCanonicalHistoryOrder<T extends Readonly<{ createdAt: string }>>(
  items: readonly T[],
  id: (item: T) => string,
): boolean {
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    if (previous === undefined || current === undefined) return false;
    if (
      previous.createdAt > current.createdAt ||
      (previous.createdAt === current.createdAt && id(previous) >= id(current))
    ) {
      return false;
    }
  }
  return true;
}

export const MomentInteractionStateResponseV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(MOMENT_INTERACTION_SCHEMA_VERSION),
    runId: safeIdSchema,
    validationId: validationIdSchema,
    states: z.array(MomentInteractionStateV1Schema).max(7),
    totalInteractionCount: z.number().int().min(0),
    totalOwnershipRecordCount: z.number().int().min(0),
    recentInteractions: z
      .array(MomentInteractionRecordV1Schema)
      .max(MOMENT_INTERACTION_MAX_RECENT_ITEMS),
    recentOwnershipRecords: z
      .array(OwnershipRecordV1Schema)
      .max(MOMENT_INTERACTION_MAX_RECENT_ITEMS),
    interactionHistoryTruncated: z.boolean(),
    ownershipRecordHistoryTruncated: z.boolean(),
  })
  .superRefine((response, context) => {
    const stateIds = new Set(response.states.map((state) => state.momentId));
    if (stateIds.size !== response.states.length) {
      context.addIssue({
        code: "custom",
        path: ["states"],
        message: "Moment states must be unique.",
      });
    }
    if (
      response.states.reduce((total, state) => total + state.interactionCount, 0) !==
        response.totalInteractionCount ||
      response.states.reduce((total, state) => total + state.ownershipRecordCount, 0) !==
        response.totalOwnershipRecordCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Interaction response aggregates are inconsistent.",
      });
    }
    const interactionHistoryConsistent = response.interactionHistoryTruncated
      ? response.totalInteractionCount > MOMENT_INTERACTION_MAX_RECENT_ITEMS &&
        response.recentInteractions.length === MOMENT_INTERACTION_MAX_RECENT_ITEMS
      : response.totalInteractionCount === response.recentInteractions.length;
    const ownershipHistoryConsistent = response.ownershipRecordHistoryTruncated
      ? response.totalOwnershipRecordCount > MOMENT_INTERACTION_MAX_RECENT_ITEMS &&
        response.recentOwnershipRecords.length === MOMENT_INTERACTION_MAX_RECENT_ITEMS
      : response.totalOwnershipRecordCount === response.recentOwnershipRecords.length;
    if (!interactionHistoryConsistent || !ownershipHistoryConsistent) {
      context.addIssue({ code: "custom", message: "Recent-history bounds are inconsistent." });
    }
    if (
      !isCanonicalHistoryOrder(response.recentInteractions, (item) => item.interactionId) ||
      !isCanonicalHistoryOrder(response.recentOwnershipRecords, (item) => item.recordId)
    ) {
      context.addIssue({ code: "custom", message: "Recent history must be canonically ordered." });
    }
    const stateByMoment = new Map(response.states.map((state) => [state.momentId, state]));
    for (const item of [...response.recentInteractions, ...response.recentOwnershipRecords]) {
      const state = stateByMoment.get(item.momentId);
      if (
        item.runId !== response.runId ||
        item.validationId !== response.validationId ||
        state === undefined ||
        state.sourceIndex !== item.sourceIndex ||
        state.sourceCandidateFingerprint !== item.sourceCandidateFingerprint ||
        state.momentType !== item.momentType
      ) {
        context.addIssue({
          code: "custom",
          message: "Recent history must match exact Moment state.",
        });
        break;
      }
    }
  });
export type MomentInteractionStateResponseV1 = z.infer<
  typeof MomentInteractionStateResponseV1Schema
>;

export function parseMomentInteractionRequestV1(input: unknown): MomentInteractionRequestV1 {
  return MomentInteractionRequestV1Schema.parse(input);
}
