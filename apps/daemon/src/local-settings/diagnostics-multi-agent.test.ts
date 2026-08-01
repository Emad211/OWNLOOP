import { describe, expect, it } from "vitest";

import { LocalDiagnosticCounters } from "./diagnostics.js";

describe("source-aware local diagnostic counters", () => {
  it("keeps shared Hook names separate by ingress source", () => {
    const counters = new LocalDiagnosticCounters("counts_only");
    counters.sink({
      type: "receipt.accepted",
      source: "claude_code",
      receiptId: "receipt-claude-diagnostics",
      hookName: "SessionStart",
      duplicate: false,
    });
    counters.sink({
      type: "receipt.accepted",
      source: "codex",
      receiptId: "receipt-codex-diagnostics",
      hookName: "SessionStart",
      duplicate: false,
    });
    counters.sink({
      type: "receipt.accepted",
      source: "codex",
      receiptId: "receipt-codex-permission",
      hookName: "PermissionRequest",
      duplicate: true,
    });

    expect(counters.snapshot()).toMatchObject({
      acceptedReceipts: 2,
      duplicateReceipts: 1,
      acceptedByHook: [
        { hookName: "SessionStart", count: 1 },
        { source: "codex", hookName: "SessionStart", count: 1 },
      ],
      duplicateByHook: [{ source: "codex", hookName: "PermissionRequest", count: 1 }],
    });
  });
});
