import { createSecretKey } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  createLoopbackIngressServer,
  generateInstallationToken,
  startLoopbackIngressServer,
} from "../ingress/index.js";
import { openPersistence, type OwnLoopPersistence } from "../persistence/index.js";
import { LocalSettingsService } from "./service.js";

const servers: ReturnType<typeof createLoopbackIngressServer>[] = [];
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
      candidates: 0,
      metadataDeleted: 0,
      objectsDeleted: 0,
      objectsMissing: 0,
      skippedReferenced: 0,
    }),
  } as unknown as LocalArtifactStore;
}

function seedRun(
  persistence: OwnLoopPersistence,
  runId: string,
  status: "Completed" | "Capturing",
): void {
  const workspaceId = `workspace-${runId}`;
  const conversationId = `conversation-${runId}`;
  persistence.workspaces.insert({
    workspaceId,
    canonicalPath: `/workspace/${runId}`,
    repositoryRoot: `/workspace/${runId}`,
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
    sourceSessionId: `session-${runId}`,
    startMode: "startup",
    startedAt: at,
    lastObservedAt: at,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId,
    conversationId,
    runNumber: 1,
    redactedPrompt: "[REDACTED]",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: at,
    endedAt: status === "Completed" ? at : null,
    status,
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Local settings loopback routes", () => {
  it("authenticates before settings access and persists only public configuration", async () => {
    const persistence = openPersistence(":memory:");
    const token = generateInstallationToken();
    const service = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey: createSecretKey(Buffer.alloc(32, 7)),
      settings: service,
      receiptIdGenerator: () => "receipt-settings-1",
      clock: () => new Date(at),
    });
    servers.push(server);
    const address = await startLoopbackIngressServer(server, 0);
    const auth = { authorization: `Bearer ${token}` };

    expect((await fetch(`${address.url}/v1/settings`)).status).toBe(401);
    const initial = await fetch(`${address.url}/v1/settings`, { headers: auth });
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toMatchObject({
      settings: { revision: 1, externalAiEnabled: false, rawSourcePayloadRetention: "off" },
      providerSecretStatus: "absent",
    });

    const update = await fetch(`${address.url}/v1/settings`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: true,
          provider,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "counts_only",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: ["tenantkey"],
        },
      }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ settings: { revision: 2 } });

    const stale = await fetch(`${address.url}/v1/settings`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        expectedRevision: 1,
        replacement: {
          schemaVersion: 1,
          externalAiEnabled: false,
          provider: null,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: [],
        },
      }),
    });
    expect(stale.status).toBe(409);

    const secret = "fixture-provider-secret-123456";
    const loaded = await fetch(`${address.url}/v1/settings/provider-secret`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, apiKey: secret }),
    });
    expect(loaded.status).toBe(200);
    const loadedBody = JSON.stringify(await loaded.json());
    expect(loadedBody).toContain("loaded");
    expect(loadedBody).not.toContain(secret);
    expect(JSON.stringify(persistence.localSettings.get())).not.toContain(secret);

    const ingress = await fetch(`${address.url}/v1/ingress/claude`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        contractVersion: 1,
        source: "claude_code",
        adapterVersion: "0.1.0",
        receivedAt: at,
        payload: {
          session_id: "session-settings",
          transcript_path: "/workspace/transcript.jsonl",
          cwd: "/workspace/project",
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_use_id: "tool-use-settings",
          tool_input: { tenant_key: "must-not-persist", ordinary: "visible" },
        },
      }),
    });
    expect(ingress.status).toBe(202);
    const receipt = persistence.ingressReceipts.get("receipt-settings-1");
    expect(receipt?.preparationStatus).toBe("prepared");
    if (receipt?.preparationStatus !== "prepared") throw new Error("prepared receipt missing");
    expect(receipt.redactedPayloadJson).not.toContain("must-not-persist");
    expect(receipt.redactedPayloadJson).toContain("visible");
    expect(receipt.redactionSummary.rulesApplied).toContain("field.secret.custom");

    persistence.close();
  });

  it("deletes only terminal Runs through the authenticated route", async () => {
    const persistence = openPersistence(":memory:");
    seedRun(persistence, "run-terminal", "Completed");
    seedRun(persistence, "run-active", "Capturing");
    const token = generateInstallationToken();
    const service = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey: createSecretKey(Buffer.alloc(32, 7)),
      settings: service,
    });
    servers.push(server);
    const address = await startLoopbackIngressServer(server, 0);
    const auth = { authorization: `Bearer ${token}` };

    expect(
      (await fetch(`${address.url}/v1/replay/runs/run-terminal`, { method: "DELETE" })).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${address.url}/v1/replay/runs/run-active`, {
          method: "DELETE",
          headers: auth,
        })
      ).status,
    ).toBe(409);
    const deleted = await fetch(`${address.url}/v1/replay/runs/run-terminal`, {
      method: "DELETE",
      headers: auth,
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ runId: "run-terminal", outcome: "deleted" });
    expect(persistence.taskRuns.get("run-terminal")).toBeNull();
    expect(persistence.taskRuns.get("run-active")).not.toBeNull();
    persistence.close();
  });
  it("rejects invalid settings media, JSON, oversized bodies, and unsupported methods without mutation", async () => {
    const persistence = openPersistence(":memory:");
    const token = generateInstallationToken();
    const service = new LocalSettingsService({ persistence, artifactStore: artifactStore() });
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey: createSecretKey(Buffer.alloc(32, 7)),
      settings: service,
    });
    servers.push(server);
    const address = await startLoopbackIngressServer(server, 0);
    const auth = { authorization: `Bearer ${token}` };

    const wrongMedia = await fetch(`${address.url}/v1/settings`, {
      method: "PUT",
      headers: { ...auth, "content-type": "text/plain" },
      body: "{}",
    });
    expect(wrongMedia.status).toBe(415);
    expect(wrongMedia.headers.get("cache-control")).toBe("no-store");

    const invalidJson = await fetch(`${address.url}/v1/settings`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.headers.get("cache-control")).toBe("no-store");

    const oversized = await fetch(`${address.url}/v1/settings/provider-secret`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, apiKey: "x".repeat(20_000) }),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get("cache-control")).toBe("no-store");

    const unsupported = await fetch(`${address.url}/v1/settings`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: "{}",
    });
    expect(unsupported.status).toBe(404);
    expect(unsupported.headers.get("cache-control")).toBe("no-store");
    expect(persistence.localSettings.get()).toMatchObject({ revision: 1 });
    persistence.close();
  });
});
