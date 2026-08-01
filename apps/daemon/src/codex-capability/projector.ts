import {
  type CodexCapabilityFactsV1,
  type CodexCapabilityLimitation,
  type CodexCapabilityStatusV1,
  type CodexConfigurationState,
  type CodexHookEngineState,
  type CodexManagedPolicyState,
  type CodexSourceSurface,
  CodexSourceSurfaceSchema,
  type CodexTrustState,
  projectCodexCapabilityStatusV1,
  SUPPORTED_CODEX_HOOK_NAMES,
} from "@ownloop/contracts/codex";

import type { OwnLoopPersistence } from "../persistence/index.js";

export type CodexCapabilityEnvironmentFacts = Readonly<{
  configurationState: CodexConfigurationState;
  hookEngineState: CodexHookEngineState;
  trustState: CodexTrustState;
  managedPolicyState: CodexManagedPolicyState;
  verifiedSourceSurfaces?: readonly CodexSourceSurface[];
  additionalLimitations?: readonly CodexCapabilityLimitation[];
}>;

function sortedUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function validatedVerifiedSurfaces(
  values: readonly CodexSourceSurface[] | undefined,
): ReadonlySet<CodexSourceSurface> {
  const parsed = (values ?? []).map((value) => CodexSourceSurfaceSchema.parse(value));
  if (parsed.length !== new Set(parsed).size || parsed.includes("unknown")) {
    throw new Error("Verified Codex source surfaces must be unique and cannot be unknown.");
  }
  return new Set(parsed);
}

function automaticLimitations(
  environment: CodexCapabilityEnvironmentFacts,
  observed: ReturnType<OwnLoopPersistence["codexCapabilities"]["readObservationFacts"]>,
): CodexCapabilityLimitation[] {
  const limitations = new Set<CodexCapabilityLimitation>(environment.additionalLimitations ?? []);
  if (environment.configurationState === "unavailable") {
    limitations.add("configuration_unavailable");
  }
  if (environment.hookEngineState === "unknown") limitations.add("hook_engine_unknown");
  if (environment.trustState === "unknown") limitations.add("trust_unknown");
  if (environment.managedPolicyState === "unknown") limitations.add("managed_policy_unknown");

  if (observed.receiptCount > 0) {
    const observedHooks = new Set(observed.observedHookNames);
    if (observedHooks.size !== SUPPORTED_CODEX_HOOK_NAMES.length) {
      limitations.add("incomplete_event_coverage");
    }
    if (observedHooks.has("PreToolUse") && !observedHooks.has("PostToolUse")) {
      limitations.add("missing_post_tool_use");
    }
    if (observedHooks.has("SubagentStart") !== observedHooks.has("SubagentStop")) {
      limitations.add("subagent_lineage_partial");
    }
    if (observed.sourceVersionMissing || observed.observedSourceVersions.length === 0) {
      limitations.add("source_version_unknown");
    }

    const verifiedSurfaces = validatedVerifiedSurfaces(environment.verifiedSourceSurfaces);
    if (
      observed.observedSourceSurfaces.some(
        (surface) => surface === "unknown" || !verifiedSurfaces.has(surface),
      )
    ) {
      limitations.add("client_surface_unverified");
    }
  } else {
    validatedVerifiedSurfaces(environment.verifiedSourceSurfaces);
  }
  return sortedUnique(limitations);
}

export function projectCodexCapabilityFromPersistence(
  persistence: OwnLoopPersistence,
  environment: CodexCapabilityEnvironmentFacts,
): CodexCapabilityStatusV1 {
  const observed = persistence.codexCapabilities.readObservationFacts();
  const facts: CodexCapabilityFactsV1 = {
    configurationState: environment.configurationState,
    hookEngineState: environment.hookEngineState,
    trustState: environment.trustState,
    managedPolicyState: environment.managedPolicyState,
    observedHookNames: [...observed.observedHookNames],
    observedSourceSurfaces: [...observed.observedSourceSurfaces],
    observedSourceVersions: [...observed.observedSourceVersions],
    lastObservedAt: observed.lastObservedAt,
    limitations: automaticLimitations(environment, observed),
  };
  return projectCodexCapabilityStatusV1(facts);
}
