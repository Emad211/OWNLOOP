import { OWNLOOP_APPLICATION_VERSION, OWNLOOP_DAEMON_RUNTIME_VERSION } from "@ownloop/contracts";

export const DIAGNOSTICS_BUNDLE_FILENAME = "ownloop-diagnostics-v1.json" as const;
export const DIAGNOSTICS_DASHBOARD_ROUTE = "/v1/diagnostics/dashboard" as const;
export const DIAGNOSTICS_BUNDLE_ROUTE = "/v1/diagnostics/bundle" as const;

export const DIAGNOSTICS_APPLICATION_VERSIONS = Object.freeze({
  app: OWNLOOP_APPLICATION_VERSION,
  contracts: OWNLOOP_APPLICATION_VERSION,
  daemon: OWNLOOP_DAEMON_RUNTIME_VERSION,
} as const);
