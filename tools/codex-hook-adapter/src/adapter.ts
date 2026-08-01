import {
  CODEX_INGRESS_CONTRACT_VERSION,
  CodexAdapterIngressSchema,
} from "@ownloop/contracts/codex";

import {
  type CodexHookAdapterEnvironment,
  readCodexHookAdapterConfiguration,
} from "./configuration.js";
import {
  CODEX_HOOK_ADAPTER_DEFAULT_TIMEOUT_MS,
  CODEX_HOOK_ADAPTER_MAX_REQUEST_BYTES,
  CODEX_HOOK_ADAPTER_SOURCE,
  CODEX_HOOK_ADAPTER_VERSION,
} from "./constants.js";
import { type CodexHookInputSource, readSupportedCodexHookPayload } from "./input.js";
import { isAcceptedCodexIngressResponse } from "./response.js";

export const CODEX_HOOK_ADAPTER_RESULTS = [
  "delivered",
  "skipped_configuration",
  "skipped_input",
  "skipped_delivery",
] as const;
export type CodexHookAdapterResult = (typeof CODEX_HOOK_ADAPTER_RESULTS)[number];

export type CodexHookAdapterDependencies = Readonly<{
  input: CodexHookInputSource;
  environment: CodexHookAdapterEnvironment;
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

export async function deliverCodexHook(
  dependencies: CodexHookAdapterDependencies,
): Promise<CodexHookAdapterResult> {
  let configuration: ReturnType<typeof readCodexHookAdapterConfiguration>;
  try {
    configuration = readCodexHookAdapterConfiguration(dependencies.environment);
  } catch {
    return "skipped_configuration";
  }
  if (configuration === null) return "skipped_configuration";

  const payload = await readSupportedCodexHookPayload(dependencies.input);
  if (payload === null) return "skipped_input";

  let receivedAt: string | null;
  try {
    receivedAt = safeReceivedAt(dependencies.clock ?? (() => new Date()));
  } catch {
    return "skipped_delivery";
  }
  if (receivedAt === null) return "skipped_delivery";

  const wrapped = CodexAdapterIngressSchema.safeParse({
    contractVersion: CODEX_INGRESS_CONTRACT_VERSION,
    source: CODEX_HOOK_ADAPTER_SOURCE,
    adapterVersion: dependencies.adapterVersion ?? CODEX_HOOK_ADAPTER_VERSION,
    sourceVersion: configuration.sourceVersion,
    sourceSurface: configuration.sourceSurface,
    receivedAt,
    payload,
  });
  if (!wrapped.success) return "skipped_delivery";

  let body: string;
  try {
    body = JSON.stringify(wrapped.data);
  } catch {
    return "skipped_delivery";
  }
  if (Buffer.byteLength(body, "utf8") > CODEX_HOOK_ADAPTER_MAX_REQUEST_BYTES) {
    return "skipped_delivery";
  }

  const timeoutMs = dependencies.timeoutMs ?? CODEX_HOOK_ADAPTER_DEFAULT_TIMEOUT_MS;
  if (!validTimeout(timeoutMs)) return "skipped_delivery";
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
    return (await isAcceptedCodexIngressResponse(response)) ? "delivered" : "skipped_delivery";
  } catch {
    return "skipped_delivery";
  } finally {
    clearTimeout(timeout);
    body = "";
  }
}
