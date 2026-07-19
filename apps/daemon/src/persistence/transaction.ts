import type { DatabaseSync } from "node:sqlite";

import { PersistenceError } from "./errors.js";

export function runInTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
  if (database.isTransaction) {
    throw new PersistenceError(
      "transaction_already_active",
      "Nested persistence transactions are not supported.",
    );
  }

  database.exec("BEGIN IMMEDIATE");

  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    if (database.isTransaction) {
      database.exec("ROLLBACK");
    }

    throw error;
  }
}
