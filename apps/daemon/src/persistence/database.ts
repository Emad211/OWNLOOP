import { DatabaseSync } from "node:sqlite";

import { requiredNumber, requiredString } from "./row-mapping.js";

export const PERSISTENCE_BUSY_TIMEOUT_MS = 1_000;
export const PERSISTENCE_SYNCHRONOUS_MODE = "FULL" as const;

export type PersistenceConnectionInfo = Readonly<{
  databasePath: string;
  fileBacked: boolean;
  foreignKeysEnabled: true;
  busyTimeoutMs: number;
  journalMode: string;
  synchronousMode: typeof PERSISTENCE_SYNCHRONOUS_MODE;
  defensiveModeEnabled: true;
}>;

export type OpenedPersistenceDatabase = Readonly<{
  database: DatabaseSync;
  connectionInfo: PersistenceConnectionInfo;
}>;

function pragmaRow(
  database: DatabaseSync,
  sql: string,
): Record<string, import("node:sqlite").SQLOutputValue> {
  const row = database.prepare(sql).get();

  if (row === undefined) {
    throw new Error(`SQLite did not return a value for ${sql}.`);
  }

  return row;
}

export function openConfiguredDatabase(databasePath: string): OpenedPersistenceDatabase {
  if (databasePath.trim().length === 0) {
    throw new TypeError("A non-empty caller-provided database path is required.");
  }

  const database = new DatabaseSync(databasePath, {
    allowBareNamedParameters: false,
    allowExtension: false,
    allowUnknownNamedParameters: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: PERSISTENCE_BUSY_TIMEOUT_MS,
  });

  try {
    database.enableDefensive(true);
    database.exec("PRAGMA foreign_keys = ON");

    const fileBacked = database.location() !== null;
    let journalMode = requiredString(pragmaRow(database, "PRAGMA journal_mode"), "journal_mode");

    if (fileBacked) {
      journalMode = requiredString(
        pragmaRow(database, "PRAGMA journal_mode = WAL"),
        "journal_mode",
      );
    }

    // FULL is deliberate for the durable ingress journal: commit waits for database and WAL data
    // to reach durable storage, accepting synchronous event-loop blocking in this local prototype.
    database.exec(`PRAGMA synchronous = ${PERSISTENCE_SYNCHRONOUS_MODE}`);

    const foreignKeys = requiredNumber(pragmaRow(database, "PRAGMA foreign_keys"), "foreign_keys");
    const busyTimeoutMs = requiredNumber(pragmaRow(database, "PRAGMA busy_timeout"), "timeout");

    if (foreignKeys !== 1) {
      throw new Error("SQLite foreign-key enforcement could not be enabled.");
    }

    return {
      database,
      connectionInfo: {
        databasePath,
        fileBacked,
        foreignKeysEnabled: true,
        busyTimeoutMs,
        journalMode,
        synchronousMode: PERSISTENCE_SYNCHRONOUS_MODE,
        defensiveModeEnabled: true,
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
