import { Buffer } from "node:buffer";
import { createSecretKey } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClaudeAdapterIngress, SupportedClaudeHookPayload } from "@ownloop/contracts";
import { prepareIngressReceipt } from "@ownloop/ingress-security";
import { afterEach, describe, expect, it } from "vitest";

import { processLifecycleReceipt } from "../lifecycle/processor.js";
import { openConfiguredDatabase } from "../persistence/database.js";
import { MIGRATIONS } from "../persistence/migration-definitions.js";
import { readAppliedMigrations, runMigrations } from "../persistence/migrations.js";
import {
  type NewPreparedIngressReceipt,
  type OwnLoopPersistence,
  openPersistence,
  type PersistenceError,
} from "../persistence/index.js";
import {
  processEventNormalization,
  processPendingEventNormalizations,
  type EventNormalizationDependencies,
} from "./processor.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 23));
const NORMALIZED_AT = "2026-07-21T15:00:30.000Z";
const openHandles: OwnLoopPersistence[] = [];
const temporaryDirectories: string[] = [];
let receiptCounter = 0;
let eventCounter = 0;

function memoryPersistence(): OwnLoopPersistence {
  const persistence = openPersistence(":memory:");
  openHandles.push(persistence);
  return persistence;
}

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ownloop-normalization-"));
  temporaryDirectories.push(directory);
  return join(directory, "ownloop.sqlite");
}

function basePayload(
  hookName: SupportedClaudeHookPayload["hook_event_name"],
): SupportedClaudeHookPayload {
  const common = {
    session_id: "session-normalization-fixture",
    transcript_path: "/workspace/.claude/transcript.jsonl",
    cwd: "/workspace/project",
  };
  switch (hookName) {
    case "SessionStart":
      return { ...common, hook_event_name: hookName, source: "startup" };
    case "UserPromptSubmit":
      return {
        ...common,
        hook_event_name: hookName,
        prompt_id: `prompt-normalization-${receiptCounter + 1}`,
        prompt: "Neutral normalized prompt fixture.",
      };
    case "PreToolUse":
      return {
        ...common,
        hook_event_name: hookName,
        tool_name: "Read",
        tool_input: { file_path: "/workspace/project/src/index.ts" },
        tool_use_id: `tool-pre-${receiptCounter + 1}`,
      };
    case "PostToolUse":
      return {
        ...common,
        hook_event_name: hookName,
        tool_name: "Write",
        tool_input: { file_path: "/workspace/project/output.txt" },
        tool_response: { success: true },
        tool_use_id: `tool-post-${receiptCounter + 1}`,
      };
    case "PostToolUseFailure":
      return {
        ...common,
        hook_event_name: hookName,
        tool_name: "Bash",
        tool_input: { command: "fixture-command" },
        tool_use_id: `tool-failure-${receiptCounter + 1}`,
        error: "Fixture failure.",
      };
    case "PostToolBatch":
      return {
        ...common,
        hook_event_name: hookName,
        tool_calls: [
          {
            tool_name: "Read",
            tool_input: {},
            tool_use_id: `tool-batch-${receiptCounter + 1}`,
            tool_response: null,
          },
        ],
      };
    case "Stop":
      return {
        ...common,
        hook_event_name: hookName,
        stop_hook_active: false,
        last_assistant_message: "Fixture complete.",
      };
    case "StopFailure":
      return { ...common, hook_event_name: hookName, error: "rate_limit" };
    case "SessionEnd":
      return { ...common, hook_event_name: hookName, reason: "other" };
  }
}

function insertReceipt(
  persistence: OwnLoopPersistence,
  hookName: SupportedClaudeHookPayload["hook_event_name"],
  options: Readonly<{
    payload?: Record<string, unknown>;
    receivedAt?: string;
    createdAt?: string;
    receiptId?: string;
  }> = {},
): NewPreparedIngressReceipt {
  receiptCounter += 1;
  const receivedAt =
    options.receivedAt ?? `2026-07-21T15:00:${String(receiptCounter).padStart(2, "0")}.000+00:00`;
  const payload = {
    ...structuredClone(basePayload(hookName)),
    ...options.payload,
  } as SupportedClaudeHookPayload;
  const ingress: ClaudeAdapterIngress = {
    contractVersion: 1,
    source: "claude_code",
    adapterVersion: "0.1.0",
    receivedAt,
    payload,
  };
  const prepared = prepareIngressReceipt(ingress, {
    hmacKey: HMAC_KEY,
    homePath: "/home/fixture",
  });
  const receipt: NewPreparedIngressReceipt = {
    ...prepared,
    receiptId: options.receiptId ?? `receipt-normalization-${receiptCounter}`,
    processingStatus: "pending",
    processedAt: null,
    failureCode: null,
    createdAt:
      options.createdAt ?? `2026-07-21T15:01:${String(receiptCounter).padStart(2, "0")}.000Z`,
  };
  persistence.ingressReceipts.insertPrepared(receipt);
  return receipt;
}

function processLifecycle(persistence: OwnLoopPersistence, receiptId: string) {
  return processLifecycleReceipt(
    {
      persistence,
      clock: () => new Date("2026-07-21T15:02:00.000Z"),
    },
    receiptId,
  );
}

function normalizationDependencies(
  persistence: OwnLoopPersistence,
  overrides: Partial<EventNormalizationDependencies> = {},
): EventNormalizationDependencies {
  return {
    persistence,
    clock: () => new Date(NORMALIZED_AT),
    eventIdGenerator: () => {
      eventCounter += 1;
      return `event-normalization-${eventCounter}`;
    },
    ...overrides,
  };
}

function normalize(
  persistence: OwnLoopPersistence,
  receiptId: string,
  overrides: Partial<EventNormalizationDependencies> = {},
) {
  return processEventNormalization(normalizationDependencies(persistence, overrides), receiptId);
}

function startConversation(persistence: OwnLoopPersistence): NewPreparedIngressReceipt {
  const receipt = insertReceipt(persistence, "SessionStart");
  processLifecycle(persistence, receipt.receiptId);
  return receipt;
}

function startRun(persistence: OwnLoopPersistence): NewPreparedIngressReceipt {
  startConversation(persistence);
  const receipt = insertReceipt(persistence, "UserPromptSubmit");
  processLifecycle(persistence, receipt.receiptId);
  return receipt;
}

function prepareHookContext(
  persistence: OwnLoopPersistence,
  hookName: SupportedClaudeHookPayload["hook_event_name"],
): void {
  if (hookName === "SessionStart") {
    return;
  }
  startConversation(persistence);
  if (
    hookName === "PreToolUse" ||
    hookName === "PostToolUse" ||
    hookName === "PostToolUseFailure" ||
    hookName === "PostToolBatch" ||
    hookName === "Stop" ||
    hookName === "StopFailure"
  ) {
    const prompt = insertReceipt(persistence, "UserPromptSubmit");
    processLifecycle(persistence, prompt.receiptId);
  }
}

afterEach(() => {
  receiptCounter = 0;
  eventCounter = 0;
  while (openHandles.length > 0) {
    openHandles.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("migration version 4", () => {
  it("upgrades a version-3 database and applies idempotently", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 3));
      expect(readAppliedMigrations(opened.database)).toHaveLength(3);
      runMigrations(opened.database);
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
      expect(() => runMigrations(opened.database)).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("enforces normalization outcome constraints and immutability", () => {
    const persistence = memoryPersistence();
    const first = startConversation(persistence);
    const second = insertReceipt(persistence, "SessionStart", {
      receiptId: "receipt-constraint",
      payload: { session_id: "session-normalization-constraint" },
    });
    processLifecycle(persistence, second.receiptId);

    expect(() =>
      persistence.eventNormalizations.insert({
        receiptId: second.receiptId,
        outcome: "normalized",
        eventCount: 0,
        diagnosticCode: null,
        normalizedAt: NORMALIZED_AT,
      }),
    ).toThrow();

    persistence.eventNormalizations.insert({
      receiptId: first.receiptId,
      outcome: "skipped",
      eventCount: 0,
      diagnosticCode: "lifecycle_failed",
      normalizedAt: NORMALIZED_AT,
    });
    expect(persistence.eventNormalizations.get(first.receiptId)?.outcome).toBe("skipped");
  });
});

describe("Hook mapping policy v1", () => {
  const cases: readonly [SupportedClaudeHookPayload["hook_event_name"], readonly string[]][] = [
    ["SessionStart", ["conversation.started"]],
    ["UserPromptSubmit", ["run.started", "user.prompt_submitted"]],
    ["PreToolUse", ["tool.requested"]],
    ["PostToolUse", ["tool.succeeded"]],
    ["PostToolUseFailure", ["tool.failed"]],
    ["PostToolBatch", ["tool.batch_completed"]],
    ["Stop", ["run.stop_observed", "run.finalization_started"]],
    ["StopFailure", ["run.stop_failed", "run.finalization_started"]],
    ["SessionEnd", ["conversation.ended"]],
  ];

  it.each(cases)("normalizes %s deterministically", (hookName, expectedTypes) => {
    const persistence = memoryPersistence();
    prepareHookContext(persistence, hookName);
    const receipt = insertReceipt(persistence, hookName);
    processLifecycle(persistence, receipt.receiptId);
    const result = normalize(persistence, receipt.receiptId);
    expect(result?.outcome).toBe("normalized");
    expect(result?.eventCount).toBe(expectedTypes.length);
    expect(result?.eventIds.map((eventId) => persistence.events.get(eventId)?.type)).toEqual(
      expectedTypes,
    );
  });

  it("maps a reactivated SessionStart to conversation.resumed", () => {
    const persistence = memoryPersistence();
    startConversation(persistence);
    const end = insertReceipt(persistence, "SessionEnd");
    processLifecycle(persistence, end.receiptId);
    const resumed = insertReceipt(persistence, "SessionStart", {
      payload: { source: "resume" },
    });
    processLifecycle(persistence, resumed.receiptId);
    const result = normalize(persistence, resumed.receiptId);
    expect(persistence.events.get(result?.eventIds[0] ?? "")?.type).toBe("conversation.resumed");
  });
});

describe("sequence, payload, and metadata policy", () => {
  it("allocates adjacent Run sequences and continues after existing Events", () => {
    const persistence = memoryPersistence();
    const prompt = startRun(persistence);
    const promptResult = normalize(persistence, prompt.receiptId);
    const runId = persistence.lifecycleResolutions.get(prompt.receiptId)?.runId ?? "";

    const tool = insertReceipt(persistence, "PreToolUse");
    processLifecycle(persistence, tool.receiptId);
    normalize(persistence, tool.receiptId);

    const stop = insertReceipt(persistence, "Stop");
    processLifecycle(persistence, stop.receiptId);
    normalize(persistence, stop.receiptId);

    const events = persistence.events.listForRun(runId);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "user.prompt_submitted",
      "tool.requested",
      "run.stop_observed",
      "run.finalization_started",
    ]);
    expect(promptResult?.eventIds).toEqual(events.slice(0, 2).map((event) => event.eventId));
  });

  it("separates synthetic and source payload/metadata/sensitivity", () => {
    const persistence = memoryPersistence();
    const prompt = startRun(persistence);
    const result = normalize(persistence, prompt.receiptId);
    const synthetic = persistence.events.get(result?.eventIds[0] ?? "");
    const source = persistence.events.get(result?.eventIds[1] ?? "");

    expect(synthetic).toMatchObject({
      source: "ownloop",
      sourceEventName: null,
      sourceEventId: null,
      sensitivity: "normal",
      metadata: { collectorVersion: "0.1.0", sourceVersion: null },
    });
    expect(synthetic?.payload).toEqual({
      triggerHook: "UserPromptSubmit",
      lifecycleAction: "run_started",
      runNumber: 1,
    });
    expect(JSON.stringify(synthetic)).not.toContain("Neutral normalized prompt fixture");

    expect(source).toMatchObject({
      source: "claude_code",
      sourceEventName: "UserPromptSubmit",
      sensitivity: "sensitive",
    });
    expect(source?.payload).toHaveProperty("prompt", "Neutral normalized prompt fixture.");
  });

  it("keeps occurred, ingested, and normalized timestamps distinct", () => {
    const persistence = memoryPersistence();
    startConversation(persistence);
    const receipt = insertReceipt(persistence, "UserPromptSubmit", {
      receivedAt: "2026-07-21T16:00:00+01:00",
      createdAt: "2026-07-21T15:00:05.000Z",
    });
    processLifecycle(persistence, receipt.receiptId);
    const result = normalize(persistence, receipt.receiptId);
    const event = persistence.events.get(result?.eventIds[0] ?? "");
    expect(event?.occurredAt).toBe("2026-07-21T15:00:00.000Z");
    expect(event?.ingestedAt).toBe("2026-07-21T15:00:05.000Z");
    expect(result?.normalizedAt).toBe(NORMALIZED_AT);
  });

  it("keeps Conversation-level Events without Run sequence", () => {
    const persistence = memoryPersistence();
    const start = startConversation(persistence);
    const result = normalize(persistence, start.receiptId);
    expect(persistence.events.get(result?.eventIds[0] ?? "")).toMatchObject({
      runId: null,
      sequence: null,
    });
  });
});

describe("transactionality and idempotency", () => {
  it("reprocessing returns original Event IDs without appending", () => {
    const persistence = memoryPersistence();
    const prompt = startRun(persistence);
    const first = normalize(persistence, prompt.receiptId);
    const eventCount = persistence.events.countAll();
    const dedupCount = persistence.events.countDeduplicationRows();
    const second = normalize(persistence, prompt.receiptId);
    expect(second).toEqual(first);
    expect(persistence.events.countAll()).toBe(eventCount);
    expect(persistence.events.countDeduplicationRows()).toBe(dedupCount);
  });

  it("rolls back partial multi-Event append and leaves no sequence gap", () => {
    const persistence = memoryPersistence();
    const prompt = startRun(persistence);
    normalize(persistence, prompt.receiptId);
    const runId = persistence.lifecycleResolutions.get(prompt.receiptId)?.runId ?? "";

    const stop = insertReceipt(persistence, "Stop");
    processLifecycle(persistence, stop.receiptId);
    normalize(persistence, stop.receiptId, {
      eventIdGenerator: () => "duplicate-event-id",
    });
    expect(persistence.eventNormalizations.get(stop.receiptId)?.outcome).toBe("failed");
    expect(persistence.events.listForRun(runId)).toHaveLength(2);

    const tool = insertReceipt(persistence, "PreToolUse");
    processLifecycle(persistence, tool.receiptId);
    normalize(persistence, tool.receiptId);
    expect(persistence.events.listForRun(runId).map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("skips failed lifecycle resolutions with zero Events", () => {
    const persistence = memoryPersistence();
    const tool = insertReceipt(persistence, "PreToolUse");
    const lifecycle = processLifecycle(persistence, tool.receiptId);
    expect(lifecycle?.outcome).toBe("failed");
    const result = normalize(persistence, tool.receiptId);
    expect(result).toMatchObject({
      outcome: "skipped",
      eventCount: 0,
      diagnosticCode: "lifecycle_failed",
      eventIds: [],
    });
    expect(persistence.events.countAll()).toBe(0);
  });

  it("records invalid redacted payload as failed without Events", () => {
    const databasePath = temporaryDatabasePath();
    const persistence = openPersistence(databasePath);
    const prompt = startRun(persistence);
    persistence.close();

    const opened = openConfiguredDatabase(databasePath);
    try {
      opened.database.exec("DROP TRIGGER ingress_receipts_reject_content_update");
      opened.database.exec("DROP TRIGGER ingress_receipts_prepared_metadata_consistency_update");
      const summary = {
        policyVersion: 1,
        redactedFieldCount: 0,
        redactedValueCount: 0,
        pathReplacementCount: 0,
        droppedUnknownFieldCount: 0,
        truncatedValueCount: 0,
        rulesApplied: [],
        outputUtf8Bytes: 2,
      };
      opened.database
        .prepare(
          `UPDATE ingress_receipts
           SET redacted_payload_json = ?, redaction_summary_json = ?
           WHERE receipt_id = ?`,
        )
        .run("{}", JSON.stringify(summary), prompt.receiptId);
    } finally {
      opened.database.close();
    }

    const reopened = openPersistence(databasePath);
    openHandles.push(reopened);
    const result = normalize(reopened, prompt.receiptId);
    expect(result).toMatchObject({
      outcome: "failed",
      eventCount: 0,
      diagnosticCode: "invalid_redacted_payload",
    });
    expect(reopened.events.countAll()).toBe(0);
  });

  it("returns null when lifecycle resolution is missing", () => {
    const persistence = memoryPersistence();
    const receipt = insertReceipt(persistence, "SessionStart");
    expect(normalize(persistence, receipt.receiptId)).toBeNull();
    expect(persistence.eventNormalizations.countAll()).toBe(0);
  });
});

describe("deduplication, batching, persistence, and safety", () => {
  it("uses controlled per-output deduplication keys without sensitive excerpts", () => {
    const persistence = memoryPersistence();
    const prompt = startRun(persistence);
    const result = normalize(persistence, prompt.receiptId);
    for (const eventId of result?.eventIds ?? []) {
      const records = persistence.events.listDeduplicationRecordsForEvent(eventId);
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record).toBeDefined();
      const key = record?.deduplicationKey ?? "";
      expect(key).toContain(":event:");
      expect(key).not.toContain("Neutral normalized prompt fixture");
      expect(key).not.toContain("/workspace/project");
      expect(key).not.toContain(prompt.sourceSessionId);
      expect(key).not.toContain(prompt.payloadFingerprint);
      expect(record?.sourceSessionId).toBe(prompt.sourceSessionId);
    }
  });

  it("processes eligible receipts in bounded deterministic order", () => {
    const persistence = memoryPersistence();
    const first = startConversation(persistence);
    const prompt = insertReceipt(persistence, "UserPromptSubmit");
    processLifecycle(persistence, prompt.receiptId);
    const results = processPendingEventNormalizations(normalizationDependencies(persistence), 1);
    expect(results.map((result) => result.receiptId)).toEqual([first.receiptId]);
    expect(processPendingEventNormalizations(normalizationDependencies(persistence), 101)).toEqual(
      [],
    );
  });

  it("preserves normalization and sequence order after file-backed reopen", () => {
    const databasePath = temporaryDatabasePath();
    const first = openPersistence(databasePath);
    const prompt = startRun(first);
    const result = normalize(first, prompt.receiptId);
    const runId = first.lifecycleResolutions.get(prompt.receiptId)?.runId ?? "";
    first.close();

    const reopened = openPersistence(databasePath);
    openHandles.push(reopened);
    expect(reopened.eventNormalizations.get(prompt.receiptId)).toEqual(result);
    expect(reopened.events.listForRun(runId).map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("does not mutate lifecycle aggregates or expose fixture-sensitive values", () => {
    const persistence = memoryPersistence();
    const prompt = startRun(persistence);
    const resolution = persistence.lifecycleResolutions.get(prompt.receiptId);
    const runBefore = persistence.taskRuns.get(resolution?.runId ?? "");
    const result = normalize(persistence, prompt.receiptId);
    expect(persistence.taskRuns.get(resolution?.runId ?? "")).toEqual(runBefore);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Neutral normalized prompt fixture");
    expect(serialized).not.toContain("/workspace/project");
    expect(serialized).not.toContain(prompt.sourceSessionId);
    expect(serialized).not.toContain(prompt.payloadFingerprint);
  });

  it("keeps Event, normalization, and linkage rows append-only", () => {
    const databasePath = temporaryDatabasePath();
    const persistence = openPersistence(databasePath);
    const prompt = startRun(persistence);
    const result = normalize(persistence, prompt.receiptId);
    const eventId = result?.eventIds[0] ?? "";
    expect(persistence.events.get(eventId)).not.toBeNull();
    persistence.close();

    const opened = openConfiguredDatabase(databasePath);
    try {
      expect(() =>
        opened.database
          .prepare(
            `UPDATE receipt_event_normalizations
             SET normalized_at = ?
             WHERE receipt_id = ?`,
          )
          .run("2026-07-21T16:00:00.000Z", prompt.receiptId),
      ).toThrow();
      expect(() =>
        opened.database
          .prepare(
            `UPDATE receipt_normalized_events
             SET event_index = 9
             WHERE receipt_id = ? AND event_index = 0`,
          )
          .run(prompt.receiptId),
      ).toThrow();
      expect(() =>
        opened.database
          .prepare("UPDATE events SET sensitivity = 'normal' WHERE event_id = ?")
          .run(eventId),
      ).toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects persisted normalization linkage with non-contiguous indices", () => {
    const databasePath = temporaryDatabasePath();
    const persistence = openPersistence(databasePath);
    const prompt = startRun(persistence);
    normalize(persistence, prompt.receiptId);
    persistence.close();

    const opened = openConfiguredDatabase(databasePath);
    try {
      opened.database.exec("DROP TRIGGER receipt_normalized_events_reject_update");
      opened.database
        .prepare(
          `UPDATE receipt_normalized_events
           SET event_index = 2
           WHERE receipt_id = ? AND event_index = 1`,
        )
        .run(prompt.receiptId);
    } finally {
      opened.database.close();
    }

    const reopened = openPersistence(databasePath);
    openHandles.push(reopened);
    expect(() => reopened.eventNormalizations.get(prompt.receiptId)).toThrowError(
      expect.objectContaining<Partial<PersistenceError>>({ code: "invalid_persisted_row" }),
    );
  });
});
