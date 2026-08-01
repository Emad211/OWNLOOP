import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { MigrationError } from "./errors.js";
import { MIGRATIONS, type MigrationDefinition } from "./migration-definitions.js";
import { requiredNumber, requiredString } from "./row-mapping.js";
import { runInTransaction } from "./transaction.js";

const CREATE_MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  checksum TEXT NOT NULL CHECK (
    length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'
  ),
  applied_at TEXT NOT NULL CHECK (length(trim(applied_at)) > 0)
) STRICT;
`;

const PRAGMA_FLAGS = ["foreign_keys", "legacy_alter_table"] as const;
type PragmaFlag = (typeof PRAGMA_FLAGS)[number];

export type AppliedMigration = Readonly<{
  version: number;
  name: string;
  checksum: string;
  appliedAt: string;
}>;

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function validateDefinitions(definitions: readonly MigrationDefinition[]): void {
  let previousVersion = 0;
  const seenVersions = new Set<number>();

  for (const definition of definitions) {
    if (
      !Number.isInteger(definition.version) ||
      definition.version <= 0 ||
      definition.name.trim().length === 0 ||
      definition.sql.trim().length === 0
    ) {
      throw new MigrationError(
        "invalid_definition",
        "Migration definitions require a positive integer version, stable name, and SQL.",
      );
    }

    if (seenVersions.has(definition.version)) {
      throw new MigrationError(
        "duplicate_version",
        `Migration version ${definition.version} is duplicated.`,
      );
    }

    if (definition.version < previousVersion) {
      throw new MigrationError(
        "unordered_versions",
        "Migration definitions must be ordered by ascending version.",
      );
    }

    previousVersion = definition.version;
    seenVersions.add(definition.version);
  }
}

function readPragmaFlag(database: DatabaseSync, pragma: PragmaFlag): 0 | 1 {
  const row = database.prepare(`PRAGMA ${pragma}`).get();
  const value = row?.[pragma];
  if (value !== 0 && value !== 1) {
    throw new MigrationError("migration_failed", `Unable to read SQLite ${pragma} state.`);
  }
  return value;
}

function setPragmaFlag(database: DatabaseSync, pragma: PragmaFlag, value: 0 | 1): void {
  database.exec(`PRAGMA ${pragma} = ${value === 1 ? "ON" : "OFF"}`);
  if (readPragmaFlag(database, pragma) !== value) {
    throw new MigrationError("migration_failed", `Unable to set SQLite ${pragma} state.`);
  }
}

function assertForeignKeyIntegrity(database: DatabaseSync): void {
  if (database.prepare("PRAGMA foreign_key_check").all().length !== 0) {
    throw new MigrationError(
      "migration_failed",
      "The migration introduced a SQLite foreign-key violation.",
    );
  }
}

export function readAppliedMigrations(database: DatabaseSync): readonly AppliedMigration[] {
  const rows = database
    .prepare(
      `SELECT version, name, checksum, applied_at
       FROM schema_migrations
       ORDER BY version`,
    )
    .all();

  return rows.map((row) => ({
    version: requiredNumber(row, "version"),
    name: requiredString(row, "name"),
    checksum: requiredString(row, "checksum"),
    appliedAt: requiredString(row, "applied_at"),
  }));
}

export function runMigrations(
  database: DatabaseSync,
  definitions: readonly MigrationDefinition[] = MIGRATIONS,
): void {
  validateDefinitions(definitions);
  database.exec(CREATE_MIGRATION_TABLE_SQL);

  const appliedMigrations = readAppliedMigrations(database);
  const definitionsByVersion = new Map(
    definitions.map((definition) => [definition.version, definition] as const),
  );

  for (const applied of appliedMigrations) {
    const definition = definitionsByVersion.get(applied.version);

    if (
      definition === undefined ||
      definition.name !== applied.name ||
      migrationChecksum(definition.sql) !== applied.checksum
    ) {
      throw new MigrationError(
        "history_mismatch",
        `Applied migration version ${applied.version} does not match the immutable definition.`,
      );
    }
  }

  const appliedVersions = new Set(appliedMigrations.map(({ version }) => version));
  const insertMigration = database.prepare(
    `INSERT INTO schema_migrations (version, name, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  );

  for (const definition of definitions) {
    if (appliedVersions.has(definition.version)) {
      continue;
    }

    const applyInsideTransaction = (): void => {
      runInTransaction(database, () => {
        database.exec(definition.sql);
        if (definition.foreignKeyPolicy === "disable_during_table_rebuild") {
          assertForeignKeyIntegrity(database);
        }
        insertMigration.run(
          definition.version,
          definition.name,
          migrationChecksum(definition.sql),
          new Date().toISOString(),
        );
      });
    };

    try {
      if (definition.foreignKeyPolicy === "disable_during_table_rebuild") {
        const foreignKeys = readPragmaFlag(database, "foreign_keys");
        const legacyAlterTable = readPragmaFlag(database, "legacy_alter_table");
        try {
          setPragmaFlag(database, "foreign_keys", 0);
          setPragmaFlag(database, "legacy_alter_table", 1);
          applyInsideTransaction();
        } finally {
          try {
            setPragmaFlag(database, "legacy_alter_table", legacyAlterTable);
          } finally {
            setPragmaFlag(database, "foreign_keys", foreignKeys);
          }
        }
      } else {
        applyInsideTransaction();
      }
    } catch (error) {
      throw new MigrationError(
        "migration_failed",
        `Migration version ${definition.version} failed and was rolled back.`,
        { cause: error },
      );
    }
  }
}
