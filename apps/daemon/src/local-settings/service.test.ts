import { createLocalArtifactStore, type LocalArtifactStore } from "../artifact-store/index.js";
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPersistence, type OwnLoopPersistence } from "../persistence/index.js";
import { LocalSettingsService } from "./service.js";
import { describe, expect, it } from "vitest";

const at = "2026-07-25T22:30:00.000Z";
const provider = {
  providerFamily: "responses_json_v1",
  baseUrl: "https://api.provider.example.org/v1",
  modelId: "model-1",
  modelRevision: null,
  timeoutMs: 30_000,
  maxResponseBytes: 65_536,
  retryPolicy: { maxAttempts: 2, baseDelayMs: 100, maxRetryAfterMs: 1_000 },
} as const;

function artifactStore(): LocalArtifactStore {
  return {
    collectUnreferencedArtifacts: async () => ({
      candidates: 2,
      metadataDeleted: 1,
      objectsDeleted: 1,
      objectsMissing: 0,
      skippedReferenced: 1,
    }),
  } as unknown as LocalArtifactStore;
}

function seedRun(
  persistence: OwnLoopPersistence,
  input: Readonly<{
    runId: string;
    runNumber: number;
    status: "Completed" | "Capturing";
    endedAt: string | null;
  }>,
): void {
  const workspaceId = `workspace-${input.runId}`;
  const conversationId = `conversation-${input.runId}`;
  persistence.workspaces.insert({
    workspaceId,
    canonicalPath: `/workspace/${input.runId}`,
    repositoryRoot: `/workspace/${input.runId}`,
    gitRemote: null,
    initialRepositoryFingerprint: "a".repeat(64),
    identityBasis: "git_resolved_v1",
    createdAt: at,
    lastObservedAt: at,
  });
  persistence.conversations.insert({
    conversationId,
    workspaceId,
    source: "claude_code",
    sourceSessionId: `session-${input.runId}`,
    startMode: "startup",
    startedAt: at,
    lastObservedAt: at,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId: input.runId,
    conversationId,
    runNumber: input.runNumber,
    redactedPrompt: "[REDACTED]",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: "2026-06-01T00:00:00.000Z",
    endedAt: input.endedAt,
    status: input.status,
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
  });
}

describe("LocalSettingsService", () => {
  it("keeps provider generation disabled until public config and memory-only secret are complete", () => {
    const persistence = openPersistence(":memory:");
    try {
      const service = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      expect(service.candidateGenerationOptions()).toEqual({ enabled: false });
      expect(() => service.loadProviderSecret("secret-key")).toThrow();

      const response = service.update({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: true,
          provider,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      expect(response.providerSecretStatus).toBe("absent");
      expect(service.candidateGenerationOptions()).toEqual({ enabled: false });

      expect(service.loadProviderSecret("secret-key")).toMatchObject({
        providerSecretStatus: "loaded",
        providerGenerationConfigured: true,
      });
      expect(service.candidateGenerationOptions()).toMatchObject({
        enabled: true,
        provider: { ...provider, apiKey: "secret-key" },
      });
      expect(JSON.stringify(persistence.localSettings.get())).not.toContain("secret-key");

      service.update({
        schemaVersion: 1,
        expectedRevision: 2,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: false,
          provider,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      expect(service.getResponse().providerSecretStatus).toBe("absent");
      expect(service.candidateGenerationOptions()).toEqual({ enabled: false });
    } finally {
      persistence.close();
    }
  });

  it("does not restore the provider secret after creating a new service instance", () => {
    const persistence = openPersistence(":memory:");
    try {
      const first = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      first.update({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: true,
          provider,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      first.loadProviderSecret("secret-key");
      expect(first.getResponse().providerSecretStatus).toBe("loaded");

      const restarted = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      expect(restarted.getResponse().providerSecretStatus).toBe("absent");
      expect(restarted.candidateGenerationOptions()).toEqual({ enabled: false });
    } finally {
      persistence.close();
    }
  });

  it("counts only allowlisted diagnostics and clears them when disabled", () => {
    const persistence = openPersistence(":memory:");
    try {
      const service = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      service.diagnosticsSink({ type: "server.started", port: 3000 });
      expect(service.diagnostics()).toMatchObject({ mode: "off", counts: [] });
      service.update({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: false,
          provider: null,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "counts_only",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      service.diagnosticsSink({
        type: "receipt.accepted",
        receiptId: "receipt-1",
        hookName: "Stop",
        duplicate: false,
      });
      service.diagnosticsSink({
        type: "receipt.accepted",
        receiptId: "receipt-1",
        hookName: "Stop",
        duplicate: true,
      });
      service.diagnosticsSink({ type: "request.rejected", code: "invalid_payload" });
      expect(service.diagnostics()).toMatchObject({
        mode: "counts_only",
        counts: [
          { code: "receipt_accepted", count: 1 },
          { code: "receipt_duplicate", count: 1 },
          { code: "request_rejected", count: 1 },
        ],
        rejectedByCode: [{ errorCode: "invalid_payload", count: 1 }],
      });
      expect(service.diagnosticsDashboardState()).toEqual({
        mode: "counts_only",
        process: {
          serverStarted: 0,
          serverStopped: 0,
          acceptedReceipts: 1,
          duplicateReceipts: 1,
          rejectedRequests: 1,
          acceptedByHook: [{ hookName: "Stop", count: 1 }],
          duplicateByHook: [{ hookName: "Stop", count: 1 }],
          rejectedByCode: [{ code: "invalid_payload", count: 1 }],
        },
      });
      service.update({
        schemaVersion: 1,
        expectedRevision: 2,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: false,
          provider: null,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      expect(service.diagnostics()).toMatchObject({ mode: "off", counts: [], rejectedByCode: [] });
    } finally {
      persistence.close();
    }
  });

  it("resets process counters after restart while preserving counts-only mode", () => {
    const persistence = openPersistence(":memory:");
    try {
      const first = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      first.update({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: false,
          provider: null,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "counts_only",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      first.diagnosticsSink({
        type: "receipt.accepted",
        receiptId: "receipt-restart",
        hookName: "Stop",
        duplicate: false,
      });
      expect(first.diagnosticsDashboardState().process?.acceptedReceipts).toBe(1);

      const restarted = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      expect(restarted.diagnosticsDashboardState()).toEqual({
        mode: "counts_only",
        process: {
          serverStarted: 0,
          serverStopped: 0,
          acceptedReceipts: 0,
          duplicateReceipts: 0,
          rejectedRequests: 0,
          acceptedByHook: [],
          duplicateByHook: [],
          rejectedByCode: [],
        },
      });
    } finally {
      persistence.close();
    }
  });

  it("previews and explicitly deletes only eligible terminal Runs", async () => {
    const persistence = openPersistence(":memory:");
    try {
      seedRun(persistence, {
        runId: "run-old",
        runNumber: 1,
        status: "Completed",
        endedAt: "2026-06-01T00:00:00.000Z",
      });
      seedRun(persistence, {
        runId: "run-new",
        runNumber: 2,
        status: "Completed",
        endedAt: "2026-07-24T00:00:00.000Z",
      });
      seedRun(persistence, {
        runId: "run-active",
        runNumber: 3,
        status: "Capturing",
        endedAt: null,
      });
      const settingsUpdatedAt = persistence.localSettings.get().updatedAt;
      const service = new LocalSettingsService({
        persistence,
        artifactStore: artifactStore(),
        clock: () => new Date(Date.parse(settingsUpdatedAt) + 1_000),
      });
      service.update({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: false,
          provider: null,
          retentionPolicy: "delete_terminal_after_30_days",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      expect(service.retentionPreview().runs.map((run) => run.runId)).toEqual(["run-old"]);
      const applied = await service.applyRetention();
      expect(applied).toMatchObject({ deletedRunIds: ["run-old"], retainedRunIds: [] });
      expect(persistence.taskRuns.get("run-old")).toBeNull();
      expect(persistence.taskRuns.get("run-new")).not.toBeNull();
      expect(persistence.taskRuns.get("run-active")).not.toBeNull();
      expect(await service.deleteRun("run-active")).toMatchObject({ outcome: "active_conflict" });
      expect(await service.deleteRun("run-new")).toMatchObject({
        outcome: "deleted",
        artifactGc: { scanned: 2, deleted: 1, retained: 1, failures: 0 },
      });
    } finally {
      persistence.close();
    }
  });
  it("never writes the provider API key to a file-backed database and forgets it after restart", () => {
    const root = mkdtempSync(join(tmpdir(), "ownloop-settings-secret-"));
    const databasePath = join(root, "ownloop.sqlite");
    const secret = "fixture-provider-secret-never-persist-123456";
    let persistence = openPersistence(databasePath);
    try {
      const service = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      service.update({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: true,
          provider,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      service.loadProviderSecret(secret);
      expect(service.getResponse().providerSecretStatus).toBe("loaded");
      persistence.close();
      expect(readFileSync(databasePath).includes(Buffer.from(secret))).toBe(false);

      persistence = openPersistence(databasePath);
      const restarted = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      expect(restarted.getResponse().providerSecretStatus).toBe("absent");
      expect(restarted.candidateGenerationOptions()).toEqual({ enabled: false });
    } finally {
      persistence.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("collects target-only artifacts while preserving content shared with another Run", async () => {
    const root = mkdtempSync(join(tmpdir(), "ownloop-settings-delete-"));
    const artifactRoot = join(root, "artifacts");
    const repositoryRoot = join(root, "repository");
    mkdirSync(repositoryRoot, { recursive: true });
    const persistence = openPersistence(join(root, "ownloop.sqlite"));
    try {
      seedRun(persistence, {
        runId: "run-delete",
        runNumber: 1,
        status: "Completed",
        endedAt: "2026-06-01T00:00:00.000Z",
      });
      seedRun(persistence, {
        runId: "run-keep",
        runNumber: 2,
        status: "Completed",
        endedAt: "2026-06-02T00:00:00.000Z",
      });
      let nextArtifact = 0;
      const store = await createLocalArtifactStore({
        artifactRoot,
        analyzedRepositoryRoots: [repositoryRoot],
        persistence,
        clock: () => new Date(at),
        artifactIdGenerator: () => `artifact-${++nextArtifact}`,
      });
      const shared = await store.putPreparedArtifactForRun({
        kind: "settings-test",
        mediaType: "application/octet-stream",
        sensitivity: "normal",
        preparedContent: [new TextEncoder().encode("shared bytes")],
        runId: "run-delete",
        role: "shared-evidence",
      });
      expect(
        store.linkArtifactToRun({
          artifactId: shared.artifactId,
          runId: "run-keep",
          role: "shared-evidence",
        }),
      ).toBe(true);
      const unique = await store.putPreparedArtifactForRun({
        kind: "settings-test",
        mediaType: "application/octet-stream",
        sensitivity: "normal",
        preparedContent: [new TextEncoder().encode("delete-only bytes")],
        runId: "run-delete",
        role: "delete-only",
      });

      const service = new LocalSettingsService({ persistence, artifactStore: store });
      const deleted = await service.deleteRun("run-delete");
      expect(deleted).toMatchObject({
        outcome: "deleted",
        artifactGc: { scanned: 1, deleted: 1, retained: 0, failures: 0 },
      });
      expect(persistence.taskRuns.get("run-delete")).toBeNull();
      expect(persistence.taskRuns.get("run-keep")).not.toBeNull();
      expect(persistence.artifacts.getMetadata(unique.artifactId)).toBeNull();
      expect(persistence.artifacts.getMetadata(shared.artifactId)).not.toBeNull();
      expect(store.listArtifactsForRun("run-keep")).toHaveLength(1);
      expect(
        new TextDecoder().decode((await store.readPreparedBytes(shared.artifactId)).bytes),
      ).toBe("shared bytes");
    } finally {
      persistence.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects provider public configuration outside the existing safe endpoint boundary", () => {
    const persistence = openPersistence(":memory:");
    try {
      const service = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
      expect(() =>
        service.update({
          schemaVersion: 1,
          expectedRevision: 1,
          replacement: {
            schemaVersion: 1,
            externalAiEnabled: true,
            provider: { ...provider, baseUrl: "https://127.0.0.1/v1" },
            retentionPolicy: "keep_until_deleted",
            diagnosticMode: "off",
            rawSourcePayloadRetention: "off",
            customSecretFieldPatterns: [],
          },
        }),
      ).toThrow();
      expect(persistence.localSettings.get()).toMatchObject({
        revision: 1,
        externalAiEnabled: false,
        provider: null,
      });
    } finally {
      persistence.close();
    }
  });

  it("reports an exact retention total beyond the bounded preview", () => {
    const persistence = openPersistence(":memory:");
    try {
      for (let index = 0; index < 105; index += 1) {
        seedRun(persistence, {
          runId: `run-preview-${String(index).padStart(3, "0")}`,
          runNumber: index + 1,
          status: "Completed",
          endedAt: "2026-06-01T00:00:00.000Z",
        });
      }
      const settingsUpdatedAt = persistence.localSettings.get().updatedAt;
      const service = new LocalSettingsService({
        persistence,
        artifactStore: artifactStore(),
        clock: () => new Date(Date.parse(settingsUpdatedAt) + 1_000),
      });
      service.update({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: false,
          provider: null,
          retentionPolicy: "delete_terminal_after_30_days",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      });
      const preview = service.retentionPreview();
      expect(preview.totalEligible).toBe(105);
      expect(preview.runs).toHaveLength(100);
      expect(preview.truncated).toBe(true);
    } finally {
      persistence.close();
    }
  });
});
