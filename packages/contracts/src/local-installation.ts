import { z } from "zod";

import {
  SUPPORTED_CLAUDE_HOOK_NAMES,
  SupportedClaudeHookNameSchema,
} from "./claude-hook-common.js";

export const OWNLOOP_APPLICATION_VERSION = "0.1.0" as const;
export const OWNLOOP_DAEMON_VERSION = "0.1.0" as const;
export const OWNLOOP_DAEMON_RUNTIME_VERSION = OWNLOOP_DAEMON_VERSION;
export const OWNLOOP_HOOK_ADAPTER_VERSION = "0.1.0" as const;
export const OWNLOOP_HOOK_ADAPTER_CONTRACT_VERSION = 1 as const;
export const OWNLOOP_WEB_VERSION = "0.1.0" as const;
export const OWNLOOP_RELEASE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const OWNLOOP_INSTALL_MANIFEST_SCHEMA_VERSION = 1 as const;
export const OWNLOOP_INSTALLATION_SECRET_SCHEMA_VERSION = 1 as const;
export const OWNLOOP_RUNTIME_STATE_SCHEMA_VERSION = 1 as const;
export const OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION = 1 as const;
export const OWNLOOP_INSTALL_LAYOUT_VERSION = 1 as const;
export const OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION = 18 as const;
export const OWNLOOP_SUPPORTED_PLATFORM = "win32" as const;
export const OWNLOOP_SUPPORTED_ARCHITECTURE = "x64" as const;
export const OWNLOOP_REQUIRED_NODE_VERSION = "24.18.0" as const;
export const OWNLOOP_REQUIRED_PNPM_VERSION = "11.4.0" as const;
export const OWNLOOP_RELEASE_DIRECTORY_NAME = OWNLOOP_APPLICATION_VERSION;
export const OWNLOOP_RELEASE_MANIFEST_FILE = "release-manifest.json" as const;
export const OWNLOOP_INSTALL_MANIFEST_FILE = "install-manifest.json" as const;
export const OWNLOOP_SECRETS_FILE = "secrets-v1.json" as const;
export const OWNLOOP_RUNTIME_STATE_FILE = "runtime-v1.json" as const;
export const OWNLOOP_STABLE_HOOK_LAUNCHER_FILE = "ownloop-hook.cmd" as const;
export const OWNLOOP_STABLE_USER_LAUNCHER_FILE = "ownloop.cmd" as const;

export const OWNLOOP_RUNTIME_PHASES = ["starting", "ready", "stopping"] as const;
export const OwnLoopRuntimePhaseSchema = z.enum(OWNLOOP_RUNTIME_PHASES);
export type OwnLoopRuntimePhase = z.infer<typeof OwnLoopRuntimePhaseSchema>;

export const OWNLOOP_PUMP_STATES = ["idle", "running", "stopping", "stopped"] as const;
export const OwnLoopPumpStateSchema = z.enum(OWNLOOP_PUMP_STATES);
export type OwnLoopPumpState = z.infer<typeof OwnLoopPumpStateSchema>;

export const OWNLOOP_RUNTIME_ERROR_CODES = [
  "unauthorized",
  "invalid_request",
  "instance_mismatch",
  "shutdown_in_progress",
  "runtime_unavailable",
  "runtime_incompatible",
  "repair_needed",
  "operation_failed",
] as const;
export const OwnLoopRuntimeErrorCodeSchema = z.enum(OWNLOOP_RUNTIME_ERROR_CODES);
export type OwnLoopRuntimeErrorCode = z.infer<typeof OwnLoopRuntimeErrorCodeSchema>;

const canonicalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid canonical UTC timestamp.");

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const sha256FingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const safeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
const windowsReservedDeviceNamePattern = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu;

function isCanonicalWindowsPackagePath(value: string): boolean {
  return value
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        /^[A-Za-z0-9._@ -]+$/u.test(segment) &&
        !segment.startsWith(" ") &&
        !segment.endsWith(" ") &&
        !segment.endsWith(".") &&
        !windowsReservedDeviceNamePattern.test(segment),
    );
}

const canonicalRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(isCanonicalWindowsPackagePath, {
    message: "Package paths must be canonical, traversal-free, and Windows-safe.",
  });

function isSortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function isCanonicalBase64UrlSecret(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length < 43 || value.length > 172) return false;
  const remainder = value.length % 4;
  if (remainder === 1) return false;
  const decodedBytes = Math.floor((value.length * 6) / 8);
  return decodedBytes >= 32 && decodedBytes <= 128;
}

const secretSchema = z
  .string()
  .refine(isCanonicalBase64UrlSecret, "Secret must be canonical base64url with at least 32 bytes.");

export const OwnLoopReleaseFileV1Schema = z.strictObject({
  path: canonicalRelativePathSchema,
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: sha256HexSchema,
  executableCritical: z.boolean(),
});
export type OwnLoopReleaseFileV1 = z.infer<typeof OwnLoopReleaseFileV1Schema>;

export const OwnLoopReleaseManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(OWNLOOP_RELEASE_MANIFEST_SCHEMA_VERSION),
    applicationVersion: z.literal(OWNLOOP_APPLICATION_VERSION),
    daemonVersion: z.literal(OWNLOOP_DAEMON_VERSION),
    hookAdapterVersion: z.literal(OWNLOOP_HOOK_ADAPTER_VERSION),
    hookAdapterContractVersion: z.literal(OWNLOOP_HOOK_ADAPTER_CONTRACT_VERSION),
    webVersion: z.literal(OWNLOOP_WEB_VERSION),
    expectedDatabaseSchemaVersion: z.literal(OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION),
    platform: z.literal(OWNLOOP_SUPPORTED_PLATFORM),
    architecture: z.literal(OWNLOOP_SUPPORTED_ARCHITECTURE),
    nodeVersion: z.literal(OWNLOOP_REQUIRED_NODE_VERSION),
    packagingPnpmVersion: z.literal(OWNLOOP_REQUIRED_PNPM_VERSION),
    installLayoutVersion: z.literal(OWNLOOP_INSTALL_LAYOUT_VERSION),
    files: z.array(OwnLoopReleaseFileV1Schema).min(1).max(100_000),
    fingerprint: sha256FingerprintSchema,
  })
  .superRefine((value, context) => {
    const paths = value.files.map((file) => file.path);
    if (!isSortedUnique(paths)) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "Files must be sorted and unique.",
      });
    }
    if (!value.files.some((file) => file.executableCritical)) {
      context.addIssue({
        code: "custom",
        path: ["files"],
        message: "At least one executable-critical file is required.",
      });
    }
  });
export type OwnLoopReleaseManifestV1 = z.infer<typeof OwnLoopReleaseManifestV1Schema>;

export const OwnLoopInstallationSecretsV1Schema = z
  .strictObject({
    schemaVersion: z.literal(OWNLOOP_INSTALLATION_SECRET_SCHEMA_VERSION),
    installId: safeIdentifierSchema,
    installationToken: secretSchema,
    hmacKey: secretSchema,
    createdAt: canonicalTimestampSchema,
  })
  .superRefine((value, context) => {
    if (value.installationToken === value.hmacKey) {
      context.addIssue({ code: "custom", message: "Installation token and HMAC key must differ." });
    }
  });
export type OwnLoopInstallationSecretsV1 = z.infer<typeof OwnLoopInstallationSecretsV1Schema>;

export const OwnLoopInstalledHookV1Schema = z.strictObject({
  event: SupportedClaudeHookNameSchema,
  command: z.string().min(1).max(1024),
});
export type OwnLoopInstalledHookV1 = z.infer<typeof OwnLoopInstalledHookV1Schema>;

export const OwnLoopClaudeSettingsMutationV1Schema = z
  .strictObject({
    settingsFileCreated: z.boolean(),
    hooksContainerCreated: z.boolean(),
    createdEventContainers: z
      .array(SupportedClaudeHookNameSchema)
      .max(SUPPORTED_CLAUDE_HOOK_NAMES.length),
  })
  .superRefine((value, context) => {
    const actual = value.createdEventContainers;
    if (new Set(actual).size !== actual.length) {
      context.addIssue({
        code: "custom",
        path: ["createdEventContainers"],
        message: "Created Hook events must be unique.",
      });
    }
    const expectedOrder = SUPPORTED_CLAUDE_HOOK_NAMES.filter((event) => actual.includes(event));
    if (actual.some((event, index) => event !== expectedOrder[index])) {
      context.addIssue({
        code: "custom",
        path: ["createdEventContainers"],
        message: "Created Hook events must use canonical order.",
      });
    }
  });
export type OwnLoopClaudeSettingsMutationV1 = z.infer<typeof OwnLoopClaudeSettingsMutationV1Schema>;

export const OwnLoopInstallManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(OWNLOOP_INSTALL_MANIFEST_SCHEMA_VERSION),
    installId: safeIdentifierSchema,
    applicationVersion: z.literal(OWNLOOP_APPLICATION_VERSION),
    releaseDirectoryName: z.literal(OWNLOOP_RELEASE_DIRECTORY_NAME),
    releaseManifestFingerprint: sha256FingerprintSchema,
    installLayoutVersion: z.literal(OWNLOOP_INSTALL_LAYOUT_VERSION),
    hooks: z.array(OwnLoopInstalledHookV1Schema).length(SUPPORTED_CLAUDE_HOOK_NAMES.length),
    claudeSettings: OwnLoopClaudeSettingsMutationV1Schema,
    installedAt: canonicalTimestampSchema,
  })
  .superRefine((value, context) => {
    const expected = [...SUPPORTED_CLAUDE_HOOK_NAMES].sort();
    const actual = value.hooks.map((hook) => hook.event).sort();
    if (
      actual.length !== expected.length ||
      actual.some((event, index) => event !== expected[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["hooks"],
        message: "Exactly nine supported Hooks are required.",
      });
    }
  });
export type OwnLoopInstallManifestV1 = z.infer<typeof OwnLoopInstallManifestV1Schema>;

export const OwnLoopRuntimeStateV1Schema = z.strictObject({
  schemaVersion: z.literal(OWNLOOP_RUNTIME_STATE_SCHEMA_VERSION),
  installId: safeIdentifierSchema,
  applicationVersion: z.literal(OWNLOOP_APPLICATION_VERSION),
  daemonVersion: z.literal(OWNLOOP_DAEMON_VERSION),
  hookAdapterVersion: z.literal(OWNLOOP_HOOK_ADAPTER_VERSION),
  installLayoutVersion: z.literal(OWNLOOP_INSTALL_LAYOUT_VERSION),
  instanceId: safeIdentifierSchema,
  pid: z.number().int().min(1).max(4_294_967_295),
  processStartIdentity: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/u),
  port: z.number().int().min(1).max(65_535),
  phase: OwnLoopRuntimePhaseSchema,
  startedAt: canonicalTimestampSchema,
  updatedAt: canonicalTimestampSchema,
});
export type OwnLoopRuntimeStateV1 = z.infer<typeof OwnLoopRuntimeStateV1Schema>;

export const OwnLoopRuntimeCompatibilityV1Schema = z.strictObject({
  platform: z.literal(OWNLOOP_SUPPORTED_PLATFORM),
  architecture: z.literal(OWNLOOP_SUPPORTED_ARCHITECTURE),
  nodeVersion: z.literal(OWNLOOP_REQUIRED_NODE_VERSION),
  databaseSchemaVersion: z.literal(OWNLOOP_EXPECTED_DATABASE_SCHEMA_VERSION),
  installLayoutVersion: z.literal(OWNLOOP_INSTALL_LAYOUT_VERSION),
  releaseManifestFingerprint: sha256FingerprintSchema,
});
export type OwnLoopRuntimeCompatibilityV1 = z.infer<typeof OwnLoopRuntimeCompatibilityV1Schema>;

export const OwnLoopRuntimeStatusResponseV1Schema = z
  .strictObject({
    ok: z.literal(true),
    schemaVersion: z.literal(OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION),
    installId: safeIdentifierSchema,
    instanceId: safeIdentifierSchema,
    applicationVersion: z.literal(OWNLOOP_APPLICATION_VERSION),
    daemonVersion: z.literal(OWNLOOP_DAEMON_VERSION),
    hookAdapterVersion: z.literal(OWNLOOP_HOOK_ADAPTER_VERSION),
    pid: z.number().int().min(1).max(4_294_967_295),
    processStartIdentity: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    port: z.number().int().min(1).max(65_535),
    phase: OwnLoopRuntimePhaseSchema,
    pumpState: OwnLoopPumpStateSchema,
    startedAt: canonicalTimestampSchema,
    compatibility: OwnLoopRuntimeCompatibilityV1Schema,
  })
  .superRefine((value, context) => {
    if (
      value.phase === "stopping" &&
      value.pumpState !== "stopping" &&
      value.pumpState !== "stopped"
    ) {
      context.addIssue({
        code: "custom",
        path: ["pumpState"],
        message: "Stopping runtime has inconsistent pump state.",
      });
    }
  });
export type OwnLoopRuntimeStatusResponseV1 = z.infer<typeof OwnLoopRuntimeStatusResponseV1Schema>;

export const OwnLoopRuntimeShutdownRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION),
  instanceId: safeIdentifierSchema,
});
export type OwnLoopRuntimeShutdownRequestV1 = z.infer<typeof OwnLoopRuntimeShutdownRequestV1Schema>;

export const OwnLoopRuntimeShutdownResponseV1Schema = z.strictObject({
  ok: z.literal(true),
  schemaVersion: z.literal(OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION),
  instanceId: safeIdentifierSchema,
  acknowledged: z.literal(true),
});
export type OwnLoopRuntimeShutdownResponseV1 = z.infer<
  typeof OwnLoopRuntimeShutdownResponseV1Schema
>;

export const OwnLoopRuntimeErrorResponseV1Schema = z.strictObject({
  ok: z.literal(false),
  schemaVersion: z.literal(OWNLOOP_RUNTIME_CONTROL_SCHEMA_VERSION),
  error: z.strictObject({ code: OwnLoopRuntimeErrorCodeSchema }),
});
export type OwnLoopRuntimeErrorResponseV1 = z.infer<typeof OwnLoopRuntimeErrorResponseV1Schema>;
