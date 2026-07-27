import { z } from "zod";

import {
  CODEX_SOURCE_SURFACES,
  CodexSourceSurfaceSchema,
  SUPPORTED_CODEX_HOOK_NAMES,
  SupportedCodexHookNameSchema,
} from "./codex-hook-common.js";

export const CODEX_CAPABILITY_SCHEMA_VERSION = 1 as const;

export const CODEX_CAPABILITY_STATES = [
  "not_installed",
  "installed_unverified",
  "needs_trust",
  "enabled_no_events_seen",
  "active",
  "partial_surface",
  "repair_needed",
  "unsupported",
] as const;
export const CodexCapabilityStateSchema = z.enum(CODEX_CAPABILITY_STATES);
export type CodexCapabilityState = z.infer<typeof CodexCapabilityStateSchema>;

export const CODEX_CONFIGURATION_STATES = [
  "missing",
  "exact",
  "ambiguous",
  "invalid",
  "unavailable",
] as const;
export const CodexConfigurationStateSchema = z.enum(CODEX_CONFIGURATION_STATES);
export type CodexConfigurationState = z.infer<typeof CodexConfigurationStateSchema>;

export const CODEX_HOOK_ENGINE_STATES = ["enabled", "disabled", "unavailable", "unknown"] as const;
export const CodexHookEngineStateSchema = z.enum(CODEX_HOOK_ENGINE_STATES);
export type CodexHookEngineState = z.infer<typeof CodexHookEngineStateSchema>;

export const CODEX_TRUST_STATES = ["trusted", "needs_trust", "unknown", "not_applicable"] as const;
export const CodexTrustStateSchema = z.enum(CODEX_TRUST_STATES);
export type CodexTrustState = z.infer<typeof CodexTrustStateSchema>;

export const CODEX_MANAGED_POLICY_STATES = ["unrestricted", "managed_only", "unknown"] as const;
export const CodexManagedPolicyStateSchema = z.enum(CODEX_MANAGED_POLICY_STATES);
export type CodexManagedPolicyState = z.infer<typeof CodexManagedPolicyStateSchema>;

export const CODEX_CAPABILITY_LIMITATIONS = [
  "configuration_unavailable",
  "hook_engine_unknown",
  "trust_unknown",
  "managed_policy_unknown",
  "client_surface_unverified",
  "incomplete_event_coverage",
  "missing_post_tool_use",
  "subagent_lineage_partial",
  "source_version_unknown",
] as const;
export const CodexCapabilityLimitationSchema = z.enum(CODEX_CAPABILITY_LIMITATIONS);
export type CodexCapabilityLimitation = z.infer<typeof CodexCapabilityLimitationSchema>;

const canonicalTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid canonical UTC timestamp.");
const sourceVersionSchema = z.string().min(1).max(256);

function sortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

const observedHooksSchema = z
  .array(SupportedCodexHookNameSchema)
  .max(SUPPORTED_CODEX_HOOK_NAMES.length)
  .superRefine((value, context) => {
    if (!sortedUnique(value)) {
      context.addIssue({ code: "custom", message: "Observed Hooks must be sorted and unique." });
    }
  });
const sourceSurfacesSchema = z
  .array(CodexSourceSurfaceSchema)
  .max(CODEX_SOURCE_SURFACES.length)
  .superRefine((value, context) => {
    if (!sortedUnique(value)) {
      context.addIssue({ code: "custom", message: "Source surfaces must be sorted and unique." });
    }
  });
const sourceVersionsSchema = z
  .array(sourceVersionSchema)
  .max(16)
  .superRefine((value, context) => {
    if (!sortedUnique(value)) {
      context.addIssue({ code: "custom", message: "Source versions must be sorted and unique." });
    }
  });
const limitationsSchema = z
  .array(CodexCapabilityLimitationSchema)
  .max(CODEX_CAPABILITY_LIMITATIONS.length)
  .superRefine((value, context) => {
    if (!sortedUnique(value)) {
      context.addIssue({ code: "custom", message: "Limitations must be sorted and unique." });
    }
  });

export const CodexCapabilityFactsV1Schema = z.strictObject({
  configurationState: CodexConfigurationStateSchema,
  hookEngineState: CodexHookEngineStateSchema,
  trustState: CodexTrustStateSchema,
  managedPolicyState: CodexManagedPolicyStateSchema,
  observedHookNames: observedHooksSchema,
  observedSourceSurfaces: sourceSurfacesSchema,
  observedSourceVersions: sourceVersionsSchema,
  lastObservedAt: canonicalTimestampSchema.nullable(),
  limitations: limitationsSchema,
});
export type CodexCapabilityFactsV1 = z.infer<typeof CodexCapabilityFactsV1Schema>;

export const CodexCapabilityStatusV1Schema = z
  .strictObject({
    schemaVersion: z.literal(CODEX_CAPABILITY_SCHEMA_VERSION),
    state: CodexCapabilityStateSchema,
    facts: CodexCapabilityFactsV1Schema,
  })
  .superRefine((value, context) => {
    const hasEvents = value.facts.observedHookNames.length > 0;
    if (hasEvents !== (value.facts.lastObservedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["facts", "lastObservedAt"],
        message: "Observed events and lastObservedAt must reconcile.",
      });
    }
    if (value.state !== capabilityState(value.facts)) {
      context.addIssue({ code: "custom", message: "Capability state does not match its facts." });
    }
    if (value.state === "active" && value.facts.limitations.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Active capability cannot contain limitations.",
      });
    }
    if (value.state === "partial_surface" && value.facts.limitations.length === 0) {
      context.addIssue({ code: "custom", message: "Partial capability requires a limitation." });
    }
  });
export type CodexCapabilityStatusV1 = z.infer<typeof CodexCapabilityStatusV1Schema>;

function capabilityState(facts: CodexCapabilityFactsV1): CodexCapabilityState {
  if (facts.configurationState === "missing") return "not_installed";
  if (facts.configurationState === "ambiguous" || facts.configurationState === "invalid") {
    return "repair_needed";
  }
  if (facts.managedPolicyState === "managed_only" || facts.hookEngineState === "unavailable") {
    return "unsupported";
  }
  if (facts.configurationState !== "exact") return "installed_unverified";
  if (facts.hookEngineState === "disabled") return "unsupported";
  if (facts.trustState === "needs_trust") return "needs_trust";
  if (
    facts.hookEngineState !== "enabled" ||
    facts.trustState === "unknown" ||
    facts.managedPolicyState === "unknown"
  ) {
    return "installed_unverified";
  }
  if (facts.observedHookNames.length === 0) return "enabled_no_events_seen";
  return facts.limitations.length > 0 ? "partial_surface" : "active";
}

export function projectCodexCapabilityStatusV1(
  input: CodexCapabilityFactsV1,
): CodexCapabilityStatusV1 {
  const facts = CodexCapabilityFactsV1Schema.parse(input);
  return CodexCapabilityStatusV1Schema.parse({
    schemaVersion: CODEX_CAPABILITY_SCHEMA_VERSION,
    state: capabilityState(facts),
    facts,
  });
}
