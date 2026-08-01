import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createSecretKey } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  type CodexAdapterIngress,
  CodexAdapterIngressSchema,
  type SupportedCodexHookName,
} from "@ownloop/contracts/codex";
import { prepareCodexIngressReceipt } from "@ownloop/ingress-security";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalArtifactStore } from "./artifact-store/index.js";
import { classifyFinalizedRunChanges } from "./change-classification/index.js";
import {
  buildFinalizedRunEvidenceGraph,
  readValidatedRunEvidenceGraph,
} from "./evidence-graph/index.js";
import { finalizeRun } from "./finalization/index.js";
import { captureGitBaseline } from "./git-baseline/index.js";
import { processLifecycleReceipt } from "./lifecycle/index.js";
import { processEventNormalization } from "./normalization/index.js";
import { type OwnLoopPersistence, openPersistence } from "./persistence/index.js";
import { projectRawRunReplay } from "./replay/index.js";
import { extractFinalizedRunVerificationEvidence } from "./verification-extraction/index.js";

const execFileAsync = promisify(execFile);
const HMAC_KEY = createSecretKey(Buffer.alloc(32, 71));
const SESSION_AT = "2026-07-27T16:00:00.000Z";
const PROMPT_AT = "2026-07-27T16:00:01.000Z";
const BASELINE_AT = "2026-07-27T16:00:02.000Z";
const SOURCE_AT = "2026-07-27T16:00:03.000Z";
const STOP_AT = "2026-07-27T16:00:04.000Z";
const FINALIZED_AT = "2026-07-27T16:00:05.000Z";
const VERIFY_AT = "2026-07-27T16:00:06.000Z";
const temporaryDirectories: string[] = [];

const RUN_ID = "run-codex-e2e";
const CONVERSATION_ID = "conversation-codex-e2e";
const WORKSPACE_ID = "workspace-codex-e2e";

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      LC_ALL: "C",
      LANG: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const root = await temporaryDirectory("ownloop-codex-e2e-repository-");
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["config", "user.name", "OwnLoop Codex Fixture"]);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "example.test.ts"), "export const value = 1;\n", "utf8");
  await git(root, ["add", "src/example.test.ts"]);
  await git(root, ["commit", "-m", "initial fixture"]);
  return await realpath(root);
}

function ingress(
  root: string,
  hookName: SupportedCodexHookName,
  receivedAt: string,
): CodexAdapterIngress {
  const common = {
    session_id: "session-codex-e2e",
    transcript_path: null,
    cwd: root,
  } as const;
  const turn = {
    ...common,
    turn_id: "turn-codex-e2e",
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
        return {
          ...turn,
          hook_event_name: hookName,
          prompt: "Build a deterministic Codex evidence fixture.",
        };
      case "PreToolUse":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "pnpm test" },
          tool_use_id: "tool-codex-e2e",
        };
      case "PermissionRequest":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "pnpm test" },
        };
      case "PostToolUse":
        return {
          ...turn,
          hook_event_name: hookName,
          tool_name: "shell_command",
          tool_input: { command: "pnpm test" },
          tool_response: { exit_code: 0, stdout: "2 tests passed" },
          tool_use_id: "tool-codex-e2e",
        };
      case "PreCompact":
      case "PostCompact":
        return { ...turn, hook_event_name: hookName, trigger: "auto" };
      case "SubagentStart":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-codex-e2e",
          agent_type: "worker",
        };
      case "SubagentStop":
        return {
          ...turn,
          hook_event_name: hookName,
          agent_id: "agent-codex-e2e",
          agent_type: "worker",
          agent_transcript_path: null,
          last_assistant_message: "Subagent work completed.",
          stop_hook_active: false,
        };
      case "Stop":
        return {
          ...turn,
          hook_event_name: hookName,
          last_assistant_message: "Codex turn completed.",
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
    receivedAt,
    payload,
  });
}

function sequentialIds(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${String(++index).padStart(3, "0")}`;
}

function processHook(
  persistence: OwnLoopPersistence,
  root: string,
  nextEventId: () => string,
  receiptId: string,
  hookName: SupportedCodexHookName,
  receivedAt: string,
): void {
  persistence.ingressReceipts.insertPreparedOrGetExisting({
    ...prepareCodexIngressReceipt(ingress(root, hookName, receivedAt), {
      hmacKey: HMAC_KEY,
      homePath: join(root, ".."),
    }),
    receiptId,
    processingStatus: "pending",
    processedAt: null,
    failureCode: null,
    createdAt: receivedAt,
  });
  const lifecycle = processLifecycleReceipt(
    {
      persistence,
      clock: () => new Date(receivedAt),
      workspaceIdGenerator: () => WORKSPACE_ID,
      conversationIdGenerator: () => CONVERSATION_ID,
      runIdGenerator: () => RUN_ID,
    },
    receiptId,
  );
  if (lifecycle === null) throw new Error("Expected a lifecycle resolution.");
  const normalization = processEventNormalization(
    {
      persistence,
      clock: () => new Date(receivedAt),
      eventIdGenerator: nextEventId,
    },
    receiptId,
  );
  if (normalization === null) throw new Error("Expected an Event normalization.");
}

describe("Codex full evidence pipeline", () => {
  it("flows through real Git, finalization, evidence, and privacy-safe Replay", async () => {
    const root = await createRepository();
    const dataRoot = await temporaryDirectory("ownloop-codex-e2e-data-");
    const persistence = openPersistence(":memory:");
    const nextSourceEventId = sequentialIds("event-codex-e2e");
    try {
      const artifactStore = await createLocalArtifactStore({
        artifactRoot: join(dataRoot, "artifacts"),
        analyzedRepositoryRoots: [root],
        persistence,
        clock: () => new Date(FINALIZED_AT),
      });

      processHook(
        persistence,
        root,
        nextSourceEventId,
        "receipt-codex-e2e-session",
        "SessionStart",
        SESSION_AT,
      );
      processHook(
        persistence,
        root,
        nextSourceEventId,
        "receipt-codex-e2e-prompt",
        "UserPromptSubmit",
        PROMPT_AT,
      );

      const baseline = await captureGitBaseline(
        {
          persistence,
          clock: () => new Date(BASELINE_AT),
          baselineIdGenerator: () => "baseline-codex-e2e",
          eventIdGenerator: () => "event-baseline-codex-e2e",
          evidenceGapIdGenerator: () => "gap-baseline-codex-e2e",
        },
        RUN_ID,
      );
      expect(baseline).toMatchObject({ outcome: "captured", diagnosticCode: null });

      await writeFile(
        join(root, "src", "example.test.ts"),
        "export const value = 2;\nexport const verified = true;\n",
        "utf8",
      );

      const sourceHooks = [
        "PreToolUse",
        "PermissionRequest",
        "PostToolUse",
        "PreCompact",
        "PostCompact",
        "SubagentStart",
        "SubagentStop",
      ] as const;
      sourceHooks.forEach((hookName, index) => {
        processHook(
          persistence,
          root,
          nextSourceEventId,
          `receipt-codex-e2e-source-${index}`,
          hookName,
          SOURCE_AT,
        );
      });
      processHook(persistence, root, nextSourceEventId, "receipt-codex-e2e-stop", "Stop", STOP_AT);

      const reconciliationEventIds = [
        "event-reconciliation-summary-codex-e2e",
        "event-reconciliation-file-codex-e2e",
      ];
      const finalizationEventIds = ["event-final-snapshot-codex-e2e", "event-terminal-codex-e2e"];
      const finalization = await finalizeRun(
        {
          persistence,
          artifactStore,
          clock: () => new Date(FINALIZED_AT),
          finalizationIdGenerator: () => "finalization-codex-e2e",
          eventIdGenerator: () => finalizationEventIds.shift() ?? "event-final-extra",
          evidenceGapIdGenerator: () => "gap-finalization-codex-e2e",
          reconciliationDependencies: {
            clock: () => new Date(STOP_AT),
            reconciliationIdGenerator: () => "reconciliation-codex-e2e",
            eventIdGenerator: () =>
              reconciliationEventIds.shift() ?? "event-reconciliation-extra-codex-e2e",
            evidenceGapIdGenerator: () => "gap-reconciliation-codex-e2e",
          },
        },
        RUN_ID,
      );
      expect(finalization).toMatchObject({
        terminalStatus: "Completed",
        diagnosticCode: null,
        reconciliationId: "reconciliation-codex-e2e",
      });
      expect(persistence.taskRuns.get(RUN_ID)).toMatchObject({
        status: "Completed",
        evidenceGapCount: 0,
      });
      expect(persistence.gitReconciliations.get("reconciliation-codex-e2e")).toMatchObject({
        outcome: "captured",
        attribution: "run_relative",
        baselineComparison: "changed",
        entryCount: 1,
        modifiedCount: 1,
      });

      const classification = await classifyFinalizedRunChanges(
        { persistence, artifactStore },
        RUN_ID,
      );
      expect(classification).toMatchObject({ outcome: "classified", entryCount: 1 });
      expect(classification?.aggregateLabels.some((entry) => entry.label === "tests")).toBe(true);

      const verification = await extractFinalizedRunVerificationEvidence(
        { persistence, artifactStore, clock: () => new Date(VERIFY_AT) },
        RUN_ID,
      );
      expect(verification).toMatchObject({
        outcome: "extracted",
        commandObservationCount: 1,
        recognizedCommandCount: 1,
        unknownCommandCount: 0,
        testFileChangeCount: 1,
      });
      expect(verification?.aggregateKinds).toEqual([
        {
          kind: "test",
          observationCount: 1,
          passedCount: 1,
          failedCount: 0,
          observedWithoutExitCodeCount: 0,
        },
      ]);

      const graph = await buildFinalizedRunEvidenceGraph({ persistence, artifactStore }, RUN_ID);
      expect(graph).toMatchObject({ runId: RUN_ID });
      const validatedGraph = await readValidatedRunEvidenceGraph(
        { persistence, artifactStore },
        RUN_ID,
      );
      expect(validatedGraph).not.toBeNull();
      expect(
        validatedGraph?.value.nodes.some(
          (node) =>
            node.kind === "event" &&
            node.metadata.eventSource === "codex" &&
            node.metadata.eventType === "permission.requested",
        ),
      ).toBe(true);
      expect(
        validatedGraph?.value.nodes.some(
          (node) =>
            node.kind === "event" &&
            node.metadata.eventSource === "codex" &&
            node.metadata.eventType === "agent.subagent_started",
        ),
      ).toBe(true);

      const replay = projectRawRunReplay(persistence, RUN_ID, validatedGraph);
      expect(replay).toMatchObject({
        run: { status: "Completed", completeness: "complete", evidenceGapCount: 0 },
      });
      expect(
        replay?.timeline.some(
          (event) => event.type === "tool.completed" && event.source === "codex",
        ),
      ).toBe(true);
      expect(
        replay?.timeline.some(
          (event) => event.type === "permission.requested" && event.source === "codex",
        ),
      ).toBe(true);
      expect(replay?.verification.map((event) => event.type)).toEqual([
        "command.completed",
        "test.observed",
      ]);
      expect(replay?.verification[0]?.payload).toMatchObject({
        verificationKind: "test",
        status: "completed",
        exitCode: 0,
      });

      const replayText = JSON.stringify(replay);
      expect(replayText).not.toContain("pnpm test");
      expect(replayText).not.toContain("2 tests passed");
      expect(replayText).not.toContain(root);
      expect(replayText).not.toContain("tool-codex-e2e");

      expect(await finalizeRun({ persistence, artifactStore }, RUN_ID)).toEqual(finalization);
      expect(await classifyFinalizedRunChanges({ persistence, artifactStore }, RUN_ID)).toEqual(
        classification,
      );
      expect(
        await extractFinalizedRunVerificationEvidence({ persistence, artifactStore }, RUN_ID),
      ).toEqual(verification);
      expect(await buildFinalizedRunEvidenceGraph({ persistence, artifactStore }, RUN_ID)).toEqual(
        graph,
      );

      processHook(
        persistence,
        root,
        nextSourceEventId,
        "receipt-codex-e2e-end",
        "SessionEnd",
        VERIFY_AT,
      );
      expect(persistence.conversations.get(CONVERSATION_ID)).toMatchObject({ status: "Ended" });
    } finally {
      persistence.close();
    }
  });
});
