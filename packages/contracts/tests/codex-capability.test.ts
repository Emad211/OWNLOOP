import { describe, expect, it } from "vitest";

import {
  type CodexCapabilityFactsV1,
  CodexCapabilityStatusV1Schema,
  projectCodexCapabilityStatusV1,
} from "../src/codex.js";

const AT = "2026-07-27T16:30:00.000Z";

function facts(overrides: Partial<CodexCapabilityFactsV1> = {}): CodexCapabilityFactsV1 {
  return {
    configurationState: "exact",
    hookEngineState: "enabled",
    trustState: "trusted",
    managedPolicyState: "unrestricted",
    observedHookNames: [],
    observedSourceSurfaces: [],
    observedSourceVersions: [],
    lastObservedAt: null,
    limitations: [],
    ...overrides,
  };
}

describe("Codex capability projection", () => {
  it.each([
    [facts({ configurationState: "missing" }), "not_installed"],
    [facts({ configurationState: "unavailable" }), "installed_unverified"],
    [facts({ configurationState: "partial" }), "repair_needed"],
    [facts({ configurationState: "ambiguous" }), "repair_needed"],
    [facts({ configurationState: "invalid" }), "repair_needed"],
    [facts({ managedPolicyState: "managed_only" }), "unsupported"],
    [facts({ hookEngineState: "unavailable" }), "unsupported"],
    [facts({ hookEngineState: "disabled" }), "unsupported"],
    [facts({ trustState: "needs_trust" }), "needs_trust"],
    [facts({ hookEngineState: "unknown" }), "installed_unverified"],
    [facts({ trustState: "unknown" }), "installed_unverified"],
    [facts({ managedPolicyState: "unknown" }), "installed_unverified"],
    [facts(), "enabled_no_events_seen"],
    [
      facts({
        observedHookNames: ["PostToolUse", "SessionStart"],
        observedSourceSurfaces: ["cli"],
        observedSourceVersions: ["codex-cli 0.133.0"],
        lastObservedAt: AT,
      }),
      "active",
    ],
    [
      facts({
        observedHookNames: ["PostToolUse", "SessionStart"],
        observedSourceSurfaces: ["desktop"],
        observedSourceVersions: ["codex-desktop 1.0.0"],
        lastObservedAt: AT,
        limitations: ["client_surface_unverified"],
      }),
      "partial_surface",
    ],
  ] as const)("projects deterministic state %s", (input, state) => {
    expect(projectCodexCapabilityStatusV1(input)).toMatchObject({ schemaVersion: 1, state });
  });

  it("rejects unsorted or duplicate observed facts", () => {
    expect(() =>
      projectCodexCapabilityStatusV1(
        facts({
          observedHookNames: ["SessionStart", "PostToolUse"],
          lastObservedAt: AT,
        }),
      ),
    ).toThrow();
    expect(() =>
      projectCodexCapabilityStatusV1(
        facts({
          observedSourceVersions: ["1.0.0", "1.0.0"],
        }),
      ),
    ).toThrow();
  });

  it("requires observed hooks and last-observed time to reconcile", () => {
    expect(
      CodexCapabilityStatusV1Schema.safeParse({
        schemaVersion: 1,
        state: "active",
        facts: facts({ observedHookNames: ["SessionStart"], lastObservedAt: null }),
      }).success,
    ).toBe(false);
    expect(
      CodexCapabilityStatusV1Schema.safeParse({
        schemaVersion: 1,
        state: "enabled_no_events_seen",
        facts: facts({ lastObservedAt: AT }),
      }).success,
    ).toBe(false);
  });

  it("does not permit active or partial status to contradict limitations", () => {
    expect(
      CodexCapabilityStatusV1Schema.safeParse({
        schemaVersion: 1,
        state: "active",
        facts: facts({
          observedHookNames: ["SessionStart"],
          lastObservedAt: AT,
          limitations: ["incomplete_event_coverage"],
        }),
      }).success,
    ).toBe(false);
    expect(
      CodexCapabilityStatusV1Schema.safeParse({
        schemaVersion: 1,
        state: "partial_surface",
        facts: facts({ observedHookNames: ["SessionStart"], lastObservedAt: AT }),
      }).success,
    ).toBe(false);
  });
});
