#!/usr/bin/env node

import { deliverCodexHook } from "./adapter.js";

async function run(): Promise<void> {
  try {
    await deliverCodexHook({ input: process.stdin, environment: process.env });
  } catch {
    // The production Codex hook is observational and must always fail open silently.
  }
  process.exitCode = 0;
}

void run().catch(() => {
  process.exitCode = 0;
});

export {
  CODEX_HOOK_ADAPTER_RESULTS,
  type CodexHookAdapterDependencies,
  type CodexHookAdapterResult,
  deliverCodexHook,
} from "./adapter.js";
export {
  type CodexHookAdapterConfiguration,
  type CodexHookAdapterEnvironment,
  readCodexHookAdapterConfiguration,
} from "./configuration.js";
export {
  CODEX_HOOK_ADAPTER_DEFAULT_TIMEOUT_MS,
  CODEX_HOOK_ADAPTER_INGRESS_PATH,
  CODEX_HOOK_ADAPTER_LOOPBACK_HOST,
  CODEX_HOOK_ADAPTER_MAX_RESPONSE_BYTES,
  CODEX_HOOK_ADAPTER_MAX_STDIN_BYTES,
  CODEX_HOOK_ADAPTER_VERSION,
} from "./constants.js";
export { type CodexHookInputSource, readSupportedCodexHookPayload } from "./input.js";
