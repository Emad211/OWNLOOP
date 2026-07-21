#!/usr/bin/env node

import { deliverHook } from "./adapter.js";

async function run(): Promise<void> {
  try {
    await deliverHook({
      input: process.stdin,
      environment: process.env,
    });
  } catch {
    // The production hook is observational and must always fail open silently.
  }
  process.exitCode = 0;
}

void run().catch(() => {
  process.exitCode = 0;
});

export {
  deliverHook,
  HOOK_ADAPTER_RESULTS,
  type HookAdapterDependencies,
  type HookAdapterResult,
} from "./adapter.js";
export {
  type HookAdapterConfiguration,
  type HookAdapterEnvironment,
  readHookAdapterConfiguration,
} from "./configuration.js";
export {
  HOOK_ADAPTER_DEFAULT_TIMEOUT_MS,
  HOOK_ADAPTER_INGRESS_PATH,
  HOOK_ADAPTER_LOOPBACK_HOST,
  HOOK_ADAPTER_MAX_RESPONSE_BYTES,
  HOOK_ADAPTER_MAX_STDIN_BYTES,
  HOOK_ADAPTER_VERSION,
} from "./constants.js";
export { type HookInputSource, readSupportedHookPayload } from "./input.js";
