import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  type AgentConversation,
  openPersistence,
  type OwnLoopPersistence,
  type TaskRun,
  type Workspace,
} from "../persistence/index.js";
import { openConfiguredDatabase } from "../persistence/database.js";
import { isSqliteConstraintError } from "../persistence/errors.js";
import { MIGRATIONS } from "../persistence/migration-definitions.js";
import { runMigrations } from "../persistence/migrations.js";
import { ArtifactStoreError, LocalArtifactStore } from "./index.js";

const TIMESTAMP = "2026-07-22T00:00:00.000Z";
const temporaryDirectories: string[] = [];
const openPersistenceHandles: OwnLoopPersistence[] = [];

function tempDirectory(prefix = "ownloop-artifact-store-"): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function workspace(id: string, path: string): Workspace {
  return {
    workspaceId: `workspace-${id}`,
    canonicalPath: path,
    repositoryRoot: path,
    gitRemote: null,
    initialRepositoryFingerprint: `workspace-fingerprint-${id}`,
    identityBasis: "legacy",
    createdAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
  };
}

function conversation(id: string, workspaceId: string): AgentConversation {
  return {
    conversationId: `conversation-${id}`,
    workspaceId,
    source: "claude_code",
    sourceSessionId: `source-session-${id}`,
    startMode: "startup",
    startedAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
    endedAt: null,
    status: "Active",
  };
}

function run(id: string, conversationId: string, runNumber: number): TaskRun {
  return {
    runId: `run-${id}`,
    conversationId,
    runNumber,
    redactedPrompt: "[REDACTED]",
    baselineGitCommit: null,
    baselineWorkingTreeFingerprint: null,
    startedAt: TIMESTAMP,
    endedAt: null,
    status: "Capturing",
    finalGitFingerprint: null,
    sourceStopReason: null,
    evidenceGapCount: 0,
  };
}

function seedRuns(persistence: OwnLoopPersistence, repositoryRoot: string): void {
  persistence.workspaces.insert(workspace("1", repositoryRoot));
  persistence.conversations.insert(conversation("1", "workspace-1"));
  persistence.taskRuns.insert(run("1", "conversation-1", 1));
  persistence.taskRuns.insert(run("2", "conversation-1", 2));
}

async function context(
  overrides: {
    maxArtifactBytes?: number;
    analyzedRepositoryRoots?: readonly string[];
    artifactIdGenerator?: () => string;
  } = {},
): Promise<{
  directory: string;
  root: string;
  databasePath: string;
  persistence: OwnLoopPersistence;
  store: LocalArtifactStore;
}> {
  const directory = tempDirectory();
  const root = join(directory, "artifact-root");
  const repositoryRoot = join(directory, "repository");
  await mkdir(repositoryRoot, { recursive: true });
  const databasePath = join(directory, "ownloop.sqlite");
  const persistence = openPersistence(databasePath);
  openPersistenceHandles.push(persistence);
  seedRuns(persistence, repositoryRoot);
  const store = await LocalArtifactStore.open({
    rootPath: root,
    persistence,
    analyzedRepositoryRoots: overrides.analyzedRepositoryRoots ?? [repositoryRoot],
    clock: () => new Date(TIMESTAMP),
    ...(overrides.maxArtifactBytes === undefined
      ? {}
      : { maxArtifactBytes: overrides.maxArtifactBytes }),
    ...(overrides.artifactIdGenerator === undefined
      ? {}
      : { artifactIdGenerator: overrides.artifactIdGenerator }),
  });
  return { directory, root, databasePath, persistence, store };
}

function expectedObjectPath(root: string, digest: string): string {
  const hex = digest.slice("sha256:".length);
  return join(root, "objects", "sha256", hex.slice(0, 2), hex.slice(2));
}

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ArtifactStoreError ? error.code : undefined;
}

afterEach(async () => {
  while (openPersistenceHandles.length > 0) openPersistenceHandles.pop()?.close();
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

describe("content-addressed artifact migration", () => {
  it("upgrades migration 6 to 7 while preserving a legacy row", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 6));
      opened.database
        .prepare(
          `INSERT INTO artifacts (
             artifact_id, digest, storage_path, size_bytes, kind, sensitivity, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("legacy-artifact", "legacy-digest", "/legacy/path", 3, "legacy", "normal", TIMESTAMP);
      runMigrations(opened.database);
      expect(
        opened.database.prepare("SELECT storage_version, media_type FROM artifacts").get(),
      ).toEqual({
        storage_version: 0,
        media_type: null,
      });
    } finally {
      opened.database.close();
    }
  });

  it("enforces v1 metadata, content immutability, reference immutability, and no downgrade", () => {
    const directory = tempDirectory();
    const databasePath = join(directory, "constraints.sqlite");
    const persistence = openPersistence(databasePath);
    seedRuns(persistence, directory);
    persistence.artifacts.insertMetadata({
      artifactId: "artifact-v1",
      digest: `sha256:${"a".repeat(64)}`,
      storagePath: `objects/sha256/aa/${"a".repeat(62)}`,
      sizeBytes: 4,
      kind: "prepared-diff",
      sensitivity: "secret",
      createdAt: TIMESTAMP,
      storageVersion: 1,
      mediaType: "text/plain",
    });
    persistence.artifacts.linkToRun({
      runId: "run-1",
      artifactId: "artifact-v1",
      role: "final-diff",
      createdAt: TIMESTAMP,
    });
    persistence.close();
    const opened = openConfiguredDatabase(databasePath);
    try {
      for (const statement of [
        "UPDATE artifacts SET size_bytes = 5 WHERE artifact_id = 'artifact-v1'",
        "UPDATE artifacts SET sensitivity = 'public' WHERE artifact_id = 'artifact-v1'",
        "UPDATE run_artifacts SET role = 'other' WHERE artifact_id = 'artifact-v1'",
        "DELETE FROM artifacts WHERE artifact_id = 'artifact-v1'",
      ]) {
        let thrown: unknown;
        try {
          opened.database.exec(statement);
        } catch (error) {
          thrown = error;
        }
        expect(isSqliteConstraintError(thrown)).toBe(true);
      }
    } finally {
      opened.database.close();
    }
  });

  it("rejects new legacy rows and malformed v1 digest/path metadata", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      const statements = [
        `INSERT INTO artifacts (
           artifact_id, digest, storage_path, size_bytes, kind, sensitivity, created_at,
           storage_version, media_type
         ) VALUES ('legacy-new', 'legacy', '/legacy', 1, 'legacy', 'normal', '${TIMESTAMP}', 0, NULL)`,
        `INSERT INTO artifacts (
           artifact_id, digest, storage_path, size_bytes, kind, sensitivity, created_at,
           storage_version, media_type
         ) VALUES (
           'invalid-v1', 'sha256:${"b".repeat(64)}',
           'objects/sha256/aa/${"b".repeat(62)}', 1, 'prepared', 'normal',
           '${TIMESTAMP}', 1, 'text/plain'
         )`,
      ];
      for (const statement of statements) {
        let thrown: unknown;
        try {
          opened.database.exec(statement);
        } catch (error) {
          thrown = error;
        }
        expect(isSqliteConstraintError(thrown)).toBe(true);
      }
    } finally {
      opened.database.close();
    }
  });
});

describe("LocalArtifactStore", () => {
  it("stores, links, reads, and lists prepared bytes without exposing the root", async () => {
    const { root, store } = await context();
    const prepared = Buffer.from("prepared artifact bytes");
    const result = await store.putPreparedBytes(prepared, {
      kind: "prepared-diff",
      mediaType: "text/plain",
      sensitivity: "sensitive",
      runReference: { runId: "run-1", role: "final-diff" },
    });

    expect(result.digest).toBe(`sha256:${createHash("sha256").update(prepared).digest("hex")}`);
    expect(result).toMatchObject({
      sizeBytes: prepared.length,
      linkedToRun: true,
      deduplicated: false,
    });
    expect(Buffer.from(await store.readPreparedBytes(result.artifactId))).toEqual(prepared);
    expect(store.listArtifactsForRun("run-1")).toEqual([
      expect.objectContaining({
        artifactId: result.artifactId,
        digest: result.digest,
        role: "final-diff",
        mediaType: "text/plain",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(root);
    expect(JSON.stringify(store.listArtifactsForRun("run-1"))).not.toContain(root);
  });

  it("streams content and removes temporary files after size-limit failure", async () => {
    const { root, store } = await context({ maxArtifactBytes: 4 });
    await expect(
      store.putPreparedStream(chunks("abc", "de"), {
        kind: "prepared-text",
        mediaType: "text/plain",
        sensitivity: "normal",
      }),
    ).rejects.toMatchObject({ code: "artifact_too_large" });
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });

  it("deduplicates concurrent identical writes and one Run reference", async () => {
    const { persistence, store } = await context();
    const prepared = Buffer.from("same prepared bytes");
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.putPreparedBytes(prepared, {
          kind: "prepared-diff",
          mediaType: "text/plain",
          sensitivity: "normal",
          runReference: { runId: "run-1", role: "final-diff" },
        }),
      ),
    );
    expect(new Set(results.map(({ artifactId }) => artifactId)).size).toBe(1);
    expect(persistence.artifacts.listForRun("run-1")).toHaveLength(1);
    expect(results.filter(({ deduplicated }) => deduplicated)).not.toHaveLength(0);
  });

  it("rejects conflicting metadata for the same digest and escalates sensitivity", async () => {
    const { persistence, store } = await context();
    const bytes = Buffer.from("metadata identity");
    const first = await store.putPreparedBytes(bytes, {
      kind: "prepared-diff",
      mediaType: "text/plain",
      sensitivity: "normal",
    });
    const escalated = await store.putPreparedBytes(bytes, {
      kind: "prepared-diff",
      mediaType: "text/plain",
      sensitivity: "secret",
    });
    expect(escalated.artifactId).toBe(first.artifactId);
    expect(persistence.artifacts.getMetadata(first.artifactId)?.sensitivity).toBe("secret");

    await expect(
      store.putPreparedBytes(bytes, {
        kind: "prepared-json",
        mediaType: "application/json",
        sensitivity: "secret",
      }),
    ).rejects.toMatchObject({ code: "artifact_metadata_conflict" });
  });

  it("rejects artifact roots overlapping analyzed repositories in either direction", async () => {
    const directory = tempDirectory();
    const repositoryRoot = join(directory, "repository");
    await mkdir(repositoryRoot, { recursive: true });
    const persistence = openPersistence(join(directory, "db.sqlite"));
    openPersistenceHandles.push(persistence);

    const nestedRoot = join(repositoryRoot, ".ownloop-artifacts");
    await expect(
      LocalArtifactStore.open({
        rootPath: nestedRoot,
        persistence,
        analyzedRepositoryRoots: [repositoryRoot],
      }),
    ).rejects.toMatchObject({ code: "invalid_artifact_root" });
    await expect(stat(nestedRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      LocalArtifactStore.open({
        rootPath: directory,
        persistence,
        analyzedRepositoryRoots: [repositoryRoot],
      }),
    ).rejects.toMatchObject({ code: "invalid_artifact_root" });
  });

  it("detects content corruption and a digest-path symlink", async () => {
    const { directory, root, store } = await context();
    const result = await store.putPreparedBytes(Buffer.from("original"), {
      kind: "prepared-text",
      mediaType: "text/plain",
      sensitivity: "normal",
    });
    const objectPath = expectedObjectPath(root, result.digest);
    await writeFile(objectPath, "corrupt!");
    await expect(store.readPreparedBytes(result.artifactId)).rejects.toMatchObject({
      code: "artifact_integrity_failed",
    });

    await unlink(objectPath);
    const external = join(directory, "external.txt");
    await writeFile(external, "original");
    await symlink(external, objectPath);
    await expect(store.readPreparedBytes(result.artifactId)).rejects.toMatchObject({
      code: "artifact_integrity_failed",
    });
  });

  it("rejects a pre-existing object with the expected path but wrong content", async () => {
    const { root, store } = await context();
    const prepared = Buffer.from("expected content");
    const hex = createHash("sha256").update(prepared).digest("hex");
    const objectPath = join(root, "objects", "sha256", hex.slice(0, 2), hex.slice(2));
    await mkdir(join(root, "objects", "sha256", hex.slice(0, 2)), { recursive: true });
    await writeFile(objectPath, Buffer.alloc(prepared.length, 120));

    await expect(
      store.putPreparedBytes(prepared, {
        kind: "prepared-text",
        mediaType: "text/plain",
        sensitivity: "normal",
      }),
    ).rejects.toMatchObject({ code: "artifact_integrity_failed" });
  });

  it("keeps shared content while referenced and garbage-collects after the final unlink", async () => {
    const { root, persistence, store } = await context();
    const stored = await store.putPreparedBytes(Buffer.from("shared content"), {
      kind: "prepared-diff",
      mediaType: "text/plain",
      sensitivity: "normal",
      runReference: { runId: "run-1", role: "final-diff" },
    });
    expect(await store.linkExistingToRun(stored.artifactId, "run-2", "final-diff")).toBe(true);
    persistence.taskRuns.delete("run-1");
    expect(await store.garbageCollectUnreferenced()).toMatchObject({ metadataDeleted: 0 });
    expect(Buffer.from(await store.readPreparedBytes(stored.artifactId)).toString()).toBe(
      "shared content",
    );

    expect(store.unlinkFromRun(stored.artifactId, "run-2", "final-diff")).toBe(true);
    const collected = await store.garbageCollectUnreferenced();
    expect(collected).toMatchObject({ metadataDeleted: 1, objectsDeleted: 1 });
    expect(persistence.artifacts.getMetadata(stored.artifactId)).toBeNull();
    await expect(stat(expectedObjectPath(root, stored.digest))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("handles a missing object during metadata garbage collection", async () => {
    const { root, store } = await context();
    const stored = await store.putPreparedBytes(Buffer.from("missing later"), {
      kind: "prepared-text",
      mediaType: "text/plain",
      sensitivity: "normal",
    });
    await unlink(expectedObjectPath(root, stored.digest));
    expect(await store.garbageCollectUnreferenced()).toMatchObject({
      metadataDeleted: 1,
      objectsAlreadyMissing: 1,
    });
  });

  it("sweeps only unreferenced regular objects in the controlled digest layout", async () => {
    const { root, store } = await context();
    const retained = await store.putPreparedBytes(Buffer.from("retained"), {
      kind: "prepared-text",
      mediaType: "text/plain",
      sensitivity: "normal",
    });
    const orphanHex = createHash("sha256").update("orphan").digest("hex");
    const prefix = join(root, "objects", "sha256", orphanHex.slice(0, 2));
    await mkdir(prefix, { recursive: true });
    await writeFile(join(prefix, orphanHex.slice(2)), "orphan");
    await writeFile(join(prefix, "not-a-digest"), "ignored");

    const result = await store.sweepOrphanObjects();
    expect(result).toMatchObject({ deleted: 1, retained: 1 });
    expect(Buffer.from(await store.readPreparedBytes(retained.artifactId)).toString()).toBe(
      "retained",
    );
  });

  it("preserves content and references across file-backed reopen", async () => {
    const { root, databasePath, persistence, store } = await context();
    const stored = await store.putPreparedBytes(Buffer.from("durable artifact"), {
      kind: "prepared-json",
      mediaType: "application/json",
      sensitivity: "normal",
      runReference: { runId: "run-1", role: "analysis-input" },
    });
    persistence.close();
    openPersistenceHandles.splice(openPersistenceHandles.indexOf(persistence), 1);
    const reopened = openPersistence(databasePath);
    openPersistenceHandles.push(reopened);
    const reopenedStore = await LocalArtifactStore.open({ rootPath: root, persistence: reopened });
    expect(Buffer.from(await reopenedStore.readPreparedBytes(stored.artifactId)).toString()).toBe(
      "durable artifact",
    );
    expect(reopenedStore.listArtifactsForRun("run-1")).toHaveLength(1);
  });

  it("uses private permissions where POSIX mode bits are supported", async () => {
    if (process.platform === "win32") return;
    const { root, store } = await context();
    const stored = await store.putPreparedBytes(Buffer.from("private"), {
      kind: "prepared-text",
      mediaType: "text/plain",
      sensitivity: "secret",
    });
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(expectedObjectPath(root, stored.digest))).mode & 0o777).toBe(0o600);
  });

  it("rejects migrated legacy metadata through the file-store API", async () => {
    const directory = tempDirectory();
    const databasePath = join(directory, "legacy.sqlite");
    const opened = openConfiguredDatabase(databasePath);
    try {
      runMigrations(opened.database, MIGRATIONS.slice(0, 5));
      opened.database
        .prepare(
          `INSERT INTO artifacts (
             artifact_id, digest, storage_path, size_bytes, kind, sensitivity, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("legacy-artifact", "legacy-digest", "/legacy/path", 3, "legacy", "normal", TIMESTAMP);
      runMigrations(opened.database);
    } finally {
      opened.database.close();
    }
    const persistence = openPersistence(databasePath);
    openPersistenceHandles.push(persistence);
    const store = await LocalArtifactStore.open({
      rootPath: join(directory, "artifact-root"),
      persistence,
    });
    await expect(store.readPreparedBytes("legacy-artifact")).rejects.toMatchObject({
      code: "artifact_unsupported",
    });
  });

  it("rolls back metadata/reference on an invalid Run and leaves only a sweepable orphan", async () => {
    const { root, persistence, store } = await context();
    const prepared = Buffer.from("orphan after failed reference");
    await expect(
      store.putPreparedBytes(prepared, {
        kind: "prepared-text",
        mediaType: "text/plain",
        sensitivity: "normal",
        runReference: { runId: "missing-run", role: "final-diff" },
      }),
    ).rejects.toMatchObject({ code: "artifact_persistence_failed" });
    expect(
      persistence.artifacts.getByDigest(
        `sha256:${createHash("sha256").update(prepared).digest("hex")}`,
      ),
    ).toBeNull();
    expect(await store.sweepOrphanObjects()).toMatchObject({ deleted: 1 });
    expect(
      JSON.stringify(errorCode(new ArtifactStoreError("artifact_persistence_failed"))),
    ).not.toContain(root);
  });
  it("cleans temporary files when a prepared-content iterator fails", async () => {
    const { root, store } = await context();
    async function* failing(): AsyncIterable<Uint8Array> {
      yield Buffer.from("partial");
      throw new Error("fixture failure");
    }
    await expect(
      store.putPreparedStream(failing(), {
        kind: "prepared-text",
        mediaType: "text/plain",
        sensitivity: "normal",
      }),
    ).rejects.toMatchObject({ code: "artifact_io_failed" });
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });

  it("rejects a digest-prefix directory symlink escaping the artifact root", async () => {
    if (process.platform === "win32") return;
    const { directory, root, store } = await context();
    const bytes = Buffer.from("prefix symlink escape");
    const hex = createHash("sha256").update(bytes).digest("hex");
    const prefix = join(root, "objects", "sha256", hex.slice(0, 2));
    const outside = join(directory, "outside");
    await mkdir(outside, { recursive: true });
    await rm(prefix, { recursive: true, force: true });
    await symlink(outside, prefix);

    await expect(
      store.putPreparedBytes(bytes, {
        kind: "prepared-text",
        mediaType: "text/plain",
        sensitivity: "normal",
      }),
    ).rejects.toMatchObject({ code: "artifact_integrity_failed" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("serializes an in-flight put with orphan sweeping", async () => {
    const { persistence, store } = await context();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* slow(): AsyncIterable<Uint8Array> {
      yield Buffer.from("first-");
      await gate;
      yield Buffer.from("second");
    }
    const put = store.putPreparedStream(slow(), {
      kind: "prepared-text",
      mediaType: "text/plain",
      sensitivity: "normal",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const sweep = store.sweepOrphanObjects();
    release?.();
    const [stored, sweepResult] = await Promise.all([put, sweep]);
    expect(persistence.artifacts.getMetadata(stored.artifactId)).not.toBeNull();
    expect(sweepResult.deleted).toBe(0);
    expect(Buffer.from(await store.readPreparedBytes(stored.artifactId)).toString()).toBe(
      "first-second",
    );
  });

  it("keeps public error messages content-free", async () => {
    const { root, store } = await context({ maxArtifactBytes: 1 });
    const secretFixture = "fixture-secret-content";
    let thrown: unknown;
    try {
      await store.putPreparedBytes(Buffer.from(secretFixture), {
        kind: "prepared-text",
        mediaType: "text/plain",
        sensitivity: "secret",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ArtifactStoreError);
    expect(String(thrown)).not.toContain(secretFixture);
    expect(String(thrown)).not.toContain(root);
  });
});
