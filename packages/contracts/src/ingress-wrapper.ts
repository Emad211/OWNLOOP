import { SemVerSchema } from "@ownloop/event-model";
import { z } from "zod";

import { SupportedClaudeHookPayloadSchema } from "./claude-hook-payloads.js";

export const CLAUDE_INGRESS_CONTRACT_VERSION = 1 as const;

export const ClaudeAdapterIngressSchema = z.strictObject({
  contractVersion: z.literal(CLAUDE_INGRESS_CONTRACT_VERSION),
  source: z.literal("claude_code"),
  adapterVersion: SemVerSchema,
  receivedAt: z.iso.datetime({ offset: true }),
  payload: SupportedClaudeHookPayloadSchema,
});
export type ClaudeAdapterIngress = z.infer<typeof ClaudeAdapterIngressSchema>;
