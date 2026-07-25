import { LocalSettingsResponseV1Schema, type ReplayRunSummaryV1 } from "@ownloop/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReplayApiClient } from "./api.js";
import {
  canDeleteRun,
  normalizeSecretPatternText,
  runDeletionConfirmation,
  SettingsPanel,
} from "./Settings.js";

const client = Object.freeze({}) as ReplayApiClient;
const response = LocalSettingsResponseV1Schema.parse({
  ok: true,
  schemaVersion: 1,
  settings: {
    schemaVersion: 1,
    id: "local",
    revision: 1,
    externalAiEnabled: false,
    provider: null,
    retentionPolicy: "keep_until_deleted",
    diagnosticMode: "off",
    rawSourcePayloadRetention: "off",
    customSecretFieldPatterns: ["*credential", "private*"],
    updatedAt: "2026-07-25T22:00:00.000Z",
  },
  providerSecretStatus: "absent",
  providerGenerationConfigured: false,
});

const terminalRun: ReplayRunSummaryV1 = {
  runId: "run-terminal",
  conversationId: "conversation-1",
  workspaceId: "workspace-1",
  runNumber: 7,
  status: "Completed",
  completeness: "complete",
  promptPreview: "Sensitive prompt must not enter confirmation",
  promptTruncated: false,
  startedAt: "2026-07-25T20:00:00.000Z",
  endedAt: "2026-07-25T20:05:00.000Z",
  evidenceGapCount: 0,
  presence: {
    baseline: true,
    reconciliation: true,
    finalization: true,
    finalManifest: true,
    terminalEvent: true,
  },
};

const activeRun: ReplayRunSummaryV1 = {
  ...terminalRun,
  runId: "run-active",
  status: "Capturing",
  endedAt: null,
};

describe("Settings and privacy UI", () => {
  it("renders memory-only provider, fixed raw-off, retention, diagnostics, and pattern controls", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        client={client}
        selectedRun={terminalRun}
        initialResponse={response}
        onUnauthorized={() => undefined}
        onRunsDeleted={() => undefined}
      />,
    );
    expect(html).toContain("Settings and privacy");
    expect(html).toContain("Keys are held only in daemon memory");
    expect(html).toContain("Raw source payloads");
    expect(html).toContain("<strong>Off.</strong>");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("private*");
    expect(html).toContain("*credential");
    expect(html).not.toContain(terminalRun.promptPreview);
    expect(html).not.toContain("localStorage");
  });

  it("canonicalizes field-name patterns without accepting duplicate lines", () => {
    expect(normalizeSecretPatternText(" private*\n*credential\nprivate*\n\n")).toEqual([
      "*credential",
      "private*",
    ]);
  });

  it("uses only Run number and status in deletion confirmation and rejects active Runs", () => {
    expect(runDeletionConfirmation(terminalRun)).toBe("Delete Run 7 (Completed) permanently?");
    expect(runDeletionConfirmation(terminalRun)).not.toContain(terminalRun.promptPreview);
    expect(canDeleteRun(terminalRun)).toBe(true);
    expect(canDeleteRun(activeRun)).toBe(false);
    expect(canDeleteRun(null)).toBe(false);
  });
});
