import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredString } from "../row-mapping.js";

export type Workspace = Readonly<{
  workspaceId: string;
  canonicalPath: string;
  repositoryRoot: string;
  gitRemote: string | null;
  initialRepositoryFingerprint: string;
  createdAt: string;
  lastObservedAt: string;
}>;

export type NewWorkspace = Workspace;

export class WorkspaceRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  insert(workspace: NewWorkspace): void {
    try {
      this.#database
        .prepare(
          `INSERT INTO workspaces (
             workspace_id,
             canonical_path,
             repository_root,
             git_remote,
             initial_repository_fingerprint,
             created_at,
             last_observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          workspace.workspaceId,
          workspace.canonicalPath,
          workspace.repositoryRoot,
          workspace.gitRemote,
          workspace.initialRepositoryFingerprint,
          workspace.createdAt,
          workspace.lastObservedAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert workspace");
    }
  }

  get(workspaceId: string): Workspace | null {
    const row = this.#database
      .prepare(
        `SELECT
           workspace_id,
           canonical_path,
           repository_root,
           git_remote,
           initial_repository_fingerprint,
           created_at,
           last_observed_at
         FROM workspaces
         WHERE workspace_id = ?`,
      )
      .get(workspaceId);

    if (row === undefined) {
      return null;
    }

    return {
      workspaceId: requiredString(row, "workspace_id"),
      canonicalPath: requiredString(row, "canonical_path"),
      repositoryRoot: requiredString(row, "repository_root"),
      gitRemote: nullableString(row, "git_remote"),
      initialRepositoryFingerprint: requiredString(row, "initial_repository_fingerprint"),
      createdAt: requiredString(row, "created_at"),
      lastObservedAt: requiredString(row, "last_observed_at"),
    };
  }

  delete(workspaceId: string): boolean {
    return (
      this.#database.prepare("DELETE FROM workspaces WHERE workspace_id = ?").run(workspaceId)
        .changes === 1
    );
  }
}
