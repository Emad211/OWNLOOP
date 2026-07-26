import {
  LOCAL_SETTINGS_RETENTION_APPLY_LIMIT,
  LOCAL_SETTINGS_RETENTION_PREVIEW_LIMIT,
  type LocalArtifactGcSummaryV1,
  type LocalProviderSecretResponseV1,
  type LocalRetentionApplyResultV1,
  type LocalRetentionPolicy,
  type LocalRetentionPreviewV1,
  type LocalRunDeletionResultV1,
  type LocalSettingsResponseV1,
  type LocalSettingsUpdateRequestV1,
  LocalSettingsUpdateRequestV1Schema,
} from "@ownloop/contracts";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  candidateGenerationProviderPublicConfig,
  type CandidateGenerationOptions,
  validateCandidateGenerationApiKey,
} from "../candidate-generation/index.js";
import type { IngressDiagnosticSink } from "../ingress/diagnostics.js";
import type { OwnLoopPersistence } from "../persistence/index.js";
import { LocalDiagnosticCounters } from "./diagnostics.js";
import { LocalSettingsServiceError } from "./errors.js";

const terminalStatuses = new Set(["Completed", "Partial", "Abandoned", "Failed"]);

function timestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new LocalSettingsServiceError("operation_failed");
  }
  return value.toISOString();
}

function providerIdentity(value: LocalSettingsResponseV1["settings"]["provider"]): string {
  return value === null ? "null" : JSON.stringify(value);
}

function cutoffFor(policy: LocalRetentionPolicy, now: Date): string | null {
  const days =
    policy === "delete_terminal_after_7_days"
      ? 7
      : policy === "delete_terminal_after_30_days"
        ? 30
        : policy === "delete_terminal_after_90_days"
          ? 90
          : null;
  return days === null ? null : new Date(now.getTime() - days * 86_400_000).toISOString();
}

function gcSummary(
  input: Awaited<ReturnType<LocalArtifactStore["collectUnreferencedArtifacts"]>>,
): LocalArtifactGcSummaryV1 {
  return {
    scanned: input.candidates,
    deleted: input.metadataDeleted,
    retained: input.skippedReferenced,
    failures: 0,
  };
}

function noGc(): LocalArtifactGcSummaryV1 {
  return { scanned: 0, deleted: 0, retained: 0, failures: 0 };
}

export type LocalSettingsServiceDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: LocalArtifactStore;
  clock?: () => Date;
}>;

export class LocalSettingsService {
  readonly #persistence: OwnLoopPersistence;
  readonly #artifactStore: LocalArtifactStore;
  readonly #clock: () => Date;
  readonly #diagnostics: LocalDiagnosticCounters;
  #apiKey: string | null = null;

  constructor(dependencies: LocalSettingsServiceDependencies) {
    this.#persistence = dependencies.persistence;
    this.#artifactStore = dependencies.artifactStore;
    this.#clock = dependencies.clock ?? (() => new Date());
    this.#diagnostics = new LocalDiagnosticCounters(
      this.#persistence.localSettings.get().diagnosticMode,
    );
  }

  get diagnosticsSink(): IngressDiagnosticSink {
    return this.#diagnostics.sink;
  }

  getCustomSecretFieldPatterns(): readonly string[] {
    return this.#persistence.localSettings.get().customSecretFieldPatterns;
  }

  getResponse(): LocalSettingsResponseV1 {
    const settings = this.#persistence.localSettings.get();
    const loaded = this.#apiKey !== null;
    return {
      ok: true,
      schemaVersion: 1,
      settings,
      providerSecretStatus: loaded ? "loaded" : "absent",
      providerGenerationConfigured:
        settings.externalAiEnabled && settings.provider !== null && loaded,
    };
  }

  update(input: LocalSettingsUpdateRequestV1): LocalSettingsResponseV1 {
    const request = LocalSettingsUpdateRequestV1Schema.parse(input);
    if (request.replacement.provider !== null) {
      const validated = candidateGenerationProviderPublicConfig({
        ...request.replacement.provider,
        apiKey: "settings-validation-placeholder",
      });
      if (validated.endpoint.baseUrl !== request.replacement.provider.baseUrl) {
        throw new LocalSettingsServiceError("invalid_request");
      }
    }
    const before = this.#persistence.localSettings.get();
    const updated = this.#persistence.withTransaction((repositories) =>
      repositories.localSettings.compareAndSwap(
        request.expectedRevision,
        request.replacement,
        timestamp(this.#clock),
      ),
    );
    if (updated === null) throw new LocalSettingsServiceError("settings_conflict");
    if (
      !updated.externalAiEnabled ||
      updated.provider === null ||
      providerIdentity(before.provider) !== providerIdentity(updated.provider)
    ) {
      this.#apiKey = null;
    }
    this.#diagnostics.setMode(updated.diagnosticMode);
    return this.getResponse();
  }

  loadProviderSecret(value: unknown): LocalProviderSecretResponseV1 {
    const settings = this.#persistence.localSettings.get();
    if (!settings.externalAiEnabled || settings.provider === null) {
      throw new LocalSettingsServiceError("invalid_request");
    }
    try {
      this.#apiKey = validateCandidateGenerationApiKey(value);
    } catch {
      throw new LocalSettingsServiceError("provider_secret_invalid");
    }
    return {
      ok: true,
      schemaVersion: 1,
      providerSecretStatus: "loaded",
      providerGenerationConfigured: true,
    };
  }

  clearProviderSecret(): LocalProviderSecretResponseV1 {
    this.#apiKey = null;
    return {
      ok: true,
      schemaVersion: 1,
      providerSecretStatus: "absent",
      providerGenerationConfigured: false,
    };
  }

  candidateGenerationOptions(): CandidateGenerationOptions {
    const settings = this.#persistence.localSettings.get();
    if (!settings.externalAiEnabled || settings.provider === null || this.#apiKey === null) {
      return { enabled: false };
    }
    return {
      enabled: true,
      provider: { ...settings.provider, apiKey: this.#apiKey },
    };
  }

  diagnostics() {
    return this.#diagnostics.response();
  }

  diagnosticsDashboardState() {
    const settings = this.#persistence.localSettings.get();
    return {
      mode: settings.diagnosticMode,
      process: this.#diagnostics.snapshot(),
    } as const;
  }

  retentionPreview(): LocalRetentionPreviewV1 {
    const settings = this.#persistence.localSettings.get();
    const now = this.#clock();
    const cutoff = cutoffFor(settings.retentionPolicy, now);
    if (cutoff === null) {
      return {
        ok: true,
        schemaVersion: 1,
        policy: settings.retentionPolicy,
        cutoff: null,
        totalEligible: 0,
        truncated: false,
        runs: [],
      };
    }
    const totalEligible = this.#persistence.taskRuns.countTerminalEndedBefore(cutoff);
    const visible = this.#persistence.taskRuns.listTerminalEndedBefore(
      cutoff,
      LOCAL_SETTINGS_RETENTION_PREVIEW_LIMIT,
    );
    return {
      ok: true,
      schemaVersion: 1,
      policy: settings.retentionPolicy,
      cutoff,
      totalEligible,
      truncated: totalEligible > visible.length,
      runs: visible.map((run) => {
        if (run.endedAt === null) throw new LocalSettingsServiceError("operation_failed");
        return {
          runId: run.runId,
          conversationId: run.conversationId,
          runNumber: run.runNumber,
          status: run.status,
          endedAt: run.endedAt,
        };
      }),
    };
  }

  async deleteRun(runId: string): Promise<LocalRunDeletionResultV1> {
    const outcome = this.#persistence.withTransaction((repositories) => {
      const run = repositories.taskRuns.get(runId);
      if (run === null) return "not_found" as const;
      if (!terminalStatuses.has(run.status)) return "active_conflict" as const;
      return repositories.taskRuns.delete(runId) ? ("deleted" as const) : ("not_found" as const);
    });
    if (outcome !== "deleted") {
      return { ok: true, schemaVersion: 1, runId, outcome, artifactGc: noGc() };
    }
    try {
      return {
        ok: true,
        schemaVersion: 1,
        runId,
        outcome,
        artifactGc: gcSummary(await this.#artifactStore.collectUnreferencedArtifacts()),
      };
    } catch {
      return {
        ok: true,
        schemaVersion: 1,
        runId,
        outcome,
        artifactGc: { ...noGc(), failures: 1 },
      };
    }
  }

  async applyRetention(): Promise<LocalRetentionApplyResultV1> {
    const preview = this.retentionPreview();
    if (preview.cutoff === null) {
      return {
        ok: true,
        schemaVersion: 1,
        policy: preview.policy,
        cutoff: null,
        considered: 0,
        deletedRunIds: [],
        retainedRunIds: [],
        artifactGc: noGc(),
      };
    }
    const cutoff = preview.cutoff;
    const candidates = this.#persistence.taskRuns
      .listTerminalEndedBefore(cutoff, LOCAL_SETTINGS_RETENTION_APPLY_LIMIT)
      .slice(0, LOCAL_SETTINGS_RETENTION_APPLY_LIMIT);
    const deletedRunIds: string[] = [];
    const retainedRunIds: string[] = [];
    for (const candidate of candidates) {
      const deleted = this.#persistence.withTransaction((repositories) => {
        const current = repositories.taskRuns.get(candidate.runId);
        return current !== null &&
          terminalStatuses.has(current.status) &&
          current.endedAt !== null &&
          current.endedAt <= cutoff
          ? repositories.taskRuns.delete(current.runId)
          : false;
      });
      (deleted ? deletedRunIds : retainedRunIds).push(candidate.runId);
    }
    let artifactGc = noGc();
    if (deletedRunIds.length > 0) {
      try {
        artifactGc = gcSummary(await this.#artifactStore.collectUnreferencedArtifacts());
      } catch {
        artifactGc = { ...noGc(), failures: 1 };
      }
    }
    return {
      ok: true,
      schemaVersion: 1,
      policy: preview.policy,
      cutoff: preview.cutoff,
      considered: candidates.length,
      deletedRunIds,
      retainedRunIds,
      artifactGc,
    };
  }
}
