import {
  DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES,
  DiagnosticsBundleV1Schema,
  DiagnosticsDashboardV1Schema,
} from "@ownloop/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ReplayApiClient } from "./api.js";
import {
  DIAGNOSTICS_DOWNLOAD_FILENAME,
  DiagnosticsPanel,
  triggerDiagnosticsDownload,
} from "./Diagnostics.js";

const fingerprint = `sha256:${"a".repeat(64)}`;
const dashboard = DiagnosticsDashboardV1Schema.parse({
  schemaVersion: 1,
  projectorVersion: "0.1.0",
  diagnosticMode: "off",
  limitations: ["diagnostics_off"],
  process: null,
  redaction: {
    preparedReceiptCount: 0,
    legacyReceiptCount: 0,
    redactedFieldCount: 0,
    redactedValueCount: 0,
    pathReplacementCount: 0,
    droppedUnknownFieldCount: 0,
    truncatedValueCount: 0,
    receiptsByHook: [],
    receiptsByRule: [],
  },
  runs: { totalRuns: 0, byStatus: [] },
  finalizations: {
    total: 0,
    byStatus: [],
    byMode: [],
    byDiagnosticCode: [],
    withoutDiagnosticCode: 0,
  },
  evidenceGapCounts: [],
  validations: {
    totalValidations: 0,
    byOutcome: [],
    sourceCandidates: 0,
    rejectedCandidates: 0,
    duplicateCandidates: 0,
    unselectedCandidates: 0,
    selectedCandidates: 0,
    reasonCounts: [],
  },
  recentRuns: [],
  recentRunsTotal: 0,
  recentRunsTruncated: false,
  fingerprint,
});
const bundle = DiagnosticsBundleV1Schema.parse({
  schemaVersion: 1,
  applicationVersions: { app: "0.1.0", contracts: "0.1.0", daemon: "0.1.0" },
  exportedAt: "2026-07-25T23:00:00.000Z",
  dashboardFingerprint: fingerprint,
  dashboard,
  excludedDataClasses: [...DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES],
  fingerprint: `sha256:${"b".repeat(64)}`,
});

const populatedDashboard = DiagnosticsDashboardV1Schema.parse({
  ...dashboard,
  diagnosticMode: "counts_only",
  limitations: ["process_counters_reset_on_restart"],
  process: {
    serverStarted: 1,
    serverStopped: 0,
    acceptedReceipts: 2,
    duplicateReceipts: 1,
    rejectedRequests: 1,
    acceptedByHook: [{ hookName: "Stop", count: 2 }],
    duplicateByHook: [{ hookName: "Stop", count: 1 }],
    rejectedByCode: [{ code: "invalid_payload", count: 1 }],
  },
  redaction: {
    ...dashboard.redaction,
    preparedReceiptCount: 2,
    redactedFieldCount: 3,
    redactedValueCount: 3,
    receiptsByHook: [{ hookName: "Stop", count: 2 }],
    receiptsByRule: [{ code: "field.secret", count: 2 }],
  },
  runs: { totalRuns: 1, byStatus: [{ status: "Completed", count: 1 }] },
  finalizations: {
    total: 1,
    byStatus: [{ code: "Completed", count: 1 }],
    byMode: [{ code: "normal", count: 1 }],
    byDiagnosticCode: [],
    withoutDiagnosticCode: 1,
  },
  validations: {
    totalValidations: 1,
    byOutcome: [{ code: "ready", count: 1 }],
    sourceCandidates: 1,
    rejectedCandidates: 0,
    duplicateCandidates: 0,
    unselectedCandidates: 0,
    selectedCandidates: 1,
    reasonCounts: [],
  },
  recentRuns: [
    {
      runId: "run-1",
      runNumber: 1,
      status: "Completed",
      endedAt: "2026-07-25T22:00:00.000Z",
      evidenceGapCount: 0,
      finalization: {
        terminalStatus: "Completed",
        mode: "normal",
        diagnosticCode: null,
        finalizedAt: "2026-07-25T22:00:00.000Z",
      },
      validation: {
        validationId: "validation-1",
        outcome: "ready",
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
  fingerprint: `sha256:${"c".repeat(64)}`,
});

const client = Object.freeze({}) as ReplayApiClient;

describe("Diagnostics dashboard UI", () => {
  it("renders diagnostics-off and sanitization limitations without absence claims", () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPanel
        client={client}
        initialDashboard={dashboard}
        onUnauthorized={() => undefined}
      />,
    );
    expect(html).toContain("Diagnostics and evidence quality");
    expect(html).toContain("diagnostics off");
    expect(html).toContain("not proof that an event never occurred");
    expect(html).toContain("Download sanitized JSON");
    expect(html).toContain("Candidate prose");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders controlled populated counts without raw diagnostic content", () => {
    const html = renderToStaticMarkup(
      <DiagnosticsPanel
        client={client}
        initialDashboard={populatedDashboard}
        onUnauthorized={() => undefined}
      />,
    );
    expect(html).toContain("Accepted");
    expect(html).toContain("invalid_payload");
    expect(html).toContain("field.secret");
    expect(html).toContain("Completed");
    expect(html).toContain("process counters reset on restart");
    expect(html).not.toContain("repositoryRoot");
    expect(html).not.toContain("apiKey");
  });

  it("revokes the ephemeral object URL even when the click fails", () => {
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click: vi.fn(() => {
        throw new Error("download blocked");
      }),
    };
    const documentValue = { createElement: vi.fn(() => anchor) } as unknown as Document;
    const revokeObjectURL = vi.fn();
    expect(() =>
      triggerDiagnosticsDownload(bundle, {
        documentValue,
        urlApi: { createObjectURL: () => "blob:diagnostics-error", revokeObjectURL },
      }),
    ).toThrow("download blocked");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagnostics-error");
  });

  it("creates an ephemeral object URL and revokes it after download", () => {
    const click = vi.fn();
    const anchor = { href: "", download: "", rel: "", click };
    const documentValue = {
      createElement: vi.fn(() => anchor),
    } as unknown as Document;
    const createObjectURL = vi.fn(() => "blob:diagnostics");
    const revokeObjectURL = vi.fn();
    triggerDiagnosticsDownload(bundle, {
      documentValue,
      urlApi: { createObjectURL, revokeObjectURL },
    });
    expect(anchor.download).toBe(DIAGNOSTICS_DOWNLOAD_FILENAME);
    expect(anchor.href).toBe("blob:diagnostics");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagnostics");
  });
});
