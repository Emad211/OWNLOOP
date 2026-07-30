import {
  OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
  OWNLOOP_INSTALL_LAYOUT_VERSION,
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_SUPPORTED_ARCHITECTURE,
  OWNLOOP_SUPPORTED_PLATFORM,
  type OwnLoopInstallManifestV1,
  OwnLoopInstallManifestV1Schema,
  type OwnLoopReleaseManifestV1,
  OwnLoopReleaseManifestV1Schema,
  type OwnLoopRuntimeCompatibilityV1,
} from "@ownloop/contracts";

export class RuntimeCompatibilityError extends Error {
  readonly code:
    | "unsupported_platform"
    | "unsupported_architecture"
    | "unsupported_node"
    | "invalid_release"
    | "invalid_installation"
    | "release_mismatch"
    | "database_incompatible";

  constructor(code: RuntimeCompatibilityError["code"]) {
    super("The installed OwnLoop runtime is incompatible.");
    this.name = "RuntimeCompatibilityError";
    this.code = code;
  }
}

export type RuntimeCompatibilityInput = Readonly<{
  platform: string;
  architecture: string;
  nodeVersion: string;
  releaseManifest: OwnLoopReleaseManifestV1;
  installManifest: OwnLoopInstallManifestV1;
  databaseSchemaVersion?: number;
}>;

export function assertRuntimeCompatibility(
  input: RuntimeCompatibilityInput,
): OwnLoopRuntimeCompatibilityV1 {
  if (input.platform !== OWNLOOP_SUPPORTED_PLATFORM) {
    throw new RuntimeCompatibilityError("unsupported_platform");
  }
  if (input.architecture !== OWNLOOP_SUPPORTED_ARCHITECTURE) {
    throw new RuntimeCompatibilityError("unsupported_architecture");
  }
  if (input.nodeVersion !== OWNLOOP_REQUIRED_NODE_VERSION) {
    throw new RuntimeCompatibilityError("unsupported_node");
  }
  let release: OwnLoopReleaseManifestV1;
  let installation: OwnLoopInstallManifestV1;
  try {
    release = OwnLoopReleaseManifestV1Schema.parse(input.releaseManifest);
  } catch {
    throw new RuntimeCompatibilityError("invalid_release");
  }
  try {
    installation = OwnLoopInstallManifestV1Schema.parse(input.installManifest);
  } catch {
    throw new RuntimeCompatibilityError("invalid_installation");
  }
  if (
    installation.releaseManifestFingerprint !== release.fingerprint ||
    installation.installLayoutVersion !== release.installLayoutVersion ||
    installation.applicationVersion !== release.applicationVersion
  ) {
    throw new RuntimeCompatibilityError("release_mismatch");
  }
  const databaseSchemaVersion =
    input.databaseSchemaVersion ?? OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION;
  if (databaseSchemaVersion !== OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION) {
    throw new RuntimeCompatibilityError("database_incompatible");
  }
  return {
    platform: OWNLOOP_SUPPORTED_PLATFORM,
    architecture: OWNLOOP_SUPPORTED_ARCHITECTURE,
    nodeVersion: OWNLOOP_REQUIRED_NODE_VERSION,
    databaseSchemaVersion: OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION,
    installLayoutVersion: OWNLOOP_INSTALL_LAYOUT_VERSION,
    releaseManifestFingerprint: release.fingerprint,
  };
}
