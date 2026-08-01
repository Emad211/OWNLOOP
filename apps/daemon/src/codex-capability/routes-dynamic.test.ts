import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { CodexTrustState } from "@ownloop/contracts/codex";

import { createInstallationTokenVerifier, generateInstallationToken } from "../ingress/index.js";
import { openPersistence } from "../persistence/index.js";
import { CODEX_CAPABILITY_ROUTE, registerCodexCapabilityRoute } from "./routes.js";

describe("dynamic Codex capability environment", () => {
  it("re-inspects trust for every authenticated request", async () => {
    const persistence = openPersistence(":memory:");
    const server = Fastify({ logger: false });
    const token = generateInstallationToken();
    let trustState: CodexTrustState = "needs_trust";
    let inspections = 0;
    registerCodexCapabilityRoute(server, {
      persistence,
      tokenVerifier: createInstallationTokenVerifier(token),
      environment: async () => {
        inspections += 1;
        return {
          configurationState: "exact",
          hookEngineState: "enabled",
          trustState,
          managedPolicyState: "unrestricted",
          verifiedSourceSurfaces: [],
        };
      },
    });

    try {
      const first = await server.inject({
        method: "GET",
        url: CODEX_CAPABILITY_ROUTE,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        state: "needs_trust",
        facts: { trustState: "needs_trust" },
      });

      trustState = "trusted";
      const second = await server.inject({
        method: "GET",
        url: CODEX_CAPABILITY_ROUTE,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({
        state: "enabled_no_events_seen",
        facts: { trustState: "trusted" },
      });
      expect(inspections).toBe(2);
    } finally {
      await server.close();
      persistence.close();
    }
  });
});
