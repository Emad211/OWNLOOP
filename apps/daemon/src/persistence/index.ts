import { openConfiguredDatabase, type PersistenceConnectionInfo } from "./database.js";
import { runMigrations } from "./migrations.js";
import { ArtifactRepository } from "./repositories/artifacts.js";
import { AgentConversationRepository } from "./repositories/conversations.js";
import { EventRepository } from "./repositories/events.js";
import { IngressReceiptRepository } from "./repositories/ingress-receipts.js";
import { RunSupportRepository } from "./repositories/run-support.js";
import { TaskRunRepository } from "./repositories/task-runs.js";
import { WorkspaceRepository } from "./repositories/workspaces.js";
import { runInTransaction } from "./transaction.js";

export type PersistenceRepositories = Readonly<{
  ingressReceipts: IngressReceiptRepository;
  workspaces: WorkspaceRepository;
  conversations: AgentConversationRepository;
  taskRuns: TaskRunRepository;
  events: EventRepository;
  runSupport: RunSupportRepository;
  artifacts: ArtifactRepository;
}>;

export type OwnLoopPersistence = PersistenceRepositories &
  Readonly<{
    connectionInfo: PersistenceConnectionInfo;
    withTransaction<Result>(operation: (repositories: PersistenceRepositories) => Result): Result;
    close(): void;
  }>;

export function openPersistence(databasePath: string): OwnLoopPersistence {
  const { database, connectionInfo } = openConfiguredDatabase(databasePath);

  try {
    runMigrations(database);
  } catch (error) {
    database.close();
    throw error;
  }

  const repositories: PersistenceRepositories = {
    ingressReceipts: new IngressReceiptRepository(database),
    workspaces: new WorkspaceRepository(database),
    conversations: new AgentConversationRepository(database),
    taskRuns: new TaskRunRepository(database),
    events: new EventRepository(database),
    runSupport: new RunSupportRepository(database),
    artifacts: new ArtifactRepository(database),
  };

  return {
    ...repositories,
    connectionInfo,
    withTransaction<Result>(operation: (repositories: PersistenceRepositories) => Result): Result {
      return runInTransaction(database, () => operation(repositories));
    },
    close(): void {
      if (database.isOpen) {
        database.close();
      }
    },
  };
}

export {
  MigrationError,
  PersistenceConstraintError,
  PersistenceError,
} from "./errors.js";
export type {
  MigrationErrorCode,
  PersistenceErrorCode,
} from "./errors.js";
export type { PersistenceConnectionInfo } from "./database.js";
export type {
  ArtifactMetadata,
  RunArtifactReference,
} from "./repositories/artifacts.js";
export type {
  AgentConversation,
  NewAgentConversation,
} from "./repositories/conversations.js";
export type { EventDeduplicationRecord } from "./repositories/events.js";
export { INGRESS_RECEIPT_STATUSES } from "./repositories/ingress-receipts.js";
export type {
  IngressReceipt,
  IngressReceiptStatus,
  NewIngressReceipt,
} from "./repositories/ingress-receipts.js";
export type {
  AnalysisJobRecord,
  EvidenceGapRecord,
} from "./repositories/run-support.js";
export { TASK_RUN_STATUSES } from "./repositories/task-runs.js";
export type {
  NewTaskRun,
  TaskRun,
  TaskRunStatus,
} from "./repositories/task-runs.js";
export type { NewWorkspace, Workspace } from "./repositories/workspaces.js";
