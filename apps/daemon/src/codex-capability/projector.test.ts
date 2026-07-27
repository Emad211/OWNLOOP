import { Buffer } from "node:buffer";
import { createSecretKey } from "node:crypto";

import {
  type CodexAdapterIngress,
  CodexAdapterIngressSchema,
  type CodexSourceSurface,
  SUPPORTED_CODEX_HOOK_NAMES,
  type SupportedCodexHookName,
} from "@ownloop/contracts/codex";
import { prepareCodexIngressReceipt } from "@ownloop/ingress-security";
import { describe, expect, it } from "vitest";

import { type OwnLoopPersistence, openPersistence } from "../persistence/index.js";
import { projectCodexCapabilityFromPersistence } from "./projector.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 83));
const AT = "2026-07-27T17:00:00.000Z";

function ingress(
  hookName: SupportedCodexHookName,
  input: Readonly<{
    sourceVersion?: string | null;
    sourceSurface?: CodexSourceSurface;
  }> = {},
): CodexAdapterIngress {
  const common = {
    session_id: "session-capability-secret-fixture",
    transcript_path: null,
    cwd: "/workspace/capability",
  } as const;
  const turn = {
    ...common,
    turn_id: "turn-capability-secret-fixture",
    model: "gpt-5.6-codex",
    permission_mode: "default",
  } as const;
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
        return { ...turn, hook_event_name: hookName, prompt: "private capability prompt" };
      case "PreToolUse":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "private capability command" },
          tool_use_id: "tool-capability-secret-fixture",
        };
      case "PermissionRequest":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "private capability command" },
        };
      case "PostToolUse":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "private capability command" },
          tool_response: { exit_code: 0, stdout: "private capability output" },
          tool_use_id: "tool-capability-secret-fixture",
        };
      case "PreCompact":
      case "PostCompact":
        return { ...turn, hook_event_name: hookName, trigger: "auto" };
      case "SubagentStart":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-capability-secret-fixture",
          agent_type: "worker",
        };
      case "SubagentStop":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-capability-secret-fixture",
          agent_type: "worker",
          agent_transcript_path: null,
          last_assistant_message: "private subagent output",
          stop_hook_active: false,
        };
      case "Stop":
        return {
          ...turn,
          hook_event_name: hookName,
          last_assistant_message: "private assistant output",
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
    sourceVersion:
      input.sourceVersion === undefined ? "codex-cli 0.133.0" : input.sourceVersion,
    sourceSurface: input.sourceSurface ?? "cli",
    receivedAt: AT,
    payload,
  });
}

function insertReceipt(
  persistence: OwnLoopPersistence,
  hookName: SupportedCodexHookName,
  index: number,
  input: Parameters<typeof ingress>[1] = {},
): void {
  persistence.ingressReceipts.insertPrepared({
    ...prepareCodexIngressReceipt(ingress(hookName, input), {
      hmacKey: HMAC_KEY,
      homePath: "/home/fixture",
    }),
    receiptId: `receipt-capability-${index}`,
    processingStatus: "pending",
    processedAt: null,
    failureCode: null,
    createdAt: new Date(Date.parse(AT) + index).toISOString(),
  });
}

function verifiedEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    configurationState: "exact" as const,
    hookEngineState: "enabled" as const,
    trustState: "trusted" as const,
    managedPolicyState: "unrestricted" as const,
    verifiedSourceSurfaces: ["cli"] as const,
    ...overrides,
  };
}

describe("Codex capability observation repository", () => {
  it("returns a canonical empty observation without reading payloads", () => {
    const persistence = openPersistence(":memory:");
    try {
      expect(persistence.codexCapabilities.readObservationFacts()).toEqual({
        receiptCount: 0,
        observedHookNames: [],
        observedSourceSurfaces: [],
        observedSourceVersions: [],
        sourceVersionMissing: false,
        lastObservedAt: null,
      });
    } finally {
      persistence.close();
    }
  });

  it("aggregates only controlled Hook, surface, version, and time facts", () => {
    const persistence = openPersistence(":memory:");
    try {
      insertReceipt(persistence, "SessionStart", 1);
      insertReceipt(persistence, "PostToolUse", 2);
      insertReceipt(persistence, "SessionEnd", 3, { sourceVersion: null });
      const facts = persistence.codexCapabilities.readObservationFacts();
      expect(facts).toEqual({
        receiptCount: 3,
        observedHookNames: ["PostToolUse", "SessionEnd", "SessionStart"],
        observedSourceSurfaces: ["cli"],
        observedSourceVersions: ["codex-cli 0.133.0"],
        sourceVersionMissing: true,
        lastObservedAt: "2026-07-27T17:00:00.003Z",
      });
      const serialized = JSON.stringify(facts);
      for (const forbidden of [
        "session-capability-secret-fixture",
        "private capability prompt",
        "private capability command",
        "private capability output",
        "tool-capability-secret-fixture",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      persistence.close();
    }
  });
});

describe("Codex runtime capability projector", () => {
  it("projects configuration state priorities without pretending events were observed", () => {
    const persistence = openPersistence(":memory:");
    try {
      expect(
        projectCodexCapabilityFromPersistence(
          persistence,
          verifiedEnvironment({ configurationState: "partial" }),
        ).state,
      ).toBe("repair_needed");
      expect(projectCodexCapabilityFromPersistence(persistence, verifiedEnvironment()).state).toBe(
        "enabled_no_events_seen",
      );
    } finally {
      persistence.close();
    }
  });

  it("derives controlled coverage and source limitations", () => {
    const persistence = openPersistence(":memory:");
    try {
      insertReceipt(persistence, "PreToolUse", 1, { sourceVersion: null, sourceSurface: "desktop" });
      insertReceipt(persistence, "SubagentStart", 2, {
        sourceVersion: null,
        sourceSurface: "desktop",
      });
      const status = projectCodexCapabilityFromPersistence(persistence, verifiedEnvironment());
      expect(status.state).toBe("partial_surface");
      expect(status.facts.limitations).toEqual([
        "client_surface_unverified",
        "incomplete_event_coverage",
        "missing_post_tool_use",
        "source_version_unknown",
        "subagent_lineage_partial",
      ]);
    } finally {
      persistence.close();
    }
  });

  it("becomes active only after all Hooks and a certified surface are observed", () => {
    const persistence = openPersistence(":memory:");
    try {
      SUPPORTED_CODEX_HOOK_NAMES.forEach((hookName, index) => {
        insertReceipt(persistence, hookName, index + 1);
      });
      const status = projectCodexCapabilityFromPersistence(persistence, verifiedEnvironment());
      expect(status).toMatchObject({
        state: "active",
        facts: {
          observedHookNames: [...SUPPORTED_CODEX_HOOK_NAMES].sort(),
          observedSourceSurfaces: ["cli"],
          observedSourceVersions: ["codex-cli 0.133.0"],
          limitations: [],
        },
      });
      const serialized = JSON.stringify(status);
      expect(serialized).not.toContain("session-capability-secret-fixture");
      expect(serialized).not.toContain("private capability");
    } finally {
      persistence.close();
    }
  });

  it("rejects duplicate or unknown certified surface declarations", () => {
    const persistence = openPersistence(":memory:");
    try {
      expect(() =>
        projectCodexCapabilityFromPersistence(
          persistence,
          verifiedEnvironment({ verifiedSourceSurfaces: ["cli", "cli"] }),
        ),
      ).toThrow();
      expect(() =>
        projectCodexCapabilityFromPersistence(
          persistence,
          verifiedEnvironment({ verifiedSourceSurfaces: ["unknown"] }),
        ),
      ).toThrow();
    } finally {
      persistence.close();
    }
  });
});
