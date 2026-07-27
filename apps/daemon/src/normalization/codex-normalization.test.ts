import { Buffer } from "node:buffer";
import { createSecretKey } from "node:crypto";

import {
  type CodexAdapterIngress,
  CodexAdapterIngressSchema,
  type SupportedCodexHookName,
} from "@ownloop/contracts/codex";
import { prepareCodexIngressReceipt } from "@ownloop/ingress-security";
import { describe, expect, it } from "vitest";

import { processLifecycleReceipt } from "../lifecycle/processor.js";
import { type OwnLoopPersistence, openPersistence } from "../persistence/index.js";
import { processEventNormalization } from "./processor.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 59));
const AT = "2026-07-27T14:30:00.000Z";

const common = {
  session_id: "session-codex-normalization",
  transcript_path: null,
  cwd: "/workspace/project",
} as const;
const turn = {
  ...common,
  turn_id: "turn-codex-normalization",
  model: "gpt-5.6-codex",
  permission_mode: "default",
} as const;

function ingress(hookName: SupportedCodexHookName): CodexAdapterIngress {
  const payload = (() => {
    switch (hookName) {
      case "SessionStart":
        return {
          ...common,
          hook_event_name: hookName,
          model: "gpt-5.6-codex",
          permission_mode: "default",
          source: "startup",
        };
      case "UserPromptSubmit":
        return { ...turn, hook_event_name: hookName, prompt: "Normalize a Codex fixture." };
      case "PreToolUse":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "git status --short" },
          tool_use_id: "tool-codex-normalization",
        };
      case "PermissionRequest":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "git status --short" },
        };
      case "PostToolUse":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "git status --short" },
          tool_response: { exit_code: 0 },
          tool_use_id: "tool-codex-normalization",
        };
      case "PreCompact":
      case "PostCompact":
        return { ...turn, hook_event_name: hookName, trigger: "auto" };
      case "SubagentStart":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-codex-normalization",
          agent_type: "worker",
        };
      case "SubagentStop":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-codex-normalization",
          agent_type: "worker",
          agent_transcript_path: null,
          last_assistant_message: "Subagent normalization complete.",
          stop_hook_active: false,
        };
      case "Stop":
        return {
          ...turn,
          hook_event_name: hookName,
          last_assistant_message: "Turn normalization complete.",
          stop_hook_active: false,
        };
      case "SessionEnd":
        return { ...common, hook_event_name: hookName, reason: "other" };
    }
  })();
  return CodexAdapterIngressSchema.parse({
    contractVersion: 1,
    source: "codex",
    adapterVersion: "0.1.0",
    sourceVersion: "codex-cli 0.133.0",
    sourceSurface: "cli",
    receivedAt: AT,
    payload,
  });
}

function insertReceipt(
  persistence: OwnLoopPersistence,
  receiptId: string,
  hookName: SupportedCodexHookName,
): void {
  persistence.ingressReceipts.insertPreparedOrGetExisting({
    ...prepareCodexIngressReceipt(ingress(hookName), {
      hmacKey: HMAC_KEY,
      homePath: "/home/fixture",
    }),
    receiptId,
    processingStatus: "pending",
    processedAt: null,
    failureCode: null,
    createdAt: AT,
  });
}

function eventIds(): () => string {
  let index = 0;
  return () => `event-codex-normalization-${String(++index).padStart(3, "0")}`;
}

function process(
  persistence: OwnLoopPersistence,
  nextEventId: () => string,
  receiptId: string,
  hookName: SupportedCodexHookName,
) {
  insertReceipt(persistence, receiptId, hookName);
  const lifecycle = processLifecycleReceipt(
    {
      persistence,
      clock: () => new Date(AT),
      workspaceIdGenerator: () => "workspace-codex-normalization",
      conversationIdGenerator: () => "conversation-codex-normalization",
      runIdGenerator: () => "run-codex-normalization",
    },
    receiptId,
  );
  if (lifecycle === null) throw new Error("Expected lifecycle resolution.");
  const normalization = processEventNormalization(
    {
      persistence,
      clock: () => new Date(AT),
      eventIdGenerator: nextEventId,
    },
    receiptId,
  );
  if (normalization === null) throw new Error("Expected Event normalization.");
  return { lifecycle, normalization };
}

describe("Codex Event normalization", () => {
  it("maps all accepted Codex Hook families into controlled provider-neutral facts", () => {
    const persistence = openPersistence(":memory:");
    const nextEventId = eventIds();
    try {
      process(persistence, nextEventId, "receipt-codex-normalization-session", "SessionStart");
      process(persistence, nextEventId, "receipt-codex-normalization-prompt", "UserPromptSubmit");
      const hookOrder = [
        "PreToolUse",
        "PermissionRequest",
        "PostToolUse",
        "PreCompact",
        "PostCompact",
        "SubagentStart",
        "SubagentStop",
        "Stop",
      ] as const;
      hookOrder.forEach((hookName, index) => {
        process(persistence, nextEventId, `receipt-codex-normalization-${index}`, hookName);
      });
      process(persistence, nextEventId, "receipt-codex-normalization-end", "SessionEnd");

      const runEvents = persistence.events.listForRun("run-codex-normalization");
      expect(runEvents.map((event) => event.type)).toEqual([
        "run.started",
        "user.prompt_submitted",
        "tool.requested",
        "permission.requested",
        "tool.succeeded",
        "context.compaction_started",
        "context.compaction_completed",
        "agent.subagent_started",
        "agent.subagent_stopped",
        "run.stop_observed",
        "run.finalization_started",
      ]);
      expect(runEvents.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(runEvents.filter((event) => event.source === "codex")).toHaveLength(9);
      expect(runEvents.filter((event) => event.source === "ownloop")).toHaveLength(2);
      expect(
        runEvents.every(
          (event) =>
            event.metadata.sourceVersion === "codex-cli 0.133.0" || event.source === "ownloop",
        ),
      ).toBe(true);

      expect(runEvents.find((event) => event.type === "permission.requested")).toMatchObject({
        source: "codex",
        sourceEventName: "PermissionRequest",
        sourceEventId: null,
        sensitivity: "sensitive",
      });
      expect(runEvents.find((event) => event.type === "context.compaction_started")).toMatchObject({
        source: "codex",
        sourceEventName: "PreCompact",
        sourceEventId: "turn-codex-normalization",
        sensitivity: "normal",
      });
      expect(runEvents.find((event) => event.type === "agent.subagent_started")).toMatchObject({
        source: "codex",
        sourceEventName: "SubagentStart",
        sourceEventId: "agent-codex-normalization",
        sensitivity: "normal",
        payload: expect.objectContaining({
          agent_id: "agent-codex-normalization",
          agent_type: "worker",
        }),
      });
      expect(runEvents.find((event) => event.type === "agent.subagent_stopped")).toMatchObject({
        source: "codex",
        sourceEventName: "SubagentStop",
        sourceEventId: "agent-codex-normalization",
        sensitivity: "sensitive",
      });

      expect(
        persistence.taskRuns.listForConversation("conversation-codex-normalization"),
      ).toHaveLength(1);
      expect(persistence.conversations.get("conversation-codex-normalization")).toMatchObject({
        source: "codex",
        status: "Ended",
      });
      expect(persistence.events.countAll()).toBe(13);
    } finally {
      persistence.close();
    }
  });

  it("keeps Codex normalization idempotent at receipt and Event sequence boundaries", () => {
    const persistence = openPersistence(":memory:");
    const nextEventId = eventIds();
    try {
      process(persistence, nextEventId, "receipt-codex-idempotent-session", "SessionStart");
      const first = process(
        persistence,
        nextEventId,
        "receipt-codex-idempotent-prompt",
        "UserPromptSubmit",
      ).normalization;
      const eventCount = persistence.events.countAll();
      const second = processEventNormalization(
        {
          persistence,
          clock: () => new Date(AT),
          eventIdGenerator: () => "event-should-not-be-used",
        },
        "receipt-codex-idempotent-prompt",
      );
      expect(second).toEqual(first);
      expect(persistence.events.countAll()).toBe(eventCount);
      expect(
        persistence.events.listForRun("run-codex-normalization").map((event) => event.sequence),
      ).toEqual([1, 2]);
    } finally {
      persistence.close();
    }
  });
});
