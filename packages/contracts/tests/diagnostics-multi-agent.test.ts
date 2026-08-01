import { describe, expect, it } from "vitest";

import {
  DiagnosticsHookCountV1Schema,
  DiagnosticsProcessSnapshotV1Schema,
} from "../src/diagnostics-dashboard.js";

describe("source-aware diagnostic Hook counts", () => {
  it("keeps legacy Claude-only rows valid", () => {
    expect(
      DiagnosticsHookCountV1Schema.safeParse({
        hookName: "SessionStart",
        count: 2,
      }).success,
    ).toBe(true);
  });

  it("accepts explicit Codex identities and rejects cross-source Hook names", () => {
    expect(
      DiagnosticsHookCountV1Schema.safeParse({
        source: "codex",
        hookName: "PermissionRequest",
        count: 1,
      }).success,
    ).toBe(true);
    expect(
      DiagnosticsHookCountV1Schema.safeParse({
        source: "codex",
        hookName: "PostToolBatch",
        count: 1,
      }).success,
    ).toBe(false);
  });

  it("distinguishes shared Hook names by source", () => {
    const snapshot = {
      serverStarted: 0,
      serverStopped: 0,
      acceptedReceipts: 3,
      duplicateReceipts: 0,
      rejectedRequests: 0,
      acceptedByHook: [
        { hookName: "SessionStart", count: 2 },
        { source: "codex", hookName: "SessionStart", count: 1 },
      ],
      duplicateByHook: [],
      rejectedByCode: [],
    } as const;
    expect(DiagnosticsProcessSnapshotV1Schema.safeParse(snapshot).success).toBe(true);
  });
});
