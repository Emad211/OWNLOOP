import { createHash, randomUUID } from "node:crypto";
import { constants, type Dirent, type Stats } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { EventSensitivity } from "@ownloop/event-model";

import {
  type ArtifactMetadata,
  type OwnLoopPersistence,
  PersistenceError,
  type RunArtifactRecord,
} from "../persistence/index.js";
import {
  ARTIFACT_DIRECTORY_MODE,
  ARTIFACT_FILE_MODE,
  ARTIFACT_STORE_DIGEST_PREFIX,
  ARTIFACT_STORE_OBJECT_DIRECTORY,
  ARTIFACT_STORE_STORAGE_VERSION,
  ARTIFACT_STORE_TEMP_DIRECTORY,
  DEFAULT_MAXIMUM_ARTIFACT_SIZE_BYTES,
  MAX_ARTIFACT_GC_BATCH,
} from "./constants.js";
import { ArtifactStoreError, isArtifactStoreError } from "./errors.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SAFE_ROLE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_PREFIX_DIRECTORY_PATTERN = /^[0-9a-f]{2}$/;
const SHA256_SUFFIX_FILE_PATTERN = /^[0-9a-f]{62}$/;
const MAXIMUM_MEDIA_TYPE_LENGTH = 255;
const READ_BUFFER_BYTES = 64 * 1024;

const SENSITIVITY_RANK: Readonly<Record<EventSensitivity, number>> = Object.freeze({
  public: 0,
  normal: 1,
  sensitive: 2,
  secret: 3,
});

export type PreparedByteStream = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

export type PreparedArtifactDescriptor = Readonly<{
  kind: string;
  mediaType: string;
  sensitivity: EventSensitivity;
}>;

export type PutPreparedArtifactResult = Readonly<{
  artifactId: string;
  digest: string;
  sizeBytes: number;
  kind: string;
  mediaType: string;
  sensitivity: EventSensitivity;
  created: boolean;
  referenceCreated: boolean;
  createdAt: string;
}>;

export type ReadPreparedArtifactResult = Readonly<{
  artifactId: string;
  digest: string;
  sizeBytes: number;
  kind: string;
  mediaType: string;
  sensitivity: EventSensitivity;
  bytes: Uint8Array;
}>;

export type ArtifactGarbageCollectionResult = Readonly<{
  candidates: number;
  metadataDeleted: number;
  objectsDeleted: number;
  objectsMissing: number;
  skippedReferenced: number;
}>;

export type ArtifactOrphanSweepResult = Readonly<{
  objectsDeleted: number;
  objectsSkipped: number;
}>;

export type LocalArtifactStoreOptions = Readonly<{
  artifactRoot: string;
  analyzedRepositoryRoots?: readonly string[];
  persistence: OwnLoopPersistence;
  maximumArtifactSizeBytes?: number;
  clock?: () => Date;
  artifactIdGenerator?: () => string;
}>;

type CanonicalStorePaths = Readonly<{
  root: string;
  objectsSha256: string;
  temporary: string;
}>;

type MaterializedPreparedContent = Readonly<{
  digest: string;
  digestHex: string;
  sizeBytes: number;
  storagePath: string;
}>;

type PersistenceResolution = Readonly<{
  metadata: ArtifactMetadata;
  created: boolean;
  referenceCreated: boolean;
}>;

type ReferenceInput = Readonly<{
  runId: string;
  role: string;
}>;

function filesystemErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

function normalizeForComparison(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function pathContains(parent: string, child: string): boolean {
  const normalizedParent = normalizeForComparison(parent);
  const normalizedChild = normalizeForComparison(child);
  const childRelative = relative(normalizedParent, normalizedChild);
  return (
    childRelative === "" ||
    (!isAbsolute(childRelative) && childRelative !== ".." && !childRelative.startsWith(`..${sep}`))
  );
}

function pathsOverlap(first: string, second: string): boolean {
  return pathContains(first, second) || pathContains(second, first);
}

function safeGeneratedId(generator: () => string): string {
  const value = generator();
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new ArtifactStoreError("artifact_persistence_failed");
  }
  return value;
}

function canonicalTimestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ArtifactStoreError("artifact_persistence_failed");
  }
  return value.toISOString();
}

function validateMaximumSize(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ArtifactStoreError("invalid_configuration");
  }
  return value;
}

function validateBatchLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_ARTIFACT_GC_BATCH) {
    throw new ArtifactStoreError("invalid_configuration");
  }
  return value;
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function validateDescriptor(descriptor: PreparedArtifactDescriptor): PreparedArtifactDescriptor {
  if (!SAFE_KIND_PATTERN.test(descriptor.kind)) {
    throw new ArtifactStoreError("invalid_prepared_content");
  }
  if (
    descriptor.mediaType.length === 0 ||
    descriptor.mediaType.length > MAXIMUM_MEDIA_TYPE_LENGTH ||
    descriptor.mediaType.trim() !== descriptor.mediaType ||
    containsAsciiControl(descriptor.mediaType)
  ) {
    throw new ArtifactStoreError("invalid_prepared_content");
  }
  if (!(descriptor.sensitivity in SENSITIVITY_RANK)) {
    throw new ArtifactStoreError("invalid_prepared_content");
  }
  return descriptor;
}

function validateReference(reference: ReferenceInput): ReferenceInput {
  if (!SAFE_ID_PATTERN.test(reference.runId) || !SAFE_ROLE_PATTERN.test(reference.role)) {
    throw new ArtifactStoreError("artifact_reference_failed");
  }
  return reference;
}

function derivedStoragePath(digestHex: string): string {
  if (!SHA256_HEX_PATTERN.test(digestHex)) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }
  return `${ARTIFACT_STORE_OBJECT_DIRECTORY}/${digestHex.slice(0, 2)}/${digestHex.slice(2)}`;
}

function digestHexFromDigest(digest: string): string {
  if (!digest.startsWith(ARTIFACT_STORE_DIGEST_PREFIX)) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }
  const digestHex = digest.slice(ARTIFACT_STORE_DIGEST_PREFIX.length);
  if (!SHA256_HEX_PATTERN.test(digestHex)) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }
  return digestHex;
}

function finalObjectPath(paths: CanonicalStorePaths, digestHex: string): string {
  return join(paths.objectsSha256, digestHex.slice(0, 2), digestHex.slice(2));
}

function assertVersionOneMetadata(metadata: ArtifactMetadata): string {
  if (metadata.storageVersion !== ARTIFACT_STORE_STORAGE_VERSION) {
    throw new ArtifactStoreError("unsupported_storage_version");
  }
  if (
    metadata.mediaType === null ||
    metadata.mediaType.length === 0 ||
    !Number.isSafeInteger(metadata.sizeBytes) ||
    metadata.sizeBytes < 0 ||
    !SAFE_KIND_PATTERN.test(metadata.kind) ||
    !(metadata.sensitivity in SENSITIVITY_RANK)
  ) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }
  const digestHex = digestHexFromDigest(metadata.digest);
  if (metadata.storagePath !== derivedStoragePath(digestHex)) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }
  return digestHex;
}

function assertMetadataIdentity(
  metadata: ArtifactMetadata,
  expected: Readonly<{
    digest: string;
    storagePath: string;
    sizeBytes: number;
    kind: string;
    mediaType: string;
  }>,
): void {
  if (
    metadata.storageVersion !== ARTIFACT_STORE_STORAGE_VERSION ||
    metadata.digest !== expected.digest ||
    metadata.storagePath !== expected.storagePath ||
    metadata.sizeBytes !== expected.sizeBytes ||
    metadata.kind !== expected.kind ||
    metadata.mediaType !== expected.mediaType
  ) {
    throw new ArtifactStoreError("artifact_metadata_conflict");
  }
}

function stricterSensitivity(
  current: EventSensitivity,
  requested: EventSensitivity,
): EventSensitivity {
  return SENSITIVITY_RANK[requested] > SENSITIVITY_RANK[current] ? requested : current;
}

async function applyPrivateMode(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch (error) {
    const code = filesystemErrorCode(error);
    if (
      process.platform === "win32" &&
      (code === "EPERM" || code === "ENOSYS" || code === "EINVAL")
    ) {
      return;
    }
    throw error;
  }
}

async function ensureCanonicalDirectory(path: string, expectedCanonical: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: ARTIFACT_DIRECTORY_MODE });
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new ArtifactStoreError("invalid_configuration");
  }
  await applyPrivateMode(path, ARTIFACT_DIRECTORY_MODE);
  const canonical = await realpath(path);
  if (normalizeForComparison(canonical) !== normalizeForComparison(expectedCanonical)) {
    throw new ArtifactStoreError("invalid_configuration");
  }
}

async function prospectiveCanonicalPath(path: string): Promise<string> {
  let current = path;
  const missingSegments: string[] = [];

  while (true) {
    try {
      const canonicalAncestor = await realpath(current);
      return resolve(canonicalAncestor, ...missingSegments);
    } catch (error) {
      if (filesystemErrorCode(error) !== "ENOENT") {
        throw new ArtifactStoreError("invalid_configuration");
      }
      const parent = dirname(current);
      if (parent === current) {
        throw new ArtifactStoreError("invalid_configuration");
      }
      missingSegments.unshift(basename(current));
      current = parent;
    }
  }
}

async function initializePaths(options: LocalArtifactStoreOptions): Promise<CanonicalStorePaths> {
  if (options.artifactRoot.trim().length === 0) {
    throw new ArtifactStoreError("invalid_configuration");
  }

  const requestedRoot = resolve(options.artifactRoot);
  const canonicalAnalyzedRoots: string[] = [];
  for (const analyzedRoot of options.analyzedRepositoryRoots ?? []) {
    if (analyzedRoot.trim().length === 0) {
      throw new ArtifactStoreError("invalid_configuration");
    }
    canonicalAnalyzedRoots.push(await realpath(resolve(analyzedRoot)));
  }

  const prospectiveRoot = await prospectiveCanonicalPath(requestedRoot);
  for (const canonicalAnalyzedRoot of canonicalAnalyzedRoots) {
    if (pathsOverlap(prospectiveRoot, canonicalAnalyzedRoot)) {
      throw new ArtifactStoreError("invalid_configuration");
    }
  }

  await mkdir(requestedRoot, { recursive: true, mode: ARTIFACT_DIRECTORY_MODE });
  const rootStatus = await lstat(requestedRoot);
  if (!rootStatus.isDirectory() || rootStatus.isSymbolicLink()) {
    throw new ArtifactStoreError("invalid_configuration");
  }
  await applyPrivateMode(requestedRoot, ARTIFACT_DIRECTORY_MODE);
  const root = await realpath(requestedRoot);

  for (const canonicalAnalyzedRoot of canonicalAnalyzedRoots) {
    if (pathsOverlap(root, canonicalAnalyzedRoot)) {
      throw new ArtifactStoreError("invalid_configuration");
    }
  }

  const objectsSha256 = resolve(root, ARTIFACT_STORE_OBJECT_DIRECTORY);
  const temporary = resolve(root, ARTIFACT_STORE_TEMP_DIRECTORY);
  if (!pathContains(root, objectsSha256) || !pathContains(root, temporary)) {
    throw new ArtifactStoreError("invalid_configuration");
  }

  await ensureCanonicalDirectory(objectsSha256, objectsSha256);
  await ensureCanonicalDirectory(temporary, temporary);

  return { root, objectsSha256, temporary };
}

async function ensureDigestDirectory(
  paths: CanonicalStorePaths,
  digestHex: string,
): Promise<string> {
  const directory = join(paths.objectsSha256, digestHex.slice(0, 2));
  if (!pathContains(paths.objectsSha256, directory)) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }
  await ensureCanonicalDirectory(directory, directory);
  return directory;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset, null);
    if (result.bytesWritten <= 0) {
      throw new ArtifactStoreError("artifact_write_failed");
    }
    offset += result.bytesWritten;
  }
}

async function readAndVerifyObject(
  paths: CanonicalStorePaths,
  metadata: ArtifactMetadata,
  maximumSizeBytes: number,
  includeBytes: boolean,
): Promise<Uint8Array | null> {
  const digestHex = assertVersionOneMetadata(metadata);
  if (metadata.sizeBytes > maximumSizeBytes) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }

  await ensureDigestDirectory(paths, digestHex);
  const objectPath = finalObjectPath(paths, digestHex);
  if (!pathContains(paths.objectsSha256, objectPath)) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }

  let initialStatus: Stats;
  try {
    initialStatus = await lstat(objectPath);
  } catch (error) {
    if (filesystemErrorCode(error) === "ENOENT") {
      throw new ArtifactStoreError("artifact_content_corrupt");
    }
    throw new ArtifactStoreError("artifact_read_failed");
  }
  if (!initialStatus.isFile() || initialStatus.isSymbolicLink()) {
    throw new ArtifactStoreError("artifact_content_corrupt");
  }

  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(objectPath, constants.O_RDONLY | noFollow);
    const status = await handle.stat();
    if (!status.isFile() || status.size !== metadata.sizeBytes) {
      throw new ArtifactStoreError("artifact_content_corrupt");
    }

    const hash = createHash("sha256");
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const buffer = Buffer.allocUnsafe(Math.min(READ_BUFFER_BYTES, Math.max(1, metadata.sizeBytes)));

    while (true) {
      const result = await handle.read(buffer, 0, buffer.byteLength, null);
      if (result.bytesRead === 0) {
        break;
      }
      const chunk = buffer.subarray(0, result.bytesRead);
      hash.update(chunk);
      totalBytes += result.bytesRead;
      if (totalBytes > maximumSizeBytes || totalBytes > metadata.sizeBytes) {
        throw new ArtifactStoreError("artifact_content_corrupt");
      }
      if (includeBytes) {
        chunks.push(Uint8Array.from(chunk));
      }
    }

    if (totalBytes !== metadata.sizeBytes || hash.digest("hex") !== digestHex) {
      throw new ArtifactStoreError("artifact_content_corrupt");
    }

    if (!includeBytes) {
      return null;
    }
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } catch (error) {
    if (isArtifactStoreError(error)) {
      throw error;
    }
    throw new ArtifactStoreError("artifact_read_failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function materializePreparedContent(
  paths: CanonicalStorePaths,
  preparedStream: PreparedByteStream,
  maximumSizeBytes: number,
): Promise<MaterializedPreparedContent> {
  let temporaryDirectory: string | null = null;
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    temporaryDirectory = await mkdtemp(join(paths.temporary, "put-"));
    await applyPrivateMode(temporaryDirectory, ARTIFACT_DIRECTORY_MODE);
    const temporaryFile = join(temporaryDirectory, "content");
    handle = await open(
      temporaryFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      ARTIFACT_FILE_MODE,
    );

    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of preparedStream) {
      if (!(chunk instanceof Uint8Array)) {
        throw new ArtifactStoreError("invalid_prepared_content");
      }
      if (chunk.byteLength === 0) {
        continue;
      }
      if (sizeBytes > maximumSizeBytes - chunk.byteLength) {
        throw new ArtifactStoreError("size_limit_exceeded");
      }
      await writeAll(handle, chunk);
      hash.update(chunk);
      sizeBytes += chunk.byteLength;
    }

    await handle.sync();
    await handle.close();
    handle = null;

    const digestHex = hash.digest("hex");
    const digest = `${ARTIFACT_STORE_DIGEST_PREFIX}${digestHex}`;
    const storagePath = derivedStoragePath(digestHex);
    await ensureDigestDirectory(paths, digestHex);
    const objectPath = finalObjectPath(paths, digestHex);

    try {
      await link(temporaryFile, objectPath);
      await applyPrivateMode(objectPath, ARTIFACT_FILE_MODE);
    } catch (error) {
      if (filesystemErrorCode(error) !== "EEXIST") {
        throw new ArtifactStoreError("artifact_write_failed");
      }
    }

    const provisionalMetadata: ArtifactMetadata = {
      artifactId: "verification",
      digest,
      storagePath,
      sizeBytes,
      kind: "verification",
      sensitivity: "normal",
      storageVersion: ARTIFACT_STORE_STORAGE_VERSION,
      mediaType: "application/octet-stream",
      createdAt: "verification",
    };
    await readAndVerifyObject(paths, provisionalMetadata, maximumSizeBytes, false);
    await applyPrivateMode(objectPath, ARTIFACT_FILE_MODE);

    return { digest, digestHex, sizeBytes, storagePath };
  } catch (error) {
    if (isArtifactStoreError(error)) {
      throw error;
    }
    throw new ArtifactStoreError("artifact_write_failed");
  } finally {
    await handle?.close().catch(() => undefined);
    if (temporaryDirectory !== null) {
      await rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined);
    }
  }
}

function persistenceResult(
  metadata: ArtifactMetadata,
  created: boolean,
  referenceCreated: boolean,
): PersistenceResolution {
  return { metadata, created, referenceCreated };
}

function persistArtifact(
  options: Readonly<{
    persistence: OwnLoopPersistence;
    materialized: MaterializedPreparedContent;
    descriptor: PreparedArtifactDescriptor;
    reference: ReferenceInput | null;
    clock: () => Date;
    artifactIdGenerator: () => string;
  }>,
): PersistenceResolution {
  const createdAt = canonicalTimestamp(options.clock);
  try {
    return options.persistence.withTransaction(({ artifacts }) => {
      const existing = artifacts.getMetadataByDigest(options.materialized.digest);
      if (existing !== null) {
        assertMetadataIdentity(existing, {
          digest: options.materialized.digest,
          storagePath: options.materialized.storagePath,
          sizeBytes: options.materialized.sizeBytes,
          kind: options.descriptor.kind,
          mediaType: options.descriptor.mediaType,
        });
        const desiredSensitivity = stricterSensitivity(
          existing.sensitivity,
          options.descriptor.sensitivity,
        );
        let resolved = existing;
        if (desiredSensitivity !== existing.sensitivity) {
          if (!artifacts.updateSensitivity(existing.artifactId, desiredSensitivity)) {
            throw new ArtifactStoreError("artifact_persistence_failed");
          }
          resolved = { ...existing, sensitivity: desiredSensitivity };
        }
        const referenceCreated =
          options.reference === null
            ? false
            : artifacts.linkToRun({
                ...options.reference,
                artifactId: resolved.artifactId,
                createdAt,
              });
        return persistenceResult(resolved, false, referenceCreated);
      }

      const metadata: ArtifactMetadata = {
        artifactId: safeGeneratedId(options.artifactIdGenerator),
        digest: options.materialized.digest,
        storagePath: options.materialized.storagePath,
        sizeBytes: options.materialized.sizeBytes,
        kind: options.descriptor.kind,
        sensitivity: options.descriptor.sensitivity,
        storageVersion: ARTIFACT_STORE_STORAGE_VERSION,
        mediaType: options.descriptor.mediaType,
        createdAt,
      };
      artifacts.insertMetadata(metadata);
      const referenceCreated =
        options.reference === null
          ? false
          : artifacts.linkToRun({
              ...options.reference,
              artifactId: metadata.artifactId,
              createdAt,
            });
      return persistenceResult(metadata, true, referenceCreated);
    });
  } catch (error) {
    if (isArtifactStoreError(error)) {
      throw error;
    }
    if (error instanceof PersistenceError) {
      throw new ArtifactStoreError(
        options.reference === null ? "artifact_persistence_failed" : "artifact_reference_failed",
      );
    }
    throw new ArtifactStoreError("artifact_persistence_failed");
  }
}

function safePutResult(resolution: PersistenceResolution): PutPreparedArtifactResult {
  const metadata = resolution.metadata;
  assertVersionOneMetadata(metadata);
  if (metadata.mediaType === null) {
    throw new ArtifactStoreError("artifact_metadata_conflict");
  }
  return {
    artifactId: metadata.artifactId,
    digest: metadata.digest,
    sizeBytes: metadata.sizeBytes,
    kind: metadata.kind,
    mediaType: metadata.mediaType,
    sensitivity: metadata.sensitivity,
    created: resolution.created,
    referenceCreated: resolution.referenceCreated,
    createdAt: metadata.createdAt,
  };
}

async function gcObjectStatus(objectPath: string): Promise<"missing" | "regular"> {
  try {
    const status = await lstat(objectPath);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new ArtifactStoreError("artifact_content_corrupt");
    }
    return "regular";
  } catch (error) {
    if (filesystemErrorCode(error) === "ENOENT") {
      return "missing";
    }
    if (isArtifactStoreError(error)) {
      throw error;
    }
    throw new ArtifactStoreError("artifact_gc_failed");
  }
}

function isValidDigestDirectory(entry: Dirent): boolean {
  return (
    entry.isDirectory() &&
    !entry.isSymbolicLink() &&
    SHA256_PREFIX_DIRECTORY_PATTERN.test(entry.name)
  );
}

function isValidDigestObject(entry: Dirent): boolean {
  return entry.isFile() && !entry.isSymbolicLink() && SHA256_SUFFIX_FILE_PATTERN.test(entry.name);
}

export type LocalArtifactStore = Readonly<{
  putPreparedBytes(
    input: PreparedArtifactDescriptor & Readonly<{ preparedBytes: Uint8Array }>,
  ): Promise<PutPreparedArtifactResult>;
  putPreparedStream(
    input: PreparedArtifactDescriptor & Readonly<{ preparedStream: PreparedByteStream }>,
  ): Promise<PutPreparedArtifactResult>;
  putPreparedArtifactForRun(
    input: PreparedArtifactDescriptor &
      Readonly<{
        preparedContent: PreparedByteStream;
        runId: string;
        role: string;
      }>,
  ): Promise<PutPreparedArtifactResult>;
  readPreparedBytes(artifactId: string): Promise<ReadPreparedArtifactResult>;
  linkArtifactToRun(input: Readonly<{ artifactId: string; runId: string; role: string }>): boolean;
  listArtifactsForRun(runId: string): readonly RunArtifactRecord[];
  unlinkArtifactFromRun(
    input: Readonly<{ artifactId: string; runId: string; role: string }>,
  ): boolean;
  collectUnreferencedArtifacts(limit?: number): Promise<ArtifactGarbageCollectionResult>;
  sweepOrphanObjects(limit?: number): Promise<ArtifactOrphanSweepResult>;
}>;

class LocalArtifactStoreImplementation implements LocalArtifactStore {
  readonly #paths: CanonicalStorePaths;
  readonly #persistence: OwnLoopPersistence;
  readonly #maximumArtifactSizeBytes: number;
  readonly #clock: () => Date;
  readonly #artifactIdGenerator: () => string;

  constructor(
    paths: CanonicalStorePaths,
    options: LocalArtifactStoreOptions,
    maximumArtifactSizeBytes: number,
  ) {
    this.#paths = paths;
    this.#persistence = options.persistence;
    this.#maximumArtifactSizeBytes = maximumArtifactSizeBytes;
    this.#clock = options.clock ?? (() => new Date());
    this.#artifactIdGenerator = options.artifactIdGenerator ?? randomUUID;
  }

  async putPreparedBytes(
    input: PreparedArtifactDescriptor & Readonly<{ preparedBytes: Uint8Array }>,
  ): Promise<PutPreparedArtifactResult> {
    if (!(input.preparedBytes instanceof Uint8Array)) {
      throw new ArtifactStoreError("invalid_prepared_content");
    }
    const copy = Uint8Array.from(input.preparedBytes);
    return this.#putPreparedStream(input, [copy], null);
  }

  async putPreparedStream(
    input: PreparedArtifactDescriptor & Readonly<{ preparedStream: PreparedByteStream }>,
  ): Promise<PutPreparedArtifactResult> {
    return this.#putPreparedStream(input, input.preparedStream, null);
  }

  async putPreparedArtifactForRun(
    input: PreparedArtifactDescriptor &
      Readonly<{
        preparedContent: PreparedByteStream;
        runId: string;
        role: string;
      }>,
  ): Promise<PutPreparedArtifactResult> {
    const reference = validateReference({ runId: input.runId, role: input.role });
    return this.#putPreparedStream(input, input.preparedContent, reference);
  }

  async #putPreparedStream(
    descriptor: PreparedArtifactDescriptor,
    preparedStream: PreparedByteStream,
    reference: ReferenceInput | null,
  ): Promise<PutPreparedArtifactResult> {
    const validatedDescriptor = validateDescriptor(descriptor);
    const materialized = await materializePreparedContent(
      this.#paths,
      preparedStream,
      this.#maximumArtifactSizeBytes,
    );
    const resolution = persistArtifact({
      persistence: this.#persistence,
      materialized,
      descriptor: validatedDescriptor,
      reference,
      clock: this.#clock,
      artifactIdGenerator: this.#artifactIdGenerator,
    });
    return safePutResult(resolution);
  }

  async readPreparedBytes(artifactId: string): Promise<ReadPreparedArtifactResult> {
    if (!SAFE_ID_PATTERN.test(artifactId)) {
      throw new ArtifactStoreError("artifact_not_found");
    }
    let metadata: ArtifactMetadata | null;
    try {
      metadata = this.#persistence.artifacts.getMetadata(artifactId);
    } catch {
      throw new ArtifactStoreError("artifact_read_failed");
    }
    if (metadata === null) {
      throw new ArtifactStoreError("artifact_not_found");
    }
    if (metadata.storageVersion !== ARTIFACT_STORE_STORAGE_VERSION || metadata.mediaType === null) {
      throw new ArtifactStoreError("unsupported_storage_version");
    }
    const bytes = await readAndVerifyObject(
      this.#paths,
      metadata,
      this.#maximumArtifactSizeBytes,
      true,
    );
    if (bytes === null) {
      throw new ArtifactStoreError("artifact_read_failed");
    }
    return {
      artifactId: metadata.artifactId,
      digest: metadata.digest,
      sizeBytes: metadata.sizeBytes,
      kind: metadata.kind,
      mediaType: metadata.mediaType,
      sensitivity: metadata.sensitivity,
      bytes,
    };
  }

  linkArtifactToRun(input: Readonly<{ artifactId: string; runId: string; role: string }>): boolean {
    if (!SAFE_ID_PATTERN.test(input.artifactId)) {
      throw new ArtifactStoreError("artifact_reference_failed");
    }
    const reference = validateReference(input);
    try {
      return this.#persistence.withTransaction(({ artifacts }) => {
        const metadata = artifacts.getMetadata(input.artifactId);
        if (metadata === null) {
          throw new ArtifactStoreError("artifact_not_found");
        }
        assertVersionOneMetadata(metadata);
        return artifacts.linkToRun({
          ...reference,
          artifactId: input.artifactId,
          createdAt: canonicalTimestamp(this.#clock),
        });
      });
    } catch (error) {
      if (isArtifactStoreError(error)) {
        throw error;
      }
      throw new ArtifactStoreError("artifact_reference_failed");
    }
  }

  listArtifactsForRun(runId: string): readonly RunArtifactRecord[] {
    if (!SAFE_ID_PATTERN.test(runId)) {
      throw new ArtifactStoreError("artifact_reference_failed");
    }
    try {
      const records = this.#persistence.artifacts.listRecordsForRun(runId);
      for (const record of records) {
        assertVersionOneMetadata(record.artifact);
      }
      return records;
    } catch (error) {
      if (isArtifactStoreError(error)) {
        throw error;
      }
      throw new ArtifactStoreError("artifact_reference_failed");
    }
  }

  unlinkArtifactFromRun(
    input: Readonly<{ artifactId: string; runId: string; role: string }>,
  ): boolean {
    if (!SAFE_ID_PATTERN.test(input.artifactId)) {
      throw new ArtifactStoreError("artifact_reference_failed");
    }
    const reference = validateReference(input);
    try {
      return this.#persistence.withTransaction(({ artifacts }) =>
        artifacts.unlinkFromRun(reference.runId, input.artifactId, reference.role),
      );
    } catch {
      throw new ArtifactStoreError("artifact_reference_failed");
    }
  }

  async collectUnreferencedArtifacts(
    limit = MAX_ARTIFACT_GC_BATCH,
  ): Promise<ArtifactGarbageCollectionResult> {
    try {
      return await this.#collectUnreferencedArtifacts(limit);
    } catch (error) {
      if (isArtifactStoreError(error)) {
        throw error;
      }
      throw new ArtifactStoreError("artifact_gc_failed");
    }
  }

  async #collectUnreferencedArtifacts(limit: number): Promise<ArtifactGarbageCollectionResult> {
    const boundedLimit = validateBatchLimit(limit);
    const candidates = this.#persistence.artifacts.listUnreferenced(boundedLimit);
    let metadataDeleted = 0;
    let objectsDeleted = 0;
    let objectsMissing = 0;
    let skippedReferenced = 0;

    for (const metadata of candidates) {
      const digestHex = assertVersionOneMetadata(metadata);
      await ensureDigestDirectory(this.#paths, digestHex);
      const objectPath = finalObjectPath(this.#paths, digestHex);
      const statusBeforeDelete = await gcObjectStatus(objectPath);

      const deleted = this.#persistence.withTransaction(({ artifacts }) =>
        artifacts.deleteMetadataIfUnreferenced(metadata.artifactId),
      );
      if (!deleted) {
        skippedReferenced += 1;
        continue;
      }
      metadataDeleted += 1;

      if (statusBeforeDelete === "missing") {
        objectsMissing += 1;
        continue;
      }
      try {
        if ((await gcObjectStatus(objectPath)) === "missing") {
          objectsMissing += 1;
          continue;
        }
        await unlink(objectPath);
        objectsDeleted += 1;
      } catch (error) {
        if (filesystemErrorCode(error) === "ENOENT") {
          objectsMissing += 1;
          continue;
        }
        if (isArtifactStoreError(error)) {
          throw error;
        }
        throw new ArtifactStoreError("artifact_gc_failed");
      }
    }

    return {
      candidates: candidates.length,
      metadataDeleted,
      objectsDeleted,
      objectsMissing,
      skippedReferenced,
    };
  }

  async sweepOrphanObjects(limit = MAX_ARTIFACT_GC_BATCH): Promise<ArtifactOrphanSweepResult> {
    try {
      return await this.#sweepOrphanObjects(limit);
    } catch (error) {
      if (isArtifactStoreError(error)) {
        throw error;
      }
      throw new ArtifactStoreError("artifact_gc_failed");
    }
  }

  async #sweepOrphanObjects(limit: number): Promise<ArtifactOrphanSweepResult> {
    const boundedLimit = validateBatchLimit(limit);
    await ensureCanonicalDirectory(this.#paths.objectsSha256, this.#paths.objectsSha256);
    let objectsDeleted = 0;
    let objectsSkipped = 0;

    let prefixEntries: Dirent[];
    try {
      prefixEntries = await readdir(this.#paths.objectsSha256, { withFileTypes: true });
    } catch {
      throw new ArtifactStoreError("artifact_gc_failed");
    }
    prefixEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const prefixEntry of prefixEntries) {
      if (objectsDeleted >= boundedLimit) {
        break;
      }
      if (!isValidDigestDirectory(prefixEntry)) {
        objectsSkipped += 1;
        continue;
      }
      const prefixPath = join(this.#paths.objectsSha256, prefixEntry.name);
      try {
        await ensureCanonicalDirectory(prefixPath, prefixPath);
      } catch {
        objectsSkipped += 1;
        continue;
      }

      let objectEntries: Dirent[];
      try {
        objectEntries = await readdir(prefixPath, { withFileTypes: true });
      } catch {
        objectsSkipped += 1;
        continue;
      }
      objectEntries.sort((left, right) => left.name.localeCompare(right.name));

      for (const objectEntry of objectEntries) {
        if (objectsDeleted >= boundedLimit) {
          break;
        }
        if (!isValidDigestObject(objectEntry)) {
          objectsSkipped += 1;
          continue;
        }
        const digestHex = `${prefixEntry.name}${objectEntry.name}`;
        const digest = `${ARTIFACT_STORE_DIGEST_PREFIX}${digestHex}`;
        if (this.#persistence.artifacts.getMetadataByDigest(digest) !== null) {
          continue;
        }
        const objectPath = join(prefixPath, objectEntry.name);
        try {
          const status = await lstat(objectPath);
          if (!status.isFile() || status.isSymbolicLink()) {
            objectsSkipped += 1;
            continue;
          }
          await unlink(objectPath);
          objectsDeleted += 1;
        } catch (error) {
          if (filesystemErrorCode(error) !== "ENOENT") {
            objectsSkipped += 1;
          }
        }
      }
    }

    return { objectsDeleted, objectsSkipped };
  }
}

export async function createLocalArtifactStore(
  options: LocalArtifactStoreOptions,
): Promise<LocalArtifactStore> {
  const maximumArtifactSizeBytes = validateMaximumSize(
    options.maximumArtifactSizeBytes ?? DEFAULT_MAXIMUM_ARTIFACT_SIZE_BYTES,
  );
  try {
    const paths = await initializePaths(options);
    return new LocalArtifactStoreImplementation(paths, options, maximumArtifactSizeBytes);
  } catch (error) {
    if (isArtifactStoreError(error)) {
      throw error;
    }
    throw new ArtifactStoreError("invalid_configuration");
  }
}
