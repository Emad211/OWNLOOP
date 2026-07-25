import { z } from "zod";

import {
  CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION,
  CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION,
  CANDIDATE_VALIDATION_RANKING_POLICY_VERSION,
  CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION,
  CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION,
  CANDIDATE_VALIDATOR_VERSION,
  CandidateValidationFactV1Schema,
  CandidateValidationScoreV1Schema,
  CandidateValidationSourceVersionsV1Schema,
} from "./candidate-validation.js";
import { CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES } from "./candidate-generation.js";
import { CandidateMomentV1Schema } from "./candidate-moment.js";
import { EvidenceIdSchema } from "./evidence-graph.js";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const validationIdSchema = z.string().regex(/^val_[0-9a-f]{48}$/u);
const validationKeySchema = z.string().regex(/^vkey_[0-9a-f]{48}$/u);

export const OWNERSHIP_MOMENTS_SCHEMA_VERSION = 1 as const;
export const OWNERSHIP_MOMENTS_PROJECTION_VERSION = "0.1.0" as const;
export const OWNERSHIP_MOMENTS_MAX_ITEMS = 7;

export const OWNERSHIP_MOMENTS_OUTCOMES = ["ready", "partial", "not_available"] as const;
export const OwnershipMomentsOutcomeSchema = z.enum(OWNERSHIP_MOMENTS_OUTCOMES);
export type OwnershipMomentsOutcome = z.infer<typeof OwnershipMomentsOutcomeSchema>;

export const OWNERSHIP_MOMENTS_DIAGNOSTIC_CODES = [
  "completed",
  "source_partial",
  "validation_not_available",
] as const;
export const OwnershipMomentsDiagnosticCodeSchema = z.enum(OWNERSHIP_MOMENTS_DIAGNOSTIC_CODES);
export type OwnershipMomentsDiagnosticCode = z.infer<typeof OwnershipMomentsDiagnosticCodeSchema>;

export const OWNERSHIP_MOMENTS_LIMITATIONS = ["source_graph_partial"] as const;
export const OwnershipMomentsLimitationSchema = z.enum(OWNERSHIP_MOMENTS_LIMITATIONS);
export type OwnershipMomentsLimitation = z.infer<typeof OwnershipMomentsLimitationSchema>;

const limitationsSchema = z
  .array(OwnershipMomentsLimitationSchema)
  .max(OWNERSHIP_MOMENTS_LIMITATIONS.length)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({ code: "custom", message: "Moment limitations must be unique." });
    }
    const expected = [...value].toSorted(
      (left, right) =>
        OWNERSHIP_MOMENTS_LIMITATIONS.indexOf(left) - OWNERSHIP_MOMENTS_LIMITATIONS.indexOf(right),
    );
    if (expected.some((item, index) => item !== value[index])) {
      context.addIssue({ code: "custom", message: "Moment limitations must be sorted." });
    }
  });

const evidenceIdsSchema = z
  .array(EvidenceIdSchema)
  .max(96)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({ code: "custom", message: "Moment Evidence IDs must be unique." });
    }
    if (value.toSorted().some((item, index) => item !== value[index])) {
      context.addIssue({ code: "custom", message: "Moment Evidence IDs must be sorted." });
    }
  });

export const OwnershipMomentDisplayIdSchema = z.string().regex(/^mom_[0-9a-f]{48}$/u);
export type OwnershipMomentDisplayId = z.infer<typeof OwnershipMomentDisplayIdSchema>;

export const OwnershipMomentProjectionItemV1Schema = z
  .strictObject({
    displayId: OwnershipMomentDisplayIdSchema,
    selectedRank: z.number().int().min(1).max(OWNERSHIP_MOMENTS_MAX_ITEMS),
    sourceIndex: z
      .number()
      .int()
      .min(0)
      .max(CANDIDATE_GENERATION_MAX_PRODUCT_CANDIDATES - 1),
    sourceCandidateFingerprint: sha256FingerprintSchema,
    candidate: CandidateMomentV1Schema,
    expandedEvidenceIds: evidenceIdsSchema,
    facts: z.array(CandidateValidationFactV1Schema).max(64),
    score: CandidateValidationScoreV1Schema,
    evidenceIds: evidenceIdsSchema,
  })
  .superRefine((value, context) => {
    if (value.expandedEvidenceIds.some((id) => value.candidate.evidenceIds.includes(id))) {
      context.addIssue({
        code: "custom",
        message: "Expanded Evidence IDs must exclude provider-cited IDs.",
      });
    }
    const expectedEvidence = [
      ...new Set([
        ...value.candidate.evidenceIds,
        ...value.expandedEvidenceIds,
        ...value.facts.flatMap((fact) => fact.evidenceIds),
      ]),
    ].toSorted();
    if (
      expectedEvidence.length !== value.evidenceIds.length ||
      expectedEvidence.some((item, index) => item !== value.evidenceIds[index])
    ) {
      context.addIssue({ code: "custom", message: "Moment Evidence union is inconsistent." });
    }
  });
export type OwnershipMomentProjectionItemV1 = z.infer<typeof OwnershipMomentProjectionItemV1Schema>;

export const OwnershipMomentsPolicyVersionsV1Schema = z.strictObject({
  validatorVersion: z.literal(CANDIDATE_VALIDATOR_VERSION),
  supportPolicyVersion: z.literal(CANDIDATE_VALIDATION_SUPPORT_POLICY_VERSION),
  contradictionPolicyVersion: z.literal(CANDIDATE_VALIDATION_CONTRADICTION_POLICY_VERSION),
  absencePolicyVersion: z.literal(CANDIDATE_VALIDATION_ABSENCE_POLICY_VERSION),
  duplicatePolicyVersion: z.literal(CANDIDATE_VALIDATION_DUPLICATE_POLICY_VERSION),
  rankingPolicyVersion: z.literal(CANDIDATE_VALIDATION_RANKING_POLICY_VERSION),
  selectionPolicyVersion: z.literal(CANDIDATE_VALIDATION_SELECTION_POLICY_VERSION),
});
export type OwnershipMomentsPolicyVersionsV1 = z.infer<
  typeof OwnershipMomentsPolicyVersionsV1Schema
>;

export const OwnershipMomentsProjectionV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(OWNERSHIP_MOMENTS_SCHEMA_VERSION),
    projectionVersion: z.literal(OWNERSHIP_MOMENTS_PROJECTION_VERSION),
    runId: safeIdSchema,
    outcome: OwnershipMomentsOutcomeSchema,
    diagnosticCode: OwnershipMomentsDiagnosticCodeSchema,
    limitations: limitationsSchema,
    finalizationId: safeIdSchema.nullable(),
    generationId: z
      .string()
      .regex(/^gen_[0-9a-f]{48}$/u)
      .nullable(),
    validationId: validationIdSchema.nullable(),
    validationKey: validationKeySchema.nullable(),
    sourceCandidateArtifactId: safeIdSchema.nullable(),
    sourceCandidateFingerprint: sha256FingerprintSchema.nullable(),
    reportArtifactId: safeIdSchema.nullable(),
    reportFingerprint: sha256FingerprintSchema.nullable(),
    evidenceGraphArtifactId: safeIdSchema.nullable(),
    evidenceGraphInputFingerprint: sha256HexSchema.nullable(),
    sourceVersions: CandidateValidationSourceVersionsV1Schema.nullable(),
    policyVersions: OwnershipMomentsPolicyVersionsV1Schema.nullable(),
    selectedCount: z.number().int().min(0).max(OWNERSHIP_MOMENTS_MAX_ITEMS),
    moments: z.array(OwnershipMomentProjectionItemV1Schema).max(OWNERSHIP_MOMENTS_MAX_ITEMS),
  })
  .superRefine((value, context) => {
    const sourceFields = [
      value.finalizationId,
      value.generationId,
      value.validationId,
      value.validationKey,
      value.sourceCandidateArtifactId,
      value.sourceCandidateFingerprint,
      value.reportArtifactId,
      value.reportFingerprint,
      value.evidenceGraphArtifactId,
      value.evidenceGraphInputFingerprint,
      value.sourceVersions,
      value.policyVersions,
    ];
    const unavailable = value.outcome === "not_available";
    if (unavailable) {
      if (
        sourceFields.some((field) => field !== null) ||
        value.diagnosticCode !== "validation_not_available" ||
        value.limitations.length !== 0 ||
        value.selectedCount !== 0 ||
        value.moments.length !== 0
      ) {
        context.addIssue({ code: "custom", message: "Unavailable Moment projection has output." });
      }
      return;
    }
    if (
      sourceFields.some((field) => field === null) ||
      value.selectedCount !== value.moments.length
    ) {
      context.addIssue({ code: "custom", message: "Available Moment projection is incomplete." });
    }
    const ranks = value.moments.map((moment) => moment.selectedRank);
    if (ranks.some((rank, index) => rank !== index + 1)) {
      context.addIssue({ code: "custom", message: "Moment ranks must be contiguous." });
    }
    if (new Set(value.moments.map((moment) => moment.displayId)).size !== value.moments.length) {
      context.addIssue({ code: "custom", message: "Moment display IDs must be unique." });
    }
    const partial = value.outcome === "partial";
    if (
      partial !== value.limitations.includes("source_graph_partial") ||
      (partial && value.diagnosticCode !== "source_partial") ||
      (!partial && (value.diagnosticCode !== "completed" || value.limitations.length !== 0))
    ) {
      context.addIssue({ code: "custom", message: "Moment projection outcome is inconsistent." });
    }
  });
export type OwnershipMomentsProjectionV1 = z.infer<typeof OwnershipMomentsProjectionV1Schema>;

export function parseOwnershipMomentsProjectionV1(input: unknown): OwnershipMomentsProjectionV1 {
  return OwnershipMomentsProjectionV1Schema.parse(input);
}
