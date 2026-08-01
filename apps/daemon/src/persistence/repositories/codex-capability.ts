import type { DatabaseSync } from "node:sqlite";

import {
  CODEX_SOURCE_SURFACES,
  CodexAdapterIngressSchema,
  type CodexSourceSurface,
  CodexSourceSurfaceSchema,
  SUPPORTED_CODEX_HOOK_NAMES,
  type SupportedCodexHookName,
  SupportedCodexHookNameSchema,
} from "@ownloop/contracts/codex";

import { PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString } from "../row-mapping.js";

const MAX_SOURCE_VERSIONS = 16;

export type CodexCapabilityObservationFacts = Readonly<{
  receiptCount: number;
  observedHookNames: readonly SupportedCodexHookName[];
  observedSourceSurfaces: readonly CodexSourceSurface[];
  observedSourceVersions: readonly string[];
  sourceVersionMissing: boolean;
  lastObservedAt: string | null;
}>;

function assertCanonicalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A Codex capability observation has an invalid canonical timestamp.",
    );
  }
  return value;
}

function parseHookName(value: string): SupportedCodexHookName {
  const parsed = SupportedCodexHookNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A Codex capability observation contains an unsupported Hook name.",
    );
  }
  return parsed.data;
}

function parseSourceSurface(value: string): CodexSourceSurface {
  const parsed = CodexSourceSurfaceSchema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A Codex capability observation contains an unsupported source surface.",
    );
  }
  return parsed.data;
}

function parseSourceVersion(value: string): string {
  const parsed = CodexAdapterIngressSchema.shape.sourceVersion.safeParse(value);
  if (!parsed.success || parsed.data === null || parsed.data === undefined) {
    throw new PersistenceError(
      "invalid_persisted_row",
      "A Codex capability observation contains an invalid source version.",
    );
  }
  return parsed.data;
}

export class CodexCapabilityRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  readObservationFacts(): CodexCapabilityObservationFacts {
    const aggregate = this.#database
      .prepare(
        `SELECT
           count(*) AS receipt_count,
           max(created_at) AS last_observed_at,
           coalesce(sum(CASE
             WHEN json_type(redacted_payload_json, '$.source_surface') = 'text' THEN 0
             ELSE 1
           END), 0) AS invalid_surface_count,
           coalesce(sum(CASE
             WHEN json_type(redacted_payload_json, '$.source_version') IN ('text', 'null') THEN 0
             ELSE 1
           END), 0) AS invalid_version_count,
           coalesce(sum(CASE
             WHEN json_type(redacted_payload_json, '$.source_version') = 'text' THEN 0
             ELSE 1
           END), 0) AS missing_version_count
         FROM ingress_receipts
         WHERE source = 'codex'
           AND canonicalization_version IS NOT NULL`,
      )
      .get();
    if (aggregate === undefined) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Codex capability observation aggregation returned no row.",
      );
    }

    const receiptCount = requiredNumber(aggregate, "receipt_count");
    const invalidSurfaceCount = requiredNumber(aggregate, "invalid_surface_count");
    const invalidVersionCount = requiredNumber(aggregate, "invalid_version_count");
    const missingVersionCount = requiredNumber(aggregate, "missing_version_count");
    const rawLastObservedAt = nullableString(aggregate, "last_observed_at");
    if (receiptCount === 0) {
      if (
        rawLastObservedAt !== null ||
        invalidSurfaceCount !== 0 ||
        invalidVersionCount !== 0 ||
        missingVersionCount !== 0
      ) {
        throw new PersistenceError(
          "invalid_persisted_row",
          "Empty Codex capability observations contain inconsistent aggregate facts.",
        );
      }
      return {
        receiptCount: 0,
        observedHookNames: [],
        observedSourceSurfaces: [],
        observedSourceVersions: [],
        sourceVersionMissing: false,
        lastObservedAt: null,
      };
    }
    if (invalidSurfaceCount !== 0 || invalidVersionCount !== 0 || rawLastObservedAt === null) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Persisted Codex capability metadata is incomplete or invalid.",
      );
    }

    const hookRows = this.#database
      .prepare(
        `SELECT DISTINCT source_event_name
         FROM ingress_receipts
         WHERE source = 'codex'
           AND canonicalization_version IS NOT NULL
         ORDER BY source_event_name ASC
         LIMIT ?`,
      )
      .all(SUPPORTED_CODEX_HOOK_NAMES.length + 1);
    if (hookRows.length > SUPPORTED_CODEX_HOOK_NAMES.length) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Persisted Codex capability observations exceed the Hook taxonomy bound.",
      );
    }
    const observedHookNames = hookRows.map((row) =>
      parseHookName(requiredString(row, "source_event_name")),
    );

    const surfaceRows = this.#database
      .prepare(
        `SELECT DISTINCT json_extract(redacted_payload_json, '$.source_surface') AS source_surface
         FROM ingress_receipts
         WHERE source = 'codex'
           AND canonicalization_version IS NOT NULL
         ORDER BY source_surface ASC
         LIMIT ?`,
      )
      .all(CODEX_SOURCE_SURFACES.length + 1);
    if (surfaceRows.length > CODEX_SOURCE_SURFACES.length) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Persisted Codex capability observations exceed the source-surface bound.",
      );
    }
    const observedSourceSurfaces = surfaceRows.map((row) =>
      parseSourceSurface(requiredString(row, "source_surface")),
    );

    const versionRows = this.#database
      .prepare(
        `SELECT DISTINCT json_extract(redacted_payload_json, '$.source_version') AS source_version
         FROM ingress_receipts
         WHERE source = 'codex'
           AND canonicalization_version IS NOT NULL
           AND json_type(redacted_payload_json, '$.source_version') = 'text'
         ORDER BY source_version ASC
         LIMIT ?`,
      )
      .all(MAX_SOURCE_VERSIONS + 1);
    if (versionRows.length > MAX_SOURCE_VERSIONS) {
      throw new PersistenceError(
        "invalid_persisted_row",
        "Persisted Codex capability observations exceed the source-version bound.",
      );
    }
    const observedSourceVersions = versionRows.map((row) =>
      parseSourceVersion(requiredString(row, "source_version")),
    );

    return {
      receiptCount,
      observedHookNames,
      observedSourceSurfaces,
      observedSourceVersions,
      sourceVersionMissing: missingVersionCount > 0,
      lastObservedAt: assertCanonicalTimestamp(rawLastObservedAt),
    };
  }
}
