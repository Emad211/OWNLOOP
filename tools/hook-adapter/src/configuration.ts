import { Buffer } from "node:buffer";

import {
  HOOK_ADAPTER_INGRESS_PATH,
  HOOK_ADAPTER_LOOPBACK_HOST,
  OWNLOOP_INGRESS_PORT_ENV,
  OWNLOOP_INSTALLATION_TOKEN_ENV,
} from "./constants.js";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MINIMUM_TOKEN_BYTES = 32;

export type HookAdapterEnvironment = Readonly<Record<string, string | undefined>>;

export type HookAdapterConfiguration = Readonly<{
  endpoint: string;
  installationToken: string;
}>;

function isCanonicalInstallationToken(value: string): boolean {
  if (!BASE64URL_PATTERN.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length >= MINIMUM_TOKEN_BYTES && decoded.toString("base64url") === value;
}

export function readHookAdapterConfiguration(
  environment: HookAdapterEnvironment,
): HookAdapterConfiguration | null {
  const rawPort = environment[OWNLOOP_INGRESS_PORT_ENV];
  const installationToken = environment[OWNLOOP_INSTALLATION_TOKEN_ENV];
  if (rawPort === undefined || installationToken === undefined) {
    return null;
  }
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) {
    return null;
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return null;
  }
  if (!isCanonicalInstallationToken(installationToken)) {
    return null;
  }

  return Object.freeze({
    endpoint: `http://${HOOK_ADAPTER_LOOPBACK_HOST}:${port}${HOOK_ADAPTER_INGRESS_PATH}`,
    installationToken,
  });
}
