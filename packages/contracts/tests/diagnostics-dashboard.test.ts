import { describe, expect, it } from "vitest";

import {
  DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES,
  DiagnosticsBundleV1Schema,
  DiagnosticsDashboardV1Schema,
} from "../src/index.js";

const fp = `sha256:${"a".repeat(64)}`;
const timestamp = "2026-07-25T23:00:00.000Z";

function dashboard() {
  return {
    schemaVersion: 1 as const,
    projectorVersion: "0.1.0" as const,
    diagnosticMode: "counts_only" as const,
    limitations: ["process_counters_reset_on_restart"] as const,
    process: {
      serverStarted: 1,
      serverStopped: 0,
      acceptedReceipts: 2,
      duplicateReceipts: 1,
      rejectedRequests: 1,
      acceptedByHook: [
        { hookName: "SessionStart" as const, count: 1 },
        { hookName: "UserPromptSubmit" as const, count: 1 },
      ],
      duplicateByHook: [{ hookName: "UserPromptSubmit" as const, count: 1 }],
      rejectedByCode: [{ code: "invalid_payload" as const, count: 1 }],
    },
    redaction: {
      preparedReceiptCount: 2,
      legacyReceiptCount: 0,
      redactedFieldCount: 1,
      redactedValueCount: 1,
      pathReplacementCount: 0,
      droppedUnknownFieldCount: 0,
      truncatedValueCount: 0,
      receiptsByHook: [
        { hookName: "SessionStart" as const, count: 1 },
        { hookName: "UserPromptSubmit" as const, count: 1 },
      ],
      receiptsByRule: [{ code: "field.secret" as const, count: 1 }],
    },
    runs: {
      totalRuns: 1,
      byStatus: [{ status: "Completed" as const, count: 1 }],
    },
    finalizations: {
      total: 1,
      byStatus: [{ code: "Completed" as const, count: 1 }],
      byMode: [{ code: "normal" as const, count: 1 }],
      byDiagnosticCode: [],
      withoutDiagnosticCode: 1,
    },
    evidenceGapCounts: [],
    validations: {
      totalValidations: 1,
      byOutcome: [{ code: "ready" as const, count: 1 }],
      sourceCandidates: 1,
      rejectedCandidates: 0,
      duplicateCandidates: 0,
      unselectedCandidates: 0,
      selectedCandidates: 1,
      reasonCounts: [],
    },
    recentRuns: [
      {
        runId: "run_1",
        runNumber: 1,
        status: "Completed" as const,
        endedAt: timestamp,
        evidenceGapCount: 0,
        finalization: {
          terminalStatus: "Completed" as const,
          mode: "normal" as const,
          diagnosticCode: null,
          finalizedAt: timestamp,
        },
        validation: {
          validationId: "val_123",
          outcome: "ready" as const,
          sourceCandidates: 1,
          rejectedCandidates: 0,
          duplicateCandidates: 0,
          unselectedCandidates: 0,
          selectedCandidates: 1,
          reasonCounts: [],
        },
        limitations: [],
      },
    ],
    recentRunsTotal: 1,
    recentRunsTruncated: false,
    fingerprint: fp,
  };
}

describe("DiagnosticsDashboardV1Schema", () => {
  it("accepts a strict populated dashboard", () => {
    expect(DiagnosticsDashboardV1Schema.parse(dashboard()).runs.totalRuns).toBe(1);
  });

  it("requires diagnostics-off semantics to be content-free", () => {
    const value = dashboard();
    expect(
      DiagnosticsDashboardV1Schema.safeParse({
        ...value,
        diagnosticMode: "off",
        limitations: ["diagnostics_off"],
        process: null,
      }).success,
    ).toBe(true);
    expect(
      DiagnosticsDashboardV1Schema.safeParse({
        ...value,
        diagnosticMode: "off",
        limitations: ["diagnostics_off"],
      }).success,
    ).toBe(false);
  });

  it("rejects aggregate mismatches and extra fields", () => {
    const value = dashboard();
    expect(
      DiagnosticsDashboardV1Schema.safeParse({
        ...value,
        process: { ...value.process, acceptedReceipts: 99 },
      }).success,
    ).toBe(false);
    expect(DiagnosticsDashboardV1Schema.safeParse({ ...value, prompt: "secret" }).success).toBe(
      false,
    );
  });

  it("rejects impossible Run quality relationships", () => {
    const value = dashboard();
    expect(
      DiagnosticsDashboardV1Schema.safeParse({
        ...value,
        recentRuns: [
          {
            ...value.recentRuns[0],
            status: "Capturing",
            endedAt: timestamp,
            limitations: ["active_run", "no_finalization"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts only canonical sanitized bundles", () => {
    const value = dashboard();
    const bundle = {
      schemaVersion: 1,
      applicationVersions: { app: "0.1.0", contracts: "0.1.0", daemon: "0.1.0" },
      exportedAt: timestamp,
      dashboardFingerprint: fp,
      dashboard: value,
      excludedDataClasses: [...DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES],
      fingerprint: `sha256:${"b".repeat(64)}`,
    };
    expect(DiagnosticsBundleV1Schema.safeParse(bundle).success).toBe(true);
    expect(
      DiagnosticsBundleV1Schema.safeParse({
        ...bundle,
        excludedDataClasses: bundle.excludedDataClasses.toReversed(),
      }).success,
    ).toBe(false);
  });
});
