import { openConfiguredDatabase, type PersistenceConnectionInfo } from "./database.js";
import { runMigrations } from "./migrations.js";
import { ArtifactRepository } from "./repositories/artifacts.js";
import { AgentConversationRepository } from "./repositories/conversations.js";
import { EventNormalizationRepository } from "./repositories/event-normalizations.js";
import { EventRepository } from "./repositories/events.js";
import { GitBaselineRepository } from "./repositories/git-baselines.js";
import { GitReconciliationRepository } from "./repositories/git-reconciliations.js";
import { IngressReceiptRepository } from "./repositories/ingress-receipts.js";
import { LifecycleResolutionRepository } from "./repositories/lifecycle-resolutions.js";
import { RunSupportRepository } from "./repositories/run-support.js";
import { TaskRunRepository } from "./repositories/task-runs.js";
import { WorkspaceRepository } from "./repositories/workspaces.js";
import { assertSynchronousTransactionOperation, runInTransaction } from "./transaction.js";

export type PersistenceRepositories = Readonly<{
  ingressReceipts: IngressReceiptRepository;
  lifecycleResolutions: LifecycleResolutionRepository;
  workspaces: WorkspaceRepository;
  conversations: AgentConversationRepository;
  taskRuns: TaskRunRepository;
  events: EventRepository;
  gitBaselines: GitBaselineRepository;
  gitReconciliations: GitReconciliationRepository;
  eventNormalizations: EventNormalizationRepository;
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
    lifecycleResolutions: new LifecycleResolutionRepository(database),
    workspaces: new WorkspaceRepository(database),
    conversations: new AgentConversationRepository(database),
    taskRuns: new TaskRunRepository(database),
    events: new EventRepository(database),
    gitBaselines: new GitBaselineRepository(database),
    gitReconciliations: new GitReconciliationRepository(database),
    eventNormalizations: new EventNormalizationRepository(database),
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
  ArtifactStorageVersion,
  RunArtifactReference,
} from "./repositories/artifacts.js";
export type {
  AgentConversation,
  AgentConversationStatus,
  NewAgentConversation,
} from "./repositories/conversations.js";
export { AGENT_CONVERSATION_STATUSES } from "./repositories/conversations.js";
export type {
  EventNormalizationDiagnosticCode,
  EventNormalizationOutcome,
  NewReceiptEventNormalization,
  ReceiptEventNormalization,
} from "./repositories/event-normalizations.js";
export {
  EVENT_NORMALIZATION_DIAGNOSTIC_CODES,
  EVENT_NORMALIZATION_OUTCOMES,
} from "./repositories/event-normalizations.js";
export type { EventDeduplicationRecord } from "./repositories/events.js";
export type {
  GitBaseline,
  GitBaselineDiagnosticCode,
  GitBaselineEntryHashStatus,
  GitBaselineEntryKind,
  GitBaselineEntrySensitivity,
  GitBaselineOutcome,
  GitBaselineUntrackedEntry,
  NewGitBaseline,
  NewGitBaselineUntrackedEntry,
} from "./repositories/git-baselines.js";
export {
  GIT_BASELINE_DIAGNOSTIC_CODES,
  GIT_BASELINE_ENTRY_HASH_STATUSES,
  GIT_BASELINE_ENTRY_KINDS,
  GIT_BASELINE_ENTRY_SENSITIVITIES,
  GIT_BASELINE_OUTCOMES,
} from "./repositories/git-baselines.js";
export type {
  GitBaselineComparison,
  GitReconciliation,
  GitReconciliationAttribution,
  GitReconciliationBoundary,
  GitReconciliationChangeKind,
  GitReconciliationDiagnosticCode,
  GitReconciliationEntry,
  GitReconciliationOutcome,
  NewGitReconciliation,
  NewGitReconciliationEntry,
} from "./repositories/git-reconciliations.js";
export {
  GIT_BASELINE_COMPARISONS,
  GIT_RECONCILIATION_ATTRIBUTIONS,
  GIT_RECONCILIATION_BOUNDARIES,
  GIT_RECONCILIATION_CHANGE_KINDS,
  GIT_RECONCILIATION_DIAGNOSTIC_CODES,
  GIT_RECONCILIATION_OUTCOMES,
} from "./repositories/git-reconciliations.js";
export type {
  IngressReceipt,
  IngressReceiptStatus,
  LegacyIngressReceipt,
  NewPreparedIngressReceipt,
  PreparedIngressInsertResult,
  PreparedIngressReceiptRecord,
} from "./repositories/ingress-receipts.js";
export {
  INGRESS_RECEIPT_STATUSES,
  MAX_PENDING_RECEIPT_BATCH,
} from "./repositories/ingress-receipts.js";
export type {
  LifecycleDiagnosticCode,
  LifecycleResolutionAction,
  LifecycleResolutionOutcome,
  NewReceiptLifecycleResolution,
  ReceiptLifecycleResolution,
} from "./repositories/lifecycle-resolutions.js";
export {
  LIFECYCLE_DIAGNOSTIC_CODES,
  LIFECYCLE_RESOLUTION_ACTIONS,
  LIFECYCLE_RESOLUTION_OUTCOMES,
} from "./repositories/lifecycle-resolutions.js";
export type {
  AnalysisJobRecord,
  EvidenceGapRecord,
} from "./repositories/run-support.js";
export type {
  NewTaskRun,
  StaleTaskRun,
  TaskRun,
  TaskRunStatus,
} from "./repositories/task-runs.js";
export { TASK_RUN_STATUSES } from "./repositories/task-runs.js";
export type {
  NewWorkspace,
  Workspace,
  WorkspaceIdentityBasis,
} from "./repositories/workspaces.js";
export { WORKSPACE_IDENTITY_BASES } from "./repositories/workspaces.js";
