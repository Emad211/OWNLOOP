export const ARTIFACT_STORE_STORAGE_VERSION = 1 as const;
export const ARTIFACT_STORE_DIGEST_PREFIX = "sha256:" as const;
export const ARTIFACT_STORE_OBJECT_DIRECTORY = "objects/sha256" as const;
export const ARTIFACT_STORE_TEMP_DIRECTORY = "tmp" as const;

export const DEFAULT_MAXIMUM_ARTIFACT_SIZE_BYTES = 64 * 1024 * 1024;
export const MAX_ARTIFACT_GC_BATCH = 100;

export const ARTIFACT_FILE_MODE = 0o600;
export const ARTIFACT_DIRECTORY_MODE = 0o700;
