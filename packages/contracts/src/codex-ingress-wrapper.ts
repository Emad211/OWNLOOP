import { SemVerSchema } from "@ownloop/event-model";
import { z } from "zod";

import { CodexSourceSurfaceSchema } from "./codex-hook-common.js";
import { SupportedCodexHookPayloadSchema } from "./codex-hook-payloads.js";

export const CODEX_INGRESS_CONTRACT_VERSION = 1 as const;

export const CodexAdapterIngressSchema = z.strictObject({
  contractVersion: z.literal(CODEX_INGRESS_CONTRACT_VERSION),
  source: z.literal("codex"),
  adapterVersion: SemVerSchema,
  sourceVersion: z.string().min(1).max(256).nullish(),
  sourceSurface: CodexSourceSurfaceSchema,
  receivedAt: z.iso.datetime({ offset: true }),
  payload: SupportedCodexHookPayloadSchema,
});
export type CodexAdapterIngress = z.infer<typeof CodexAdapterIngressSchema>;
