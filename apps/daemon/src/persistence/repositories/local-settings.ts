import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import {
  type LocalProviderPublicSettingsV1,
  type LocalSettingsDocumentV1,
  LocalSettingsDocumentV1Schema,
  type LocalSettingsReplacementV1,
  LocalSettingsReplacementV1Schema,
} from "@ownloop/contracts";

import { mapPersistenceWriteError, PersistenceError } from "../errors.js";
import { nullableString, requiredNumber, requiredString, type SqliteRow } from "../row-mapping.js";

const SELECT_SETTINGS = `SELECT
  settings_id,
  schema_version,
  revision,
  external_ai_enabled,
  provider_family,
  provider_base_url,
  provider_model_id,
  provider_model_revision,
  provider_timeout_ms,
  provider_max_response_bytes,
  provider_retry_max_attempts,
  provider_retry_base_delay_ms,
  provider_retry_max_retry_after_ms,
  retention_policy,
  diagnostic_mode,
  raw_source_payload_retention,
  custom_secret_field_patterns_json,
  updated_at
FROM local_settings
WHERE settings_id = 'local'`;

function invalidRow(message: string): never {
  throw new PersistenceError("invalid_persisted_row", message);
}

function parsePatterns(row: SqliteRow): readonly string[] {
  const raw = requiredString(row, "custom_secret_field_patterns_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalidRow("The persisted custom secret-field patterns are invalid.");
  }
  if (!Array.isArray(parsed) || JSON.stringify(parsed) !== raw) {
    return invalidRow("The persisted custom secret-field patterns are not canonical.");
  }
  return parsed as readonly string[];
}

function parseProvider(row: SqliteRow): LocalProviderPublicSettingsV1 | null {
  const family = nullableString(row, "provider_family");
  if (family === null) return null;
  return {
    providerFamily: family as LocalProviderPublicSettingsV1["providerFamily"],
    baseUrl: requiredString(row, "provider_base_url"),
    modelId: requiredString(row, "provider_model_id"),
    modelRevision: nullableString(row, "provider_model_revision"),
    timeoutMs: requiredNumber(row, "provider_timeout_ms"),
    maxResponseBytes: requiredNumber(row, "provider_max_response_bytes"),
    retryPolicy: {
      maxAttempts: requiredNumber(row, "provider_retry_max_attempts"),
      baseDelayMs: requiredNumber(row, "provider_retry_base_delay_ms"),
      maxRetryAfterMs: requiredNumber(row, "provider_retry_max_retry_after_ms"),
    },
  };
}

function parseSettings(row: SqliteRow): LocalSettingsDocumentV1 {
  const externalAi = requiredNumber(row, "external_ai_enabled");
  if (externalAi !== 0 && externalAi !== 1) {
    return invalidRow("The persisted external AI flag is invalid.");
  }
  const document = LocalSettingsDocumentV1Schema.parse({
    schemaVersion: requiredNumber(row, "schema_version"),
    id: requiredString(row, "settings_id"),
    revision: requiredNumber(row, "revision"),
    externalAiEnabled: externalAi === 1,
    provider: parseProvider(row),
    retentionPolicy: requiredString(row, "retention_policy"),
    diagnosticMode: requiredString(row, "diagnostic_mode"),
    rawSourcePayloadRetention: requiredString(row, "raw_source_payload_retention"),
    customSecretFieldPatterns: parsePatterns(row),
    updatedAt: requiredString(row, "updated_at"),
  });
  if (
    JSON.stringify(document.customSecretFieldPatterns) !==
    requiredString(row, "custom_secret_field_patterns_json")
  ) {
    return invalidRow("The persisted custom secret-field pattern document differs from its index.");
  }
  return document;
}

function providerColumns(provider: LocalProviderPublicSettingsV1 | null): readonly SQLInputValue[] {
  if (provider === null) {
    return [null, null, null, null, null, null, null, null, null];
  }
  return [
    provider.providerFamily,
    provider.baseUrl,
    provider.modelId,
    provider.modelRevision,
    provider.timeoutMs,
    provider.maxResponseBytes,
    provider.retryPolicy.maxAttempts,
    provider.retryPolicy.baseDelayMs,
    provider.retryPolicy.maxRetryAfterMs,
  ];
}

export class LocalSettingsRepository {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  get(): LocalSettingsDocumentV1 {
    const row = this.#database.prepare(SELECT_SETTINGS).get();
    if (row === undefined) {
      throw new PersistenceError("invalid_persisted_row", "The local settings row is missing.");
    }
    return parseSettings(row);
  }

  compareAndSwap(
    expectedRevision: number,
    replacementInput: LocalSettingsReplacementV1,
    updatedAt: string,
  ): LocalSettingsDocumentV1 | null {
    const replacement = LocalSettingsReplacementV1Schema.parse(replacementInput);
    const current = this.get();
    const provider = providerColumns(replacement.provider);
    try {
      const result = this.#database
        .prepare(
          `UPDATE local_settings SET
             revision = revision + 1,
             external_ai_enabled = ?,
             provider_family = ?,
             provider_base_url = ?,
             provider_model_id = ?,
             provider_model_revision = ?,
             provider_timeout_ms = ?,
             provider_max_response_bytes = ?,
             provider_retry_max_attempts = ?,
             provider_retry_base_delay_ms = ?,
             provider_retry_max_retry_after_ms = ?,
             retention_policy = ?,
             diagnostic_mode = ?,
             raw_source_payload_retention = ?,
             custom_secret_field_patterns_json = ?,
             updated_at = ?
           WHERE settings_id = 'local' AND revision = ?`,
        )
        .run(
          replacement.externalAiEnabled ? 1 : 0,
          ...provider,
          replacement.retentionPolicy,
          replacement.diagnosticMode,
          replacement.rawSourcePayloadRetention,
          JSON.stringify(replacement.customSecretFieldPatterns),
          updatedAt,
          expectedRevision,
        );
      if (result.changes === 0) return null;
    } catch (error) {
      mapPersistenceWriteError(error, "update local settings");
    }
    const updated = this.get();
    if (updated.revision !== current.revision + 1 || updated.revision !== expectedRevision + 1) {
      return invalidRow("The local settings revision changed unexpectedly.");
    }
    return updated;
  }
}
