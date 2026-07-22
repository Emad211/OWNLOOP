import { describe, expect, it } from "vitest";

import {
  FinalDiffManifestV1Schema,
  RawRunReplayV1Schema,
  ReplayErrorResponseSchema,
  ReplayRunListResponseV1Schema,
} from "../src/index.js";

const summary = {
  runId: "run-1",
  conversationId: "conversation-1",
  workspaceId: "workspace-1",
  runNumber: 1,
  status: "Completed",
  completeness: "complete",
  promptPreview: "Build the replay",
  promptTruncated: false,
  startedAt: "2026-07-22T10:00:00.000Z",
  endedAt: "2026-07-22T10:02:00.000Z",
  evidenceGapCount: 0,
  presence: {
    baseline: true,
    reconciliation: true,
    finalization: true,
    finalManifest: true,
    terminalEvent: true,
  },
} as const;

describe("raw replay contracts", () => {
  it("accepts strict list and replay fixtures", () => {
    expect(
      ReplayRunListResponseV1Schema.safeParse({
        ok: true,
        schemaVersion: 1,
        runs: [summary],
        nextCursor: null,
      }).success,
    ).toBe(true);

    const replay = {
      ok: true,
      schemaVersion: 1,
      run: { ...summary, redactedPrompt: "Build the replay", sourceStopReason: "stop" },
      timeline: [],
      causalLinks: [],
      baseline: null,
      reconciliations: [],
      verification: [],
      evidenceGaps: [],
      finalization: null,
      artifacts: [],
    };
    expect(RawRunReplayV1Schema.safeParse(replay).success).toBe(true);
    expect(RawRunReplayV1Schema.safeParse({ ...replay, repositoryRoot: "/private" }).success).toBe(
      false,
    );
  });

  it("rejects privacy-unsafe timeline payloads and uncontrolled Stop reasons", () => {
    const base = {
      ok: true,
      schemaVersion: 1,
      run: { ...summary, redactedPrompt: "Build", sourceStopReason: "stop" },
      causalLinks: [],
      baseline: null,
      reconciliations: [],
      verification: [],
      evidenceGaps: [],
      finalization: null,
      artifacts: [],
    };
    expect(
      RawRunReplayV1Schema.safeParse({
        ...base,
        timeline: [
          {
            eventId: "event-1",
            sequence: 1,
            type: "test.observed",
            source: "ownloop",
            sensitivity: "normal",
            occurredAt: "2026-07-22T10:00:00.000Z",
            ingestedAt: "2026-07-22T10:00:00.000Z",
            payload: { repositoryRoot: "/private" },
            metadata: { collectorVersion: "0.1.0", sourceVersion: null },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RawRunReplayV1Schema.safeParse({
        ...base,
        run: { ...base.run, sourceStopReason: "arbitrary persisted text" },
        timeline: [],
      }).success,
    ).toBe(false);
  });

  it("rejects persistence-only artifact fields and unsafe URLs", () => {
    const replay = {
      ok: true,
      schemaVersion: 1,
      run: { ...summary, redactedPrompt: "Build", sourceStopReason: null },
      timeline: [],
      causalLinks: [],
      baseline: null,
      reconciliations: [],
      verification: [],
      evidenceGaps: [],
      finalization: null,
      artifacts: [
        {
          artifactId: "artifact-1",
          role: "final-diff-manifest-v1",
          kind: "final-diff-manifest-v1",
          mediaType: "application/vnd.ownloop.final-diff+json",
          sensitivity: "sensitive",
          sizeBytes: 10,
          contentUrl: "/v1/replay/artifacts/artifact-1",
          digest: "sha256:secret",
        },
      ],
    };
    expect(RawRunReplayV1Schema.safeParse(replay).success).toBe(false);
  });

  it("validates final manifest and bounded content-free errors", () => {
    expect(
      FinalDiffManifestV1Schema.safeParse({
        version: 1,
        runId: "run-1",
        reconciliationId: "reconciliation-1",
        outcome: "captured",
        diagnosticCode: null,
        attribution: "run_relative",
        baselineComparison: "changed",
        boundary: "stop",
        finalFingerprintPresent: true,
        stagedDirty: false,
        unstagedDirty: true,
        counts: { entryCount: 0, created: 0, modified: 0, deleted: 0, typeChanged: 0, unmerged: 0 },
        entries: [],
      }).success,
    ).toBe(true);
    expect(
      ReplayErrorResponseSchema.safeParse({
        ok: false,
        error: { code: "projection_failed", message: "Replay projection failed safely." },
      }).success,
    ).toBe(true);
  });
});
