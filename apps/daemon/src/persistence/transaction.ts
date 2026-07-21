import type { DatabaseSync } from "node:sqlite";

import { PersistenceError } from "./errors.js";

function asyncTransactionError(): PersistenceError {
  return new PersistenceError(
    "async_transaction_not_supported",
    "Persistence transaction callbacks must complete synchronously.",
  );
}

function isNativeAsyncFunction(operation: unknown): boolean {
  return typeof operation === "function" && operation.constructor.name === "AsyncFunction";
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return false;
  }

  return "then" in value && typeof value.then === "function";
}

function rollbackIfActive(database: DatabaseSync): void {
  if (database.isTransaction) {
    database.exec("ROLLBACK");
  }
}

export function assertSynchronousTransactionOperation(operation: unknown): void {
  if (isNativeAsyncFunction(operation)) {
    throw asyncTransactionError();
  }
}

export function runInTransaction<Result>(database: DatabaseSync, operation: () => Result): Result {
  assertSynchronousTransactionOperation(operation);

  if (database.isTransaction) {
    throw new PersistenceError(
      "transaction_already_active",
      "Nested persistence transactions are not supported.",
    );
  }

  database.exec("BEGIN IMMEDIATE");

  try {
    const result = operation();

    if (isPromiseLike(result)) {
      rollbackIfActive(database);
      void Promise.resolve(result).catch(() => undefined);
      throw asyncTransactionError();
    }

    database.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackIfActive(database);
    throw error;
  }
}
