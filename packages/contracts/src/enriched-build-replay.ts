import { z } from "zod";

import { CandidateMomentV1Schema } from "./candidate-moment.js";
import {
  CandidateValidationFactV1Schema,
  CandidateValidationScoreV1Schema,
  CandidateValidationSourceVersionsV1Schema,
} from "./candidate-validation.js";
import { EvidenceIdSchema } from "./evidence-graph.js";
import {
  MOMENT_INTERACTION_SCHEMA_VERSION,
  MomentInteractionStateV1Schema,
} from "./moment-interactions.js";
import {
  OWNERSHIP_MOMENTS_PROJECTION_VERSION,
  OWNERSHIP_MOMENTS_SCHEMA_VERSION,
  OwnershipMomentDisplayIdSchema,
  OwnershipMomentsPolicyVersionsV1Schema,
} from "./ownership-moments.js";
import {
  RAW_REPLAY_SCHEMA_VERSION,
  ReplayChangedFileV1Schema,
  ReplayEvidenceGapV1Schema,
  ReplayVerificationV1Schema,
} from "./replay.js";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const validationIdSchema = z.string().regex(/^val_[0-9a-f]{48}$/u);
const validationKeySchema = z.string().regex(/^vkey_[0-9a-f]{48}$/u);
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const timestampSchema = z.iso.datetime({ offset: true });

export const ENRICHED_BUILD_REPLAY_SCHEMA_VERSION = 1 as const;
export const ENRICHED_BUILD_REPLAY_PROJECTOR_VERSION = "0.1.0" as const;
export const ENRICHED_BUILD_REPLAY_MAX_BYTES = 1024 * 1024;
export const ENRICHED_BUILD_REPLAY_MAX_MOMENTS = 7;
export const ENRICHED_BUILD_REPLAY_MAX_FILES = 100;
export const ENRICHED_BUILD_REPLAY_MAX_VERIFICATION = 100;
export const ENRICHED_BUILD_REPLAY_MAX_GAPS = 100;

export const ENRICHED_BUILD_REPLAY_OUTCOMES = ["ready", "partial", "not_available"] as const;
export const EnrichedBuildReplayOutcomeSchema = z.enum(ENRICHED_BUILD_REPLAY_OUTCOMES);
export type EnrichedBuildReplayOutcome = z.infer<typeof EnrichedBuildReplayOutcomeSchema>;

export const ENRICHED_BUILD_REPLAY_DIAGNOSTICS = [
  "completed",
  "source_partial",
  "run_not_terminal",
] as const;
export const EnrichedBuildReplayDiagnosticSchema = z.enum(ENRICHED_BUILD_REPLAY_DIAGNOSTICS);
export type EnrichedBuildReplayDiagnostic = z.infer<typeof EnrichedBuildReplayDiagnosticSchema>;

export const ENRICHED_BUILD_REPLAY_LIMITATIONS = [
  "run_partial",
  "run_failed",
  "run_abandoned",
  "raw_replay_partial",
  "finalization_limited",
  "evidence_graph_partial",
  "evidence_gaps_present",
  "moments_partial",
  "moments_unavailable",
  "files_truncated",
  "verification_truncated",
  "gaps_truncated",
] as const;
export const EnrichedBuildReplayLimitationSchema = z.enum(ENRICHED_BUILD_REPLAY_LIMITATIONS);
export type EnrichedBuildReplayLimitation = z.infer<typeof EnrichedBuildReplayLimitationSchema>;

const limitationsSchema = z
  .array(EnrichedBuildReplayLimitationSchema)
  .max(ENRICHED_BUILD_REPLAY_LIMITATIONS.length)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({ code: "custom", message: "Replay limitations must be unique." });
    }
    const positions = value.map((item) => ENRICHED_BUILD_REPLAY_LIMITATIONS.indexOf(item));
    if (
      positions
        .toSorted((left, right) => left - right)
        .some((item, index) => item !== positions[index])
    ) {
      context.addIssue({ code: "custom", message: "Replay limitations must be sorted." });
    }
  });

export const ENRICHED_BUILD_REPLAY_REVIEW_ACTIVITIES = [
  "none",
  "viewed",
  "evidence_opened",
  "responded",
] as const;
export const EnrichedBuildReplayReviewActivitySchema = z.enum(
  ENRICHED_BUILD_REPLAY_REVIEW_ACTIVITIES,
);
export type EnrichedBuildReplayReviewActivity = z.infer<
  typeof EnrichedBuildReplayReviewActivitySchema
>;

export const EnrichedBuildReplayMomentReferenceV1Schema = z.strictObject({
  displayId: OwnershipMomentDisplayIdSchema,
  selectedRank: z.number().int().min(1).max(ENRICHED_BUILD_REPLAY_MAX_MOMENTS),
});
export type EnrichedBuildReplayMomentReferenceV1 = z.infer<
  typeof EnrichedBuildReplayMomentReferenceV1Schema
>;

function momentReferencesSchema(minimum: number) {
  return z
    .array(EnrichedBuildReplayMomentReferenceV1Schema)
    .min(minimum)
    .max(ENRICHED_BUILD_REPLAY_MAX_MOMENTS)
    .superRefine((value, context) => {
      if (new Set(value.map((item) => item.displayId)).size !== value.length) {
        context.addIssue({ code: "custom", message: "Moment references must be unique." });
      }
      if (new Set(value.map((item) => item.selectedRank)).size !== value.length) {
        context.addIssue({ code: "custom", message: "Moment reference ranks must be unique." });
      }
      if (
        value
          .toSorted((left, right) => left.selectedRank - right.selectedRank)
          .some(
            (item, index) =>
              item.displayId !== value[index]?.displayId ||
              item.selectedRank !== value[index]?.selectedRank,
          )
      ) {
        context.addIssue({ code: "custom", message: "Moment references must be rank ordered." });
      }
    });
}

export const EnrichedBuildReplayChangedFileV1Schema = z.strictObject({
  reconciliationId: safeIdSchema,
  reconciliationCapturedAt: timestampSchema,
  file: ReplayChangedFileV1Schema,
  linkedMoments: momentReferencesSchema(1),
});
export type EnrichedBuildReplayChangedFileV1 = z.infer<
  typeof EnrichedBuildReplayChangedFileV1Schema
>;

function evidenceIdsSchema(minimum: number, maximum: number) {
  return z
    .array(EvidenceIdSchema)
    .min(minimum)
    .max(maximum)
    .superRefine((value, context) => {
      if (new Set(value).size !== value.length) {
        context.addIssue({ code: "custom", message: "Replay Evidence IDs must be unique." });
      }
      if (value.toSorted().some((item, index) => item !== value[index])) {
        context.addIssue({ code: "custom", message: "Replay Evidence IDs must be sorted." });
      }
    });
}

export const EnrichedBuildReplayMomentSupportV1Schema = z.strictObject({
  citedEvidenceIds: evidenceIdsSchema(1, 32),
  expandedEvidenceIds: evidenceIdsSchema(0, 64),
  facts: z.array(CandidateValidationFactV1Schema).max(64),
  score: CandidateValidationScoreV1Schema,
  evidenceIds: evidenceIdsSchema(1, 128),
});
export type EnrichedBuildReplayMomentSupportV1 = z.infer<
  typeof EnrichedBuildReplayMomentSupportV1Schema
>;

export const EnrichedBuildReplayMomentReviewV1Schema = z
  .strictObject({
    activity: EnrichedBuildReplayReviewActivitySchema,
    state: MomentInteractionStateV1Schema,
  })
  .superRefine((value, context) => {
    const expected =
      value.state.ownershipRecordCount > 0
        ? "responded"
        : value.state.evidenceViewCount > 0
          ? "evidence_opened"
          : value.state.viewCount > 0
            ? "viewed"
            : "none";
    if (value.activity !== expected) {
      context.addIssue({ code: "custom", message: "Review activity differs from recorded state." });
    }
  });
export type EnrichedBuildReplayMomentReviewV1 = z.infer<
  typeof EnrichedBuildReplayMomentReviewV1Schema
>;

export const EnrichedBuildReplayMomentV1Schema = z
  .strictObject({
    displayId: OwnershipMomentDisplayIdSchema,
    selectedRank: z.number().int().min(1).max(ENRICHED_BUILD_REPLAY_MAX_MOMENTS),
    sourceIndex: z.number().int().min(0).max(6),
    sourceCandidateFingerprint: fingerprintSchema,
    proposal: CandidateMomentV1Schema,
    support: EnrichedBuildReplayMomentSupportV1Schema,
    review: EnrichedBuildReplayMomentReviewV1Schema,
  })
  .superRefine((value, context) => {
    if (
      value.review.state.momentId !== value.displayId ||
      value.review.state.sourceIndex !== value.sourceIndex ||
      value.review.state.sourceCandidateFingerprint !== value.sourceCandidateFingerprint ||
      value.review.state.momentType !== value.proposal.type
    ) {
      context.addIssue({ code: "custom", message: "Moment review state has foreign identity." });
    }
    if (value.support.expandedEvidenceIds.some((id) => value.proposal.evidenceIds.includes(id))) {
      context.addIssue({
        code: "custom",
        message: "Expanded replay Evidence must exclude provider-cited Evidence.",
      });
    }
    const cited = [...value.proposal.evidenceIds].toSorted();
    if (
      cited.length !== value.support.citedEvidenceIds.length ||
      cited.some((item, index) => item !== value.support.citedEvidenceIds[index])
    ) {
      context.addIssue({ code: "custom", message: "Moment cited Evidence differs from proposal." });
    }
    const expectedEvidence = [
      ...new Set([
        ...value.proposal.evidenceIds,
        ...value.support.expandedEvidenceIds,
        ...value.support.facts.flatMap((fact) => fact.evidenceIds),
      ]),
    ].toSorted();
    if (
      expectedEvidence.length !== value.support.evidenceIds.length ||
      expectedEvidence.some((item, index) => item !== value.support.evidenceIds[index])
    ) {
      context.addIssue({ code: "custom", message: "Moment Evidence union is inconsistent." });
    }
  });
export type EnrichedBuildReplayMomentV1 = z.infer<typeof EnrichedBuildReplayMomentV1Schema>;

export const EnrichedBuildReplayGapV1Schema = z.strictObject({
  gap: ReplayEvidenceGapV1Schema,
  linkedMoments: momentReferencesSchema(0),
});
export type EnrichedBuildReplayGapV1 = z.infer<typeof EnrichedBuildReplayGapV1Schema>;

export const EnrichedBuildReplaySectionCountsV1Schema = z.strictObject({
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type EnrichedBuildReplaySectionCountsV1 = z.infer<
  typeof EnrichedBuildReplaySectionCountsV1Schema
>;

export const EnrichedBuildReplayReviewSummaryV1Schema = z.strictObject({
  selected: z.number().int().min(0).max(7),
  none: z.number().int().min(0).max(7),
  viewed: z.number().int().min(0).max(7),
  evidenceOpened: z.number().int().min(0).max(7),
  responded: z.number().int().min(0).max(7),
  totalMomentViews: z.number().int().nonnegative(),
  totalEvidenceViews: z.number().int().nonnegative(),
  totalInteractions: z.number().int().nonnegative(),
  totalOwnershipRecords: z.number().int().nonnegative(),
});
export type EnrichedBuildReplayReviewSummaryV1 = z.infer<
  typeof EnrichedBuildReplayReviewSummaryV1Schema
>;

export const EnrichedBuildReplaySourceV1Schema = z
  .strictObject({
    rawReplaySchemaVersion: z.literal(RAW_REPLAY_SCHEMA_VERSION),
    ownershipMomentsSchemaVersion: z.literal(OWNERSHIP_MOMENTS_SCHEMA_VERSION),
    ownershipMomentsProjectionVersion: z.literal(OWNERSHIP_MOMENTS_PROJECTION_VERSION),
    momentInteractionSchemaVersion: z.literal(MOMENT_INTERACTION_SCHEMA_VERSION),
    finalizationId: safeIdSchema,
    generationId: z
      .string()
      .regex(/^gen_[0-9a-f]{48}$/u)
      .nullable(),
    validationId: validationIdSchema.nullable(),
    validationKey: validationKeySchema.nullable(),
    sourceCandidateArtifactId: safeIdSchema.nullable(),
    sourceCandidateFingerprint: fingerprintSchema.nullable(),
    reportArtifactId: safeIdSchema.nullable(),
    reportFingerprint: fingerprintSchema.nullable(),
    evidenceGraphArtifactId: safeIdSchema.nullable(),
    evidenceGraphInputFingerprint: sha256HexSchema.nullable(),
    sourceVersions: CandidateValidationSourceVersionsV1Schema.nullable(),
    policyVersions: OwnershipMomentsPolicyVersionsV1Schema.nullable(),
  })
  .superRefine((value, context) => {
    const validationFields = [
      value.generationId,
      value.validationId,
      value.validationKey,
      value.sourceCandidateArtifactId,
      value.sourceCandidateFingerprint,
      value.reportArtifactId,
      value.reportFingerprint,
      value.evidenceGraphInputFingerprint,
      value.sourceVersions,
      value.policyVersions,
    ];
    const hasAny = validationFields.some((field) => field !== null);
    const hasAll = validationFields.every((field) => field !== null);
    if (hasAny !== hasAll || (hasAll && value.evidenceGraphArtifactId === null)) {
      context.addIssue({ code: "custom", message: "Replay source identity tuple is incomplete." });
    }
    if (!hasAny && value.evidenceGraphInputFingerprint !== null) {
      context.addIssue({
        code: "custom",
        message: "Replay Graph input fingerprint requires a validation source tuple.",
      });
    }
  });
export type EnrichedBuildReplaySourceV1 = z.infer<typeof EnrichedBuildReplaySourceV1Schema>;

export const EnrichedBuildReplayV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(ENRICHED_BUILD_REPLAY_SCHEMA_VERSION),
    projectorVersion: z.literal(ENRICHED_BUILD_REPLAY_PROJECTOR_VERSION),
    projectionFingerprint: fingerprintSchema,
    runId: safeIdSchema,
    outcome: EnrichedBuildReplayOutcomeSchema,
    diagnosticCode: EnrichedBuildReplayDiagnosticSchema,
    limitations: limitationsSchema,
    source: EnrichedBuildReplaySourceV1Schema.nullable(),
    goal: z.string().max(262_144).nullable(),
    completion: z
      .strictObject({
        conversationId: safeIdSchema,
        workspaceId: safeIdSchema,
        status: z.enum(["Completed", "Partial", "Failed", "Abandoned"]),
        completeness: z.enum(["complete", "partial", "failed", "abandoned", "in_progress"]),
        startedAt: timestampSchema,
        endedAt: timestampSchema,
        finalizationDiagnostic: z.string().min(1).max(128).nullable(),
        finalizedAt: timestampSchema,
      })
      .nullable(),
    files: z.strictObject({
      counts: EnrichedBuildReplaySectionCountsV1Schema,
      items: z.array(EnrichedBuildReplayChangedFileV1Schema).max(ENRICHED_BUILD_REPLAY_MAX_FILES),
    }),
    moments: z.array(EnrichedBuildReplayMomentV1Schema).max(ENRICHED_BUILD_REPLAY_MAX_MOMENTS),
    verification: z.strictObject({
      counts: EnrichedBuildReplaySectionCountsV1Schema,
      items: z.array(ReplayVerificationV1Schema).max(ENRICHED_BUILD_REPLAY_MAX_VERIFICATION),
    }),
    gaps: z.strictObject({
      counts: EnrichedBuildReplaySectionCountsV1Schema,
      items: z.array(EnrichedBuildReplayGapV1Schema).max(ENRICHED_BUILD_REPLAY_MAX_GAPS),
    }),
    reviewSummary: EnrichedBuildReplayReviewSummaryV1Schema,
  })
  .superRefine((value, context) => {
    const sections = [value.files, value.verification, value.gaps];
    if (
      sections.some(
        (section) =>
          section.counts.returned !== section.items.length ||
          section.counts.total < section.counts.returned ||
          section.counts.truncated !== section.counts.total > section.counts.returned,
      )
    ) {
      context.addIssue({ code: "custom", message: "Replay section counts are inconsistent." });
    }
    if (value.reviewSummary.selected !== value.moments.length) {
      context.addIssue({ code: "custom", message: "Review summary selected count differs." });
    }
    const orderedMoments = [...value.moments].toSorted(
      (left, right) => left.selectedRank - right.selectedRank,
    );
    if (
      orderedMoments.some((moment, index) => moment.selectedRank !== index + 1) ||
      new Set(value.moments.map((moment) => moment.displayId)).size !== value.moments.length ||
      new Set(value.moments.map((moment) => moment.sourceIndex)).size !== value.moments.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Replay Moment identity/order is inconsistent.",
      });
    }
    const momentReferences = new Map(
      value.moments.map((moment) => [moment.displayId, moment.selectedRank] as const),
    );
    for (const reference of [
      ...value.files.items.flatMap((item) => item.linkedMoments),
      ...value.gaps.items.flatMap((item) => item.linkedMoments),
    ]) {
      if (momentReferences.get(reference.displayId) !== reference.selectedRank) {
        context.addIssue({
          code: "custom",
          message: "Replay section references a foreign Moment.",
        });
        break;
      }
    }
    const stateTotals = value.moments.reduce(
      (totals, moment) => ({
        momentViews: totals.momentViews + moment.review.state.viewCount,
        evidenceViews: totals.evidenceViews + moment.review.state.evidenceViewCount,
        interactions: totals.interactions + moment.review.state.interactionCount,
        ownershipRecords: totals.ownershipRecords + moment.review.state.ownershipRecordCount,
      }),
      { momentViews: 0, evidenceViews: 0, interactions: 0, ownershipRecords: 0 },
    );
    if (
      value.reviewSummary.totalMomentViews !== stateTotals.momentViews ||
      value.reviewSummary.totalEvidenceViews !== stateTotals.evidenceViews ||
      value.reviewSummary.totalInteractions !== stateTotals.interactions ||
      value.reviewSummary.totalOwnershipRecords !== stateTotals.ownershipRecords
    ) {
      context.addIssue({ code: "custom", message: "Replay review totals do not reconcile." });
    }
    if (
      value.reviewSummary.none +
        value.reviewSummary.viewed +
        value.reviewSummary.evidenceOpened +
        value.reviewSummary.responded !==
      value.reviewSummary.selected
    ) {
      context.addIssue({ code: "custom", message: "Review activity counts do not reconcile." });
    }
    if (value.outcome === "not_available") {
      if (
        value.diagnosticCode !== "run_not_terminal" ||
        value.source !== null ||
        value.goal !== null ||
        value.completion !== null ||
        value.limitations.length !== 0 ||
        value.files.items.length !== 0 ||
        value.moments.length !== 0 ||
        value.verification.items.length !== 0 ||
        value.gaps.items.length !== 0 ||
        value.reviewSummary.selected !== 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Unavailable replay contains enriched output.",
        });
      }
    } else if (value.source === null || value.goal === null || value.completion === null) {
      context.addIssue({ code: "custom", message: "Available replay is missing its source." });
    } else if (value.source.validationId === null && value.moments.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Replay without a validation cannot contain selected Moments.",
      });
    }
    if (
      value.outcome !== "not_available" &&
      (value.outcome === "ready") !== (value.limitations.length === 0)
    ) {
      context.addIssue({ code: "custom", message: "Replay outcome and limitations disagree." });
    }
    if (value.outcome === "ready" && value.diagnosticCode !== "completed") {
      context.addIssue({ code: "custom", message: "Ready replay has the wrong diagnostic." });
    }
    if (value.outcome === "partial" && value.diagnosticCode !== "source_partial") {
      context.addIssue({ code: "custom", message: "Partial replay has the wrong diagnostic." });
    }
  });
export type EnrichedBuildReplayV1 = z.infer<typeof EnrichedBuildReplayV1Schema>;
