import { createSecretKey } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FinalDiffManifestV1Schema,
  RawRunReplayV1Schema,
  ReplayErrorResponseSchema,
  ReplayRunListResponseV1Schema,
} from "@ownloop/contracts";
import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  type NormalizedEventEnvelope,
  NormalizedEventEnvelopeSchema,
} from "@ownloop/event-model";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalArtifactStore, type LocalArtifactStore } from "../artifact-store/index.js";
import { finalizeRun, recoverStaleRuns } from "../finalization/index.js";
import {
  createLoopbackIngressServer,
  generateInstallationToken,
  startLoopbackIngressServer,
} from "../ingress/index.js";
import { type OwnLoopPersistence, openPersistence } from "../persistence/index.js";
import { decodeReplayCursor, projectRawRunReplay, projectReplayRunList } from "./index.js";

const AT = "2026-07-22T10:00:00.000Z";
const STOP_AT = "2026-07-22T10:01:00.000Z";
const FINAL_AT = "2026-07-22T10:02:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "c".repeat(40);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function event(
  input: Readonly<{
    eventId: string;
    sequence: number;
    type: NormalizedEventEnvelope["type"];
    source?: "claude_code" | "ownloop";
    at?: string;
    payload?: Record<string, unknown>;
    workspaceId?: string;
    conversationId?: string;
    runId?: string;
  }>,
): NormalizedEventEnvelope {
  return NormalizedEventEnvelopeSchema.parse({
    eventId: input.eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: input.workspaceId ?? "workspace-1",
    conversationId: input.conversationId ?? "conversation-1",
    runId: input.runId ?? "run-1",
    sequence: input.sequence,
    type: input.type,
    source: input.source ?? "ownloop",
    sourceEventName: input.source === "claude_code" ? "fixture" : null,
    sourceEventId: null,
    occurredAt: input.at ?? AT,
    ingestedAt: input.at ?? AT,
    sensitivity: "normal",
    payload: input.payload ?? {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  });
}

async function completeFixture(databasePath = ":memory:"): Promise<
  Readonly<{
    persistence: OwnLoopPersistence;
    artifactStore: LocalArtifactStore;
    artifactRoot: string;
  }>
> {
  const directory = await temporaryDirectory("ownloop-replay-");
  const persistence = openPersistence(databasePath);
  persistence.workspaces.insert({
    workspaceId: "workspace-1",
    canonicalPath: "/private/workspace",
    repositoryRoot: "/private/workspace",
    gitRemote: null,
    initialRepositoryFingerprint: HASH_A,
    identityBasis: "git_resolved_v1",
    createdAt: AT,
    lastObservedAt: STOP_AT,
  });
  persistence.conversations.insert({
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    source: "claude_code",
    sourceSessionId: "secret-session-id",
    startMode: "startup",
    startedAt: AT,
    lastObservedAt: STOP_AT,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId: "run-1",
    conversationId: "conversation-1",
    runNumber: 1,
    redactedPrompt: `${"Understand this change. ".repeat(30)}[REDACTED]`,
    baselineGitCommit: COMMIT,
    baselineWorkingTreeFingerprint: HASH_A,
    startedAt: AT,
    endedAt: null,
    status: "Finalizing",
    finalGitFingerprint: null,
    sourceStopReason: "stop",
    evidenceGapCount: 0,
  });
  for (const item of [
    event({ eventId: "baseline-event", sequence: 1, type: "snapshot.baseline_captured" }),
    event({
      eventId: "prompt-event",
      sequence: 2,
      type: "user.prompt_submitted",
      source: "claude_code",
      payload: { prompt: "must-not-be-replayed", sourceSessionId: "secret-session-id" },
    }),
    event({
      eventId: "stop-event",
      sequence: 3,
      type: "run.stop_observed",
      source: "claude_code",
      at: STOP_AT,
    }),
    event({
      eventId: "summary-event",
      sequence: 4,
      type: "git.diff_computed",
      at: STOP_AT,
      payload: {
        outcome: "captured",
        diagnosticCode: null,
        repositoryRoot: "/private/workspace",
        workingTreeFingerprint: HASH_B,
      },
    }),
    event({
      eventId: "file-event",
      sequence: 5,
      type: "file.change_observed",
      at: STOP_AT,
      payload: { relativePath: ".env", pathIdentitySha256: HASH_A, changeKind: "modified" },
    }),
    event({
      eventId: "test-event",
      sequence: 6,
      type: "test.observed",
      at: STOP_AT,
      payload: { status: "passed", command: "pnpm test", repositoryRoot: "/private" },
    }),
  ]) {
    persistence.events.append(item);
  }
  persistence.gitBaselines.insert({
    baselineId: "baseline-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineEventId: "baseline-event",
    outcome: "captured",
    diagnosticCode: null,
    repositoryRoot: "/private/workspace",
    headCommit: COMMIT,
    stagedDiffSha256: HASH_A,
    unstagedDiffSha256: HASH_A,
    statusBeforeSha256: HASH_A,
    statusAfterSha256: HASH_A,
    workingTreeFingerprint: HASH_A,
    stagedDirty: false,
    unstagedDirty: false,
    untrackedCount: 0,
    untrackedHashedCount: 0,
    untrackedOmittedCount: 0,
    capturedAt: AT,
    captureDelayMs: 0,
  });
  persistence.gitReconciliations.insert({
    reconciliationId: "reconciliation-1",
    runId: "run-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    baselineId: "baseline-1",
    triggerEventId: "stop-event",
    summaryEventId: "summary-event",
    boundary: "stop",
    outcome: "captured",
    diagnosticCode: null,
    attribution: "run_relative",
    baselineComparison: "changed",
    repositoryRoot: "/private/workspace",
    headCommit: COMMIT,
    stagedDiffSha256: HASH_B,
    unstagedDiffSha256: HASH_B,
    statusBeforeSha256: HASH_B,
    statusAfterSha256: HASH_B,
    workingTreeFingerprint: HASH_B,
    stagedDirty: false,
    unstagedDirty: true,
    entryCount: 1,
    createdCount: 0,
    modifiedCount: 1,
    deletedCount: 0,
    typeChangedCount: 0,
    unmergedCount: 0,
    capturedAt: STOP_AT,
  });
  persistence.gitReconciliations.insertEntry({
    reconciliationId: "reconciliation-1",
    entryIndex: 0,
    fileEventId: "file-event",
    pathIdentitySha256: HASH_A,
    relativePath: null,
    changeKind: "modified",
    staged: false,
    unstaged: true,
    sensitivity: "secret",
    attribution: "run_relative",
  });
  const artifactRoot = join(directory, "artifacts");
  let artifactIndex = 0;
  const artifactStore = await createLocalArtifactStore({
    artifactRoot,
    persistence,
    clock: () => new Date(FINAL_AT),
    artifactIdGenerator: () => {
      artifactIndex += 1;
      return `artifact-${artifactIndex}`;
    },
  });
  const ids = ["snapshot-event", "terminal-event"];
  await finalizeRun(
    {
      persistence,
      artifactStore,
      clock: () => new Date(FINAL_AT),
      finalizationIdGenerator: () => "finalization-1",
      eventIdGenerator: () => ids.shift() ?? "extra-event",
      evidenceGapIdGenerator: () => "final-gap",
    },
    "run-1",
  );
  return { persistence, artifactStore, artifactRoot };
}

type ControlledRunVariant = "dirty_completed" | "partial" | "failed" | "abandoned";

async function addControlledReplayRun(
  persistence: OwnLoopPersistence,
  artifactStore: LocalArtifactStore,
  index: number,
  variant: ControlledRunVariant,
): Promise<string> {
  const suffix = String(index);
  const workspaceId = `workspace-${suffix}`;
  const conversationId = `conversation-${suffix}`;
  const runId = `run-${suffix}`;
  const startedAt = `2026-07-22T0${index}:00:00.000Z`;
  const stoppedAt = `2026-07-22T0${index}:01:00.000Z`;
  const finalizedAt = `2026-07-22T0${index}:02:00.000Z`;
  const stale = variant === "abandoned";
  persistence.workspaces.insert({
    workspaceId,
    canonicalPath: `/private/${workspaceId}`,
    repositoryRoot: `/private/${workspaceId}`,
    gitRemote: null,
    initialRepositoryFingerprint: HASH_A,
    identityBasis: "git_resolved_v1",
    createdAt: startedAt,
    lastObservedAt: stale ? startedAt : stoppedAt,
  });
  persistence.conversations.insert({
    conversationId,
    workspaceId,
    source: "claude_code",
    sourceSessionId: `secret-session-${suffix}`,
    startMode: "startup",
    startedAt,
    lastObservedAt: stale ? startedAt : stoppedAt,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId,
    conversationId,
    runNumber: index,
    redactedPrompt: `Controlled ${variant} replay`,
    baselineGitCommit: stale ? null : COMMIT,
    baselineWorkingTreeFingerprint: stale ? null : HASH_A,
    startedAt,
    endedAt: null,
    status: stale ? "Capturing" : "Finalizing",
    finalGitFingerprint: null,
    sourceStopReason: variant === "failed" ? "controlled failure details" : stale ? null : "stop",
    evidenceGapCount: 0,
  });

  if (stale) {
    const results = await recoverStaleRuns(
      {
        persistence,
        artifactStore,
        clock: () => new Date(finalizedAt),
        finalizationIdGenerator: () => `finalization-${suffix}`,
        eventIdGenerator: () => `terminal-${suffix}`,
        evidenceGapIdGenerator: () => `gap-${suffix}`,
      },
      `2026-07-22T0${index}:30:00.000Z`,
    );
    expect(results.some((result) => result.runId === runId)).toBe(true);
    return runId;
  }

  const baselineEventId = `baseline-${suffix}`;
  const stopEventId = `stop-${suffix}`;
  const summaryEventId = `summary-${suffix}`;
  for (const item of [
    event({
      eventId: baselineEventId,
      sequence: 1,
      type: "snapshot.baseline_captured",
      workspaceId,
      conversationId,
      runId,
      at: startedAt,
    }),
    event({
      eventId: stopEventId,
      sequence: 2,
      type: variant === "failed" ? "run.stop_failed" : "run.stop_observed",
      source: "claude_code",
      workspaceId,
      conversationId,
      runId,
      at: stoppedAt,
    }),
    event({
      eventId: summaryEventId,
      sequence: 3,
      type: "git.diff_computed",
      workspaceId,
      conversationId,
      runId,
      at: stoppedAt,
    }),
  ]) {
    persistence.events.append(item);
  }
  const dirty = variant === "dirty_completed";
  const partial = variant === "partial";
  const baselineId = `baseline-record-${suffix}`;
  persistence.gitBaselines.insert({
    baselineId,
    runId,
    workspaceId,
    conversationId,
    baselineEventId,
    outcome: "captured",
    diagnosticCode: null,
    repositoryRoot: `/private/${workspaceId}`,
    headCommit: COMMIT,
    stagedDiffSha256: HASH_A,
    unstagedDiffSha256: HASH_A,
    statusBeforeSha256: HASH_A,
    statusAfterSha256: HASH_A,
    workingTreeFingerprint: HASH_A,
    stagedDirty: dirty,
    unstagedDirty: false,
    untrackedCount: 0,
    untrackedHashedCount: 0,
    untrackedOmittedCount: 0,
    capturedAt: startedAt,
    captureDelayMs: 0,
  });
  persistence.gitReconciliations.insert({
    reconciliationId: `reconciliation-${suffix}`,
    runId,
    workspaceId,
    conversationId,
    baselineId,
    triggerEventId: stopEventId,
    summaryEventId,
    boundary: variant === "failed" ? "stop_failure" : "stop",
    outcome: partial ? "partial" : "captured",
    diagnosticCode: partial ? "baseline_partial" : null,
    attribution: partial ? "unavailable" : dirty ? "observed_only" : "run_relative",
    baselineComparison: partial ? "unavailable" : "changed",
    repositoryRoot: `/private/${workspaceId}`,
    headCommit: COMMIT,
    stagedDiffSha256: HASH_B,
    unstagedDiffSha256: HASH_B,
    statusBeforeSha256: HASH_B,
    statusAfterSha256: HASH_B,
    workingTreeFingerprint: partial ? null : HASH_B,
    stagedDirty: dirty,
    unstagedDirty: false,
    entryCount: 0,
    createdCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    typeChangedCount: 0,
    unmergedCount: 0,
    capturedAt: stoppedAt,
  });
  const finalEventIds = [`snapshot-${suffix}`, `terminal-${suffix}`];
  await finalizeRun(
    {
      persistence,
      artifactStore,
      clock: () => new Date(finalizedAt),
      finalizationIdGenerator: () => `finalization-${suffix}`,
      eventIdGenerator: () => finalEventIds.shift() ?? `extra-${suffix}`,
      evidenceGapIdGenerator: () => `gap-${suffix}`,
    },
    runId,
  );
  return runId;
}

function addCapturingRun(persistence: OwnLoopPersistence): void {
  persistence.taskRuns.insert({
    runId: "run-2",
    conversationId: "conversation-1",
    runNumber: 2,
    redactedPrompt: "New in-progress work",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: "2026-07-22T11:00:00.000Z",
    endedAt: null,
    status: "Capturing",
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
  });
}

function hmacKey() {
  return createSecretKey(Buffer.alloc(32, 7));
}

describe("Raw Replay projection", () => {
  it("projects a deterministic privacy-bounded complete replay", async () => {
    const fixture = await completeFixture();
    try {
      const replay = projectRawRunReplay(fixture.persistence, "run-1");
      expect(RawRunReplayV1Schema.safeParse(replay).success).toBe(true);
      expect(replay).toMatchObject({
        run: { status: "Completed", completeness: "complete", promptTruncated: true },
        baseline: { headPresent: true },
        finalization: { manifestArtifactId: "artifact-1" },
      });
      expect(replay?.reconciliations[0]?.changedFiles[0]).toMatchObject({
        relativePath: null,
        sensitivity: "secret",
      });
      expect(replay?.verification.map((item) => item.eventId)).toEqual(["test-event"]);
      expect(replay?.causalLinks.map((link) => link.type)).toEqual(
        expect.arrayContaining([
          "baseline_event",
          "reconciliation_trigger",
          "reconciliation_summary",
          "reconciliation_file_event",
          "finalization_terminal",
          "finalization_artifact",
        ]),
      );
      const serialized = JSON.stringify(replay);
      for (const forbidden of [
        "/private/workspace",
        "secret-session-id",
        COMMIT,
        HASH_A,
        HASH_B,
        "must-not-be-replayed",
        "pathIdentitySha256",
        "workingTreeFingerprint",
        "pnpm test",
        "storagePath",
        "digest",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      fixture.persistence.close();
    }
  });

  it("lists terminal and in-progress Runs using deterministic cursor order", async () => {
    const fixture = await completeFixture();
    try {
      addCapturingRun(fixture.persistence);
      const first = projectReplayRunList(fixture.persistence, 1, null);
      expect(ReplayRunListResponseV1Schema.safeParse(first).success).toBe(true);
      expect(first.runs.map((run) => [run.runId, run.completeness])).toEqual([
        ["run-2", "in_progress"],
      ]);
      expect(first.nextCursor).not.toBeNull();
      const decoded = decodeReplayCursor(first.nextCursor ?? undefined);
      expect(decoded).not.toBe(false);
      const second = projectReplayRunList(
        fixture.persistence,
        1,
        decoded === false ? null : decoded,
      );
      expect(second.runs.map((run) => run.runId)).toEqual(["run-1"]);
      expect(second.nextCursor).toBeNull();
    } finally {
      fixture.persistence.close();
    }
  });

  it("lists and replays five controlled Milestone A outcomes deterministically", async () => {
    const fixture = await completeFixture();
    try {
      const runIds = [
        "run-1",
        await addControlledReplayRun(
          fixture.persistence,
          fixture.artifactStore,
          3,
          "dirty_completed",
        ),
        await addControlledReplayRun(fixture.persistence, fixture.artifactStore, 4, "partial"),
        await addControlledReplayRun(fixture.persistence, fixture.artifactStore, 5, "failed"),
        await addControlledReplayRun(fixture.persistence, fixture.artifactStore, 6, "abandoned"),
      ];
      const list = projectReplayRunList(fixture.persistence, 20, null);
      expect(list.runs.filter((run) => runIds.includes(run.runId))).toHaveLength(5);
      const projected = runIds.map((runId) => projectRawRunReplay(fixture.persistence, runId));
      expect(projected.map((item) => item?.run.completeness).sort()).toEqual(
        ["abandoned", "complete", "complete", "failed", "partial"].sort(),
      );
      const dirty = projected.find((item) => item?.run.runId === "run-3");
      expect(dirty?.reconciliations[0]?.attribution).toBe("observed_only");
      const failed = projected.find((item) => item?.run.runId === "run-5");
      expect(failed?.run.sourceStopReason).toBe("source_failure");
      for (const replay of projected) {
        expect(RawRunReplayV1Schema.safeParse(replay).success).toBe(true);
        expect(JSON.stringify(replay)).not.toContain("/private/");
      }
    } finally {
      fixture.persistence.close();
    }
  });

  it("rejects malformed cursors without throwing", () => {
    expect(decodeReplayCursor("not+base64")).toBe(false);
    expect(decodeReplayCursor(Buffer.from('{"v":2}', "utf8").toString("base64url"))).toBe(false);
    const withoutTimezone = Buffer.from(
      JSON.stringify({
        v: 1,
        startedAt: "2026-07-22T10:00:00",
        conversationId: "conversation-1",
        runNumber: 1,
        runId: "run-1",
      }),
      "utf8",
    ).toString("base64url");
    const invalidCalendarDate = Buffer.from(
      JSON.stringify({
        v: 1,
        startedAt: "2026-02-30T10:00:00.000Z",
        conversationId: "conversation-1",
        runNumber: 1,
        runId: "run-1",
      }),
      "utf8",
    ).toString("base64url");
    expect(decodeReplayCursor(withoutTimezone)).toBe(false);
    expect(decodeReplayCursor(invalidCalendarDate)).toBe(false);
    expect(decodeReplayCursor(undefined)).toBeNull();
  });
});

describe("authenticated replay routes and contained static delivery", () => {
  it("serves authenticated list, detail, and verified artifact responses", async () => {
    const fixture = await completeFixture();
    const token = generateInstallationToken();
    const server = createLoopbackIngressServer({
      persistence: fixture.persistence,
      installationToken: token,
      hmacKey: hmacKey(),
      replay: { persistence: fixture.persistence, artifactStore: fixture.artifactStore },
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      const unauthorized = await fetch(`${address.url}/v1/replay/runs`);
      expect(unauthorized.status).toBe(401);
      expect(ReplayErrorResponseSchema.safeParse(await unauthorized.json()).success).toBe(true);

      const headers = { authorization: `Bearer ${token}` };
      const list = await fetch(`${address.url}/v1/replay/runs?limit=10`, { headers });
      expect(list.status).toBe(200);
      expect(ReplayRunListResponseV1Schema.safeParse(await list.json()).success).toBe(true);

      const detail = await fetch(`${address.url}/v1/replay/runs/run-1`, { headers });
      expect(detail.status).toBe(200);
      expect(RawRunReplayV1Schema.safeParse(await detail.json()).success).toBe(true);

      const artifact = await fetch(`${address.url}/v1/replay/artifacts/artifact-1`, { headers });
      expect(artifact.status).toBe(200);
      expect(artifact.headers.get("cache-control")).toBe("no-store");
      expect(artifact.headers.get("x-content-type-options")).toBe("nosniff");
      expect(artifact.headers.get("content-disposition")).toContain("artifact-1");
      expect(artifact.headers.get("content-length")).toBe(
        String(fixture.persistence.artifacts.getMetadata("artifact-1")?.sizeBytes),
      );
      expect(FinalDiffManifestV1Schema.parse(await artifact.json()).version).toBe(1);

      const invalidCursor = await fetch(`${address.url}/v1/replay/runs?cursor=***`, { headers });
      expect(invalidCursor.status).toBe(400);
      const nonCanonicalLimit = await fetch(`${address.url}/v1/replay/runs?limit=1e2`, { headers });
      expect(nonCanonicalLimit.status).toBe(400);
    } finally {
      await server.close();
      fixture.persistence.close();
    }
  });

  it("returns stable content-free errors for missing Runs and unavailable artifacts", async () => {
    const fixture = await completeFixture();
    const unreferenced = await fixture.artifactStore.putPreparedBytes({
      preparedBytes: new TextEncoder().encode('{"version":1}'),
      kind: "final-diff-manifest-v1",
      mediaType: "application/vnd.ownloop.final-diff+json",
      sensitivity: "sensitive",
    });
    const token = generateInstallationToken();
    const server = createLoopbackIngressServer({
      persistence: fixture.persistence,
      installationToken: token,
      hmacKey: hmacKey(),
      replay: { persistence: fixture.persistence, artifactStore: fixture.artifactStore },
    });
    const address = await startLoopbackIngressServer(server, 0);
    const headers = { authorization: `Bearer ${token}` };
    try {
      const missingRun = await fetch(`${address.url}/v1/replay/runs/missing-run`, { headers });
      expect(missingRun.status).toBe(404);
      expect(ReplayErrorResponseSchema.parse(await missingRun.json()).error.code).toBe(
        "run_not_found",
      );

      const unreferencedArtifact = await fetch(
        `${address.url}/v1/replay/artifacts/${unreferenced.artifactId}`,
        { headers },
      );
      expect(unreferencedArtifact.status).toBe(404);
      expect(ReplayErrorResponseSchema.parse(await unreferencedArtifact.json()).error.code).toBe(
        "artifact_not_found",
      );

      const metadata = fixture.persistence.artifacts.getMetadata("artifact-1");
      if (metadata === null) {
        throw new Error("fixture artifact metadata is missing");
      }
      await writeFile(join(fixture.artifactRoot, metadata.storagePath), "corrupted-content");
      const corruptArtifact = await fetch(`${address.url}/v1/replay/artifacts/artifact-1`, {
        headers,
      });
      expect(corruptArtifact.status).toBe(409);
      const corruptBody = ReplayErrorResponseSchema.parse(await corruptArtifact.json());
      expect(corruptBody.error.code).toBe("artifact_unavailable");
      const serialized = JSON.stringify(corruptBody);
      expect(serialized).not.toContain(fixture.artifactRoot);
      expect(serialized).not.toContain(metadata.storagePath);
      expect(serialized).not.toContain("corrupted-content");
    } finally {
      await server.close();
      fixture.persistence.close();
    }
  });

  it("rejects artifacts whose only Run reference is not a valid replay projection", async () => {
    const directory = await temporaryDirectory("ownloop-replay-artifact-run-corruption-");
    const databasePath = join(directory, "ownloop.sqlite");
    const fixture = await completeFixture(databasePath);
    const raw = new DatabaseSync(databasePath);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.prepare("DELETE FROM events WHERE event_id = ?").run("baseline-event");
    raw.close();
    const token = generateInstallationToken();
    let artifactRead = false;
    const server = createLoopbackIngressServer({
      persistence: fixture.persistence,
      installationToken: token,
      hmacKey: hmacKey(),
      replay: {
        persistence: fixture.persistence,
        artifactStore: {
          async readPreparedBytes() {
            artifactRead = true;
            throw new Error("artifact bytes must not be read for an invalid replay Run");
          },
        },
      },
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      const response = await fetch(`${address.url}/v1/replay/artifacts/artifact-1`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(503);
      expect(ReplayErrorResponseSchema.parse(await response.json()).error.code).toBe(
        "projection_failed",
      );
      expect(artifactRead).toBe(false);
    } finally {
      await server.close();
      fixture.persistence.close();
    }
  });

  it("checks authorization before touching replay persistence", async () => {
    const persistence = openPersistence(":memory:");
    const token = generateInstallationToken();
    const replayPersistence = new Proxy(persistence, {
      get(target, property, receiver) {
        if (property === "taskRuns") {
          throw new Error("replay-read-before-auth");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey: hmacKey(),
      replay: {
        persistence: replayPersistence,
        artifactStore: {
          async readPreparedBytes() {
            throw new Error("unexpected artifact read");
          },
        },
      },
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      expect((await fetch(`${address.url}/v1/replay/runs`)).status).toBe(401);
    } finally {
      await server.close();
      persistence.close();
    }
  });

  it("preserves deterministic replay and verified artifacts across daemon restart", async () => {
    const directory = await temporaryDirectory("ownloop-replay-restart-");
    const databasePath = join(directory, "ownloop.sqlite");
    const fixture = await completeFixture(databasePath);
    const before = projectRawRunReplay(fixture.persistence, "run-1");
    fixture.persistence.close();

    const reopened = openPersistence(databasePath);
    const reopenedStore = await createLocalArtifactStore({
      artifactRoot: fixture.artifactRoot,
      persistence: reopened,
    });
    const token = generateInstallationToken();
    const server = createLoopbackIngressServer({
      persistence: reopened,
      installationToken: token,
      hmacKey: hmacKey(),
      replay: { persistence: reopened, artifactStore: reopenedStore },
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      expect(projectRawRunReplay(reopened, "run-1")).toEqual(before);
      const response = await fetch(`${address.url}/v1/replay/runs/run-1`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(RawRunReplayV1Schema.safeParse(await response.json()).success).toBe(true);
      const artifact = await reopenedStore.readPreparedBytes("artifact-1");
      expect(artifact.mediaType).toBe("application/vnd.ownloop.final-diff+json");
    } finally {
      await server.close();
      reopened.close();
    }
  });

  it("keeps replay APIs available with an invalid static root and never adds CORS", async () => {
    const fixture = await completeFixture();
    const token = generateInstallationToken();
    const server = createLoopbackIngressServer({
      persistence: fixture.persistence,
      installationToken: token,
      hmacKey: hmacKey(),
      replay: {
        persistence: fixture.persistence,
        artifactStore: fixture.artifactStore,
        webRoot: join(fixture.artifactRoot, "missing-web-root"),
      },
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      const headers = { authorization: `Bearer ${token}` };
      const list = await fetch(`${address.url}/v1/replay/runs`, { headers });
      expect(list.status).toBe(200);
      expect(list.headers.get("access-control-allow-origin")).toBeNull();
      const unknown = await fetch(`${address.url}/v1/replay/unknown`, { headers });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "invalid_query" }),
        }),
      );
      expect((await fetch(`${address.url}/`)).status).toBe(404);
    } finally {
      await server.close();
      fixture.persistence.close();
    }
  });

  it("serves a contained same-origin SPA without exposing symlinks or traversal", async () => {
    const fixture = await completeFixture();
    const webRoot = await temporaryDirectory("ownloop-replay-web-");
    await mkdir(join(webRoot, "assets"));
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>OwnLoop Replay</title>");
    await writeFile(join(webRoot, "assets", "app.js"), "console.log('fixture')");
    const outside = join(await temporaryDirectory("ownloop-replay-outside-"), "secret.txt");
    await writeFile(outside, "fixture-secret");
    await symlink(outside, join(webRoot, "assets", "linked.txt"));
    const token = generateInstallationToken();
    const server = createLoopbackIngressServer({
      persistence: fixture.persistence,
      installationToken: token,
      hmacKey: hmacKey(),
      replay: { persistence: fixture.persistence, artifactStore: fixture.artifactStore, webRoot },
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      for (const path of ["/", "/runs/run-1", "/assets/app.js"]) {
        const response = await fetch(`${address.url}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
        expect(response.headers.get("x-frame-options")).toBe("DENY");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      const script = await fetch(`${address.url}/assets/app.js`);
      expect(script.headers.get("content-type")).toContain("text/javascript");
      const linked = await fetch(`${address.url}/assets/linked.txt`);
      expect(linked.status).toBe(404);
      expect(await linked.text()).not.toContain("fixture-secret");
      expect((await fetch(`${address.url}/..%2Fsecret.txt`)).status).toBe(404);
    } finally {
      await server.close();
      fixture.persistence.close();
    }
  });
});
