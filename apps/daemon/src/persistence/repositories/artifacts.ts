import type { EventSensitivity } from "@ownloop/event-model";
import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

export type ArtifactStorageVersion = 0 | 1;

export type ArtifactMetadata = Readonly<{
  artifactId: string;
  digest: string;
  storagePath: string;
  sizeBytes: number;
  kind: string;
  sensitivity: EventSensitivity;
  createdAt: string;
  storageVersion: ArtifactStorageVersion;
  mediaType: string | null;
}>;

export type RunArtifactReference = Readonly<{
  runId: string;
  artifactId: string;
  role: string;
  createdAt: string;
}>;

const ARTIFACT_SELECT = `SELECT
  artifact_id,
  digest,
  storage_path,
  size_bytes,
  kind,
  sensitivity,
  created_at,
  storage_version,
  media_type
FROM artifacts`;

const SENSITIVITY_RANK: Readonly<Record<EventSensitivity, number>> = {
  public: 0,
  normal: 1,
  sensitive: 2,
  secret: 3,
};

function mapArtifact(row: SqliteRow): ArtifactMetadata {
  return {
    artifactId: requiredString(row, "artifact_id"),
    digest: requiredString(row, "digest"),
    storagePath: requiredString(row, "storage_path"),
    sizeBytes: requiredNumber(row, "size_bytes"),
    kind: requiredString(row, "kind"),
    sensitivity: requiredString(row, "sensitivity") as EventSensitivity,
    createdAt: requiredString(row, "created_at"),
    storageVersion: requiredNumber(row, "storage_version") as ArtifactStorageVersion,
    mediaType: nullableString(row, "media_type"),
  };
}

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
             created_at,
             storage_version,
             media_type
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.artifactId,
          artifact.digest,
          artifact.storagePath,
          artifact.sizeBytes,
          artifact.kind,
          artifact.sensitivity,
          artifact.createdAt,
          artifact.storageVersion,
          artifact.mediaType,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert artifact metadata");
    }
  }

  getMetadata(artifactId: string): ArtifactMetadata | null {
    const row = this.#database.prepare(`${ARTIFACT_SELECT} WHERE artifact_id = ?`).get(artifactId);
    return row === undefined ? null : mapArtifact(row);
  }

  getByDigest(digest: string): ArtifactMetadata | null {
    const row = this.#database.prepare(`${ARTIFACT_SELECT} WHERE digest = ?`).get(digest);
    return row === undefined ? null : mapArtifact(row);
  }

  escalateSensitivity(artifactId: string, sensitivity: EventSensitivity): boolean {
    const existing = this.getMetadata(artifactId);
    if (existing === null) return false;
    if (SENSITIVITY_RANK[sensitivity] <= SENSITIVITY_RANK[existing.sensitivity]) return true;
    try {
      return (
        this.#database
          .prepare("UPDATE artifacts SET sensitivity = ? WHERE artifact_id = ?")
          .run(sensitivity, artifactId).changes === 1
      );
    } catch (error) {
      mapPersistenceWriteError(error, "escalate artifact sensitivity");
    }
  }

  linkToRun(reference: RunArtifactReference): boolean {
    try {
      return (
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO run_artifacts (run_id, artifact_id, role, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(reference.runId, reference.artifactId, reference.role, reference.createdAt)
          .changes === 1
      );
    } catch (error) {
      mapPersistenceWriteError(error, "link artifact to Task Run");
    }
  }

  unlinkFromRun(runId: string, artifactId: string, role: string): boolean {
    try {
      return (
        this.#database
          .prepare(
            `DELETE FROM run_artifacts
             WHERE run_id = ? AND artifact_id = ? AND role = ?`,
          )
          .run(runId, artifactId, role).changes === 1
      );
    } catch (error) {
      mapPersistenceWriteError(error, "unlink artifact from Task Run");
    }
  }

  listForRun(runId: string): readonly RunArtifactReference[] {
    return this.#database
      .prepare(
        `SELECT run_id, artifact_id, role, created_at
         FROM run_artifacts
         WHERE run_id = ?
         ORDER BY artifact_id, role`,
      )
      .all(runId)
      .map((row) => ({
        runId: requiredString(row, "run_id"),
        artifactId: requiredString(row, "artifact_id"),
        role: requiredString(row, "role"),
        createdAt: requiredString(row, "created_at"),
      }));
  }

  countReferences(artifactId: string): number {
    const row = this.#database
      .prepare("SELECT count(*) AS count FROM run_artifacts WHERE artifact_id = ?")
      .get(artifactId);
    return row === undefined ? 0 : requiredNumber(row, "count");
  }

  listUnreferenced(limit: number): readonly ArtifactMetadata[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return [];
    return this.#database
      .prepare(
        `${ARTIFACT_SELECT}
         WHERE NOT EXISTS (
           SELECT 1 FROM run_artifacts ra WHERE ra.artifact_id = artifacts.artifact_id
         )
         ORDER BY created_at ASC, artifact_id ASC
         LIMIT ?`,
      )
      .all(limit)
      .map(mapArtifact);
  }

  deleteMetadataIfUnreferenced(artifactId: string): ArtifactMetadata | null {
    const existing = this.getMetadata(artifactId);
    if (existing === null) return null;
    try {
      const result = this.#database
        .prepare(
          `DELETE FROM artifacts
           WHERE artifact_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM run_artifacts WHERE artifact_id = ?
             )`,
        )
        .run(artifactId, artifactId);
      return result.changes === 1 ? existing : null;
    } catch (error) {
      mapPersistenceWriteError(error, "delete unreferenced artifact metadata");
    }
  }

  assertCompatibleContentAddressed(
    existing: ArtifactMetadata,
    expected: Readonly<{
      digest: string;
      storagePath: string;
      sizeBytes: number;
      kind: string;
      mediaType: string;
    }>,
  ): void {
    if (
      existing.storageVersion !== 1 ||
      existing.digest !== expected.digest ||
      existing.storagePath !== expected.storagePath ||
      existing.sizeBytes !== expected.sizeBytes ||
      existing.kind !== expected.kind ||
      existing.mediaType !== expected.mediaType
    ) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Artifact metadata conflicts with the prepared content identity.",
      );
    }
  }
}
