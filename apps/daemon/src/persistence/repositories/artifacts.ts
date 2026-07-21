import type { EventSensitivity } from "@ownloop/event-model";
import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

export const ARTIFACT_STORAGE_VERSIONS = [0, 1] as const;
export type ArtifactStorageVersion = (typeof ARTIFACT_STORAGE_VERSIONS)[number];

export type ArtifactMetadata = Readonly<{
  artifactId: string;
  digest: string;
  storagePath: string;
  sizeBytes: number;
  kind: string;
  sensitivity: EventSensitivity;
  storageVersion: ArtifactStorageVersion;
  mediaType: string | null;
  createdAt: string;
}>;

export type RunArtifactReference = Readonly<{
  runId: string;
  artifactId: string;
  role: string;
  createdAt: string;
}>;

export type RunArtifactRecord = Readonly<{
  reference: RunArtifactReference;
  artifact: ArtifactMetadata;
}>;

function artifactStorageVersion(row: SqliteRow): ArtifactStorageVersion {
  const value = requiredNumber(row, "storage_version");
  if (value === 0 || value === 1) {
    return value;
  }
  throw new PersistenceError(
    "invalid_persisted_row",
    "The persisted row contains an invalid storage_version column.",
  );
}

function mapArtifact(row: SqliteRow): ArtifactMetadata {
  return {
    artifactId: requiredString(row, "artifact_id"),
    digest: requiredString(row, "digest"),
    storagePath: requiredString(row, "storage_path"),
    sizeBytes: requiredNumber(row, "size_bytes"),
    kind: requiredString(row, "kind"),
    sensitivity: requiredString(row, "sensitivity") as EventSensitivity,
    storageVersion: artifactStorageVersion(row),
    mediaType: nullableString(row, "media_type"),
    createdAt: requiredString(row, "created_at"),
  };
}

function mapReference(row: SqliteRow): RunArtifactReference {
  return {
    runId: requiredString(row, "run_id"),
    artifactId: requiredString(row, "artifact_id"),
    role: requiredString(row, "role"),
    createdAt: requiredString(row, "reference_created_at"),
  };
}

const ARTIFACT_COLUMNS = `
  artifact_id,
  digest,
  storage_path,
  size_bytes,
  kind,
  sensitivity,
  storage_version,
  media_type,
  created_at
`;

const QUALIFIED_ARTIFACT_COLUMNS = `
  a.artifact_id,
  a.digest,
  a.storage_path,
  a.size_bytes,
  a.kind,
  a.sensitivity,
  a.storage_version,
  a.media_type,
  a.created_at
`;

export class ArtifactRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insertMetadata(artifact: ArtifactMetadata): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO artifacts (
             artifact_id,
             digest,
             storage_path,
             size_bytes,
             kind,
             sensitivity,
             storage_version,
             media_type,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.artifactId,
          artifact.digest,
          artifact.storagePath,
          artifact.sizeBytes,
          artifact.kind,
          artifact.sensitivity,
          artifact.storageVersion,
          artifact.mediaType,
          artifact.createdAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert artifact metadata");
    }
  }

  getMetadata(artifactId: string): ArtifactMetadata | null {
    const row = this.#database
      .prepare(
        `SELECT ${ARTIFACT_COLUMNS}
         FROM artifacts
         WHERE artifact_id = ?`,
      )
      .get(artifactId);

    return row === undefined ? null : mapArtifact(row);
  }

  getMetadataByDigest(digest: string): ArtifactMetadata | null {
    const row = this.#database
      .prepare(
        `SELECT ${ARTIFACT_COLUMNS}
         FROM artifacts
         WHERE digest = ?`,
      )
      .get(digest);

    return row === undefined ? null : mapArtifact(row);
  }

  updateSensitivity(artifactId: string, sensitivity: EventSensitivity): boolean {
    try {
      const result = this.#database
        .prepare("UPDATE artifacts SET sensitivity = ? WHERE artifact_id = ?")
        .run(sensitivity, artifactId);
      return result.changes === 1;
    } catch (error) {
      mapPersistenceWriteError(error, "update artifact sensitivity");
    }
  }

  linkToRun(reference: RunArtifactReference): boolean {
    if (this.hasReference(reference.runId, reference.artifactId, reference.role)) {
      return false;
    }
    try {
      const result = this.#database
        .prepare(
          `INSERT INTO run_artifacts (run_id, artifact_id, role, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(reference.runId, reference.artifactId, reference.role, reference.createdAt);
      return result.changes === 1;
    } catch (error) {
      if (this.hasReference(reference.runId, reference.artifactId, reference.role)) {
        return false;
      }
      mapPersistenceWriteError(error, "link artifact to Task Run");
    }
  }

  hasReference(runId: string, artifactId: string, role: string): boolean {
    return (
      this.#database
        .prepare(
          `SELECT 1
           FROM run_artifacts
           WHERE run_id = ? AND artifact_id = ? AND role = ?`,
        )
        .get(runId, artifactId, role) !== undefined
    );
  }

  unlinkFromRun(runId: string, artifactId: string, role: string): boolean {
    try {
      const result = this.#database
        .prepare(
          `DELETE FROM run_artifacts
           WHERE run_id = ? AND artifact_id = ? AND role = ?`,
        )
        .run(runId, artifactId, role);
      return result.changes === 1;
    } catch (error) {
      mapPersistenceWriteError(error, "unlink artifact from Task Run");
    }
  }

  listForRun(runId: string): readonly RunArtifactReference[] {
    return this.#database
      .prepare(
        `SELECT run_id, artifact_id, role, created_at AS reference_created_at
         FROM run_artifacts
         WHERE run_id = ?
         ORDER BY artifact_id, role`,
      )
      .all(runId)
      .map(mapReference);
  }

  listRecordsForRun(runId: string): readonly RunArtifactRecord[] {
    return this.#database
      .prepare(
        `SELECT
           r.run_id,
           r.artifact_id,
           r.role,
           r.created_at AS reference_created_at,
           a.digest,
           a.storage_path,
           a.size_bytes,
           a.kind,
           a.sensitivity,
           a.storage_version,
           a.media_type,
           a.created_at
         FROM run_artifacts r
         JOIN artifacts a ON a.artifact_id = r.artifact_id
         WHERE r.run_id = ?
         ORDER BY r.artifact_id, r.role`,
      )
      .all(runId)
      .map((row) => ({
        reference: mapReference(row),
        artifact: mapArtifact(row),
      }));
  }

  countReferences(artifactId: string): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS reference_count FROM run_artifacts WHERE artifact_id = ?")
      .get(artifactId);
    return requiredNumber(row ?? {}, "reference_count");
  }

  listUnreferenced(limit: number): readonly ArtifactMetadata[] {
    return this.#database
      .prepare(
        `SELECT ${QUALIFIED_ARTIFACT_COLUMNS}
         FROM artifacts a
         WHERE a.storage_version = 1
           AND NOT EXISTS (
             SELECT 1 FROM run_artifacts r WHERE r.artifact_id = a.artifact_id
           )
         ORDER BY a.created_at, a.artifact_id
         LIMIT ?`,
      )
      .all(limit)
      .map(mapArtifact);
  }

  deleteMetadataIfUnreferenced(artifactId: string): boolean {
    try {
      const result = this.#database
        .prepare(
          `DELETE FROM artifacts
           WHERE artifact_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM run_artifacts WHERE artifact_id = artifacts.artifact_id
             )`,
        )
        .run(artifactId);
      return result.changes === 1;
    } catch (error) {
      mapPersistenceWriteError(error, "delete unreferenced artifact metadata");
    }
  }
}
