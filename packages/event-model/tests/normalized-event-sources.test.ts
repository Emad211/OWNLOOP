import { describe, expect, it } from "vitest";

import {
  NORMALIZED_EVENT_SOURCES,
  NormalizedEventEnvelopeSchema,
  NormalizedEventSourceSchema,
} from "../src/index.js";

const codexEvent = {
  eventId: "event-codex-source",
  schemaVersion: 1,
  workspaceId: "workspace-codex-source",
  conversationId: "conversation-codex-source",
  runId: "run-codex-source",
  sequence: 1,
  type: "tool.requested",
  source: "codex",
  sourceEventName: "PreToolUse",
  sourceEventId: "tool-codex-source",
  occurredAt: "2026-07-27T00:30:00.000Z",
  ingestedAt: "2026-07-27T00:30:00.001Z",
  sensitivity: "sensitive",
  payload: {},
  metadata: { collectorVersion: "0.1.0", sourceVersion: "1.2.3" },
} as const;

describe("normalized multi-agent source taxonomy", () => {
  it("accepts exactly Claude Code, Codex, and OwnLoop sources", () => {
    expect(NORMALIZED_EVENT_SOURCES).toEqual(["claude_code", "codex", "ownloop"]);
    for (const source of NORMALIZED_EVENT_SOURCES) {
      expect(NormalizedEventSourceSchema.safeParse(source).success).toBe(true);
    }
    expect(NormalizedEventSourceSchema.safeParse("future_agent").success).toBe(false);
  });

  it("parses a controlled Codex Event without weakening the envelope", () => {
    expect(NormalizedEventEnvelopeSchema.parse(codexEvent)).toEqual(codexEvent);
    expect(
      NormalizedEventEnvelopeSchema.safeParse({ ...codexEvent, source: "future_agent" }).success,
    ).toBe(false);
  });
});
