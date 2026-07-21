import type { EventSensitivity } from "@ownloop/event-model";
import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { requiredNumber, requiredString } from "../row-mapping.js";

export type ArtifactMetadata = Readonly<{
  artifactId: string;
  digest: string;
  storagePath: string;
  sizeBytes: number;
  kind: string;
  sensitivity: EventSensitivity;
  createdAt: string;
}>;

export type RunArtifactReference = Readonly<{
  runId: string;
  artifactId: string;
  role: string;
  createdAt: string;
}>;

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
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.artifactId,
          artifact.digest,
          artifact.storagePath,
          artifact.sizeBytes,
          artifact.kind,
          artifact.sensitivity,
          artifact.createdAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert artifact metadata");
    }
  }

  getMetadata(artifactId: string): ArtifactMetadata | null {
    const row = this.#database
      .prepare(
        `SELECT artifact_id, digest, storage_path, size_bytes, kind, sensitivity, created_at
         FROM artifacts
         WHERE artifact_id = ?`,
      )
      .get(artifactId);

    if (row === undefined) {
      return null;
    }

    return {
      artifactId: requiredString(row, "artifact_id"),
      digest: requiredString(row, "digest"),
      storagePath: requiredString(row, "storage_path"),
      sizeBytes: requiredNumber(row, "size_bytes"),
      kind: requiredString(row, "kind"),
      sensitivity: requiredString(row, "sensitivity") as EventSensitivity,
      createdAt: requiredString(row, "created_at"),
    };
  }

  linkToRun(reference: RunArtifactReference): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO run_artifacts (run_id, artifact_id, role, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(reference.runId, reference.artifactId, reference.role, reference.createdAt);
    } catch (error) {
      mapPersistenceWriteError(error, "link artifact to Task Run");
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
}
