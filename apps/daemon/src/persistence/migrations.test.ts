import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openConfiguredDatabase, PERSISTENCE_BUSY_TIMEOUT_MS } from "./database.js";
import type { MigrationError } from "./errors.js";
import { MIGRATIONS, type MigrationDefinition } from "./migration-definitions.js";
import { migrationChecksum, readAppliedMigrations, runMigrations } from "./migrations.js";

const REQUIRED_TABLES = [
  "agent_conversations",
  "analysis_jobs",
  "artifacts",
  "event_deduplication",
  "events",
  "evidence_gaps",
  "ingress_receipts",
  "receipt_event_normalizations",
  "receipt_lifecycle_resolutions",
  "receipt_normalized_events",
  "run_artifacts",
  "schema_migrations",
  "task_runs",
  "workspaces",
] as const;

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "ownloop-persistence-"));
  temporaryDirectories.push(directory);
  return join(directory, "ownloop.sqlite");
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }
});

describe("SQLite migrations", () => {
  it("migrates a new in-memory database and creates every required table", () => {
    const opened = openConfiguredDatabase(":memory:");

    try {
      runMigrations(opened.database);

      const tables = opened.database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all()
        .map((row) => row.name);

      expect(tables).toEqual(REQUIRED_TABLES);
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
    } finally {
      opened.database.close();
    }
  });

  it("migrates a new file-backed database with durable connection settings", () => {
    const databasePath = temporaryDatabasePath();
    const opened = openConfiguredDatabase(databasePath);

    try {
      runMigrations(opened.database);

      expect(opened.connectionInfo).toMatchObject({
        databasePath,
        fileBacked: true,
        foreignKeysEnabled: true,
        busyTimeoutMs: PERSISTENCE_BUSY_TIMEOUT_MS,
        journalMode: "wal",
        synchronousMode: "FULL",
        defensiveModeEnabled: true,
      });
      expect(opened.database.prepare("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
      expect(readAppliedMigrations(opened.database)).toHaveLength(MIGRATIONS.length);
    } finally {
      opened.database.close();
    }
  });

  it("reruns applied migrations idempotently", () => {
    const opened = openConfiguredDatabase(":memory:");

    try {
      runMigrations(opened.database);
      const before = readAppliedMigrations(opened.database);
      runMigrations(opened.database);

      expect(readAppliedMigrations(opened.database)).toEqual(before);
    } finally {
      opened.database.close();
    }
  });

  it("rejects a checksum mismatch for an applied migration", () => {
    const opened = openConfiguredDatabase(":memory:");
    const initialMigration = MIGRATIONS[0];

    if (initialMigration === undefined) {
      throw new Error("The initial migration definition is missing.");
    }

    try {
      runMigrations(opened.database);
      const changedDefinition: MigrationDefinition = {
        ...initialMigration,
        sql: `${initialMigration.sql}\n-- immutable history changed`,
      };

      expect(() => runMigrations(opened.database, [changedDefinition])).toThrowError(
        expect.objectContaining<Partial<MigrationError>>({
          code: "history_mismatch",
        }),
      );
    } finally {
      opened.database.close();
    }
  });

  it("records the SHA-256 checksum of the immutable SQL", () => {
    const opened = openConfiguredDatabase(":memory:");
    const initialMigration = MIGRATIONS[0];

    if (initialMigration === undefined) {
      throw new Error("The initial migration definition is missing.");
    }

    try {
      runMigrations(opened.database);
      const applied = readAppliedMigrations(opened.database)[0];

      expect(applied?.checksum).toBe(migrationChecksum(initialMigration.sql));
      expect(applied?.checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      opened.database.close();
    }
  });

  it.each([
    {
      name: "duplicate versions",
      definitions: [
        { version: 1, name: "one", sql: "SELECT 1;" },
        { version: 1, name: "duplicate", sql: "SELECT 2;" },
      ],
      code: "duplicate_version" as const,
    },
    {
      name: "unordered versions",
      definitions: [
        { version: 2, name: "two", sql: "SELECT 2;" },
        { version: 1, name: "one", sql: "SELECT 1;" },
      ],
      code: "unordered_versions" as const,
    },
  ])("rejects $name", ({ definitions, code }) => {
    const opened = openConfiguredDatabase(":memory:");

    try {
      expect(() => runMigrations(opened.database, definitions)).toThrowError(
        expect.objectContaining<Partial<MigrationError>>({ code }),
      );
    } finally {
      opened.database.close();
    }
  });
});
