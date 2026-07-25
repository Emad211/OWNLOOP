import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalSettingsReplacementV1 } from "@ownloop/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { openPersistence } from "../index.js";
import { openConfiguredDatabase } from "../database.js";
import { runMigrations } from "../migrations.js";
import { LocalSettingsRepository } from "./local-settings.js";

const temporaryDirectories: string[] = [];
const at1 = "2035-07-25T22:30:00.000Z";
const at2 = "2035-07-25T22:30:00.001Z";
const provider = {
  providerFamily: "responses_json_v1",
  baseUrl: "https://api.provider.example.org/v1",
  modelId: "model-1",
  modelRevision: null,
  timeoutMs: 30_000,
  maxResponseBytes: 65_536,
  retryPolicy: { maxAttempts: 2, baseDelayMs: 100, maxRetryAfterMs: 1_000 },
} as const;

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ownloop-local-settings-"));
  temporaryDirectories.push(directory);
  return join(directory, "ownloop.sqlite");
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe("LocalSettingsRepository", () => {
  it("reads the strict privacy-preserving defaults", () => {
    const persistence = openPersistence(":memory:");
    try {
      expect(persistence.localSettings.get()).toMatchObject({
        schemaVersion: 1,
        id: "local",
        revision: 1,
        externalAiEnabled: false,
        provider: null,
        retentionPolicy: "keep_until_deleted",
        diagnosticMode: "off",
        rawSourcePayloadRetention: "off",
        customSecretFieldPatterns: [],
      });
    } finally {
      persistence.close();
    }
  });

  it("updates the complete document with compare-and-swap and rejects stale revisions", () => {
    const persistence = openPersistence(":memory:");
    try {
      const replacement: LocalSettingsReplacementV1 = {
        schemaVersion: 1,
        externalAiEnabled: true,
        provider,
        retentionPolicy: "delete_terminal_after_30_days",
        diagnosticMode: "counts_only",
        rawSourcePayloadRetention: "off",
        customSecretFieldPatterns: ["*token", "apikey"],
      };
      const updated = persistence.withTransaction((repositories) =>
        repositories.localSettings.compareAndSwap(1, replacement, at1),
      );
      expect(updated).toMatchObject({ revision: 2, ...replacement, updatedAt: at1 });
      expect(
        persistence.withTransaction((repositories) =>
          repositories.localSettings.compareAndSwap(1, replacement, at2),
        ),
      ).toBeNull();
      expect(persistence.localSettings.get()).toEqual(updated);
    } finally {
      persistence.close();
    }
  });

  it("persists public settings across restart without any provider secret field", () => {
    const path = databasePath();
    const first = openPersistence(path);
    first.withTransaction((repositories) =>
      repositories.localSettings.compareAndSwap(
        1,
        {
          schemaVersion: 1,
          externalAiEnabled: true,
          provider,
          retentionPolicy: "keep_until_deleted",
          diagnosticMode: "off",
          rawSourcePayloadRetention: "off",
          customSecretFieldPatterns: ["apikey"],
        },
        at1,
      ),
    );
    first.close();

    const reopened = openPersistence(path);
    try {
      const settings = reopened.localSettings.get();
      expect(settings).toMatchObject({
        revision: 2,
        provider,
        customSecretFieldPatterns: ["apikey"],
      });
      expect(JSON.stringify(settings)).not.toContain("apiKey");
      expect(JSON.stringify(settings)).not.toContain("secret");
    } finally {
      reopened.close();
    }
  });
  it("allows exactly one winner for concurrent compare-and-swap attempts", () => {
    const persistence = openPersistence(":memory:");
    try {
      const firstReplacement: LocalSettingsReplacementV1 = {
        schemaVersion: 1,
        externalAiEnabled: false,
        provider: null,
        retentionPolicy: "delete_terminal_after_7_days",
        diagnosticMode: "off",
        rawSourcePayloadRetention: "off",
        customSecretFieldPatterns: [],
      };
      const secondReplacement: LocalSettingsReplacementV1 = {
        ...firstReplacement,
        retentionPolicy: "delete_terminal_after_90_days",
      };
      const first = persistence.withTransaction((repositories) =>
        repositories.localSettings.compareAndSwap(1, firstReplacement, at1),
      );
      const second = persistence.withTransaction((repositories) =>
        repositories.localSettings.compareAndSwap(1, secondReplacement, at2),
      );
      expect([first, second].filter((result) => result !== null)).toHaveLength(1);
      expect(persistence.localSettings.get()).toMatchObject({
        revision: 2,
        retentionPolicy: "delete_terminal_after_7_days",
      });
    } finally {
      persistence.close();
    }
  });

  it("fails closed on valid JSON that violates canonical pattern grammar", () => {
    const opened = openConfiguredDatabase(":memory:");
    try {
      runMigrations(opened.database);
      opened.database
        .prepare(
          `UPDATE local_settings
           SET revision = 2,
               custom_secret_field_patterns_json = ?,
               updated_at = ?
           WHERE settings_id = 'local'`,
        )
        .run('["private*","*credential"]', "2035-07-25T22:30:00.000Z");
      expect(() => new LocalSettingsRepository(opened.database).get()).toThrow();
    } finally {
      opened.database.close();
    }
  });
});
