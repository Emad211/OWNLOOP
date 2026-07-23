import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import { describe, expect, it } from "vitest";

import { acceptedBashObservation } from "./source.js";

function event(
  type: "tool.succeeded" | "tool.failed",
  payload: NormalizedEventEnvelope["payload"],
): NormalizedEventEnvelope {
  return {
    eventId: "event-1",
    schemaVersion: 1,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId: "run-1",
    sequence: 1,
    type,
    source: "claude_code",
    sourceEventName: type === "tool.succeeded" ? "PostToolUse" : "PostToolUseFailure",
    sourceEventId: "tool-use-1",
    occurredAt: "2026-07-23T08:00:00.000Z",
    ingestedAt: "2026-07-23T08:00:01.000Z",
    sensitivity: "sensitive",
    payload,
    metadata: { collectorVersion: "0.1.0", sourceVersion: "1" },
  };
}

describe("accepted Bash verification source", () => {
  it("retains failed Hook outcome without inventing an exit code", () => {
    expect(
      acceptedBashObservation(
        event("tool.failed", {
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          error: "tests failed",
        }),
      ),
    ).toMatchObject({
      sourceToolOutcome: "failed",
      exitCode: null,
      recognition: { kind: "test" },
    });
  });

  it("retains succeeded execution without an explicit exit code", () => {
    expect(
      acceptedBashObservation(
        event("tool.succeeded", {
          tool_name: "Bash",
          tool_input: { command: "pnpm lint" },
          tool_response: { stdout: "clean" },
        }),
      ),
    ).toMatchObject({
      sourceToolOutcome: "succeeded",
      exitCode: null,
      recognition: { kind: "lint" },
    });
  });

  it("marks unsupported non-null response shapes partial", () => {
    expect(
      acceptedBashObservation(
        event("tool.failed", {
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_response: ["unsupported"],
          error: "tests failed",
        }),
      ),
    ).toMatchObject({
      sourceToolOutcome: "failed",
      partial: true,
    });
  });

  it("rejects source outcome and exit-code conflicts", () => {
    expect(() =>
      acceptedBashObservation(
        event("tool.succeeded", {
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_response: { exitCode: 2 },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "invalid_persisted_row" }));
  });

  it("ignores non-Bash tool completions", () => {
    expect(
      acceptedBashObservation(
        event("tool.succeeded", {
          tool_name: "Read",
          tool_input: { file_path: "/redacted" },
          tool_response: "content",
        }),
      ),
    ).toBeNull();
  });
});
