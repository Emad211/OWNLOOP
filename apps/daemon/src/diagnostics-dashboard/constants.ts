export const DIAGNOSTICS_BUNDLE_FILENAME = "ownloop-diagnostics-v1.json" as const;
export const DIAGNOSTICS_DASHBOARD_ROUTE = "/v1/diagnostics/dashboard" as const;
export const DIAGNOSTICS_BUNDLE_ROUTE = "/v1/diagnostics/bundle" as const;

export const DIAGNOSTICS_APPLICATION_VERSIONS = Object.freeze({
  app: "0.0.0",
  contracts: "0.0.0",
  daemon: "0.0.0",
} as const);
