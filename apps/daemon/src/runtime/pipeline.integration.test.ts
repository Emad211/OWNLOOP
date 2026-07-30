import { createSecretKey } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ClaudeAdapterIngress, SupportedClaudeHookPayload } from "@ownloop/contracts";
import { CANDIDATE_MOMENT_SCHEMA_VERSION } from "@ownloop/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalArtifactStore } from "../artifact-store/index.js";
import type { CandidateGenerationTransport } from "../candidate-generation/index.js";
import {
  createLoopbackIngressServer,
  generateInstallationToken,
  INGRESS_ROUTE,
  startLoopbackIngressServer,
} from "../ingress/index.js";
import { LocalSettingsService } from "../local-settings/index.js";
import { openPersistence } from "../persistence/index.js";
import { createProductionRuntimeStages } from "./stages.js";

const execFile = promisify(execFileCallback);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function git(repository: string, ...args: string[]): Promise<void> {
  await execFile("git", ["-C", repository, ...args], {
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
}

function hookPayload(
  repository: string,
  event: SupportedClaudeHookPayload["hook_event_name"],
): SupportedClaudeHookPayload {
  const common = {
    session_id: "session-runtime-pipeline",
    transcript_path: join(repository, ".claude", "transcript.jsonl"),
    cwd: repository,
  };
  switch (event) {
    case "SessionStart":
      return { ...common, hook_event_name: event, source: "startup" };
    case "UserPromptSubmit":
      return {
        ...common,
        hook_event_name: event,
        prompt_id: "d9428888-122b-11e1-b85c-61cd3cbb3210",
        prompt: "Modify the source file and run the tests.",
      };
    case "PostToolUse":
      return {
        ...common,
        hook_event_name: event,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { exitCode: 0, stdout: "PASS runtime pipeline", stderr: "" },
        tool_use_id: "tool-runtime-pipeline-1",
      };
    case "Stop":
      return {
        ...common,
        hook_event_name: event,
        stop_hook_active: false,
        last_assistant_message: "Source file modified and tests passed.",
      };
    default:
      throw new Error(`Unsupported pipeline fixture Hook: ${event}`);
  }
}

async function postHook(
  address: Readonly<{ url: string }>,
  token: string,
  receivedAt: string,
  payload: SupportedClaudeHookPayload,
): Promise<void> {
  const ingress: ClaudeAdapterIngress = {
    contractVersion: 1,
    source: "claude_code",
    adapterVersion: "0.1.0",
    receivedAt,
    payload,
  };
  const response = await fetch(`${address.url}${INGRESS_ROUTE}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(ingress),
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ ok: true, duplicate: false });
}

function providerTransport(): ReturnType<typeof vi.fn<CandidateGenerationTransport>> {
  return vi.fn<CandidateGenerationTransport>(async (request) => {
    expect(request.url).toBe("https://api.provider.example.org/v1/responses");
    expect(request.headers.Authorization).toBe("Bearer test-secret-api-key");
    const requestText = decoder.decode(request.body);
    expect(requestText).not.toContain("test-secret-api-key");
    const providerRequest = JSON.parse(requestText) as { input: string };
    const semanticInput = JSON.parse(providerRequest.input) as {
      evidenceSummaries: Array<{
        evidenceId: string;
        kind: string;
        changeKind?: string;
      }>;
    };
    const changedFile = semanticInput.evidenceSummaries.find(
      (summary) => summary.kind === "changed_file" && summary.changeKind === "modified",
    );
    if (changedFile === undefined) {
      throw new Error("The provider fixture did not receive modified-file Evidence.");
    }
    const batch = {
      schemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
      candidates: [
        {
          type: "change",
          title: "File modified",
          claim: "File modified",
          importance: "high",
          confidenceBasisPoints: 8_000,
          evidenceIds: [changedFile.evidenceId],
          suggestedInteraction: { kind: "acknowledge" },
        },
      ],
    };
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-request-id": "resp_runtime_pipeline_1",
      },
      body: encoder.encode(
        JSON.stringify({
          id: "resp_runtime_pipeline_1",
          status: "completed",
          output: [{ content: [{ type: "output_text", text: JSON.stringify(batch) }] }],
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
      ),
    };
  });
}

async function runStage(
  operation: (input: Readonly<{ signal: AbortSignal }>) => unknown,
): Promise<unknown> {
  return Promise.resolve(operation({ signal: new AbortController().signal }));
}

describe("production runtime pipeline", () => {
  it("processes authenticated Hooks through Git Evidence, provider generation, and deterministic validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "ownloop-runtime-pipeline-"));
    roots.push(root);
    const repository = join(root, "repository");
    await mkdir(join(repository, "src"), { recursive: true });
    await writeFile(join(repository, "src", "index.ts"), "export const value = 1;\n");
    await git(repository, "init", "-b", "main");
    await git(repository, "config", "user.email", "fixture@example.invalid");
    await git(repository, "config", "user.name", "OwnLoop Fixture");
    await git(repository, "add", ".");
    await git(repository, "commit", "-m", "Initial fixture");

    const databasePath = join(root, "data", "ownloop.sqlite");
    await mkdir(join(root, "data"), { recursive: true });
    const persistence = openPersistence(databasePath);
    const artifactStore = await createLocalArtifactStore({
      artifactRoot: join(root, "data", "artifacts"),
      persistence,
    });
    const initialSettings = persistence.localSettings.get();
    let now = new Date(new Date(initialSettings.updatedAt).getTime() + 1_000);
    const clock = () => new Date(now);
    const settings = new LocalSettingsService({ persistence, artifactStore, clock });
    const token = generateInstallationToken();
    const hmacKey = createSecretKey(Buffer.alloc(32, 29));
    let receipt = 0;
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey,
      homePath: root,
      settings,
      clock,
      receiptIdGenerator: () => `receipt-runtime-pipeline-${++receipt}`,
    });
    const address = await startLoopbackIngressServer(server, 0);
    const transport = providerTransport();
    const stages = createProductionRuntimeStages({
      persistence,
      artifactStore,
      settings,
      transport,
      clock,
      sleep: async () => undefined,
    });

    try {
      await postHook(address, token, now.toISOString(), hookPayload(repository, "SessionStart"));
      now = new Date(now.getTime() + 1_000);
      await postHook(
        address,
        token,
        now.toISOString(),
        hookPayload(repository, "UserPromptSubmit"),
      );
      now = new Date(now.getTime() + 1_000);
      await runStage(stages.lifecycle);
      await runStage(stages.normalization);
      const conversation = persistence.conversations.getBySourceSession(
        "claude_code",
        "session-runtime-pipeline",
      );
      expect(conversation).not.toBeNull();
      const run = persistence.taskRuns.listForConversation(conversation!.conversationId)[0];
      expect(run).toMatchObject({ status: "Capturing" });

      const baseline = (await runStage(stages.baseline)) as readonly unknown[];
      expect(baseline).toHaveLength(1);
      expect(persistence.gitBaselines.getByRun(run!.runId)).toMatchObject({ outcome: "captured" });

      await writeFile(join(repository, "src", "index.ts"), "export const value = 2;\n");
      now = new Date(now.getTime() + 1_000);
      await postHook(address, token, now.toISOString(), hookPayload(repository, "PostToolUse"));
      now = new Date(now.getTime() + 1_000);
      await postHook(address, token, now.toISOString(), hookPayload(repository, "Stop"));
      now = new Date(now.getTime() + 1_000);
      await runStage(stages.lifecycle);
      await runStage(stages.normalization);
      expect(persistence.taskRuns.get(run!.runId)).toMatchObject({ status: "Finalizing" });

      expect(await runStage(stages.reconciliation)).toHaveLength(1);
      expect(persistence.gitReconciliations.listForRun(run!.runId)[0]).toMatchObject({
        outcome: "captured",
        attribution: "run_relative",
        modifiedCount: 1,
      });
      expect(await runStage(stages.finalization)).toHaveLength(1);
      expect(persistence.taskRuns.get(run!.runId)).toMatchObject({ status: "Completed" });
      expect(await runStage(stages.classification)).toHaveLength(1);
      expect(await runStage(stages.verification)).toHaveLength(1);
      expect(await runStage(stages.evidence_graph)).toHaveLength(1);

      const current = settings.getResponse().settings;
      now = new Date(Math.max(now.getTime(), new Date(current.updatedAt).getTime()) + 1_000);
      settings.update({
        schemaVersion: 1,
        expectedRevision: current.revision,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: true,
          provider: {
            providerFamily: "responses_json_v1",
            baseUrl: "https://api.provider.example.org/v1",
            modelId: "model-1",
            modelRevision: "2026-07-01",
            timeoutMs: 10_000,
            maxResponseBytes: 65_536,
            retryPolicy: { maxAttempts: 1, baseDelayMs: 10, maxRetryAfterMs: 100 },
          },
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      settings.loadProviderSecret("test-secret-api-key");

      expect(await runStage(stages.semantic_input)).toHaveLength(1);
      expect(await runStage(stages.candidate_generation)).toHaveLength(1);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(await runStage(stages.candidate_validation)).toHaveLength(1);
      const generation = persistence.candidateGenerations.listForRun(run!.runId)[0];
      expect(generation).toMatchObject({
        status: "succeeded",
        candidateCounts: { total: 1, change: 1 },
      });
      const validation = persistence.candidateValidations.getLatestForRun(run!.runId);
      expect(validation).toMatchObject({ outcome: "partial", counts: { selected: 1 } });
    } finally {
      await server.close();
      persistence.close();
    }

    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from("test-secret-api-key"))).toBe(false);
    expect(databaseBytes.includes(Buffer.from("File modified"))).toBe(false);
  });
});
