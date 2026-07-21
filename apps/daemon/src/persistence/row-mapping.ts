import type { SQLOutputValue } from "node:sqlite";

import { PersistenceError } from "./errors.js";

export type SqliteRow = Record<string, SQLOutputValue>;

function invalidColumn(column: string): never {
  throw new PersistenceError(
    "invalid_persisted_row",
    `The persisted row contains an invalid ${column} column.`,
  );
}

export function requiredString(row: SqliteRow, column: string): string {
  const value = row[column];
  return typeof value === "string" ? value : invalidColumn(column);
}

export function nullableString(row: SqliteRow, column: string): string | null {
  const value = row[column];
  return value === null ? null : requiredString(row, column);
}

export function requiredNumber(row: SqliteRow, column: string): number {
  const value = row[column];
  return typeof value === "number" ? value : invalidColumn(column);
}

export function nullableNumber(row: SqliteRow, column: string): number | null {
  const value = row[column];
  return value === null ? null : requiredNumber(row, column);
}
