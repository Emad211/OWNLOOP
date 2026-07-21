import { openConfiguredDatabase, type PersistenceConnectionInfo } from "./database.js";
import { runMigrations } from "./migrations.js";
import { ArtifactRepository } from "./repositories/artifacts.js";
import { AgentConversationRepository } from "./repositories/conversations.js";
import { EventRepository } from "./repositories/events.js";
import { IngressReceiptRepository } from "./repositories/ingress-receipts.js";
import { RunSupportRepository } from "./repositories/run-support.js";
import { TaskRunRepository } from "./repositories/task-runs.js";
import { WorkspaceRepository } from "./repositories/workspaces.js";
import { assertSynchronousTransactionOperation, runInTransaction } from "./transaction.js";

export type PersistenceRepositories = Readonly<{
  ingressReceipts: IngressReceiptRepository;
  workspaces: WorkspaceRepository;
  conversations: AgentConversationRepository;
  taskRuns: TaskRunRepository;
  events: EventRepository;
  runSupport: RunSupportRepository;
  artifacts: ArtifactRepository;
}>;

type AsyncTransactionGuard<Result> = [Result] extends [never]
  ? []
  : Result extends PromiseLike<unknown>
    ? [error: "Async transaction callbacks are not supported"]
    : [];

export type OwnLoopPersistence = PersistenceRepositories &
  Readonly<{
    connectionInfo: PersistenceConnectionInfo;
    withTransaction<Result>(
      operation: (repositories: PersistenceRepositories) => Result,
      ...asyncTransactionGuard: AsyncTransactionGuard<Result>
    ): Result;
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

  function withTransaction<Result>(
    operation: (repositories: PersistenceRepositories) => Result,
    ..._asyncTransactionGuard: AsyncTransactionGuard<Result>
  ): Result {
    assertSynchronousTransactionOperation(operation);
    return runInTransaction(database, () => operation(repositories));
  }

  return {
    ...repositories,
    connectionInfo,
    withTransaction,
    close(): void {
      if (database.isOpen) {
        database.close();
      }
    },
  };
}

export type { PersistenceConnectionInfo } from "./database.js";
export type {
  MigrationErrorCode,
  PersistenceErrorCode,
} from "./errors.js";
export {
  MigrationError,
  PersistenceConstraintError,
  PersistenceDeduplicationConflictError,
  PersistenceError,
} from "./errors.js";
export type {
  ArtifactMetadata,
  RunArtifactReference,
} from "./repositories/artifacts.js";
export type {
  AgentConversation,
  NewAgentConversation,
} from "./repositories/conversations.js";
export type { EventDeduplicationRecord } from "./repositories/events.js";
export type {
  IngressReceipt,
  IngressReceiptStatus,
  LegacyIngressReceipt,
  NewPreparedIngressReceipt,
  PreparedIngressInsertResult,
  PreparedIngressReceiptRecord,
} from "./repositories/ingress-receipts.js";
export { INGRESS_RECEIPT_STATUSES } from "./repositories/ingress-receipts.js";
export type {
  AnalysisJobRecord,
  EvidenceGapRecord,
} from "./repositories/run-support.js";
export type {
  NewTaskRun,
  TaskRun,
  TaskRunStatus,
} from "./repositories/task-runs.js";
export { TASK_RUN_STATUSES } from "./repositories/task-runs.js";
export type { NewWorkspace, Workspace } from "./repositories/workspaces.js";
