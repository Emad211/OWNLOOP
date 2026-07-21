import type { DatabaseSync } from "node:sqlite";

import { mapPersistenceWriteError } from "../errors.js";
import { nullableString, requiredString, type SqliteRow } from "../row-mapping.js";

export const WORKSPACE_IDENTITY_BASES = ["legacy", "canonical_path_v1", "git_resolved_v1"] as const;
export type WorkspaceIdentityBasis = (typeof WORKSPACE_IDENTITY_BASES)[number];

export type Workspace = Readonly<{
  workspaceId: string;
  canonicalPath: string;
  repositoryRoot: string;
  gitRemote: string | null;
  initialRepositoryFingerprint: string;
  identityBasis: WorkspaceIdentityBasis;
  createdAt: string;
  lastObservedAt: string;
}>;

export type NewWorkspace = Workspace;

function mapWorkspace(row: SqliteRow): Workspace {
  return {
    workspaceId: requiredString(row, "workspace_id"),
    canonicalPath: requiredString(row, "canonical_path"),
    repositoryRoot: requiredString(row, "repository_root"),
    gitRemote: nullableString(row, "git_remote"),
    initialRepositoryFingerprint: requiredString(row, "initial_repository_fingerprint"),
    identityBasis: requiredString(row, "identity_basis") as WorkspaceIdentityBasis,
    createdAt: requiredString(row, "created_at"),
    lastObservedAt: requiredString(row, "last_observed_at"),
  };
}

const WORKSPACE_SELECT = `SELECT
  workspace_id,
  canonical_path,
  repository_root,
  git_remote,
  initial_repository_fingerprint,
  identity_basis,
  created_at,
  last_observed_at
FROM workspaces`;

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
             identity_basis,
             created_at,
             last_observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          workspace.workspaceId,
          workspace.canonicalPath,
          workspace.repositoryRoot,
          workspace.gitRemote,
          workspace.initialRepositoryFingerprint,
          workspace.identityBasis,
          workspace.createdAt,
          workspace.lastObservedAt,
        );
    } catch (error) {
      mapPersistenceWriteError(error, "insert workspace");
    }
  }

  get(workspaceId: string): Workspace | null {
    const row = this.#database
      .prepare(`${WORKSPACE_SELECT} WHERE workspace_id = ?`)
      .get(workspaceId);
    return row === undefined ? null : mapWorkspace(row);
  }

  getByCanonicalPath(canonicalPath: string): Workspace | null {
    const row = this.#database
      .prepare(`${WORKSPACE_SELECT} WHERE canonical_path = ?`)
      .get(canonicalPath);
    return row === undefined ? null : mapWorkspace(row);
  }

  touch(workspaceId: string, observedAt: string): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE workspaces
           SET last_observed_at = CASE
             WHEN last_observed_at < ? THEN ?
             ELSE last_observed_at
           END
           WHERE workspace_id = ?`,
        )
        .run(observedAt, observedAt, workspaceId).changes === 1
    );
  }

  upgradeGitIdentity(
    workspaceId: string,
    repositoryRoot: string,
    workingTreeFingerprint: string | null,
  ): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE workspaces
           SET repository_root = ?,
               identity_basis = 'git_resolved_v1',
               initial_repository_fingerprint = CASE
                 WHEN ? IS NOT NULL
                   AND initial_repository_fingerprint LIKE 'path-sha256:%'
                   THEN ?
                 ELSE initial_repository_fingerprint
               END
           WHERE workspace_id = ?`,
        )
        .run(repositoryRoot, workingTreeFingerprint, workingTreeFingerprint, workspaceId)
        .changes === 1
    );
  }

  delete(workspaceId: string): boolean {
    return (
      this.#database.prepare("DELETE FROM workspaces WHERE workspace_id = ?").run(workspaceId)
        .changes === 1
    );
  }
}
