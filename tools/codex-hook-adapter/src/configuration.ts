import { Buffer } from "node:buffer";

import { CodexSourceSurfaceSchema, type CodexSourceSurface } from "@ownloop/contracts/codex";

import {
  CODEX_HOOK_ADAPTER_INGRESS_PATH,
  CODEX_HOOK_ADAPTER_LOOPBACK_HOST,
  OWNLOOP_CODEX_SOURCE_SURFACE_ENV,
  OWNLOOP_CODEX_SOURCE_VERSION_ENV,
  OWNLOOP_INGRESS_PORT_ENV,
  OWNLOOP_INSTALLATION_TOKEN_ENV,
} from "./constants.js";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MINIMUM_TOKEN_BYTES = 32;
const MAXIMUM_SOURCE_VERSION_CODE_POINTS = 256;

export type CodexHookAdapterEnvironment = Readonly<Record<string, string | undefined>>;

export type CodexHookAdapterConfiguration = Readonly<{
  endpoint: string;
  installationToken: string;
  sourceVersion: string | null;
  sourceSurface: CodexSourceSurface;
}>;

function isCanonicalInstallationToken(value: string): boolean {
  if (!BASE64URL_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length >= MINIMUM_TOKEN_BYTES && decoded.toString("base64url") === value;
}

function controlledSourceVersion(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.length > 0 && [...value].length <= MAXIMUM_SOURCE_VERSION_CODE_POINTS ? value : null;
}

export function readCodexHookAdapterConfiguration(
  environment: CodexHookAdapterEnvironment,
): CodexHookAdapterConfiguration | null {
  const rawPort = environment[OWNLOOP_INGRESS_PORT_ENV];
  const installationToken = environment[OWNLOOP_INSTALLATION_TOKEN_ENV];
  if (rawPort === undefined || installationToken === undefined) return null;
  if (!/^[1-9][0-9]{0,4}$/u.test(rawPort)) return null;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  if (!isCanonicalInstallationToken(installationToken)) return null;

  const rawSurface = environment[OWNLOOP_CODEX_SOURCE_SURFACE_ENV] ?? "unknown";
  const surface = CodexSourceSurfaceSchema.safeParse(rawSurface);
  if (!surface.success) return null;
  const sourceVersion = controlledSourceVersion(environment[OWNLOOP_CODEX_SOURCE_VERSION_ENV]);
  if (environment[OWNLOOP_CODEX_SOURCE_VERSION_ENV] !== undefined && sourceVersion === null) {
    return null;
  }

  return Object.freeze({
    endpoint: `http://${CODEX_HOOK_ADAPTER_LOOPBACK_HOST}:${port}${CODEX_HOOK_ADAPTER_INGRESS_PATH}`,
    installationToken,
    sourceVersion,
    sourceSurface: surface.data,
  });
}
