export const HOOK_ADAPTER_VERSION = "0.1.0" as const;
export const HOOK_ADAPTER_CONTRACT_VERSION = 1 as const;
export const HOOK_ADAPTER_SOURCE = "claude_code" as const;

export const OWNLOOP_INGRESS_PORT_ENV = "OWNLOOP_INGRESS_PORT" as const;
export const OWNLOOP_INSTALLATION_TOKEN_ENV = "OWNLOOP_INSTALLATION_TOKEN" as const;

export const HOOK_ADAPTER_LOOPBACK_HOST = "127.0.0.1" as const;
export const HOOK_ADAPTER_INGRESS_PATH = "/v1/ingress/claude" as const;
export const HOOK_ADAPTER_MAX_STDIN_BYTES = 1_000_000;
export const HOOK_ADAPTER_MAX_RESPONSE_BYTES = 65_536;
export const HOOK_ADAPTER_DEFAULT_TIMEOUT_MS = 750;
export const HOOK_ADAPTER_MAX_REQUEST_BYTES = 1_048_576;
