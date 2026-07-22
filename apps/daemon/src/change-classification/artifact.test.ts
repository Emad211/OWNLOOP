import { describe, expect, it } from "vitest";

import type {
  GitReconciliation,
  GitReconciliationEntry,
  RunFinalization,
} from "../persistence/index.js";
import {
  parseCanonicalChangeClassification,
  prepareDeterministicChangeClassification,
} from "./artifact.js";

function finalization(reconciliationId: string | null): RunFinalization {
  return {
    finalizationId: "finalization-1",
    runId: "run-1",
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    terminalStatus: reconciliationId === null ? "Abandoned" : "Completed",
    mode: reconciliationId === null ? "recovery" : "normal",
    triggerEventId: reconciliationId === null ? null : "stop-event",
    reconciliationId,
    manifestArtifactId: reconciliationId === null ? null : "manifest-artifact",
    finalFingerprint: reconciliationId === null ? null : "b".repeat(64),
    finalSnapshotEventId: reconciliationId === null ? null : "snapshot-event",
    terminalEventId: "terminal-event",
    diagnosticCode: reconciliationId === null ? "stale_capturing_recovered" : null,
    finalizedAt: "2026-07-22T12:00:00.000Z",
    generatorVersion: "0.1.0",
  };
}

function entry(
  index: number,
  path: string | null,
  sensitivity: "normal" | "secret" = "normal",
): GitReconciliationEntry {
  return {
    reconciliationId: "reconciliation-1",
    entryIndex: index,
    fileEventId: `file-event-${index}`,
    pathIdentitySha256: String(index + 1)
      .repeat(64)
      .slice(0, 64),
    relativePath: path,
    changeKind: "modified",
    staged: true,
    unstaged: false,
    sensitivity,
    attribution: "run_relative",
  };
}

function reconciliation(outcome: "captured" | "partial" = "captured"): GitReconciliation {
  const entries = [
    entry(0, "apps/web/src/App.tsx"),
    entry(1, "pnpm-lock.yaml"),
    entry(2, null, "secret"),
  ];
  return {
    reconciliationId: "reconciliation-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineId: "baseline-1",
    triggerEventId: "stop-event",
    summaryEventId: "summary-event",
    boundary: "stop",
    outcome,
    diagnosticCode: outcome === "partial" ? "baseline_partial" : null,
    attribution: "run_relative",
    baselineComparison: "changed",
    repositoryRoot: "/private/repository",
    headCommit: "c".repeat(40),
    stagedDiffSha256: "d".repeat(64),
    unstagedDiffSha256: "e".repeat(64),
    statusBeforeSha256: "f".repeat(64),
    statusAfterSha256: "a".repeat(64),
    workingTreeFingerprint: outcome === "captured" ? "b".repeat(64) : null,
    stagedDirty: true,
    unstagedDirty: false,
    entryCount: entries.length,
    createdCount: 0,
    modifiedCount: entries.length,
    deletedCount: 0,
    typeChangedCount: 0,
    unmergedCount: 0,
    capturedAt: "2026-07-22T11:00:00.000Z",
    entries,
  };
}
function reconciliationWithEntries(
  entries: readonly GitReconciliationEntry[],
  outcome: "captured" | "partial" = "captured",
): GitReconciliation {
  return {
    ...reconciliation(outcome),
    entries,
    entryCount: entries.length,
    modifiedCount: entries.length,
  };
}

describe("deterministic change classification artifact", () => {
  it("produces byte-identical canonical output and hides source paths/hashes", () => {
    const first = prepareDeterministicChangeClassification(
      "run-1",
      finalization("reconciliation-1"),
      reconciliation(),
    );
    const second = prepareDeterministicChangeClassification(
      "run-1",
      finalization("reconciliation-1"),
      reconciliation(),
    );
    expect(first.bytes).toEqual(second.bytes);
    expect(first.value.inputFingerprint).toBe(second.value.inputFingerprint);
    expect(parseCanonicalChangeClassification(first.bytes)).toEqual(first.value);
    for (const forbidden of [
      "/private/repository",
      "apps/web/src/App.tsx",
      "pnpm-lock.yaml",
      "c".repeat(40),
      "pathIdentitySha256",
      "workingTreeFingerprint",
    ]) {
      expect(first.canonicalJson).not.toContain(forbidden);
    }
  });

  it("represents partial and unavailable evidence explicitly", () => {
    const partial = prepareDeterministicChangeClassification(
      "run-1",
      { ...finalization("reconciliation-1"), terminalStatus: "Partial" },
      reconciliation("partial"),
    );
    expect(partial.value).toMatchObject({
      outcome: "partial",
      diagnosticCode: "reconciliation_partial",
      reconciliationId: "reconciliation-1",
    });

    const unavailable = prepareDeterministicChangeClassification("run-1", finalization(null), null);
    expect(unavailable.value).toMatchObject({
      outcome: "unavailable",
      diagnosticCode: "reconciliation_unavailable",
      reconciliationId: null,
      entries: [],
      aggregateLabels: [],
    });
  });

  it("changes the input fingerprint when accepted input changes", () => {
    const first = prepareDeterministicChangeClassification(
      "run-1",
      finalization("reconciliation-1"),
      reconciliation(),
    );
    const changed = reconciliation();
    const second = prepareDeterministicChangeClassification(
      "run-1",
      finalization("reconciliation-1"),
      { ...changed, entries: [entry(0, "apps/daemon/src/routes/users.ts")] },
    );
    expect(first.value.inputFingerprint).not.toBe(second.value.inputFingerprint);
  });

  it("covers the five Milestone A Run outcomes without unexplained entries", () => {
    const fixtures = [
      {
        name: "clean completed",
        finalization: finalization("reconciliation-1"),
        reconciliation: reconciliation("captured"),
        expectedOutcome: "classified",
      },
      {
        name: "dirty baseline attributed",
        finalization: finalization("reconciliation-1"),
        reconciliation: {
          ...reconciliation("captured"),
          baselineComparison: "changed" as const,
          attribution: "observed_only" as const,
          entries: reconciliation("captured").entries.map((item) => ({
            ...item,
            attribution: "observed_only" as const,
          })),
        },
        expectedOutcome: "classified",
      },
      {
        name: "partial with evidence gap",
        finalization: {
          ...finalization("reconciliation-1"),
          terminalStatus: "Partial" as const,
          diagnosticCode: "final_reconciliation_partial" as const,
        },
        reconciliation: reconciliation("partial"),
        expectedOutcome: "partial",
      },
      {
        name: "failed StopFailure",
        finalization: {
          ...finalization("reconciliation-1"),
          terminalStatus: "Failed" as const,
          diagnosticCode: "source_stop_failure" as const,
        },
        reconciliation: reconciliation("captured"),
        expectedOutcome: "classified",
      },
      {
        name: "abandoned recovery",
        finalization: finalization(null),
        reconciliation: null,
        expectedOutcome: "unavailable",
      },
    ] as const;

    for (const fixture of fixtures) {
      const prepared = prepareDeterministicChangeClassification(
        "run-1",
        fixture.finalization,
        fixture.reconciliation,
      );
      expect(prepared.value.outcome, fixture.name).toBe(fixture.expectedOutcome);
      expect(prepared.value.entries, fixture.name).toHaveLength(
        fixture.reconciliation?.entries.length ?? 0,
      );
      for (const classified of prepared.value.entries) {
        expect(classified.labels.length, fixture.name).toBeGreaterThan(0);
      }
    }
  });

  it("supports the full classifier canonical limits beyond the Hook-ingress budget", () => {
    const richEntries = Array.from({ length: 1500 }, (_, index) =>
      entry(index, "src/auth/api/components/__tests__/migration.test.tsx"),
    );
    const largeArtifact = prepareDeterministicChangeClassification(
      "run-1",
      finalization("reconciliation-1"),
      reconciliationWithEntries(richEntries),
    );
    expect(largeArtifact.bytes.byteLength).toBeGreaterThan(1024 * 1024);
    expect(largeArtifact.bytes.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(parseCanonicalChangeClassification(largeArtifact.bytes)).toEqual(largeArtifact.value);

    const maximumInputEntries = Array.from({ length: 2000 }, (_, index) =>
      entry(index, "é".repeat(1024)),
    );
    const maximumInput = prepareDeterministicChangeClassification(
      "run-1",
      finalization("reconciliation-1"),
      reconciliationWithEntries(maximumInputEntries),
    );
    expect(maximumInput.value.entries).toHaveLength(2000);
    expect(maximumInput.value.entries.every((item) => item.labels[0]?.label === "unknown")).toBe(
      true,
    );
  });

  it("rejects persisted classification bytes above the two MiB bound", () => {
    expect(() =>
      parseCanonicalChangeClassification(new Uint8Array(2 * 1024 * 1024 + 1)),
    ).toThrowError(expect.objectContaining({ code: "invalid_persisted_row" }));
  });

  it("rejects non-canonical or contract-invalid persisted bytes", () => {
    expect(() =>
      parseCanonicalChangeClassification(new TextEncoder().encode('{"schemaVersion":1, "x":2}')),
    ).toThrowError(expect.objectContaining({ code: "invalid_persisted_row" }));
    expect(() => parseCanonicalChangeClassification(Uint8Array.from([0xff]))).toThrowError(
      expect.objectContaining({ code: "invalid_persisted_row" }),
    );
  });
});
