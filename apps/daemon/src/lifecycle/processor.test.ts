import { Buffer } from "node:buffer";
import { createHash, createSecretKey } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ClaudeAdapterIngress, SupportedClaudeHookPayload } from "@ownloop/contracts";
import { prepareIngressReceipt } from "@ownloop/ingress-security";
import { afterEach, describe, expect, it } from "vitest";

import { openConfiguredDatabase } from "../persistence/database.js";
import { MIGRATIONS } from "../persistence/migration-definitions.js";
import { readAppliedMigrations, runMigrations } from "../persistence/migrations.js";
import {
  type NewPreparedIngressReceipt,
  type OwnLoopPersistence,
  openPersistence,
  PersistenceError,
} from "../persistence/index.js";
import {
  processLifecycleReceipt,
  processPendingLifecycleReceipts,
  type LifecycleProcessorDependencies,
} from "./processor.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 17));
const CREATED_AT = "2026-07-21T14:00:00.000Z";
const RESOLVED_AT = "2026-07-21T14:00:10.000Z";
const openHandles: OwnLoopPersistence[] = [];
const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ownloop-lifecycle-"));
  temporaryDirectories.push(directory);
  return join(directory, "ownloop.sqlite");
}

function memoryPersistence(): OwnLoopPersistence {
  const persistence = openPersistence(":memory:");
  openHandles.push(persistence);
  return persistence;
}

function basePayload(
  hookName: SupportedClaudeHookPayload["hook_event_name"],
): SupportedClaudeHookPayload {
  const common = {
    session_id: "session-fixture-001",
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
        prompt_id: "prompt-fixture-default",
        prompt: "Neutral lifecycle prompt.",
      };
    case "PreToolUse":
      return {
        ...common,
        hook_event_name: hookName,
        tool_name: "Read",
        tool_input: { file_path: "/workspace/project/src/index.ts" },
        tool_use_id: "tool-pre-default",
      };
    case "PostToolUse":
      return {
        ...common,
        hook_event_name: hookName,
        tool_name: "Write",
        tool_input: { file_path: "/workspace/project/output.txt" },
        tool_response: { success: true },
        tool_use_id: "tool-post-default",
      };
    case "PostToolUseFailure":
      return {
        ...common,
        hook_event_name: hookName,
        tool_name: "Bash",
        tool_input: { command: "fixture-command" },
        tool_use_id: "tool-failure-default",
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
            tool_use_id: "tool-batch-default",
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

function payloadFixture(
  hookName: SupportedClaudeHookPayload["hook_event_name"],
  overrides: Record<string, unknown> = {},
): SupportedClaudeHookPayload {
  return {
    ...structuredClone(basePayload(hookName)),
    ...overrides,
  } as SupportedClaudeHookPayload;
}

let receiptCounter = 0;
function insertHookReceipt(
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
    options.receivedAt ?? `2026-07-21T14:00:${String(receiptCounter).padStart(2, "0")}.000Z`;
  const payload = payloadFixture(hookName, options.payload);
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
    receiptId: options.receiptId ?? `receipt-${receiptCounter}`,
    processingStatus: "pending",
    processedAt: null,
    failureCode: null,
    createdAt: options.createdAt ?? receivedAt,
  };
  persistence.ingressReceipts.insertPrepared(receipt);
  return receipt;
}

function dependencies(
  persistence: OwnLoopPersistence,
  overrides: Partial<LifecycleProcessorDependencies> = {},
): LifecycleProcessorDependencies {
  return {
    persistence,
    clock: () => new Date(RESOLVED_AT),
    ...overrides,
  };
}

function process(
  persistence: OwnLoopPersistence,
  receiptId: string,
  overrides: Partial<LifecycleProcessorDependencies> = {},
) {
  return processLifecycleReceipt(dependencies(persistence, overrides), receiptId);
}

afterEach(() => {
  receiptCounter = 0;
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

describe("migration version 3", () => {
  it("upgrades a version-2 database and preserves legacy Workspace identity honestly", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 2));
      opened.database
        .prepare(
          `INSERT INTO workspaces (
             workspace_id, canonical_path, repository_root, git_remote,
             initial_repository_fingerprint, created_at, last_observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-workspace",
          "/legacy/project",
          "/legacy/project",
          null,
          "legacy-fingerprint",
          CREATED_AT,
          CREATED_AT,
        );

      runMigrations(opened.database);
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
      expect(
        opened.database
          .prepare("SELECT identity_basis FROM workspaces WHERE workspace_id = ?")
          .get("legacy-workspace"),
      ).toEqual({ identity_basis: "legacy" });
      expect(() => runMigrations(opened.database)).not.toThrow();
    } finally {
      opened.database.close();
    }
  });

  it("rejects invalid future Conversation statuses", () => {
    const persistence = memoryPersistence();
    persistence.workspaces.insert({
      workspaceId: "workspace-fixture",
      canonicalPath: "/workspace/fixture",
      repositoryRoot: "/workspace/fixture",
      gitRemote: null,
      initialRepositoryFingerprint: `path-sha256:${"a".repeat(64)}`,
      identityBasis: "canonical_path_v1",
      createdAt: CREATED_AT,
      lastObservedAt: CREATED_AT,
    });
    expect(() =>
      persistence.conversations.insert({
        conversationId: "conversation-fixture",
        workspaceId: "workspace-fixture",
        source: "claude_code",
        sourceSessionId: "session-fixture",
        startMode: null,
        startedAt: CREATED_AT,
        lastObservedAt: CREATED_AT,
        endedAt: null,
        status: "Broken" as "Active",
      }),
    ).toThrow();
  });
});

describe("Workspace and Conversation lifecycle", () => {
  it("creates and reuses an explicit provisional Workspace", () => {
    const persistence = memoryPersistence();
    const first = insertHookReceipt(persistence, "SessionStart", {
      payload: { future_delivery: 1 },
    });
    const second = insertHookReceipt(persistence, "SessionStart", {
      payload: { future_delivery: 2, source: "resume" },
    });

    const firstResult = process(persistence, first.receiptId);
    const secondResult = process(persistence, second.receiptId);

    expect(firstResult).toMatchObject({ action: "conversation_started", outcome: "applied" });
    expect(secondResult).toMatchObject({
      workspaceId: firstResult?.workspaceId,
      conversationId: firstResult?.conversationId,
      action: "conversation_resumed",
    });
    const workspace = persistence.workspaces.get(firstResult?.workspaceId ?? "missing");
    expect(workspace).toMatchObject({
      canonicalPath: "/workspace/project",
      repositoryRoot: "/workspace/project",
      gitRemote: null,
      identityBasis: "canonical_path_v1",
      initialRepositoryFingerprint: `path-sha256:${createHash("sha256")
        .update("/workspace/project", "utf8")
        .digest("hex")}`,
    });
  });

  it.each(["startup", "resume", "clear", "compact"])("records SessionStart mode %s", (source) => {
    const persistence = memoryPersistence();
    const receipt = insertHookReceipt(persistence, "SessionStart", {
      payload: { source, future_delivery: source },
    });
    const result = process(persistence, receipt.receiptId);
    expect(persistence.conversations.get(result?.conversationId ?? "missing")?.startMode).toBe(
      source,
    );
  });

  it("infers a Conversation from a prompt and reactivates it after SessionEnd", () => {
    const persistence = memoryPersistence();
    const prompt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-inferred", prompt: "Neutral lifecycle prompt." },
    });
    const promptResult = process(persistence, prompt.receiptId);
    expect(promptResult).toMatchObject({ action: "run_started", outcome: "applied" });
    expect(persistence.conversations.get(promptResult?.conversationId ?? "missing")).toMatchObject({
      startMode: null,
      status: "Active",
    });

    const end = insertHookReceipt(persistence, "SessionEnd", {
      payload: { reason: "other", future_delivery: 1 },
    });
    process(persistence, end.receiptId);
    expect(persistence.conversations.get(promptResult?.conversationId ?? "missing")?.status).toBe(
      "Ended",
    );

    const rejectedTool = insertHookReceipt(persistence, "PreToolUse", {
      payload: { tool_use_id: "tool-after-end" },
    });
    expect(process(persistence, rejectedTool.receiptId)).toMatchObject({
      outcome: "failed",
      diagnosticCode: "conversation_ended",
    });

    const resume = insertHookReceipt(persistence, "SessionStart", {
      payload: { source: "resume", future_delivery: 2 },
    });
    expect(process(persistence, resume.receiptId)).toMatchObject({
      action: "conversation_resumed",
      outcome: "applied",
    });
    expect(persistence.conversations.get(promptResult?.conversationId ?? "missing")).toMatchObject({
      status: "Active",
      endedAt: null,
      startMode: "resume",
    });
  });

  it("fails a source session observed under another Workspace atomically", () => {
    const persistence = memoryPersistence();
    const start = insertHookReceipt(persistence, "SessionStart", {
      payload: { future_delivery: 1 },
    });
    process(persistence, start.receiptId);

    const conflict = insertHookReceipt(persistence, "SessionStart", {
      payload: {
        cwd: "/workspace/other",
        transcript_path: "/workspace/other/transcript.jsonl",
        future_delivery: 2,
      },
    });
    const result = process(persistence, conflict.receiptId);
    expect(result).toMatchObject({
      outcome: "failed",
      action: "receipt_failed",
      diagnosticCode: "conversation_workspace_conflict",
      conversationId: null,
    });
    expect(persistence.ingressReceipts.get(conflict.receiptId)).toMatchObject({
      processingStatus: "failed",
      failureCode: "conversation_workspace_conflict",
    });
  });
});

describe("Task Run lifecycle", () => {
  it("creates sequential Runs and abandons an unresolved Capturing Run", () => {
    const persistence = memoryPersistence();
    const first = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-1", prompt: "First neutral prompt." },
    });
    const firstResult = process(persistence, first.receiptId);
    const second = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-2", prompt: "Second neutral prompt." },
    });
    const secondResult = process(persistence, second.receiptId);

    const runs = persistence.taskRuns.listForConversation(firstResult?.conversationId ?? "missing");
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      runNumber: 1,
      status: "Abandoned",
      sourceStopReason: "superseded_by_prompt",
    });
    expect(runs[1]).toMatchObject({
      runId: secondResult?.runId,
      runNumber: 2,
      status: "Capturing",
      redactedPrompt: "Second neutral prompt.",
      baselineGitCommit: null,
      finalGitFingerprint: null,
    });
  });

  it.each(["PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch"] as const)(
    "associates %s with the latest active Run",
    (hookName) => {
      const persistence = memoryPersistence();
      const prompt = insertHookReceipt(persistence, "UserPromptSubmit", {
        payload: { prompt_id: `prompt-${hookName}`, prompt: "Neutral prompt." },
      });
      const run = process(persistence, prompt.receiptId);
      const tool = insertHookReceipt(persistence, hookName, {
        payload:
          hookName === "PostToolBatch"
            ? { future_delivery: hookName }
            : { tool_use_id: `tool-${hookName}` },
      });
      expect(process(persistence, tool.receiptId)).toMatchObject({
        runId: run?.runId,
        action: "run_associated",
        outcome: "associated",
      });
    },
  );

  it("fails tool and Stop receipts when no active Run exists", () => {
    const persistence = memoryPersistence();
    const tool = insertHookReceipt(persistence, "PreToolUse", {
      payload: { tool_use_id: "tool-no-run" },
    });
    const stop = insertHookReceipt(persistence, "Stop", {
      payload: { last_assistant_message: "No active run fixture." },
    });
    expect(process(persistence, tool.receiptId)).toMatchObject({
      outcome: "failed",
      diagnosticCode: "no_active_run",
    });
    expect(process(persistence, stop.receiptId)).toMatchObject({
      outcome: "failed",
      diagnosticCode: "no_active_run",
    });
  });

  it("transitions Stop and StopFailure to Finalizing idempotently", () => {
    const persistence = memoryPersistence();
    const prompt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-stop", prompt: "Neutral stop prompt." },
    });
    const run = process(persistence, prompt.receiptId);
    const stop = insertHookReceipt(persistence, "Stop", {
      payload: { last_assistant_message: "Stop fixture one." },
    });
    expect(process(persistence, stop.receiptId)).toMatchObject({
      runId: run?.runId,
      action: "run_finalizing",
      outcome: "applied",
    });
    expect(persistence.taskRuns.get(run?.runId ?? "missing")).toMatchObject({
      status: "Finalizing",
      sourceStopReason: "stop",
    });

    const failure = insertHookReceipt(persistence, "StopFailure", {
      payload: { error: "rate_limit", future_delivery: 2 },
    });
    expect(process(persistence, failure.receiptId)).toMatchObject({
      runId: run?.runId,
      outcome: "associated",
    });
    expect(persistence.taskRuns.get(run?.runId ?? "missing")?.sourceStopReason).toBe("rate_limit");
  });

  it("SessionEnd abandons Capturing Runs but preserves Finalizing Runs", () => {
    const persistence = memoryPersistence();
    const firstPrompt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-finalizing", prompt: "First prompt." },
    });
    const firstRun = process(persistence, firstPrompt.receiptId);
    const stop = insertHookReceipt(persistence, "Stop", {
      payload: { last_assistant_message: "Finalizing fixture." },
    });
    process(persistence, stop.receiptId);
    const secondPrompt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-capturing", prompt: "Second prompt." },
    });
    const secondRun = process(persistence, secondPrompt.receiptId);

    const end = insertHookReceipt(persistence, "SessionEnd", {
      payload: { reason: "other", future_delivery: 5 },
    });
    expect(process(persistence, end.receiptId)).toMatchObject({
      action: "conversation_ended",
      runId: null,
    });
    expect(persistence.taskRuns.get(firstRun?.runId ?? "missing")?.status).toBe("Finalizing");
    expect(persistence.taskRuns.get(secondRun?.runId ?? "missing")).toMatchObject({
      status: "Abandoned",
      sourceStopReason: "conversation_ended",
    });
  });
});

describe("receipt processing guarantees", () => {
  it("returns the stored resolution without replaying transitions", () => {
    const persistence = memoryPersistence();
    const receipt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-idempotent", prompt: "Idempotent prompt." },
    });
    const first = process(persistence, receipt.receiptId);
    const second = process(persistence, receipt.receiptId, {
      runIdGenerator: () => "run-should-not-be-created",
    });
    expect(second).toEqual(first);
    expect(
      persistence.taskRuns.listForConversation(first?.conversationId ?? "missing"),
    ).toHaveLength(1);
  });

  it("records invalid redacted lifecycle shape as a safe failed resolution", () => {
    const persistence = memoryPersistence();
    const receipt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-corrupt", prompt: "Original prompt." },
    });
    const original = persistence.ingressReceipts.get(receipt.receiptId);
    if (original === null || original.preparationStatus !== "prepared") {
      throw new Error("Prepared fixture receipt missing.");
    }
    persistence.close();
    openHandles.pop();

    const databasePath = temporaryDatabasePath();
    const target = openPersistence(databasePath);
    openHandles.push(target);
    target.ingressReceipts.insertPrepared({
      ...receipt,
      redactedPayloadJson: "{}",
      redactionSummary: {
        ...receipt.redactionSummary,
        outputUtf8Bytes: 2,
      },
    });
    expect(process(target, receipt.receiptId)).toMatchObject({
      outcome: "failed",
      diagnosticCode: "invalid_redacted_payload",
      workspaceId: null,
      conversationId: null,
    });
  });

  it("rolls back inferred aggregates when Run ID generation fails", () => {
    const persistence = memoryPersistence();
    const receipt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-run-id-failure", prompt: "Rollback fixture prompt." },
    });
    const result = process(persistence, receipt.receiptId, {
      runIdGenerator: () => "unsafe run id",
    });
    expect(result).toMatchObject({
      outcome: "failed",
      diagnosticCode: "lifecycle_processing_failed",
      workspaceId: null,
      conversationId: null,
      runId: null,
    });
    expect(persistence.workspaces.getByCanonicalPath("/workspace/project")).toBeNull();
    expect(
      persistence.conversations.getBySourceSession("claude_code", "session-fixture-001"),
    ).toBeNull();
  });

  it("marks unexpected generator failure after rolling back partial aggregate work", () => {
    const persistence = memoryPersistence();
    const receipt = insertHookReceipt(persistence, "SessionStart");
    const result = process(persistence, receipt.receiptId, {
      workspaceIdGenerator: () => "unsafe id with spaces",
    });
    expect(result).toMatchObject({
      outcome: "failed",
      diagnosticCode: "lifecycle_processing_failed",
      workspaceId: null,
    });
    expect(persistence.workspaces.getByCanonicalPath("/workspace/project")).toBeNull();
  });

  it("lists pending receipts deterministically and processes a bounded batch", () => {
    const persistence = memoryPersistence();
    const later = insertHookReceipt(persistence, "SessionStart", {
      receiptId: "receipt-b",
      createdAt: "2026-07-21T14:00:02.000Z",
      payload: { future_delivery: "b" },
    });
    const earlierA = insertHookReceipt(persistence, "SessionStart", {
      receiptId: "receipt-a",
      createdAt: "2026-07-21T14:00:01.000Z",
      payload: { future_delivery: "a" },
    });
    const earlierC = insertHookReceipt(persistence, "SessionStart", {
      receiptId: "receipt-c",
      createdAt: "2026-07-21T14:00:01.000Z",
      payload: { future_delivery: "c" },
    });
    expect(persistence.ingressReceipts.listPending(3).map((item) => item.receiptId)).toEqual([
      earlierA.receiptId,
      earlierC.receiptId,
      later.receiptId,
    ]);
    const results = processPendingLifecycleReceipts(dependencies(persistence), 2);
    expect(results.map((result) => result.receiptId)).toEqual([
      earlierA.receiptId,
      earlierC.receiptId,
    ]);
    expect(persistence.ingressReceipts.listPending(10).map((item) => item.receiptId)).toEqual([
      later.receiptId,
    ]);
  });

  it("discovers stale active Runs after file-backed reopen and creates no Events", () => {
    const databasePath = temporaryDatabasePath();
    let persistence = openPersistence(databasePath);
    const prompt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-stale", prompt: "Stale run prompt." },
      receivedAt: "2026-07-21T10:00:00.000Z",
      createdAt: "2026-07-21T10:00:00.000Z",
    });
    const result = processLifecycleReceipt(
      dependencies(persistence, { clock: () => new Date("2026-07-21T10:00:01.000Z") }),
      prompt.receiptId,
    );
    persistence.close();

    persistence = openPersistence(databasePath);
    openHandles.push(persistence);
    expect(persistence.taskRuns.listStaleActive("2026-07-21T11:00:00.000Z", 10)).toEqual([
      expect.objectContaining({
        run: expect.objectContaining({ runId: result?.runId, status: "Capturing" }),
      }),
    ]);
    expect(persistence.events.countAll()).toBe(0);
  });

  it("keeps committed lifecycle resolutions immutable in SQLite", () => {
    const databasePath = temporaryDatabasePath();
    const persistence = openPersistence(databasePath);
    const receipt = insertHookReceipt(persistence, "SessionStart");
    const result = process(persistence, receipt.receiptId);
    persistence.close();

    const opened = openConfiguredDatabase(databasePath);
    try {
      expect(() =>
        opened.database
          .prepare(
            "UPDATE receipt_lifecycle_resolutions SET outcome = 'associated' WHERE receipt_id = ?",
          )
          .run(receipt.receiptId),
      ).toThrow();
      expect(
        opened.database
          .prepare("SELECT outcome, action FROM receipt_lifecycle_resolutions WHERE receipt_id = ?")
          .get(receipt.receiptId),
      ).toEqual({ outcome: result?.outcome, action: result?.action });
    } finally {
      opened.database.close();
    }
  });

  it("fails legacy pending receipts without fabricating aggregate IDs", () => {
    const databasePath = temporaryDatabasePath();
    const opened = openConfiguredDatabase(databasePath);
    try {
      runMigrations(opened.database, [MIGRATIONS[0] as (typeof MIGRATIONS)[number]]);
      opened.database
        .prepare(
          `INSERT INTO ingress_receipts (
             receipt_id, ingress_contract_version, source, source_session_id,
             source_event_name, source_event_id, deduplication_key, received_at,
             payload_fingerprint, redacted_payload_json, processing_status,
             processed_at, failure_code, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "legacy-receipt",
          1,
          "claude_code",
          "legacy-session",
          "SessionStart",
          null,
          "legacy-dedup",
          CREATED_AT,
          "legacy-fingerprint",
          "{}",
          "pending",
          null,
          null,
          CREATED_AT,
        );
      runMigrations(opened.database);
    } finally {
      opened.database.close();
    }

    const persistence = openPersistence(databasePath);
    openHandles.push(persistence);
    expect(process(persistence, "legacy-receipt")).toMatchObject({
      outcome: "failed",
      diagnosticCode: "legacy_receipt_unsupported",
      workspaceId: null,
      conversationId: null,
      runId: null,
    });
  });

  it("keeps result and thrown error surfaces free of fixture content", () => {
    const persistence = memoryPersistence();
    const secretPrompt = "fixture-secret-prompt-value";
    const receipt = insertHookReceipt(persistence, "UserPromptSubmit", {
      payload: { prompt_id: "prompt-safe-result", prompt: secretPrompt },
    });
    const result = process(persistence, receipt.receiptId);
    expect(JSON.stringify(result)).not.toContain(secretPrompt);
    expect(JSON.stringify(result)).not.toContain("/workspace/project");
    expect(JSON.stringify(result)).not.toContain("session-fixture-001");
    expect(JSON.stringify(result)).not.toContain(receipt.payloadFingerprint);

    expect(() =>
      processLifecycleReceipt(
        dependencies(persistence, { clock: () => new Date(Number.NaN) }),
        "missing-receipt",
      ),
    ).toThrowError(PersistenceError);
  });
});
