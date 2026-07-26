import { describe, expect, it } from "vitest";

import type {
  CandidateValidationReason,
  DiagnosticsProcessSnapshotV1,
  DiagnosticsRedactionAggregatesV1,
} from "@ownloop/contracts";
import type { OwnLoopPersistence } from "../persistence/index.js";
import {
  prepareDiagnosticsBundle,
  projectDiagnosticsDashboard,
  type DiagnosticsDashboardDependencies,
} from "./projector.js";

const timestamp = "2026-07-25T23:00:00.000Z";

const process: DiagnosticsProcessSnapshotV1 = {
  serverStarted: 1,
  serverStopped: 0,
  acceptedReceipts: 1,
  duplicateReceipts: 0,
  rejectedRequests: 1,
  acceptedByHook: [{ hookName: "UserPromptSubmit", count: 1 }],
  duplicateByHook: [],
  rejectedByCode: [{ code: "invalid_payload", count: 1 }],
};

const redaction: DiagnosticsRedactionAggregatesV1 = {
  preparedReceiptCount: 1,
  legacyReceiptCount: 0,
  redactedFieldCount: 1,
  redactedValueCount: 1,
  pathReplacementCount: 0,
  droppedUnknownFieldCount: 0,
  truncatedValueCount: 0,
  receiptsByHook: [{ hookName: "UserPromptSubmit", count: 1 }],
  receiptsByRule: [{ code: "field.secret", count: 1 }],
};

function validated(reason: CandidateValidationReason = "missing_evidence") {
  return {
    record: {
      validationId: "val_1",
      runId: "run_1",
      outcome: "ready",
    },
    report: {
      value: {
        counts: {
          source: 3,
          rejected: 1,
          valid: 2,
          selected: 1,
          duplicate: 1,
          unselected: 1,
        },
        items: [{ reasons: [reason] }, { reasons: [] }, { reasons: ["duplicate_candidate"] }],
      },
    },
  } as never;
}

function dependencies(input?: Readonly<{ off?: boolean; finalizationTamper?: boolean }>) {
  const finalization = {
    terminalStatus: "Completed",
    mode: "normal",
    diagnosticCode: null,
    finalizedAt: timestamp,
  };
  const persistence = {
    diagnostics: {
      readRedactionAggregates: () => redaction,
      countRuns: () => 1,
      countRunsByStatus: () => [{ status: "Completed", count: 1 }],
      listRecentRuns: () => [
        {
          runId: "run_1",
          conversationId: "conv_1",
          runNumber: 1,
          status: "Completed",
          startedAt: "2026-07-25T22:00:00.000Z",
          endedAt: timestamp,
          evidenceGapCount: 1,
        },
      ],
      listFinalizations: () => [
        {
          runId: "run_1",
          ...finalization,
        },
      ],
      listEvidenceGapCodes: () => ["missing_test", "missing_test"],
      listLatestCurrentValidationIds: () => ["val_1"],
    },
    runFinalizations: {
      getByRun: () => ({
        ...finalization,
        finalizedAt: input?.finalizationTamper ? "2026-07-25T23:00:01.000Z" : timestamp,
      }),
    },
  } as unknown as OwnLoopPersistence;
  return {
    persistence,
    artifactStore: {} as never,
    settings: {
      diagnosticsDashboardState: () =>
        input?.off
          ? ({ mode: "off", process: null } as const)
          : ({ mode: "counts_only", process } as const),
    },
    readValidation: async () => validated(),
  } as unknown as DiagnosticsDashboardDependencies;
}

describe("projectDiagnosticsDashboard", () => {
  it("produces deterministic verified aggregates and fingerprints", async () => {
    const first = await projectDiagnosticsDashboard(dependencies());
    const second = await projectDiagnosticsDashboard(dependencies());
    expect(first).toEqual(second);
    expect(first.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.evidenceGapCounts).toEqual([{ code: "missing_test", count: 2 }]);
    expect(first.validations).toMatchObject({
      sourceCandidates: 3,
      rejectedCandidates: 1,
      duplicateCandidates: 1,
      unselectedCandidates: 0,
      selectedCandidates: 1,
    });
    expect(first.validations.reasonCounts).toEqual([
      { code: "duplicate_candidate", count: 1 },
      { code: "missing_evidence", count: 1 },
    ]);
    expect(first.recentRuns[0]?.validation?.reasonCounts).toEqual([
      { code: "duplicate_candidate", count: 1 },
      { code: "missing_evidence", count: 1 },
    ]);
    expect(JSON.stringify(first)).not.toContain("prompt");
  });

  it("represents disabled process diagnostics without fabricating zero counters", async () => {
    const value = await projectDiagnosticsDashboard(dependencies({ off: true }));
    expect(value.diagnosticMode).toBe("off");
    expect(value.process).toBeNull();
    expect(value.limitations).toEqual(["diagnostics_off"]);
  });

  it("fails closed when finalization index and validated read-back disagree", async () => {
    await expect(
      projectDiagnosticsDashboard(dependencies({ finalizationTamper: true })),
    ).rejects.toThrow(/Finalization diagnostics differ/u);
  });

  it("prepares an ephemeral canonical sanitized bundle", async () => {
    const dashboard = await projectDiagnosticsDashboard(dependencies());
    const first = prepareDiagnosticsBundle(dashboard, () => new Date(timestamp));
    const second = prepareDiagnosticsBundle(dashboard, () => new Date(timestamp));
    expect(first).toEqual(second);
    expect(first.dashboardFingerprint).toBe(dashboard.fingerprint);
    expect(first.applicationVersions).toEqual({
      app: "0.0.0",
      contracts: "0.0.0",
      daemon: "0.0.0",
    });
    expect(first.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const dashboardBytes = JSON.stringify(first.dashboard);
    expect(dashboardBytes).not.toMatch(/prompt|apiKey|evidenceId|artifactId/u);
    expect(first.excludedDataClasses).toContain("repository_and_source_content");
  });
});
