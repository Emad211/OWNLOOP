import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type AgentConversation,
  type ArtifactMetadata,
  type OwnLoopPersistence,
  openPersistence,
  PersistenceConstraintError,
  type TaskRun,
  type Workspace,
} from "../persistence/index.js";
import {
  ARTIFACT_DIRECTORY_MODE,
  ARTIFACT_FILE_MODE,
  ArtifactStoreError,
  createLocalArtifactStore,
  MAX_ARTIFACT_GC_BATCH,
  type PreparedArtifactDescriptor,
} from "./index.js";

const TIMESTAMP = "2026-07-22T00:00:00.000Z";
const CONTENT = new TextEncoder().encode("prepared evidence\n");
const OTHER_CONTENT = new TextEncoder().encode("different prepared evidence\n");
const DESCRIPTOR: PreparedArtifactDescriptor = {
  kind: "prepared-evidence",
  mediaType: "application/octet-stream",
  sensitivity: "normal",
};

const temporaryDirectories: string[] = [];
const openPersistenceHandles: OwnLoopPersistence[] = [];

type TestEnvironment = Readonly<{
  root: string;
  artifactRoot: string;
  repositoryRoot: string;
  databasePath: string;
}>;

function environment(): TestEnvironment {
  const root = mkdtempSync(join(tmpdir(), "ownloop-artifact-store-"));
  temporaryDirectories.push(root);
  const artifactRoot = join(root, "artifact-root");
  const repositoryRoot = join(root, "repository");
  mkdirSync(repositoryRoot, { recursive: true });
  return {
    root,
    artifactRoot,
    repositoryRoot,
    databasePath: join(root, "ownloop.sqlite"),
  };
}

function workspace(repositoryRoot: string): Workspace {
  return {
    workspaceId: "workspace-1",
    canonicalPath: repositoryRoot,
    repositoryRoot,
    gitRemote: null,
    initialRepositoryFingerprint: "workspace-fingerprint-1",
    identityBasis: "legacy",
    createdAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
  };
}

function conversation(): AgentConversation {
  return {
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    source: "claude_code",
    sourceSessionId: "source-session-1",
    startMode: "startup",
    startedAt: TIMESTAMP,
    lastObservedAt: TIMESTAMP,
    endedAt: null,
    status: "Active",
  };
}

function taskRun(runId: string, runNumber: number): TaskRun {
  return {
    runId,
    conversationId: "conversation-1",
    runNumber,
    redactedPrompt: "Store prepared evidence.",
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

function openSeededPersistence(env: TestEnvironment, secondRun = false): OwnLoopPersistence {
  const persistence = openPersistence(env.databasePath);
  openPersistenceHandles.push(persistence);
  persistence.workspaces.insert(workspace(env.repositoryRoot));
  persistence.conversations.insert(conversation());
  persistence.taskRuns.insert(taskRun("run-1", 1));
  if (secondRun) {
    persistence.taskRuns.insert(taskRun("run-2", 2));
  }
  return persistence;
}

function digestHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(bytes: Uint8Array): string {
  return `sha256:${digestHex(bytes)}`;
}

function storagePath(bytes: Uint8Array): string {
  const hex = digestHex(bytes);
  return `objects/sha256/${hex.slice(0, 2)}/${hex.slice(2)}`;
}

function objectPath(artifactRoot: string, bytes: Uint8Array): string {
  const hex = digestHex(bytes);
  return join(artifactRoot, "objects", "sha256", hex.slice(0, 2), hex.slice(2));
}

function sequentialIds(...ids: string[]): () => string {
  let index = 0;
  return () => {
    const value = ids[index];
    index += 1;
    if (value === undefined) {
      throw new Error("No deterministic artifact ID remains.");
    }
    return value;
  };
}

async function store(
  env: TestEnvironment,
  persistence: OwnLoopPersistence,
  options: Readonly<{
    maximumArtifactSizeBytes?: number;
    artifactIdGenerator?: () => string;
  }> = {},
) {
  return createLocalArtifactStore({
    artifactRoot: env.artifactRoot,
    analyzedRepositoryRoots: [env.repositoryRoot],
    persistence,
    clock: () => new Date(TIMESTAMP),
    artifactIdGenerator: options.artifactIdGenerator ?? (() => "artifact-1"),
    ...(options.maximumArtifactSizeBytes === undefined
      ? {}
      : { maximumArtifactSizeBytes: options.maximumArtifactSizeBytes }),
  });
}

function expectSafeError(
  error: unknown,
  env: TestEnvironment,
  secret = "private prepared value",
): void {
  expect(error).toBeInstanceOf(ArtifactStoreError);
  const serialized = JSON.stringify({
    name: error instanceof Error ? error.name : null,
    message: error instanceof Error ? error.message : null,
    code: error instanceof ArtifactStoreError ? error.code : null,
  });
  expect(serialized).not.toContain(env.artifactRoot);
  expect(serialized).not.toContain(env.repositoryRoot);
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain("stack");
  if (error instanceof ArtifactStoreError) {
    expect(error.stack).toBeUndefined();
  }
}

afterEach(() => {
  while (openPersistenceHandles.length > 0) {
    openPersistenceHandles.pop()?.close();
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("local content-addressed artifact store", () => {
  it("puts and verifies prepared bytes using the deterministic digest path", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    const result = await artifactStore.putPreparedBytes({
      ...DESCRIPTOR,
      preparedBytes: CONTENT,
    });
    const read = await artifactStore.readPreparedBytes(result.artifactId);
    const metadata = persistence.artifacts.getMetadata(result.artifactId);

    expect(result).toMatchObject({
      artifactId: "artifact-1",
      digest: digest(CONTENT),
      sizeBytes: CONTENT.byteLength,
      created: true,
      referenceCreated: false,
    });
    expect(read.bytes).toEqual(CONTENT);
    expect(metadata).toMatchObject({
      storageVersion: 1,
      storagePath: storagePath(CONTENT),
      mediaType: DESCRIPTOR.mediaType,
    });
    expect(metadata?.storagePath).not.toContain(env.artifactRoot);
    expect(readFileSync(objectPath(env.artifactRoot, CONTENT))).toEqual(Buffer.from(CONTENT));

    if (process.platform !== "win32") {
      expect(statSync(objectPath(env.artifactRoot, CONTENT)).mode & 0o777).toBe(ARTIFACT_FILE_MODE);
      expect(statSync(join(env.artifactRoot, "objects", "sha256")).mode & 0o777).toBe(
        ARTIFACT_DIRECTORY_MODE,
      );
    }
  });

  it("streams chunks and removes temporary files after success", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    const result = await artifactStore.putPreparedStream({
      ...DESCRIPTOR,
      preparedStream: [CONTENT.subarray(0, 4), CONTENT.subarray(4)],
    });

    expect(result.digest).toBe(digest(CONTENT));
    expect(readdirSync(join(env.artifactRoot, "tmp"))).toEqual([]);
  });

  it("enforces the size limit and removes failed temporary files", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence, { maximumArtifactSizeBytes: 4 });

    await expect(
      artifactStore.putPreparedStream({
        ...DESCRIPTOR,
        preparedStream: [CONTENT.subarray(0, 3), CONTENT.subarray(3)],
      }),
    ).rejects.toMatchObject({ code: "size_limit_exceeded" });
    expect(readdirSync(join(env.artifactRoot, "tmp"))).toEqual([]);
    expect(persistence.artifacts.getMetadataByDigest(digest(CONTENT))).toBeNull();
  });

  it("rejects non-byte stream chunks without persisting metadata", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    await expect(
      artifactStore.putPreparedStream({
        ...DESCRIPTOR,
        preparedStream: ["not bytes"] as unknown as Iterable<Uint8Array>,
      }),
    ).rejects.toMatchObject({ code: "invalid_prepared_content" });
    expect(readdirSync(join(env.artifactRoot, "tmp"))).toEqual([]);
  });

  it("deduplicates concurrent identical prepared writes", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence, {
      artifactIdGenerator: sequentialIds("artifact-1", "artifact-2"),
    });

    const [first, second] = await Promise.all([
      artifactStore.putPreparedBytes({ ...DESCRIPTOR, preparedBytes: CONTENT }),
      artifactStore.putPreparedBytes({ ...DESCRIPTOR, preparedBytes: CONTENT }),
    ]);

    expect(first.artifactId).toBe(second.artifactId);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    expect(persistence.artifacts.getMetadataByDigest(digest(CONTENT))?.artifactId).toBe(
      first.artifactId,
    );
    expect(readFileSync(objectPath(env.artifactRoot, CONTENT))).toEqual(Buffer.from(CONTENT));
  });

  it("escalates sensitivity and never downgrades it", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    await artifactStore.putPreparedBytes({
      ...DESCRIPTOR,
      sensitivity: "public",
      preparedBytes: CONTENT,
    });
    const escalated = await artifactStore.putPreparedBytes({
      ...DESCRIPTOR,
      sensitivity: "secret",
      preparedBytes: CONTENT,
    });
    const attemptedDowngrade = await artifactStore.putPreparedBytes({
      ...DESCRIPTOR,
      sensitivity: "normal",
      preparedBytes: CONTENT,
    });

    expect(escalated.sensitivity).toBe("secret");
    expect(attemptedDowngrade.sensitivity).toBe("secret");
    expect(() => persistence.artifacts.updateSensitivity("artifact-1", "public")).toThrowError(
      PersistenceConstraintError,
    );
  });

  it.each([
    { kind: "different-kind", mediaType: DESCRIPTOR.mediaType },
    { kind: DESCRIPTOR.kind, mediaType: "text/plain" },
  ])("rejects conflicting persisted metadata for the same digest", async (conflict) => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    mkdirSync(join(env.artifactRoot, "objects", "sha256", digestHex(CONTENT).slice(0, 2)), {
      recursive: true,
    });
    writeFileSync(objectPath(env.artifactRoot, CONTENT), CONTENT, { mode: 0o600 });
    persistence.artifacts.insertMetadata({
      artifactId: "artifact-conflict",
      digest: digest(CONTENT),
      storagePath: storagePath(CONTENT),
      sizeBytes: CONTENT.byteLength,
      kind: conflict.kind,
      sensitivity: "normal",
      storageVersion: 1,
      mediaType: conflict.mediaType,
      createdAt: TIMESTAMP,
    });
    const artifactStore = await store(env, persistence);

    await expect(
      artifactStore.putPreparedBytes({ ...DESCRIPTOR, preparedBytes: CONTENT }),
    ).rejects.toMatchObject({ code: "artifact_metadata_conflict" });
  });

  it.each(["artifact-inside-repository", "repository-inside-artifact", "equal-roots"] as const)(
    "rejects overlapping roots before creating managed directories: %s",
    async (arrangement) => {
      const env = environment();
      const persistence = openSeededPersistence(env);
      const artifactRoot =
        arrangement === "artifact-inside-repository"
          ? join(env.repositoryRoot, "ownloop-artifacts")
          : arrangement === "equal-roots"
            ? env.repositoryRoot
            : env.artifactRoot;
      const repositoryRoot =
        arrangement === "artifact-inside-repository" || arrangement === "equal-roots"
          ? env.repositoryRoot
          : join(env.artifactRoot, "repository");
      mkdirSync(repositoryRoot, { recursive: true });
      const artifactRootExistedBefore = existsSync(artifactRoot);

      let caught: unknown;
      try {
        await createLocalArtifactStore({
          artifactRoot,
          analyzedRepositoryRoots: [repositoryRoot],
          persistence,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: "invalid_configuration" });
      expectSafeError(caught, { ...env, artifactRoot, repositoryRoot });
      if (!artifactRootExistedBefore) {
        expect(existsSync(artifactRoot)).toBe(false);
      }
    },
  );

  it.each(["digest", "symlink"] as const)(
    "rejects %s corruption without returning bytes",
    async (kind) => {
      const env = environment();
      const persistence = openSeededPersistence(env);
      const artifactStore = await store(env, persistence);
      const result = await artifactStore.putPreparedBytes({
        ...DESCRIPTOR,
        preparedBytes: CONTENT,
      });
      const path = objectPath(env.artifactRoot, CONTENT);

      if (kind === "digest") {
        writeFileSync(path, OTHER_CONTENT);
      } else {
        unlinkSync(path);
        const target = join(env.root, "outside-content");
        writeFileSync(target, CONTENT);
        symlinkSync(target, path);
      }

      await expect(artifactStore.readPreparedBytes(result.artifactId)).rejects.toMatchObject({
        code: "artifact_content_corrupt",
      });
    },
  );

  it("rejects an existing digest object with the wrong content", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const path = objectPath(env.artifactRoot, CONTENT);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, OTHER_CONTENT);
    const artifactStore = await store(env, persistence);

    await expect(
      artifactStore.putPreparedBytes({ ...DESCRIPTOR, preparedBytes: CONTENT }),
    ).rejects.toMatchObject({ code: "artifact_content_corrupt" });
    expect(persistence.artifacts.getMetadataByDigest(digest(CONTENT))).toBeNull();
  });

  it("inserts metadata and a Run reference transactionally and idempotently", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    const first = await artifactStore.putPreparedArtifactForRun({
      ...DESCRIPTOR,
      preparedContent: [CONTENT],
      runId: "run-1",
      role: "final-diff",
    });
    const second = await artifactStore.putPreparedArtifactForRun({
      ...DESCRIPTOR,
      preparedContent: [CONTENT],
      runId: "run-1",
      role: "final-diff",
    });

    expect(first.referenceCreated).toBe(true);
    expect(second.referenceCreated).toBe(false);
    expect(artifactStore.listArtifactsForRun("run-1")).toHaveLength(1);
  });

  it("rolls back metadata when Run reference insertion fails", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    await expect(
      artifactStore.putPreparedArtifactForRun({
        ...DESCRIPTOR,
        preparedContent: [CONTENT],
        runId: "missing-run",
        role: "final-diff",
      }),
    ).rejects.toMatchObject({ code: "artifact_reference_failed" });
    expect(persistence.artifacts.getMetadataByDigest(digest(CONTENT))).toBeNull();
    expect(readFileSync(objectPath(env.artifactRoot, CONTENT))).toEqual(Buffer.from(CONTENT));
  });

  it("links shared content to multiple Runs and preserves it after one Run is deleted", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env, true);
    const artifactStore = await store(env, persistence);
    const result = await artifactStore.putPreparedArtifactForRun({
      ...DESCRIPTOR,
      preparedContent: [CONTENT],
      runId: "run-1",
      role: "final-diff",
    });

    expect(
      artifactStore.linkArtifactToRun({
        artifactId: result.artifactId,
        runId: "run-2",
        role: "final-diff",
      }),
    ).toBe(true);
    persistence.taskRuns.delete("run-1");

    expect(persistence.artifacts.getMetadata(result.artifactId)).not.toBeNull();
    expect(artifactStore.listArtifactsForRun("run-2")).toHaveLength(1);
    expect((await artifactStore.readPreparedBytes(result.artifactId)).bytes).toEqual(CONTENT);
  });

  it("unlinks the final reference and garbage-collects metadata and content", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);
    const result = await artifactStore.putPreparedArtifactForRun({
      ...DESCRIPTOR,
      preparedContent: [CONTENT],
      runId: "run-1",
      role: "final-diff",
    });

    expect(
      artifactStore.unlinkArtifactFromRun({
        artifactId: result.artifactId,
        runId: "run-1",
        role: "final-diff",
      }),
    ).toBe(true);
    const collected = await artifactStore.collectUnreferencedArtifacts();

    expect(collected).toEqual({
      candidates: 1,
      metadataDeleted: 1,
      objectsDeleted: 1,
      objectsMissing: 0,
      skippedReferenced: 0,
    });
    expect(persistence.artifacts.getMetadata(result.artifactId)).toBeNull();
    expect(() => lstatSync(objectPath(env.artifactRoot, CONTENT))).toThrow();
  });

  it("never selects referenced artifacts for garbage collection", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);
    const result = await artifactStore.putPreparedArtifactForRun({
      ...DESCRIPTOR,
      preparedContent: [CONTENT],
      runId: "run-1",
      role: "final-diff",
    });

    expect(await artifactStore.collectUnreferencedArtifacts()).toMatchObject({ candidates: 0 });
    expect(persistence.artifacts.getMetadata(result.artifactId)).not.toBeNull();
    expect(readFileSync(objectPath(env.artifactRoot, CONTENT))).toEqual(Buffer.from(CONTENT));
  });

  it("handles a missing unreferenced object during garbage collection", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);
    const result = await artifactStore.putPreparedBytes({ ...DESCRIPTOR, preparedBytes: CONTENT });
    unlinkSync(objectPath(env.artifactRoot, CONTENT));

    expect(await artifactStore.collectUnreferencedArtifacts()).toEqual({
      candidates: 1,
      metadataDeleted: 1,
      objectsDeleted: 0,
      objectsMissing: 1,
      skippedReferenced: 0,
    });
    expect(persistence.artifacts.getMetadata(result.artifactId)).toBeNull();
  });

  it("restricts orphan sweeping to valid regular digest objects", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);
    const orphanHex = digestHex(OTHER_CONTENT);
    const orphanDirectory = join(env.artifactRoot, "objects", "sha256", orphanHex.slice(0, 2));
    const orphanPath = join(orphanDirectory, orphanHex.slice(2));
    mkdirSync(orphanDirectory, { recursive: true });
    writeFileSync(orphanPath, OTHER_CONTENT);
    writeFileSync(join(orphanDirectory, "not-a-digest"), OTHER_CONTENT);
    const outside = join(env.root, "outside-orphan");
    writeFileSync(outside, OTHER_CONTENT);
    symlinkSync(outside, join(orphanDirectory, "a".repeat(62)));

    const swept = await artifactStore.sweepOrphanObjects();

    expect(swept.objectsDeleted).toBe(1);
    expect(() => lstatSync(orphanPath)).toThrow();
    expect(readFileSync(join(orphanDirectory, "not-a-digest"))).toEqual(Buffer.from(OTHER_CONTENT));
    expect(lstatSync(join(orphanDirectory, "a".repeat(62))).isSymbolicLink()).toBe(true);
    expect(readFileSync(outside)).toEqual(Buffer.from(OTHER_CONTENT));
  });

  it("preserves verified content and references across SQLite close and reopen", async () => {
    const env = environment();
    let persistence = openSeededPersistence(env);
    let artifactStore = await store(env, persistence);
    const result = await artifactStore.putPreparedArtifactForRun({
      ...DESCRIPTOR,
      preparedContent: [CONTENT],
      runId: "run-1",
      role: "final-diff",
    });
    persistence.close();
    openPersistenceHandles.splice(openPersistenceHandles.indexOf(persistence), 1);

    persistence = openPersistence(env.databasePath);
    openPersistenceHandles.push(persistence);
    artifactStore = await store(env, persistence, { artifactIdGenerator: () => "unused" });

    expect((await artifactStore.readPreparedBytes(result.artifactId)).bytes).toEqual(CONTENT);
    expect(artifactStore.listArtifactsForRun("run-1")).toHaveLength(1);
  });

  it("rejects legacy metadata at the file-store boundary", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const legacy: ArtifactMetadata = {
      artifactId: "legacy-artifact",
      digest: "sha256:legacy",
      storagePath: "legacy/path",
      sizeBytes: 1,
      kind: "legacy",
      sensitivity: "normal",
      storageVersion: 0,
      mediaType: null,
      createdAt: TIMESTAMP,
    };
    persistence.artifacts.insertMetadata(legacy);
    const artifactStore = await store(env, persistence);

    await expect(artifactStore.readPreparedBytes(legacy.artifactId)).rejects.toMatchObject({
      code: "unsupported_storage_version",
    });
  });

  it("rejects legacy metadata from file-store Run listings", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    persistence.artifacts.insertMetadata({
      artifactId: "legacy-artifact",
      digest: "sha256:legacy",
      storagePath: "legacy/path",
      sizeBytes: 1,
      kind: "legacy",
      sensitivity: "normal",
      storageVersion: 0,
      mediaType: null,
      createdAt: TIMESTAMP,
    });
    persistence.artifacts.linkToRun({
      runId: "run-1",
      artifactId: "legacy-artifact",
      role: "legacy-role",
      createdAt: TIMESTAMP,
    });
    const artifactStore = await store(env, persistence);

    expect(() => artifactStore.listArtifactsForRun("run-1")).toThrowError(
      expect.objectContaining({ code: "unsupported_storage_version" }),
    );
  });

  it("rejects unsafe generated IDs without leaking prepared content", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence, {
      artifactIdGenerator: () => "unsafe artifact id",
    });
    const secret = "private prepared value";
    let caught: unknown;

    try {
      await artifactStore.putPreparedBytes({
        ...DESCRIPTOR,
        preparedBytes: new TextEncoder().encode(secret),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: "artifact_persistence_failed" });
    expectSafeError(caught, env, secret);
  });

  it.each([
    { field: "kind", descriptor: { ...DESCRIPTOR, kind: "Unsafe Kind" } },
    { field: "media type", descriptor: { ...DESCRIPTOR, mediaType: " text/plain" } },
  ])("rejects an invalid $field", async ({ descriptor }) => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    await expect(
      artifactStore.putPreparedBytes({ ...descriptor, preparedBytes: CONTENT }),
    ).rejects.toMatchObject({ code: "invalid_prepared_content" });
  });

  it("rejects garbage-collection limits above the hard maximum", async () => {
    const env = environment();
    const persistence = openSeededPersistence(env);
    const artifactStore = await store(env, persistence);

    await expect(
      artifactStore.collectUnreferencedArtifacts(MAX_ARTIFACT_GC_BATCH + 1),
    ).rejects.toMatchObject({ code: "invalid_configuration" });
  });
});
