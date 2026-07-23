import { z } from "zod";

const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const safeVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const safeRuleIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u);
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const VERIFICATION_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const VERIFICATION_EXTRACTOR_VERSION = "0.1.0" as const;
export const VERIFICATION_COMMAND_RULE_SET_VERSION = "ownloop-node-command-rules-v1" as const;
export const VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION = "ownloop-output-reduction-v1" as const;
export const VERIFICATION_MAX_RUN_EVENTS = 10_000;
export const VERIFICATION_MAX_COMMAND_OBSERVATIONS = 500;
export const VERIFICATION_MAX_TEST_FILE_REFERENCES = 2_000;
export const VERIFICATION_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const VERIFICATION_MAX_REDUCED_OUTPUTS = 5;
export const VERIFICATION_MAX_OUTPUT_EXCERPT_CODE_POINTS = 4_096;

export const VERIFICATION_KINDS = ["test", "lint", "typecheck", "build", "unknown"] as const;
export const VerificationKindSchema = z.enum(VERIFICATION_KINDS);
export type VerificationKind = z.infer<typeof VerificationKindSchema>;

export const VERIFICATION_TOOL_FAMILIES = [
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "vitest",
  "jest",
  "node_test",
  "typescript",
  "eslint",
  "biome",
  "vite",
  "next",
  "rollup",
  "webpack",
  "unknown",
] as const;
export const VerificationToolFamilySchema = z.enum(VERIFICATION_TOOL_FAMILIES);
export type VerificationToolFamily = z.infer<typeof VerificationToolFamilySchema>;

export const VERIFICATION_SOURCE_TOOL_OUTCOMES = ["succeeded", "failed"] as const;
export const VerificationSourceToolOutcomeSchema = z.enum(VERIFICATION_SOURCE_TOOL_OUTCOMES);
export type VerificationSourceToolOutcome = z.infer<typeof VerificationSourceToolOutcomeSchema>;

export const VERIFICATION_OBSERVED_STATUSES = [
  "passed",
  "failed",
  "observed_without_exit_code",
  "unknown",
] as const;
export const VerificationObservedStatusSchema = z.enum(VERIFICATION_OBSERVED_STATUSES);
export type VerificationObservedStatus = z.infer<typeof VerificationObservedStatusSchema>;

export const VERIFICATION_OUTPUT_FIELDS = [
  "stdout",
  "stderr",
  "output",
  "tool_response",
  "error",
] as const;
export const VerificationOutputFieldSchema = z.enum(VERIFICATION_OUTPUT_FIELDS);
export type VerificationOutputField = z.infer<typeof VerificationOutputFieldSchema>;

export const VERIFICATION_EVIDENCE_OUTCOMES = ["extracted", "partial", "unavailable"] as const;
export const VerificationEvidenceOutcomeSchema = z.enum(VERIFICATION_EVIDENCE_OUTCOMES);
export type VerificationEvidenceOutcome = z.infer<typeof VerificationEvidenceOutcomeSchema>;

export const VERIFICATION_EVIDENCE_DIAGNOSTIC_CODES = [
  "source_observation_partial",
  "classification_partial",
  "source_and_classification_partial",
  "classification_unavailable",
] as const;
export const VerificationEvidenceDiagnosticCodeSchema = z.enum(
  VERIFICATION_EVIDENCE_DIAGNOSTIC_CODES,
);
export type VerificationEvidenceDiagnosticCode = z.infer<
  typeof VerificationEvidenceDiagnosticCodeSchema
>;

export const VerificationReducedOutputV1Schema = z.strictObject({
  field: VerificationOutputFieldSchema,
  acceptedByteCount: z
    .number()
    .int()
    .nonnegative()
    .max(16 * 1024 * 1024),
  acceptedSha256: sha256HexSchema,
  excerpt: z.string().max(VERIFICATION_MAX_OUTPUT_EXCERPT_CODE_POINTS * 2),
  excerptByteCount: z
    .number()
    .int()
    .nonnegative()
    .max(64 * 1024),
  lineCount: z.number().int().nonnegative().max(10_000_000),
  truncated: z.boolean(),
});
export type VerificationReducedOutputV1 = z.infer<typeof VerificationReducedOutputV1Schema>;

export const VerificationCommandObservationV1Schema = z
  .strictObject({
    observationIndex: z.number().int().nonnegative(),
    sourceEventId: safeIdSchema,
    commandFingerprint: sha256HexSchema.nullable(),
    kind: VerificationKindSchema,
    ruleId: safeRuleIdSchema,
    toolFamily: VerificationToolFamilySchema,
    sourceToolOutcome: VerificationSourceToolOutcomeSchema,
    exitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
    status: VerificationObservedStatusSchema,
    reducedOutputs: z
      .array(VerificationReducedOutputV1Schema)
      .max(VERIFICATION_MAX_REDUCED_OUTPUTS),
    commandEventId: safeIdSchema,
    verificationEventId: safeIdSchema.nullable(),
  })
  .superRefine((value, context) => {
    const outputFields = value.reducedOutputs.map((entry) => entry.field);
    const sortedFields = outputFields.toSorted(
      (left, right) =>
        VERIFICATION_OUTPUT_FIELDS.indexOf(left) - VERIFICATION_OUTPUT_FIELDS.indexOf(right),
    );
    if (sortedFields.some((field, index) => field !== outputFields[index])) {
      context.addIssue({ code: "custom", message: "Reduced outputs must be sorted." });
    }
    if (new Set(outputFields).size !== outputFields.length) {
      context.addIssue({ code: "custom", message: "Reduced outputs must be unique." });
    }

    const exitConsistent =
      (value.sourceToolOutcome === "succeeded" &&
        (value.exitCode === null || value.exitCode === 0)) ||
      (value.sourceToolOutcome === "failed" && (value.exitCode === null || value.exitCode !== 0));
    if (!exitConsistent) {
      context.addIssue({ code: "custom", message: "Observed exit code is inconsistent." });
    }

    if (value.kind === "unknown") {
      if (
        value.ruleId !== "unknown.unsupported_command" ||
        value.toolFamily !== "unknown" ||
        value.status !== "unknown" ||
        value.verificationEventId !== null
      ) {
        context.addIssue({ code: "custom", message: "Unknown command observation is invalid." });
      }
    } else {
      if (
        value.ruleId === "unknown.unsupported_command" ||
        value.toolFamily === "unknown" ||
        value.status === "unknown" ||
        value.verificationEventId === null
      ) {
        context.addIssue({ code: "custom", message: "Recognized command observation is invalid." });
      }
      const expectedStatus =
        value.sourceToolOutcome === "failed"
          ? "failed"
          : value.exitCode === 0
            ? "passed"
            : "observed_without_exit_code";
      if (value.status !== expectedStatus) {
        context.addIssue({ code: "custom", message: "Verification status is inconsistent." });
      }
    }
  });
export type VerificationCommandObservationV1 = z.infer<
  typeof VerificationCommandObservationV1Schema
>;

export const VerificationTestFileChangeV1Schema = z
  .strictObject({
    entryIndex: z.number().int().nonnegative(),
    fileEventId: safeIdSchema,
    classificationRuleIds: z.array(safeRuleIdSchema).min(1).max(32),
  })
  .superRefine((value, context) => {
    const sorted = value.classificationRuleIds.toSorted();
    if (sorted.some((ruleId, index) => ruleId !== value.classificationRuleIds[index])) {
      context.addIssue({ code: "custom", message: "Classification rule IDs must be sorted." });
    }
    if (new Set(sorted).size !== sorted.length) {
      context.addIssue({ code: "custom", message: "Classification rule IDs must be unique." });
    }
  });
export type VerificationTestFileChangeV1 = z.infer<typeof VerificationTestFileChangeV1Schema>;

export const VerificationKindAggregateV1Schema = z.strictObject({
  kind: z.enum(["test", "lint", "typecheck", "build"]),
  observationCount: z.number().int().positive(),
  passedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  observedWithoutExitCodeCount: z.number().int().nonnegative(),
});
export type VerificationKindAggregateV1 = z.infer<typeof VerificationKindAggregateV1Schema>;

export const VerificationEvidenceAggregatesV1Schema = z.strictObject({
  commandObservationCount: z.number().int().nonnegative(),
  recognizedCommandCount: z.number().int().nonnegative(),
  unknownCommandCount: z.number().int().nonnegative(),
  testFileChangeCount: z.number().int().nonnegative(),
  kinds: z.array(VerificationKindAggregateV1Schema).max(4),
});
export type VerificationEvidenceAggregatesV1 = z.infer<
  typeof VerificationEvidenceAggregatesV1Schema
>;

export const DeterministicVerificationEvidenceV1Schema = z
  .strictObject({
    schemaVersion: z.literal(VERIFICATION_EVIDENCE_SCHEMA_VERSION),
    extractorVersion: safeVersionSchema,
    commandRuleSetVersion: safeVersionSchema,
    outputReductionPolicyVersion: safeVersionSchema,
    runId: safeIdSchema,
    finalizationId: safeIdSchema,
    classificationArtifactId: safeIdSchema,
    classificationInputFingerprint: sha256HexSchema,
    sourceEventCount: z.number().int().nonnegative().max(VERIFICATION_MAX_RUN_EVENTS),
    outcome: VerificationEvidenceOutcomeSchema,
    diagnosticCode: VerificationEvidenceDiagnosticCodeSchema.nullable(),
    inputFingerprint: sha256HexSchema,
    commandObservations: z
      .array(VerificationCommandObservationV1Schema)
      .max(VERIFICATION_MAX_COMMAND_OBSERVATIONS),
    testFileChanges: z
      .array(VerificationTestFileChangeV1Schema)
      .max(VERIFICATION_MAX_TEST_FILE_REFERENCES),
    aggregates: VerificationEvidenceAggregatesV1Schema,
  })
  .superRefine((value, context) => {
    if (value.extractorVersion !== VERIFICATION_EXTRACTOR_VERSION) {
      context.addIssue({ code: "custom", message: "Unsupported verification extractor version." });
    }
    if (value.commandRuleSetVersion !== VERIFICATION_COMMAND_RULE_SET_VERSION) {
      context.addIssue({ code: "custom", message: "Unsupported command rule-set version." });
    }
    if (value.outputReductionPolicyVersion !== VERIFICATION_OUTPUT_REDUCTION_POLICY_VERSION) {
      context.addIssue({ code: "custom", message: "Unsupported output reduction version." });
    }
    const outcomeValid =
      (value.outcome === "extracted" && value.diagnosticCode === null) ||
      (value.outcome === "partial" &&
        (value.diagnosticCode === "source_observation_partial" ||
          value.diagnosticCode === "classification_partial" ||
          value.diagnosticCode === "source_and_classification_partial" ||
          value.diagnosticCode === "classification_unavailable")) ||
      (value.outcome === "unavailable" &&
        value.diagnosticCode === "classification_unavailable" &&
        value.commandObservations.length === 0 &&
        value.testFileChanges.length === 0);
    if (!outcomeValid) {
      context.addIssue({ code: "custom", message: "Verification outcome is inconsistent." });
    }
    if (
      value.commandObservations.some((observation, index) => observation.observationIndex !== index)
    ) {
      context.addIssue({ code: "custom", message: "Observation indices must be contiguous." });
    }
    const sourceEventIds = value.commandObservations.map((entry) => entry.sourceEventId);
    if (new Set(sourceEventIds).size !== sourceEventIds.length) {
      context.addIssue({ code: "custom", message: "Source command Events must be unique." });
    }
    const derivedEventIds = value.commandObservations.flatMap((entry) =>
      entry.verificationEventId === null
        ? [entry.commandEventId]
        : [entry.commandEventId, entry.verificationEventId],
    );
    if (new Set(derivedEventIds).size !== derivedEventIds.length) {
      context.addIssue({ code: "custom", message: "Derived verification Events must be unique." });
    }
    const testEntryIndices = value.testFileChanges.map((entry) => entry.entryIndex);
    if (new Set(testEntryIndices).size !== testEntryIndices.length) {
      context.addIssue({ code: "custom", message: "Test-file evidence must be unique." });
    }

    const recognized = value.commandObservations.filter((entry) => entry.kind !== "unknown");
    const unknown = value.commandObservations.length - recognized.length;
    const expectedKinds = new Map<
      "test" | "lint" | "typecheck" | "build",
      { observationCount: number; passedCount: number; failedCount: number; withoutExit: number }
    >();
    for (const observation of recognized) {
      const kind = observation.kind as "test" | "lint" | "typecheck" | "build";
      const current = expectedKinds.get(kind) ?? {
        observationCount: 0,
        passedCount: 0,
        failedCount: 0,
        withoutExit: 0,
      };
      current.observationCount += 1;
      if (observation.status === "passed") current.passedCount += 1;
      if (observation.status === "failed") current.failedCount += 1;
      if (observation.status === "observed_without_exit_code") current.withoutExit += 1;
      expectedKinds.set(kind, current);
    }
    const aggregateKindOrder = ["test", "lint", "typecheck", "build"] as const;
    const actualKinds = value.aggregates.kinds.map((entry) => entry.kind);
    const sortedKinds = actualKinds.toSorted(
      (left, right) => aggregateKindOrder.indexOf(left) - aggregateKindOrder.indexOf(right),
    );
    if (sortedKinds.some((kind, index) => kind !== actualKinds[index])) {
      context.addIssue({ code: "custom", message: "Verification aggregates must be sorted." });
    }
    const aggregateCountsValid =
      value.aggregates.commandObservationCount === value.commandObservations.length &&
      value.aggregates.recognizedCommandCount === recognized.length &&
      value.aggregates.unknownCommandCount === unknown &&
      value.aggregates.testFileChangeCount === value.testFileChanges.length &&
      value.aggregates.kinds.length === expectedKinds.size;
    if (!aggregateCountsValid) {
      context.addIssue({ code: "custom", message: "Verification aggregate counts are invalid." });
    }
    for (const aggregate of value.aggregates.kinds) {
      const expected = expectedKinds.get(aggregate.kind);
      if (
        expected === undefined ||
        aggregate.observationCount !== expected.observationCount ||
        aggregate.passedCount !== expected.passedCount ||
        aggregate.failedCount !== expected.failedCount ||
        aggregate.observedWithoutExitCodeCount !== expected.withoutExit
      ) {
        context.addIssue({ code: "custom", message: "Verification kind aggregate is invalid." });
      }
    }
  });
export type DeterministicVerificationEvidenceV1 = z.infer<
  typeof DeterministicVerificationEvidenceV1Schema
>;
