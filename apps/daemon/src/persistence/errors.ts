export type PersistenceErrorCode =
  | "async_transaction_not_supported"
  | "constraint_violation"
  | "invalid_persisted_row"
  | "operation_failed"
  | "transaction_already_active";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export class PersistenceConstraintError extends PersistenceError {
  constructor(operation: string, options?: ErrorOptions) {
    super(
      "constraint_violation",
      `A persistence constraint rejected the ${operation} operation.`,
      options,
    );
    this.name = "PersistenceConstraintError";
  }
}

export type MigrationErrorCode =
  | "duplicate_version"
  | "history_mismatch"
  | "invalid_definition"
  | "migration_failed"
  | "unordered_versions";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
    this.code = code;
  }
}

function sqliteResultCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("errcode" in error)) {
    return null;
  }

  const value = error.errcode;
  return typeof value === "number" ? value : null;
}

export function isSqliteConstraintError(error: unknown): boolean {
  const resultCode = sqliteResultCode(error);
  return resultCode !== null && (resultCode & 0xff) === 19;
}

export function mapPersistenceWriteError(error: unknown, operation: string): never {
  if (isSqliteConstraintError(error)) {
    throw new PersistenceConstraintError(operation, { cause: error });
  }

  throw new PersistenceError("operation_failed", `The ${operation} persistence operation failed.`, {
    cause: error,
  });
}
