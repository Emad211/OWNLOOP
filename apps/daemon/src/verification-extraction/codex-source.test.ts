import type { NormalizedEventEnvelope } from "@ownloop/event-model";
import { describe, expect, it } from "vitest";

import { acceptedCommandObservation } from "./source.js";

function event(
  input: Readonly<{
    toolName?: string;
    sourceEventName?: string;
    toolResponse?: NormalizedEventEnvelope["payload"][string];
  }> = {},
): NormalizedEventEnvelope {
  return {
    eventId: "event-codex-command-1",
    schemaVersion: 1,
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    runId: "run-1",
    sequence: 1,
    type: "tool.completed",
    source: "codex",
    sourceEventName: input.sourceEventName ?? "PostToolUse",
    sourceEventId: "tool-use-codex-1",
    occurredAt: "2026-07-27T15:10:00.000Z",
    ingestedAt: "2026-07-27T15:10:01.000Z",
    sensitivity: "sensitive",
    payload: {
      tool_name: input.toolName ?? "shell_command",
      tool_input: { command: "pnpm test" },
      tool_response: input.toolResponse ?? { exit_code: 0, stdout: "2 tests passed" },
    },
    metadata: { collectorVersion: "0.1.0", sourceVersion: "codex-cli 0.133.0" },
  };
}

describe("accepted Codex command verification source", () => {
  it("retains neutral completion with a zero structured exit code", () => {
    expect(acceptedCommandObservation(event())).toMatchObject({
      sourceToolOutcome: "completed",
      exitCode: 0,
      recognition: { kind: "test", toolFamily: "pnpm" },
      partial: false,
    });
  });

  it("retains neutral completion with a non-zero structured exit code", () => {
    expect(
      acceptedCommandObservation(event({ toolResponse: { exit_code: 2, stderr: "tests failed" } })),
    ).toMatchObject({
      sourceToolOutcome: "completed",
      exitCode: 2,
      recognition: { kind: "test" },
      partial: false,
    });
  });

  it("retains completion without inventing an exit code", () => {
    expect(acceptedCommandObservation(event({ toolResponse: { stdout: "observed" } }))).toMatchObject({
      sourceToolOutcome: "completed",
      exitCode: null,
      partial: false,
    });
  });

  it("ignores non-shell Codex tool completions", () => {
    expect(acceptedCommandObservation(event({ toolName: "apply_patch" }))).toBeNull();
  });

  it("rejects inconsistent Codex Hook linkage", () => {
    expect(() => acceptedCommandObservation(event({ sourceEventName: "PreToolUse" }))).toThrowError(
      expect.objectContaining({ code: "invalid_persisted_row" }),
    );
  });
});
