import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, readdir, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { EventSensitivity } from "@ownloop/event-model";

import { type OwnLoopPersistence, PersistenceError } from "../persistence/index.js";

const DIGEST_HEX = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/;
const MAX_GC_BATCH = 100;
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const SENSITIVITIES = new Set<EventSensitivity>(["public", "normal", "sensitive", "secret"]);

export type ArtifactStoreErrorCode =
  | "artifact_integrity_failed"
  | "artifact_io_failed"
  | "artifact_metadata_conflict"
  | "artifact_persistence_failed"
  | "artifact_too_large"
  | "artifact_unsupported"
  | "invalid_artifact_input"
  | "invalid_artifact_root";

export class ArtifactStoreError extends Error {
  readonly code: ArtifactStoreErrorCode;

  constructor(code: ArtifactStoreErrorCode) {
    super("The local artifact operation failed safely.");
    this.name = "ArtifactStoreError";
    this.code = code;
  }
}

export type PreparedArtifactWrite = Readonly<{
  kind: string;
  mediaType: string;
  sensitivity: EventSensitivity;
  runReference?: Readonly<{
    runId: string;
    role: string;
  }>;
}>;

export type StoredArtifactResult = Readonly<{
  artifactId: string;
  digest: string;
  sizeBytes: number;
  kind: string;
  mediaType: string;
  sensitivity: EventSensitivity;
  deduplicated: boolean;
  linkedToRun: boolean;
}>;

export type RunStoredArtifact = Readonly<{
  artifactId: string;
  digest: string;
  sizeBytes: number;
  kind: string;
  mediaType: string;
  sensitivity: EventSensitivity;
  role: string;
  createdAt: string;
}>;

export type ArtifactGarbageCollectionResult = Readonly<{
  metadataDeleted: number;
  objectsDeleted: number;
  objectsAlreadyMissing: number;
  objectDeletionFailures: number;
}>;

export type ArtifactOrphanSweepResult = Readonly<{
  scanned: number;
  deleted: number;
  retained: number;
  ignored: number;
}>;

export type ArtifactStoreDependencies = Readonly<{
  rootPath: string;
  persistence: OwnLoopPersistence;
  analyzedRepositoryRoots?: readonly string[];
  clock?: () => Date;
  artifactIdGenerator?: () => string;
  maxArtifactBytes?: number;
}>;

function pathForDigestHex(hex: string): string {
  if (!DIGEST_HEX.test(hex)) throw new ArtifactStoreError("invalid_artifact_input");
  return `objects/sha256/${hex.slice(0, 2)}/${hex.slice(2)}`;
}

function digestFromHex(hex: string): string {
  return `sha256:${hex}`;
}

function hexFromDigest(digest: string): string {
  if (!digest.startsWith("sha256:")) throw new ArtifactStoreError("artifact_unsupported");
  const hex = digest.slice(7);
  if (!DIGEST_HEX.test(hex)) throw new ArtifactStoreError("artifact_integrity_failed");
  return hex;
}

function safeLabel(value: string): string {
  if (!SAFE_LABEL.test(value)) throw new ArtifactStoreError("invalid_artifact_input");
  return value;
}

function safeId(value: string): string {
  if (!SAFE_ID.test(value)) throw new ArtifactStoreError("invalid_artifact_input");
  return value;
}

function safeSensitivity(value: EventSensitivity): EventSensitivity {
  if (!SENSITIVITIES.has(value)) throw new ArtifactStoreError("invalid_artifact_input");
  return value;
}

function canonicalTimestamp(clock: () => Date): string {
  const value = clock();
  if (!Number.isFinite(value.getTime())) throw new ArtifactStoreError("invalid_artifact_input");
  return value.toISOString();
}

function containsPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function absoluteObjectPath(root: string, storagePath: string): string {
  if (isAbsolute(storagePath) || storagePath.includes("\\")) {
    throw new ArtifactStoreError("artifact_integrity_failed");
  }
  const absolute = resolve(root, ...storagePath.split("/"));
  if (!containsPath(root, absolute)) throw new ArtifactStoreError("artifact_integrity_failed");
  return absolute;
}

async function ensureControlledDirectory(root: string, directory: string): Promise<string> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ArtifactStoreError("artifact_integrity_failed");
  }
  const canonical = await realpath(directory);
  if (!containsPath(root, canonical)) {
    throw new ArtifactStoreError("artifact_integrity_failed");
  }
  await chmod(canonical, 0o700).catch(() => undefined);
  return canonical;
}

async function verifiedObjectPath(root: string, storagePath: string): Promise<string> {
  const lexical = absoluteObjectPath(root, storagePath);
  const parent = await ensureControlledDirectory(root, resolve(lexical, ".."));
  return join(parent, storagePath.split("/").at(-1) ?? "");
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function verifyObject(
  absolutePath: string,
  expectedSize: number,
  expectedHex: string,
): Promise<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const stats = await lstat(absolutePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== expectedSize) {
      throw new ArtifactStoreError("artifact_integrity_failed");
    }
    handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== expectedSize) {
      throw new ArtifactStoreError("artifact_integrity_failed");
    }
    const output = Buffer.alloc(expectedSize);
    const hash = createHash("sha256");
    let offset = 0;
    while (offset < expectedSize) {
      const length = Math.min(READ_CHUNK_BYTES, expectedSize - offset);
      const { bytesRead } = await handle.read(output, offset, length, offset);
      if (bytesRead === 0) throw new ArtifactStoreError("artifact_integrity_failed");
      hash.update(output.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, offset);
    if (extraBytes !== 0 || hash.digest("hex") !== expectedHex) {
      throw new ArtifactStoreError("artifact_integrity_failed");
    }
    return output;
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError("artifact_io_failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function* oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

export class LocalArtifactStore {
  readonly #root: string;
  readonly #persistence: OwnLoopPersistence;
  readonly #clock: () => Date;
  readonly #artifactIdGenerator: () => string;
  readonly #maxArtifactBytes: number;
  #mutationTail: Promise<void> = Promise.resolve();

  private constructor(root: string, dependencies: ArtifactStoreDependencies) {
    this.#root = root;
    this.#persistence = dependencies.persistence;
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#artifactIdGenerator = dependencies.artifactIdGenerator ?? randomUUID;
    this.#maxArtifactBytes = dependencies.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  }

  async #withMutationLock<Result>(operation: () => Promise<Result>): Promise<Result> {
    const previous = this.#mutationTail;
    let release: (() => void) | undefined;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  static async open(dependencies: ArtifactStoreDependencies): Promise<LocalArtifactStore> {
    if (!Number.isInteger(dependencies.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES)) {
      throw new ArtifactStoreError("invalid_artifact_input");
    }
    if ((dependencies.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES) < 1) {
      throw new ArtifactStoreError("invalid_artifact_input");
    }
    try {
      const requestedRoot = resolve(dependencies.rootPath);
      const analyzedRoots = await Promise.all(
        (dependencies.analyzedRepositoryRoots ?? []).map((candidate) => realpath(candidate)),
      );
      for (const repositoryRoot of analyzedRoots) {
        if (
          containsPath(requestedRoot, repositoryRoot) ||
          containsPath(repositoryRoot, requestedRoot)
        ) {
          throw new ArtifactStoreError("invalid_artifact_root");
        }
      }
      await mkdir(requestedRoot, { mode: 0o700, recursive: true });
      const root = await realpath(requestedRoot);
      await chmod(root, 0o700).catch(() => undefined);
      for (const repositoryRoot of analyzedRoots) {
        if (containsPath(root, repositoryRoot) || containsPath(repositoryRoot, root)) {
          throw new ArtifactStoreError("invalid_artifact_root");
        }
      }
      await ensureControlledDirectory(root, join(root, ".tmp"));
      await ensureControlledDirectory(root, join(root, "objects"));
      await ensureControlledDirectory(root, join(root, "objects", "sha256"));
      return new LocalArtifactStore(root, dependencies);
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError("invalid_artifact_root");
    }
  }

  putPreparedBytes(
    preparedBytes: Uint8Array,
    input: PreparedArtifactWrite,
  ): Promise<StoredArtifactResult> {
    return this.putPreparedStream(oneChunk(preparedBytes), input);
  }

  putPreparedStream(
    preparedContent: AsyncIterable<Uint8Array>,
    input: PreparedArtifactWrite,
  ): Promise<StoredArtifactResult> {
    return this.#withMutationLock(() => this.#putPreparedStreamUnlocked(preparedContent, input));
  }

  async #putPreparedStreamUnlocked(
    preparedContent: AsyncIterable<Uint8Array>,
    input: PreparedArtifactWrite,
  ): Promise<StoredArtifactResult> {
    const kind = safeLabel(input.kind);
    const mediaType = safeLabel(input.mediaType);
    const sensitivity = safeSensitivity(input.sensitivity);
    const runReference = input.runReference
      ? { runId: safeId(input.runReference.runId), role: safeLabel(input.runReference.role) }
      : null;
    const createdAt = canonicalTimestamp(this.#clock);
    const tempName = `${safeId(this.#artifactIdGenerator())}.tmp`;
    const tempDirectory = await ensureControlledDirectory(this.#root, join(this.#root, ".tmp"));
    const tempPath = join(tempDirectory, tempName);
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    let sizeBytes = 0;
    const hash = createHash("sha256");
    try {
      handle = await open(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      for await (const value of preparedContent) {
        if (!(value instanceof Uint8Array)) throw new ArtifactStoreError("invalid_artifact_input");
        sizeBytes += value.byteLength;
        if (sizeBytes > this.#maxArtifactBytes) throw new ArtifactStoreError("artifact_too_large");
        hash.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
          if (bytesWritten < 1) throw new ArtifactStoreError("artifact_io_failed");
          offset += bytesWritten;
        }
      }
      await handle.sync();
      await handle.close();
      handle = null;
      const hex = hash.digest("hex");
      const digest = digestFromHex(hex);
      const storagePath = pathForDigestHex(hex);
      await ensureControlledDirectory(this.#root, join(this.#root, "objects"));
      await ensureControlledDirectory(this.#root, join(this.#root, "objects", "sha256"));
      await ensureControlledDirectory(
        this.#root,
        join(this.#root, "objects", "sha256", hex.slice(0, 2)),
      );
      const finalPath = await verifiedObjectPath(this.#root, storagePath);
      let deduplicated = false;
      try {
        await link(tempPath, finalPath);
        await chmod(finalPath, 0o600).catch(() => undefined);
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          deduplicated = true;
        } else {
          throw error;
        }
      }
      await removeIfPresent(tempPath);
      await verifyObject(finalPath, sizeBytes, hex);

      try {
        return this.#persistence.withTransaction((persistence) => {
          let metadata = persistence.artifacts.getByDigest(digest);
          if (metadata === null) {
            const artifactId = safeId(this.#artifactIdGenerator());
            metadata = {
              artifactId,
              digest,
              storagePath,
              sizeBytes,
              kind,
              sensitivity,
              createdAt,
              storageVersion: 1,
              mediaType,
            };
            persistence.artifacts.insertMetadata(metadata);
          } else {
            persistence.artifacts.assertCompatibleContentAddressed(metadata, {
              digest,
              storagePath,
              sizeBytes,
              kind,
              mediaType,
            });
            if (!persistence.artifacts.escalateSensitivity(metadata.artifactId, sensitivity)) {
              throw new PersistenceError(
                "invalid_persisted_row",
                "Artifact sensitivity could not be escalated.",
              );
            }
            metadata = persistence.artifacts.getMetadata(metadata.artifactId);
            if (metadata === null) {
              throw new PersistenceError("invalid_persisted_row", "Artifact metadata disappeared.");
            }
            deduplicated = true;
          }
          const linkedToRun = runReference
            ? persistence.artifacts.linkToRun({
                ...runReference,
                artifactId: metadata.artifactId,
                createdAt,
              })
            : false;
          return {
            artifactId: metadata.artifactId,
            digest: metadata.digest,
            sizeBytes: metadata.sizeBytes,
            kind: metadata.kind,
            mediaType: metadata.mediaType ?? mediaType,
            sensitivity: metadata.sensitivity,
            deduplicated,
            linkedToRun,
          };
        });
      } catch (error) {
        if (error instanceof PersistenceError && error.code === "invalid_persisted_row") {
          throw new ArtifactStoreError("artifact_metadata_conflict");
        }
        throw new ArtifactStoreError("artifact_persistence_failed");
      }
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError("artifact_io_failed");
    } finally {
      await handle?.close().catch(() => undefined);
      await removeIfPresent(tempPath).catch(() => undefined);
    }
  }

  async readPreparedBytes(artifactId: string): Promise<Uint8Array> {
    const safeArtifactId = safeId(artifactId);
    const metadata = this.#persistence.artifacts.getMetadata(safeArtifactId);
    if (metadata === null) throw new ArtifactStoreError("artifact_unsupported");
    if (metadata.storageVersion !== 1 || metadata.mediaType === null) {
      throw new ArtifactStoreError("artifact_unsupported");
    }
    if (metadata.sizeBytes > this.#maxArtifactBytes) {
      throw new ArtifactStoreError("artifact_integrity_failed");
    }
    const hex = hexFromDigest(metadata.digest);
    if (metadata.storagePath !== pathForDigestHex(hex)) {
      throw new ArtifactStoreError("artifact_integrity_failed");
    }
    return verifyObject(
      await verifiedObjectPath(this.#root, metadata.storagePath),
      metadata.sizeBytes,
      hex,
    );
  }

  async linkExistingToRun(artifactId: string, runId: string, role: string): Promise<boolean> {
    const createdAt = canonicalTimestamp(this.#clock);
    const safeArtifactId = safeId(artifactId);
    await this.readPreparedBytes(safeArtifactId);
    try {
      return this.#persistence.withTransaction((persistence) => {
        const metadata = persistence.artifacts.getMetadata(safeArtifactId);
        if (metadata === null || metadata.storageVersion !== 1) {
          throw new ArtifactStoreError("artifact_unsupported");
        }
        return persistence.artifacts.linkToRun({
          runId: safeId(runId),
          artifactId: metadata.artifactId,
          role: safeLabel(role),
          createdAt,
        });
      });
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError("artifact_persistence_failed");
    }
  }

  unlinkFromRun(artifactId: string, runId: string, role: string): boolean {
    try {
      return this.#persistence.withTransaction((persistence) =>
        persistence.artifacts.unlinkFromRun(safeId(runId), safeId(artifactId), safeLabel(role)),
      );
    } catch {
      throw new ArtifactStoreError("artifact_persistence_failed");
    }
  }

  listArtifactsForRun(runId: string): readonly RunStoredArtifact[] {
    try {
      const references = this.#persistence.artifacts.listForRun(safeId(runId));
      return references.map((reference) => {
        const metadata = this.#persistence.artifacts.getMetadata(reference.artifactId);
        if (metadata === null || metadata.storageVersion !== 1 || metadata.mediaType === null) {
          throw new ArtifactStoreError("artifact_unsupported");
        }
        return {
          artifactId: metadata.artifactId,
          digest: metadata.digest,
          sizeBytes: metadata.sizeBytes,
          kind: metadata.kind,
          mediaType: metadata.mediaType,
          sensitivity: metadata.sensitivity,
          role: reference.role,
          createdAt: reference.createdAt,
        };
      });
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      throw new ArtifactStoreError("artifact_persistence_failed");
    }
  }

  garbageCollectUnreferenced(limit = 100): Promise<ArtifactGarbageCollectionResult> {
    return this.#withMutationLock(() => this.#garbageCollectUnreferencedUnlocked(limit));
  }

  async #garbageCollectUnreferencedUnlocked(
    limit: number,
  ): Promise<ArtifactGarbageCollectionResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GC_BATCH) {
      return {
        metadataDeleted: 0,
        objectsDeleted: 0,
        objectsAlreadyMissing: 0,
        objectDeletionFailures: 0,
      };
    }
    const candidates = this.#persistence.artifacts.listUnreferenced(limit);
    let metadataDeleted = 0;
    let objectsDeleted = 0;
    let objectsAlreadyMissing = 0;
    let objectDeletionFailures = 0;
    for (const candidate of candidates) {
      if (candidate.storageVersion !== 1) continue;
      const deleted = this.#persistence.withTransaction((persistence) =>
        persistence.artifacts.deleteMetadataIfUnreferenced(candidate.artifactId),
      );
      if (deleted === null) continue;
      metadataDeleted += 1;
      try {
        await unlink(await verifiedObjectPath(this.#root, deleted.storagePath));
        objectsDeleted += 1;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          objectsAlreadyMissing += 1;
        } else {
          objectDeletionFailures += 1;
        }
      }
    }
    return { metadataDeleted, objectsDeleted, objectsAlreadyMissing, objectDeletionFailures };
  }

  sweepOrphanObjects(limit = 100): Promise<ArtifactOrphanSweepResult> {
    return this.#withMutationLock(() => this.#sweepOrphanObjectsUnlocked(limit));
  }

  async #sweepOrphanObjectsUnlocked(limit: number): Promise<ArtifactOrphanSweepResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_GC_BATCH) {
      return { scanned: 0, deleted: 0, retained: 0, ignored: 0 };
    }
    let scanned = 0;
    let deleted = 0;
    let retained = 0;
    let ignored = 0;
    const objectRoot = await ensureControlledDirectory(
      this.#root,
      join(this.#root, "objects", "sha256"),
    );
    const prefixes = await readdir(objectRoot, { withFileTypes: true }).catch(() => []);
    for (const prefix of prefixes.sort((a, b) => a.name.localeCompare(b.name))) {
      if (scanned >= limit) break;
      if (!prefix.isDirectory() || !/^[0-9a-f]{2}$/.test(prefix.name)) {
        ignored += 1;
        continue;
      }
      const prefixPath = join(objectRoot, prefix.name);
      const objects = await readdir(prefixPath, { withFileTypes: true }).catch(() => []);
      for (const object of objects.sort((a, b) => a.name.localeCompare(b.name))) {
        if (scanned >= limit) break;
        if (!object.isFile() || !/^[0-9a-f]{62}$/.test(object.name)) {
          ignored += 1;
          continue;
        }
        scanned += 1;
        const digest = digestFromHex(`${prefix.name}${object.name}`);
        if (this.#persistence.artifacts.getByDigest(digest) !== null) {
          retained += 1;
          continue;
        }
        try {
          await unlink(join(prefixPath, object.name));
          deleted += 1;
        } catch {
          ignored += 1;
        }
      }
    }
    return { scanned, deleted, retained, ignored };
  }
}
