import { CLAUDE_INGRESS_CONTRACT_VERSION, ClaudeAdapterIngressSchema } from "@ownloop/contracts";
import { type HookAdapterEnvironment, readHookAdapterConfiguration } from "./configuration.js";
import {
  HOOK_ADAPTER_DEFAULT_TIMEOUT_MS,
  HOOK_ADAPTER_MAX_REQUEST_BYTES,
  HOOK_ADAPTER_SOURCE,
  HOOK_ADAPTER_VERSION,
} from "./constants.js";
import { type HookInputSource, readSupportedHookPayload } from "./input.js";
import { isAcceptedIngressResponse } from "./response.js";

export const HOOK_ADAPTER_RESULTS = [
  "delivered",
  "skipped_configuration",
  "skipped_input",
  "skipped_delivery",
] as const;
export type HookAdapterResult = (typeof HOOK_ADAPTER_RESULTS)[number];

export type HookAdapterDependencies = Readonly<{
  input: HookInputSource;
  environment: HookAdapterEnvironment;
  fetchImplementation?: typeof fetch;
  clock?: () => Date;
  timeoutMs?: number;
  adapterVersion?: string;
}>;

function safeReceivedAt(clock: () => Date): string | null {
  const instant = clock();
  return instant instanceof Date && Number.isFinite(instant.getTime())
    ? instant.toISOString()
    : null;
}

function validTimeout(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 30_000;
}

export async function deliverHook(
  dependencies: HookAdapterDependencies,
): Promise<HookAdapterResult> {
  let configuration: ReturnType<typeof readHookAdapterConfiguration>;
  try {
    configuration = readHookAdapterConfiguration(dependencies.environment);
  } catch {
    return "skipped_configuration";
  }
  if (configuration === null) {
    return "skipped_configuration";
  }

  const payload = await readSupportedHookPayload(dependencies.input);
  if (payload === null) {
    return "skipped_input";
  }

  let receivedAt: string | null;
  try {
    receivedAt = safeReceivedAt(dependencies.clock ?? (() => new Date()));
  } catch {
    return "skipped_delivery";
  }
  if (receivedAt === null) {
    return "skipped_delivery";
  }
  const wrapped = ClaudeAdapterIngressSchema.safeParse({
    contractVersion: CLAUDE_INGRESS_CONTRACT_VERSION,
    source: HOOK_ADAPTER_SOURCE,
    adapterVersion: dependencies.adapterVersion ?? HOOK_ADAPTER_VERSION,
    receivedAt,
    payload,
  });
  if (!wrapped.success) {
    return "skipped_delivery";
  }

  let body: string;
  try {
    body = JSON.stringify(wrapped.data);
  } catch {
    return "skipped_delivery";
  }
  if (Buffer.byteLength(body, "utf8") > HOOK_ADAPTER_MAX_REQUEST_BYTES) {
    return "skipped_delivery";
  }

  const timeoutMs = dependencies.timeoutMs ?? HOOK_ADAPTER_DEFAULT_TIMEOUT_MS;
  if (!validTimeout(timeoutMs)) {
    return "skipped_delivery";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();

  try {
    const response = await (dependencies.fetchImplementation ?? fetch)(configuration.endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${configuration.installationToken}`,
        "content-type": "application/json",
      },
      body,
    });
    return (await isAcceptedIngressResponse(response)) ? "delivered" : "skipped_delivery";
  } catch {
    return "skipped_delivery";
  } finally {
    clearTimeout(timeout);
    body = "";
  }
}
