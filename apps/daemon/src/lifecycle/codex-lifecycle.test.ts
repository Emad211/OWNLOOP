import { Buffer } from "node:buffer";
import { createSecretKey } from "node:crypto";

import {
  type CodexAdapterIngress,
  CodexAdapterIngressSchema,
  type SupportedCodexHookName,
} from "@ownloop/contracts/codex";
import { prepareCodexIngressReceipt } from "@ownloop/ingress-security";
import { describe, expect, it } from "vitest";

import { type OwnLoopPersistence, openPersistence } from "../persistence/index.js";
import { processLifecycleReceipt } from "./processor.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 53));
const AT = "2026-07-27T14:00:00.000Z";

const common = {
  session_id: "session-codex-lifecycle",
  transcript_path: null,
  cwd: "/workspace/project",
} as const;

const turn = {
  ...common,
  turn_id: "turn-codex-lifecycle",
  model: "gpt-5.6-codex",
  permission_mode: "default",
} as const;

function ingress(hookName: SupportedCodexHookName, startSource = "startup"): CodexAdapterIngress {
  const payload = (() => {
    switch (hookName) {
      case "SessionStart":
        return {
          ...common,
          hook_event_name: hookName,
          model: "gpt-5.6-codex",
          permission_mode: "default",
          source: startSource,
        };
      case "UserPromptSubmit":
        return { ...turn, hook_event_name: hookName, prompt: "Implement a lifecycle fixture." };
      case "PreToolUse":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "git status --short" },
          tool_use_id: "tool-codex-lifecycle",
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
          tool_use_id: "tool-codex-lifecycle",
        };
      case "PreCompact":
      case "PostCompact":
        return { ...turn, hook_event_name: hookName, trigger: "auto" };
      case "SubagentStart":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-codex-lifecycle",
          agent_type: "worker",
        };
      case "SubagentStop":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-codex-lifecycle",
          agent_type: "worker",
          agent_transcript_path: null,
          last_assistant_message: "Subagent observation complete.",
          stop_hook_active: false,
        };
      case "Stop":
        return {
          ...turn,
          hook_event_name: hookName,
          last_assistant_message: "Turn observation complete.",
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
  startSource = "startup",
): void {
  persistence.ingressReceipts.insertPreparedOrGetExisting({
    ...prepareCodexIngressReceipt(ingress(hookName, startSource), {
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

function resolve(
  persistence: OwnLoopPersistence,
  receiptId: string,
  hookName: SupportedCodexHookName,
  startSource = "startup",
) {
  insertReceipt(persistence, receiptId, hookName, startSource);
  return processLifecycleReceipt(
    {
      persistence,
      clock: () => new Date(AT),
      workspaceIdGenerator: () => "workspace-codex-lifecycle",
      conversationIdGenerator: () => "conversation-codex-lifecycle",
      runIdGenerator: () => "run-codex-lifecycle",
    },
    receiptId,
  );
}

describe("Codex lifecycle projection", () => {
  it("associates permission, compaction, and subagent facts with one active Run", () => {
    const persistence = openPersistence(":memory:");
    try {
      expect(resolve(persistence, "receipt-codex-session", "SessionStart")).toMatchObject({
        outcome: "applied",
        action: "conversation_started",
        runId: null,
      });
      const started = resolve(persistence, "receipt-codex-prompt", "UserPromptSubmit");
      expect(started).toMatchObject({
        outcome: "applied",
        action: "run_started",
        runId: "run-codex-lifecycle",
      });

      const associatedHooks = [
        "PermissionRequest",
        "PreCompact",
        "PostCompact",
        "SubagentStart",
        "SubagentStop",
      ] as const;
      for (const [index, hookName] of associatedHooks.entries()) {
        expect(resolve(persistence, `receipt-codex-associated-${index}`, hookName)).toMatchObject({
          outcome: "associated",
          action: "run_associated",
          runId: "run-codex-lifecycle",
        });
      }

      const conversation = persistence.conversations.get("conversation-codex-lifecycle");
      expect(conversation).toMatchObject({ source: "codex", status: "Active" });
      expect(persistence.taskRuns.listForConversation("conversation-codex-lifecycle")).toEqual([
        expect.objectContaining({
          runId: "run-codex-lifecycle",
          runNumber: 1,
          status: "Capturing",
        }),
      ]);
    } finally {
      persistence.close();
    }
  });

  it("does not create a Task Run for a compact-source SessionStart", () => {
    const persistence = openPersistence(":memory:");
    try {
      expect(
        resolve(persistence, "receipt-codex-compact-session", "SessionStart", "compact"),
      ).toMatchObject({
        action: "conversation_started",
        runId: null,
      });
      expect(persistence.taskRuns.listForConversation("conversation-codex-lifecycle")).toEqual([]);
      expect(persistence.conversations.get("conversation-codex-lifecycle")).toMatchObject({
        startMode: "compact",
      });
    } finally {
      persistence.close();
    }
  });

  it("fails a Run-associated Codex fact when no active Run exists", () => {
    const persistence = openPersistence(":memory:");
    try {
      resolve(persistence, "receipt-codex-no-run-session", "SessionStart");
      expect(
        resolve(persistence, "receipt-codex-no-run-permission", "PermissionRequest"),
      ).toMatchObject({
        outcome: "failed",
        action: "receipt_failed",
        diagnosticCode: "no_active_run",
        runId: null,
      });
      expect(persistence.ingressReceipts.get("receipt-codex-no-run-permission")).toMatchObject({
        processingStatus: "failed",
        failureCode: "no_active_run",
      });
    } finally {
      persistence.close();
    }
  });

  it("uses Stop and SessionEnd as the only Codex state transitions after a prompt", () => {
    const persistence = openPersistence(":memory:");
    try {
      resolve(persistence, "receipt-codex-stop-session", "SessionStart");
      resolve(persistence, "receipt-codex-stop-prompt", "UserPromptSubmit");
      expect(resolve(persistence, "receipt-codex-stop", "Stop")).toMatchObject({
        action: "run_finalizing",
        runId: "run-codex-lifecycle",
      });
      expect(persistence.taskRuns.get("run-codex-lifecycle")).toMatchObject({
        status: "Finalizing",
        sourceStopReason: "stop",
      });
      expect(resolve(persistence, "receipt-codex-session-end", "SessionEnd")).toMatchObject({
        action: "conversation_ended",
        runId: null,
      });
      expect(persistence.conversations.get("conversation-codex-lifecycle")).toMatchObject({
        status: "Ended",
      });
    } finally {
      persistence.close();
    }
  });
});
