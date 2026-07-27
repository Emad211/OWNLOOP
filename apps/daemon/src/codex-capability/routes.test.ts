import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import {
  createInstallationTokenVerifier,
  generateInstallationToken,
} from "../ingress/index.js";
import { openPersistence } from "../persistence/index.js";
import { CODEX_CAPABILITY_ROUTE, registerCodexCapabilityRoute } from "./routes.js";

async function runningRoute(
  environment?: Parameters<typeof registerCodexCapabilityRoute>[1]["environment"],
) {
  const persistence = openPersistence(":memory:");
  const token = generateInstallationToken();
  const server = Fastify({ logger: false });
  registerCodexCapabilityRoute(server, {
    persistence,
    tokenVerifier: createInstallationTokenVerifier(token),
    ...(environment === undefined ? {} : { environment }),
  });
  await server.ready();
  return {
    token,
    persistence,
    server,
    async close(): Promise<void> {
      await server.close();
      persistence.close();
    },
  };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe("Codex capability status route", () => {
  it("defaults to explicit unverified facts when installation inspection is unavailable", async () => {
    const running = await runningRoute();
    try {
      const response = await running.server.inject({
        method: "GET",
        url: CODEX_CAPABILITY_ROUTE,
        headers: authorization(running.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-type"]).toContain("application/json");
      expect(Number(response.headers["content-length"])).toBe(Buffer.byteLength(response.body));
      expect(JSON.parse(response.body)).toEqual({
        facts: {
          configurationState: "unavailable",
          hookEngineState: "unknown",
          lastObservedAt: null,
          limitations: [
            "configuration_unavailable",
            "hook_engine_unknown",
            "managed_policy_unknown",
            "trust_unknown",
          ],
          managedPolicyState: "unknown",
          observedHookNames: [],
          observedSourceSurfaces: [],
          observedSourceVersions: [],
          trustState: "unknown",
        },
        schemaVersion: 1,
        state: "installed_unverified",
      });
    } finally {
      await running.close();
    }
  });

  it("reports enabled-no-events without claiming active support", async () => {
    const running = await runningRoute(() => ({
      configurationState: "exact",
      hookEngineState: "enabled",
      trustState: "trusted",
      managedPolicyState: "unrestricted",
      verifiedSourceSurfaces: ["cli"],
    }));
    try {
      const response = await running.server.inject({
        method: "GET",
        url: CODEX_CAPABILITY_ROUTE,
        headers: authorization(running.token),
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({
        state: "enabled_no_events_seen",
        facts: { observedHookNames: [], lastObservedAt: null, limitations: [] },
      });
    } finally {
      await running.close();
    }
  });

  it("requires the installation token and rejects query-controlled expansion", async () => {
    const running = await runningRoute();
    try {
      const missing = await running.server.inject({ method: "GET", url: CODEX_CAPABILITY_ROUTE });
      const incorrect = await running.server.inject({
        method: "GET",
        url: CODEX_CAPABILITY_ROUTE,
        headers: authorization(generateInstallationToken()),
      });
      expect([missing.statusCode, incorrect.statusCode]).toEqual([401, 401]);
      expect(missing.body).toBe(incorrect.body);
      expect(JSON.parse(missing.body)).toEqual({ ok: false, error: "unauthorized" });

      const query = await running.server.inject({
        method: "GET",
        url: `${CODEX_CAPABILITY_ROUTE}?include=payloads`,
        headers: authorization(running.token),
      });
      expect(query.statusCode).toBe(400);
      expect(JSON.parse(query.body)).toEqual({ ok: false, error: "invalid_request" });
    } finally {
      await running.close();
    }
  });

  it("maps inspection failures to a bounded generic projection error", async () => {
    const running = await runningRoute(() => {
      throw new Error("fixture-private-inspection-stack");
    });
    try {
      const response = await running.server.inject({
        method: "GET",
        url: CODEX_CAPABILITY_ROUTE,
        headers: authorization(running.token),
      });
      expect(response.statusCode).toBe(500);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(JSON.parse(response.body)).toEqual({ ok: false, error: "projection_failed" });
      expect(response.body).not.toContain("fixture-private-inspection-stack");
    } finally {
      await running.close();
    }
  });
});
