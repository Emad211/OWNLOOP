import { createHash } from "node:crypto";

import {
  type CANDIDATE_VALIDATION_REASONS,
  DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES,
  DIAGNOSTICS_BUNDLE_MAX_BYTES,
  DIAGNOSTICS_BUNDLE_SCHEMA_VERSION,
  DIAGNOSTICS_DASHBOARD_MAX_BYTES,
  DIAGNOSTICS_DASHBOARD_MAX_RECENT_RUNS,
  DIAGNOSTICS_DASHBOARD_PROJECTOR_VERSION,
  DIAGNOSTICS_DASHBOARD_SCHEMA_VERSION,
  DIAGNOSTICS_RUN_LIMITATIONS,
  type DiagnosticsBundleV1,
  DiagnosticsBundleV1Schema,
  type DiagnosticsDashboardV1,
  DiagnosticsDashboardV1Schema,
  type DiagnosticsProcessSnapshotV1,
  type DiagnosticsRunQualityV1,
  type LocalDiagnosticMode,
} from "@ownloop/contracts";
import { canonicalizeJson } from "@ownloop/ingress-security";

import {
  readValidatedCandidateValidation,
  type CandidateValidationDependencies,
} from "../candidate-validation/index.js";
import type { LocalArtifactStore } from "../artifact-store/index.js";
import type { LocalSettingsService } from "../local-settings/index.js";
import { PersistenceError, type OwnLoopPersistence } from "../persistence/index.js";
import { DIAGNOSTICS_APPLICATION_VERSIONS } from "./constants.js";

const ZERO_FINGERPRINT = `sha256:${"0".repeat(64)}`;
const DASHBOARD_LIMITS = Object.freeze({
  maxUtf8Bytes: DIAGNOSTICS_DASHBOARD_MAX_BYTES,
  maxDepth: 64,
  maxObjectProperties: 1024,
  maxArrayItems: 100_000,
});
const BUNDLE_LIMITS = Object.freeze({
  maxUtf8Bytes: DIAGNOSTICS_BUNDLE_MAX_BYTES,
  maxDepth: 72,
  maxObjectProperties: 2048,
  maxArrayItems: 100_000,
});

export type DiagnosticsValidationReader = (
  dependencies: DiagnosticsDashboardDependencies,
  validationId: string,
) => ReturnType<typeof readValidatedCandidateValidation>;

export type DiagnosticsDashboardDependencies = Readonly<{
  persistence: OwnLoopPersistence;
  artifactStore: Pick<LocalArtifactStore, "readPreparedBytes">;
  settings: Pick<LocalSettingsService, "diagnosticsDashboardState">;
  readValidation?: DiagnosticsValidationReader;
}>;

function fail(message: string): never {
  throw new PersistenceError("invalid_persisted_row", message);
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedCounts(map: ReadonlyMap<string, number>) {
  return [...map]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => ({ code, count }));
}

function dashboardFingerprint(value: Omit<DiagnosticsDashboardV1, "fingerprint">): string {
  const canonical = canonicalizeJson({ ...value, fingerprint: ZERO_FINGERPRINT }, DASHBOARD_LIMITS);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function bundleFingerprint(value: Omit<DiagnosticsBundleV1, "fingerprint">): string {
  const canonical = canonicalizeJson({ ...value, fingerprint: ZERO_FINGERPRINT }, BUNDLE_LIMITS);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function processState(
  input: Readonly<{
    mode: LocalDiagnosticMode;
    process: DiagnosticsProcessSnapshotV1 | null;
  }>,
): Readonly<{
  limitations: DiagnosticsDashboardV1["limitations"];
  process: DiagnosticsProcessSnapshotV1 | null;
}> {
  if (input.mode === "off") {
    if (input.process !== null) fail("Disabled diagnostics unexpectedly contain process counters.");
    return { limitations: ["diagnostics_off"], process: null };
  }
  if (input.process === null) fail("Enabled diagnostics are missing process counters.");
  return { limitations: ["process_counters_reset_on_restart"], process: input.process };
}

function validationCounts(
  report: NonNullable<Awaited<ReturnType<typeof readValidatedCandidateValidation>>>,
) {
  const reasonCounts = new Map<string, number>();
  for (const item of report.report.value.items) {
    for (const reason of item.reasons) increment(reasonCounts, reason);
  }
  const counts = report.report.value.counts;
  return {
    validationId: report.record.validationId,
    outcome: report.record.outcome,
    sourceCandidates: counts.source,
    rejectedCandidates: counts.rejected,
    duplicateCandidates: counts.duplicate,
    unselectedCandidates: counts.unselected - counts.duplicate,
    selectedCandidates: counts.selected,
    reasonCounts: sortedCounts(reasonCounts).map((item) => ({
      code: item.code as (typeof CANDIDATE_VALIDATION_REASONS)[number],
      count: item.count,
    })),
  } as const;
}

export async function projectDiagnosticsDashboard(
  dependencies: DiagnosticsDashboardDependencies,
): Promise<DiagnosticsDashboardV1> {
  const settingsState = dependencies.settings.diagnosticsDashboardState();
  const diagnosticState = processState(settingsState);
  const redaction = dependencies.persistence.diagnostics.readRedactionAggregates();
  const totalRuns = dependencies.persistence.diagnostics.countRuns();
  const byStatus = dependencies.persistence.diagnostics.countRunsByStatus();
  const recentIndex = dependencies.persistence.diagnostics.listRecentRuns(
    DIAGNOSTICS_DASHBOARD_MAX_RECENT_RUNS,
  );

  const finalizationRows = dependencies.persistence.diagnostics.listFinalizations();
  const finalizationsByRun = new Map<string, (typeof finalizationRows)[number]>();
  const finalizationStatusCounts = new Map<string, number>();
  const finalizationModeCounts = new Map<string, number>();
  const finalizationDiagnosticCounts = new Map<string, number>();
  let withoutDiagnosticCode = 0;
  for (const row of finalizationRows) {
    if (finalizationsByRun.has(row.runId)) fail("A Run has multiple finalization rows.");
    const validated = dependencies.persistence.runFinalizations.getByRun(row.runId);
    if (
      validated === null ||
      validated.terminalStatus !== row.terminalStatus ||
      validated.mode !== row.mode ||
      validated.diagnosticCode !== row.diagnosticCode ||
      validated.finalizedAt !== row.finalizedAt
    ) {
      fail("Finalization diagnostics differ from validated finalization read-back.");
    }
    finalizationsByRun.set(row.runId, row);
    increment(finalizationStatusCounts, row.terminalStatus);
    increment(finalizationModeCounts, row.mode);
    if (row.diagnosticCode === null) withoutDiagnosticCode += 1;
    else increment(finalizationDiagnosticCounts, row.diagnosticCode);
  }

  const gapCounts = new Map<string, number>();
  for (const code of dependencies.persistence.diagnostics.listEvidenceGapCodes()) {
    increment(gapCounts, code);
  }

  const validationIds = dependencies.persistence.diagnostics.listLatestCurrentValidationIds();
  const validationReader =
    dependencies.readValidation ??
    ((input: DiagnosticsDashboardDependencies, validationId: string) =>
      readValidatedCandidateValidation(
        input as unknown as CandidateValidationDependencies,
        validationId,
      ));
  const validationsByRun = new Map<string, ReturnType<typeof validationCounts>>();
  const validationOutcomeCounts = new Map<string, number>();
  const globalReasonCounts = new Map<string, number>();
  let sourceCandidates = 0;
  let rejectedCandidates = 0;
  let duplicateCandidates = 0;
  let unselectedCandidates = 0;
  let selectedCandidates = 0;
  for (const validationId of validationIds) {
    const validated = await validationReader(dependencies, validationId);
    if (validated === null) fail("A current validation disappeared during diagnostics projection.");
    if (validationsByRun.has(validated.record.runId)) {
      fail("A Run has multiple current-policy validations in diagnostics projection.");
    }
    const counts = validationCounts(validated);
    validationsByRun.set(validated.record.runId, counts);
    increment(validationOutcomeCounts, counts.outcome);
    sourceCandidates += counts.sourceCandidates;
    rejectedCandidates += counts.rejectedCandidates;
    duplicateCandidates += counts.duplicateCandidates;
    unselectedCandidates += counts.unselectedCandidates;
    selectedCandidates += counts.selectedCandidates;
    for (const reason of counts.reasonCounts)
      increment(globalReasonCounts, reason.code, reason.count);
  }

  const recentRuns: DiagnosticsRunQualityV1[] = recentIndex.map((run) => {
    const finalization = finalizationsByRun.get(run.runId) ?? null;
    const validation = validationsByRun.get(run.runId) ?? null;
    const active = run.status === "Capturing" || run.status === "Finalizing";
    if (active && (finalization !== null || validation !== null)) {
      fail("An active Run contains terminal diagnostics output.");
    }
    const limitations = DIAGNOSTICS_RUN_LIMITATIONS.filter(
      (item) =>
        (item === "active_run" && active) ||
        (item === "no_finalization" && finalization === null) ||
        (item === "no_current_validation" && validation === null),
    );
    return {
      runId: run.runId,
      runNumber: run.runNumber,
      status: run.status as DiagnosticsRunQualityV1["status"],
      endedAt: run.endedAt,
      evidenceGapCount: run.evidenceGapCount,
      finalization:
        finalization === null
          ? null
          : {
              terminalStatus: finalization.terminalStatus as NonNullable<
                DiagnosticsRunQualityV1["finalization"]
              >["terminalStatus"],
              mode: finalization.mode as NonNullable<
                DiagnosticsRunQualityV1["finalization"]
              >["mode"],
              diagnosticCode: finalization.diagnosticCode,
              finalizedAt: finalization.finalizedAt,
            },
      validation,
      limitations,
    };
  });

  const withoutFingerprint: Omit<DiagnosticsDashboardV1, "fingerprint"> = {
    schemaVersion: DIAGNOSTICS_DASHBOARD_SCHEMA_VERSION,
    projectorVersion: DIAGNOSTICS_DASHBOARD_PROJECTOR_VERSION,
    diagnosticMode: settingsState.mode,
    limitations: diagnosticState.limitations,
    process: diagnosticState.process,
    redaction,
    runs: {
      totalRuns,
      byStatus: byStatus.map((item) => ({
        status: item.status as DiagnosticsDashboardV1["runs"]["byStatus"][number]["status"],
        count: item.count,
      })),
    },
    finalizations: {
      total: finalizationRows.length,
      byStatus: sortedCounts(
        finalizationStatusCounts,
      ) as DiagnosticsDashboardV1["finalizations"]["byStatus"],
      byMode: sortedCounts(
        finalizationModeCounts,
      ) as DiagnosticsDashboardV1["finalizations"]["byMode"],
      byDiagnosticCode: sortedCounts(finalizationDiagnosticCounts),
      withoutDiagnosticCode,
    },
    evidenceGapCounts: sortedCounts(gapCounts),
    validations: {
      totalValidations: validationIds.length,
      byOutcome: sortedCounts(
        validationOutcomeCounts,
      ) as DiagnosticsDashboardV1["validations"]["byOutcome"],
      sourceCandidates,
      rejectedCandidates,
      duplicateCandidates,
      unselectedCandidates,
      selectedCandidates,
      reasonCounts: sortedCounts(globalReasonCounts).map((item) => ({
        code: item.code as (typeof CANDIDATE_VALIDATION_REASONS)[number],
        count: item.count,
      })),
    },
    recentRuns,
    recentRunsTotal: totalRuns,
    recentRunsTruncated: totalRuns > recentRuns.length,
  };

  const dashboard = DiagnosticsDashboardV1Schema.parse({
    ...withoutFingerprint,
    fingerprint: dashboardFingerprint(withoutFingerprint),
  });
  canonicalizeJson(dashboard, DASHBOARD_LIMITS);
  return dashboard;
}

export function prepareDiagnosticsBundle(
  dashboardInput: DiagnosticsDashboardV1,
  clock: () => Date = () => new Date(),
): DiagnosticsBundleV1 {
  const dashboard = DiagnosticsDashboardV1Schema.parse(dashboardInput);
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new PersistenceError("operation_failed", "The diagnostics export clock is invalid.");
  }
  const withoutFingerprint: Omit<DiagnosticsBundleV1, "fingerprint"> = {
    schemaVersion: DIAGNOSTICS_BUNDLE_SCHEMA_VERSION,
    applicationVersions: DIAGNOSTICS_APPLICATION_VERSIONS,
    exportedAt: now.toISOString(),
    dashboardFingerprint: dashboard.fingerprint,
    dashboard,
    excludedDataClasses: [...DIAGNOSTICS_BUNDLE_EXCLUDED_DATA_CLASSES],
  };
  const bundle = DiagnosticsBundleV1Schema.parse({
    ...withoutFingerprint,
    fingerprint: bundleFingerprint(withoutFingerprint),
  });
  canonicalizeJson(bundle, BUNDLE_LIMITS);
  return bundle;
}
