import type { RawRunReplayV1, ReplayRunSummaryV1 } from "@ownloop/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App, ReplayViewer } from "./App.js";
import { createReplayApiClient } from "./api.js";

const summary: ReplayRunSummaryV1 = {
  runId: "run-1",
  conversationId: "conversation-1",
  workspaceId: "workspace-1",
  runNumber: 1,
  status: "Partial",
  completeness: "partial",
  promptPreview: "Review a changed file",
  promptTruncated: false,
  startedAt: "2026-07-22T10:00:00.000Z",
  endedAt: "2026-07-22T10:02:00.000Z",
  evidenceGapCount: 1,
  presence: {
    baseline: true,
    reconciliation: true,
    finalization: true,
    finalManifest: false,
    terminalEvent: true,
  },
};

const replay: RawRunReplayV1 = {
  ok: true,
  schemaVersion: 1,
  run: {
    ...summary,
    redactedPrompt: "Review a changed file [REDACTED]",
    sourceStopReason: "stop",
  },
  timeline: [
    {
      eventId: "event-1",
      sequence: 1,
      type: "run.started",
      source: "ownloop",
      sensitivity: "normal",
      occurredAt: "2026-07-22T10:00:00.000Z",
      ingestedAt: "2026-07-22T10:00:00.000Z",
      payload: {},
      metadata: { collectorVersion: "0.1.0", sourceVersion: null },
    },
  ],
  causalLinks: [],
  baseline: null,
  reconciliations: [],
  verification: [],
  evidenceGaps: [
    {
      gapId: "gap-1",
      code: "baseline_partial",
      message: "The baseline was incomplete.",
      createdAt: "2026-07-22T10:02:00.000Z",
    },
  ],
  finalization: {
    finalizationId: "finalization-1",
    terminalStatus: "Partial",
    mode: "normal",
    diagnosticCode: "baseline_partial",
    triggerEventId: "event-1",
    reconciliationId: null,
    finalSnapshotEventId: null,
    terminalEventId: "event-1",
    manifestArtifactId: null,
    finalizedAt: "2026-07-22T10:02:00.000Z",
  },
  artifacts: [],
};

describe("Raw Replay viewer", () => {
  it("renders semantic Run, timeline, uncertainty, and no-verification states", () => {
    const html = renderToStaticMarkup(
      <ReplayViewer
        state="ready"
        statusMessage=""
        runs={[summary]}
        replay={replay}
        manifest={null}
        selectedRunId="run-1"
        nextCursor={null}
        onSelectRun={() => undefined}
        onLoadMore={() => undefined}
        onLoadArtifact={() => undefined}
        onDisconnect={() => undefined}
      />,
    );
    expect(html).toContain("Raw Build Replay");
    expect(html).toContain("Replay completeness");
    expect(html).toContain("Evidence gaps");
    expect(html).toContain("No verification Event was observed");
    expect(html).toContain("run.started");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("renders a password connection control and exposes no browser-persistence API", () => {
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { search: "", origin: "http://127.0.0.1:4021", pathname: "/" },
        history: { replaceState: () => undefined },
      },
    });
    try {
      const html = renderToStaticMarkup(<App />);
      expect(html).toContain('type="password"');
      const implementationText = `${App.toString()}\n${createReplayApiClient.toString()}`;
      for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
        expect(implementationText).not.toContain(forbidden);
      }
      expect(createReplayApiClient.toString()).not.toContain("apiHost");
      expect(App.toString()).toContain('error.code === "unauthorized"');
      expect(App.toString()).toContain("clearConnection(error.message)");
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    }
  });
});
