import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NORMALIZED_EVENT_SCHEMA_VERSION,
  type NormalizedEventEnvelope,
  NormalizedEventEnvelopeSchema,
} from "@ownloop/event-model";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLocalArtifactStore, type LocalArtifactStore } from "../artifact-store/index.js";
import {
  CANDIDATE_VALIDATION_REPORT_ROLE,
  getCandidateValidation,
  getRunCandidateValidations,
  validateCandidateGeneration,
  validateEligibleCandidateGenerations,
} from "../candidate-validation/index.js";
import { classifyFinalizedRunChanges } from "../change-classification/index.js";
import { buildFinalizedRunEvidenceGraph } from "../evidence-graph/index.js";
import { finalizeRun } from "../finalization/index.js";
import {
  openPersistence,
  type OwnLoopPersistence,
  PersistenceError,
} from "../persistence/index.js";
import { extractFinalizedRunVerificationEvidence } from "../verification-extraction/index.js";
import { prepareFinalizedRunSemanticAnalysisInput } from "../semantic-input/index.js";
import {
  CANDIDATE_GENERATION_ARTIFACT_ROLE_PREFIX,
  type CandidateGenerationDependencies,
  type CandidateGenerationTransport,
  generateEligibleFinalizedRunCandidateBatches,
  generateFinalizedRunCandidateBatch,
  getCandidateGeneration,
  getRunCandidateGenerations,
} from "../candidate-generation/index.js";
import { TEST_API_KEY, TEST_PROVIDER } from "../candidate-generation/test-fixture.js";
import { CANDIDATE_MOMENT_SCHEMA_VERSION } from "@ownloop/contracts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "c".repeat(40);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

type RunSpec = Readonly<{
  suffix: string;
  runNumber: number;
  startedAt: string;
  commandAt: string;
  stoppedAt: string;
  finalizedAt: string;
}>;

const RUN_A: RunSpec = {
  suffix: "a",
  runNumber: 1,
  startedAt: "2026-07-24T10:00:00.000Z",
  commandAt: "2026-07-24T10:00:30.000Z",
  stoppedAt: "2026-07-24T10:01:00.000Z",
  finalizedAt: "2026-07-24T10:02:00.000Z",
};
const RUN_B: RunSpec = {
  suffix: "b",
  runNumber: 2,
  startedAt: "2026-07-24T10:03:00.000Z",
  commandAt: "2026-07-24T10:03:30.000Z",
  stoppedAt: "2026-07-24T10:04:00.000Z",
  finalizedAt: "2026-07-24T10:05:00.000Z",
};

function ids(spec: RunSpec) {
  return {
    workspaceId: `workspace-${spec.suffix}`,
    conversationId: `conversation-${spec.suffix}`,
    runId: `run-${spec.suffix}`,
    baselineId: `baseline-${spec.suffix}`,
    reconciliationId: `reconciliation-${spec.suffix}`,
    baselineEventId: `baseline-event-${spec.suffix}`,
    commandEventId: `command-event-${spec.suffix}`,
    stopEventId: `stop-event-${spec.suffix}`,
    summaryEventId: `summary-event-${spec.suffix}`,
    fileEventId: `file-event-${spec.suffix}`,
    finalizationId: `finalization-${spec.suffix}`,
  };
}

function event(
  spec: RunSpec,
  input: Readonly<{
    eventId: string;
    sequence: number;
    type: NormalizedEventEnvelope["type"];
    source?: NormalizedEventEnvelope["source"];
    sourceEventName?: string | null;
    occurredAt?: string;
    payload?: NormalizedEventEnvelope["payload"];
  }>,
): NormalizedEventEnvelope {
  const value = ids(spec);
  return NormalizedEventEnvelopeSchema.parse({
    eventId: input.eventId,
    schemaVersion: NORMALIZED_EVENT_SCHEMA_VERSION,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    runId: value.runId,
    sequence: input.sequence,
    type: input.type,
    source: input.source ?? "ownloop",
    sourceEventName: input.sourceEventName ?? null,
    sourceEventId: null,
    occurredAt: input.occurredAt ?? spec.startedAt,
    ingestedAt: input.occurredAt ?? spec.startedAt,
    sensitivity: "normal",
    payload: input.payload ?? {},
    metadata: { collectorVersion: "0.1.0", sourceVersion: null },
  });
}

function seedFinalizingRun(persistence: OwnLoopPersistence, spec: RunSpec): void {
  const value = ids(spec);
  const repositoryRoot = `/workspace/project-${spec.suffix}`;
  persistence.workspaces.insert({
    workspaceId: value.workspaceId,
    canonicalPath: repositoryRoot,
    repositoryRoot,
    gitRemote: null,
    initialRepositoryFingerprint: HASH_A,
    identityBasis: "git_resolved_v1",
    createdAt: spec.startedAt,
    lastObservedAt: spec.stoppedAt,
  });
  persistence.conversations.insert({
    conversationId: value.conversationId,
    workspaceId: value.workspaceId,
    source: "claude_code",
    sourceSessionId: `session-${spec.suffix}`,
    startMode: "startup",
    startedAt: spec.startedAt,
    lastObservedAt: spec.stoppedAt,
    endedAt: null,
    status: "Active",
  });
  persistence.taskRuns.insert({
    runId: value.runId,
    conversationId: value.conversationId,
    runNumber: spec.runNumber,
    redactedPrompt:
      "Verify package.json behavior and contact owner@example.com without exposing /workspace/private.",
    baselineGitCommit: COMMIT,
    baselineWorkingTreeFingerprint: HASH_A,
    startedAt: spec.startedAt,
    endedAt: null,
    status: "Finalizing",
    finalGitFingerprint: null,
    sourceStopReason: "stop",
    evidenceGapCount: 0,
  });
  const sourceEvents: NormalizedEventEnvelope[] = [
    event(spec, {
      eventId: value.baselineEventId,
      sequence: 1,
      type: "snapshot.baseline_captured",
    }),
    event(spec, {
      eventId: value.commandEventId,
      sequence: 2,
      type: "tool.succeeded",
      source: "claude_code",
      sourceEventName: "PostToolUse",
      occurredAt: spec.commandAt,
      payload: {
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: {
          exitCode: 0,
          stdout: "PASS /home/alice/project bearer secret-token owner@example.com",
        },
      },
    }),
    event(spec, {
      eventId: value.stopEventId,
      sequence: 3,
      type: "run.stop_observed",
      source: "claude_code",
      sourceEventName: "Stop",
      occurredAt: spec.stoppedAt,
    }),
    event(spec, {
      eventId: value.summaryEventId,
      sequence: 4,
      type: "git.diff_computed",
      occurredAt: spec.stoppedAt,
    }),
    event(spec, {
      eventId: value.fileEventId,
      sequence: 5,
      type: "file.change_observed",
      occurredAt: spec.stoppedAt,
    }),
  ];
  for (const sourceEvent of sourceEvents) persistence.events.append(sourceEvent);
  persistence.gitBaselines.insert({
    baselineId: value.baselineId,
    runId: value.runId,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    baselineEventId: value.baselineEventId,
    outcome: "captured",
    diagnosticCode: null,
    repositoryRoot,
    headCommit: COMMIT,
    stagedDiffSha256: HASH_A,
    unstagedDiffSha256: HASH_A,
    statusBeforeSha256: HASH_A,
    statusAfterSha256: HASH_A,
    workingTreeFingerprint: HASH_A,
    stagedDirty: false,
    unstagedDirty: false,
    untrackedCount: 0,
    untrackedHashedCount: 0,
    untrackedOmittedCount: 0,
    capturedAt: spec.startedAt,
    captureDelayMs: 0,
  });
  persistence.gitReconciliations.insert({
    reconciliationId: value.reconciliationId,
    runId: value.runId,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    baselineId: value.baselineId,
    triggerEventId: value.stopEventId,
    summaryEventId: value.summaryEventId,
    boundary: "stop",
    outcome: "captured",
    diagnosticCode: null,
    attribution: "run_relative",
    baselineComparison: "changed",
    repositoryRoot,
    headCommit: COMMIT,
    stagedDiffSha256: HASH_B,
    unstagedDiffSha256: HASH_B,
    statusBeforeSha256: HASH_B,
    statusAfterSha256: HASH_B,
    workingTreeFingerprint: HASH_B,
    stagedDirty: true,
    unstagedDirty: false,
    entryCount: 1,
    createdCount: 0,
    modifiedCount: 1,
    deletedCount: 0,
    typeChangedCount: 0,
    unmergedCount: 0,
    capturedAt: spec.stoppedAt,
  });
  persistence.gitReconciliations.insertEntry({
    reconciliationId: value.reconciliationId,
    entryIndex: 0,
    fileEventId: value.fileEventId,
    pathIdentitySha256: createHash("sha256").update(`path-${spec.suffix}`).digest("hex"),
    relativePath: `src/example-${spec.suffix}.test.ts`,
    changeKind: "modified",
    staged: true,
    unstaged: false,
    sensitivity: "normal",
    attribution: "run_relative",
  });
}

type IntegrationContext = Readonly<{
  directory: string;
  artifactRoot: string;
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
}>;

async function createContext(
  specs: readonly RunSpec[],
  databasePath: string = ":memory:",
): Promise<IntegrationContext> {
  const directory = await temporaryDirectory("ownloop-candidate-generation-integration-");
  const artifactRoot = join(directory, "artifacts");
  const persistence = openPersistence(databasePath);
  for (const spec of specs) seedFinalizingRun(persistence, spec);
  let artifactIndex = 0;
  const artifactStore = await createLocalArtifactStore({
    artifactRoot,
    persistence,
    clock: () => new Date("2026-07-24T10:10:00.000Z"),
    artifactIdGenerator: () => `integration-artifact-${artifactIndex++}`,
  });
  return { directory, artifactRoot, persistence, artifactStore };
}

function dependencies(context: Pick<IntegrationContext, "persistence" | "artifactStore">) {
  return { persistence: context.persistence, artifactStore: context.artifactStore };
}

async function preparePrerequisites(context: IntegrationContext, spec: RunSpec): Promise<void> {
  const value = ids(spec);
  const finalEventIds = [`snapshot-event-${spec.suffix}`, `terminal-event-${spec.suffix}`];
  await finalizeRun(
    {
      persistence: context.persistence,
      artifactStore: context.artifactStore,
      clock: () => new Date(spec.finalizedAt),
      finalizationIdGenerator: () => value.finalizationId,
      eventIdGenerator: () => finalEventIds.shift() ?? `extra-final-${spec.suffix}`,
      evidenceGapIdGenerator: () => `gap-${spec.suffix}`,
    },
    value.runId,
  );
  await classifyFinalizedRunChanges(dependencies(context), value.runId);
  await extractFinalizedRunVerificationEvidence(
    {
      ...dependencies(context),
      clock: () => new Date(spec.finalizedAt),
    },
    value.runId,
  );
  await buildFinalizedRunEvidenceGraph(dependencies(context), value.runId);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

async function prepareCandidatePrerequisites(
  context: IntegrationContext,
  spec: RunSpec,
): Promise<void> {
  await preparePrerequisites(context, spec);
  const semantic = await prepareFinalizedRunSemanticAnalysisInput(
    dependencies(context),
    ids(spec).runId,
    { enabled: true },
  );
  expect(semantic.artifactId).toEqual(expect.any(String));
}

function generationDependencies(
  context: Pick<IntegrationContext, "persistence" | "artifactStore">,
  transport: CandidateGenerationTransport,
  generationIdGenerator: () => string,
): CandidateGenerationDependencies {
  return {
    persistence: context.persistence,
    artifactStore: context.artifactStore,
    transport,
    generationIdGenerator,
    clock: () => new Date("2026-07-24T10:20:00.000Z"),
    sleep: async () => {},
  };
}

function sequentialGenerationIds(): () => string {
  let index = 1;
  return () => `gen_${(index++).toString(16).padStart(48, "0")}`;
}

function validationTransport(requests: Array<Parameters<CandidateGenerationTransport>[0]>) {
  return vi.fn<CandidateGenerationTransport>(async (request) => {
    requests.push(request);
    const providerRequest = JSON.parse(decoder.decode(request.body)) as { input: string };
    const semanticInput = JSON.parse(providerRequest.input) as {
      evidenceSummaries: Array<{ kind: string; evidenceId: string }>;
    };
    const evidenceId = semanticInput.evidenceSummaries.find(
      (summary) => summary.kind === "changed_file",
    )?.evidenceId;
    if (evidenceId === undefined) throw new Error("Changed-file Evidence is missing.");
    const candidateBatch = {
      schemaVersion: CANDIDATE_MOMENT_SCHEMA_VERSION,
      candidates: [
        {
          type: "change",
          title: "File modified",
          claim: "File modified",
          importance: "high",
          confidenceBasisPoints: 8_000,
          evidenceIds: [evidenceId],
          suggestedInteraction: { kind: "acknowledge" },
        },
      ],
    };
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-request-id": "resp_validation_integration_1",
      },
      body: encoder.encode(
        JSON.stringify({
          id: "resp_validation_integration_1",
          status: "completed",
          output: [{ content: [{ type: "output_text", text: JSON.stringify(candidateBatch) }] }],
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
      ),
    };
  });
}

async function generateForValidation(
  context: IntegrationContext,
  spec: RunSpec,
  generator: () => string,
) {
  await prepareCandidatePrerequisites(context, spec);
  const transport = validationTransport([]);
  const deps = generationDependencies(context, transport, generator);
  const result = await generateFinalizedRunCandidateBatch(deps, ids(spec).runId, {
    enabled: true,
    provider: TEST_PROVIDER,
  });
  if (result.generationId === null) throw new Error("Generation ID is missing.");
  return { result, deps, transport };
}

describe("Candidate validation processor integration", () => {
  it("persists once under concurrency, keeps text out of SQLite, and survives restart", async () => {
    const directory = await temporaryDirectory("ownloop-candidate-validation-restart-");
    const databasePath = join(directory, "ownloop.sqlite");
    const context = await createContext([RUN_A], databasePath);
    const generated = await generateForValidation(context, RUN_A, sequentialGenerationIds());
    const [first, second] = await Promise.all([
      validateCandidateGeneration(generated.deps, generated.result.generationId!),
      validateCandidateGeneration(generated.deps, generated.result.generationId!),
    ]);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      runId: ids(RUN_A).runId,
      outcome: "partial",
      diagnosticCode: "source_graph_partial",
      limitations: ["source_graph_partial"],
      counts: { source: 1, rejected: 0, selected: 1 },
      reportArtifactId: expect.any(String),
      selectedSourceIndexes: [0],
    });
    if (first === null || first.validationId === null || first.reportArtifactId === null) {
      throw new Error("Validation identifiers are missing.");
    }
    expect(context.persistence.candidateValidations.listForRun(ids(RUN_A).runId)).toHaveLength(1);
    expect(
      context.persistence.artifacts
        .listForRun(ids(RUN_A).runId)
        .filter((reference) => reference.role === CANDIDATE_VALIDATION_REPORT_ROLE),
    ).toHaveLength(1);
    const report = await context.artifactStore.readPreparedBytes(first.reportArtifactId);
    expect(decoder.decode(report.bytes)).not.toContain("File modified");
    context.persistence.close();
    const databaseBytes = await readFile(databasePath);
    expect(databaseBytes.includes(Buffer.from(TEST_API_KEY))).toBe(false);
    expect(databaseBytes.includes(Buffer.from("File modified"))).toBe(false);

    const persistence = openPersistence(databasePath);
    const artifactStore = await createLocalArtifactStore({
      artifactRoot: context.artifactRoot,
      persistence,
    });
    try {
      const restartedDeps = generationDependencies(
        persistenceAndStore(persistence, artifactStore),
        validationTransport([]),
        sequentialGenerationIds(),
      );
      expect(await getCandidateValidation(restartedDeps, first.validationId)).toEqual(first);
    } finally {
      persistence.close();
    }
  });

  it("rejects validation report bytes that fail OL-010 integrity", async () => {
    const context = await createContext([RUN_A]);
    try {
      const generated = await generateForValidation(context, RUN_A, sequentialGenerationIds());
      const validated = await validateCandidateGeneration(
        generated.deps,
        generated.result.generationId!,
      );
      if (
        validated === null ||
        validated.validationId === null ||
        validated.reportArtifactId === null
      ) {
        throw new Error("Validation identifiers are missing.");
      }
      const metadata = context.persistence.artifacts.getMetadata(validated.reportArtifactId);
      if (metadata === null) throw new Error("Validation metadata is missing.");
      await writeFile(
        join(context.artifactRoot, metadata.storagePath),
        "tampered validation bytes",
      );
      await expect(
        getCandidateValidation(generated.deps, validated.validationId),
      ).rejects.toThrow();
    } finally {
      context.persistence.close();
    }
  });

  it("reads its exact report reference beyond 1000 unrelated references", async () => {
    const context = await createContext([RUN_A]);
    try {
      const generated = await generateForValidation(context, RUN_A, sequentialGenerationIds());
      const validated = await validateCandidateGeneration(
        generated.deps,
        generated.result.generationId!,
      );
      if (validated === null || validated.validationId === null) {
        throw new Error("Validation ID is missing.");
      }
      for (let index = 0; index < 1001; index += 1) {
        const digestHex = createHash("sha256")
          .update(`validation-unrelated-${index}`)
          .digest("hex");
        const artifactId = `validation-unrelated-${index}`;
        context.persistence.artifacts.insertMetadata({
          artifactId,
          digest: `sha256:${digestHex}`,
          storagePath: `objects/sha256/${digestHex.slice(0, 2)}/${digestHex.slice(2)}`,
          sizeBytes: 1,
          kind: "unrelated-artifact",
          sensitivity: "normal",
          storageVersion: 1,
          mediaType: "application/octet-stream",
          createdAt: RUN_A.finalizedAt,
        });
        context.persistence.artifacts.linkToRun({
          runId: ids(RUN_A).runId,
          artifactId,
          role: "unrelated-artifact",
          createdAt: RUN_A.finalizedAt,
        });
      }
      expect(await getCandidateValidation(generated.deps, validated.validationId)).toEqual(
        validated,
      );
    } finally {
      context.persistence.close();
    }
  });

  it("leaves a failed validation report object eligible for garbage collection", async () => {
    const context = await createContext([RUN_A]);
    try {
      const generated = await generateForValidation(context, RUN_A, sequentialGenerationIds());
      const failingPersistence = new Proxy(context.persistence, {
        get(target, property, receiver) {
          if (property === "withTransaction") {
            return () => {
              throw new PersistenceError(
                "operation_failed",
                "forced validation transaction failure",
              );
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as OwnLoopPersistence;
      const deps = generationDependencies(
        { persistence: failingPersistence, artifactStore: context.artifactStore },
        generated.transport,
        sequentialGenerationIds(),
      );
      await expect(
        validateCandidateGeneration(deps, generated.result.generationId!),
      ).rejects.toMatchObject({ code: "operation_failed" });
      expect(context.persistence.candidateValidations.listForRun(ids(RUN_A).runId)).toEqual([]);
      expect(
        context.persistence.artifacts
          .listForRun(ids(RUN_A).runId)
          .filter((reference) => reference.role === CANDIDATE_VALIDATION_REPORT_ROLE),
      ).toEqual([]);
      expect(await context.artifactStore.collectUnreferencedArtifacts()).toMatchObject({
        metadataDeleted: 1,
        objectsDeleted: 1,
      });
    } finally {
      context.persistence.close();
    }
  });

  it("validates a bounded batch in generation order and remains idempotent", async () => {
    const context = await createContext([RUN_B, RUN_A]);
    try {
      const generator = sequentialGenerationIds();
      const firstGenerated = await generateForValidation(context, RUN_A, generator);
      await generateForValidation(context, RUN_B, generator);
      expect(await validateEligibleCandidateGenerations(firstGenerated.deps, 0)).toEqual([]);
      const first = await validateEligibleCandidateGenerations(firstGenerated.deps, 10);
      expect(first.map((result) => result.runId)).toEqual([ids(RUN_A).runId, ids(RUN_B).runId]);
      expect(await validateEligibleCandidateGenerations(firstGenerated.deps, 10)).toEqual([]);
      expect(await getRunCandidateValidations(firstGenerated.deps, ids(RUN_A).runId)).toHaveLength(
        1,
      );
      expect(await getRunCandidateValidations(firstGenerated.deps, ids(RUN_B).runId)).toHaveLength(
        1,
      );
    } finally {
      context.persistence.close();
    }
  });
});

function persistenceAndStore(
  persistence: OwnLoopPersistence,
  artifactStore: LocalArtifactStore,
): Pick<IntegrationContext, "persistence" | "artifactStore"> {
  return { persistence, artifactStore };
}
