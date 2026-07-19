import { SemVerSchema } from "@ownloop/event-model";
import { z } from "zod";

import { SupportedClaudeHookNameSchema } from "./claude-hook-common.js";

const nonEmptyStringSchema = z.string().min(1);

export const ClaudeSourceMetadataSchema = z.strictObject({
  source: z.literal("claude_code"),
  sourceSessionId: nonEmptyStringSchema,
  sourceEventName: SupportedClaudeHookNameSchema,
  sourceEventId: nonEmptyStringSchema.nullish(),
  promptId: z.uuid().nullish(),
  transcriptPath: nonEmptyStringSchema,
  cwd: nonEmptyStringSchema,
  permissionMode: nonEmptyStringSchema.nullish(),
  effortLevel: nonEmptyStringSchema.nullish(),
  agentId: nonEmptyStringSchema.nullish(),
  agentType: nonEmptyStringSchema.nullish(),
  adapterVersion: SemVerSchema,
  sourceVersion: nonEmptyStringSchema.nullish(),
});
export type ClaudeSourceMetadata = z.infer<typeof ClaudeSourceMetadataSchema>;
