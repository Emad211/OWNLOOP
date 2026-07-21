export type ArtifactStoreErrorCode =
  | "artifact_content_corrupt"
  | "artifact_gc_failed"
  | "artifact_metadata_conflict"
  | "artifact_not_found"
  | "artifact_persistence_failed"
  | "artifact_read_failed"
  | "artifact_reference_failed"
  | "artifact_write_failed"
  | "invalid_configuration"
  | "invalid_prepared_content"
  | "size_limit_exceeded"
  | "unsupported_storage_version";

const ERROR_MESSAGES: Readonly<Record<ArtifactStoreErrorCode, string>> = Object.freeze({
  artifact_content_corrupt: "The artifact content failed integrity verification.",
  artifact_gc_failed: "Artifact garbage collection failed safely.",
  artifact_metadata_conflict: "Persisted artifact metadata conflicts with the prepared content.",
  artifact_not_found: "The requested artifact was not found.",
  artifact_persistence_failed: "Artifact metadata could not be persisted safely.",
  artifact_read_failed: "The artifact could not be read safely.",
  artifact_reference_failed: "The artifact reference operation failed safely.",
  artifact_write_failed: "The prepared artifact could not be written safely.",
  invalid_configuration: "The artifact store configuration is invalid.",
  invalid_prepared_content: "The prepared artifact input is invalid.",
  size_limit_exceeded: "The prepared artifact exceeds the configured size limit.",
  unsupported_storage_version: "The artifact storage version is not supported by the file store.",
});

export class ArtifactStoreError extends Error {
  readonly code: ArtifactStoreErrorCode;

  constructor(code: ArtifactStoreErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ArtifactStoreError";
    this.code = code;
    Object.defineProperty(this, "stack", {
      configurable: true,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  }
}

export function isArtifactStoreError(error: unknown): error is ArtifactStoreError {
  return error instanceof ArtifactStoreError;
}
