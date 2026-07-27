import type { AddressInfo } from "node:net";

import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { createInstallationTokenVerifier, generateInstallationToken } from "../ingress/index.js";
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
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (address === null || typeof address === "string") {
    await server.close();
    persistence.close();
    throw new Error("Expected an IPv4 loopback listener.");
  }
  return {
    token,
    persistence,
    server,
    url: `http://127.0.0.1:${(address as AddressInfo).port}`,
    async close(): Promise<void> {
      await server.close();
      persistence.close();
    },
  };
}

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function get(
  running: Awaited<ReturnType<typeof runningRoute>>,
  path: string,
  token: string | null,
): Promise<Readonly<{ response: Response; body: string }>> {
  const response = await fetch(`${running.url}${path}`, {
    method: "GET",
    ...(token === null ? {} : { headers: authorization(token) }),
  });
  return { response, body: await response.text() };
}

describe("Codex capability status route", () => {
  it("defaults to explicit unverified facts when installation inspection is unavailable", async () => {
    const running = await runningRoute();
    try {
      const { response, body } = await get(running, CODEX_CAPABILITY_ROUTE, running.token);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(Number(response.headers.get("content-length"))).toBe(Buffer.byteLength(body));
      expect(JSON.parse(body)).toEqual({
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
      const { response, body } = await get(running, CODEX_CAPABILITY_ROUTE, running.token);
      expect(response.status).toBe(200);
      expect(JSON.parse(body)).toMatchObject({
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
      const missing = await get(running, CODEX_CAPABILITY_ROUTE, null);
      const incorrect = await get(running, CODEX_CAPABILITY_ROUTE, generateInstallationToken());
      expect([missing.response.status, incorrect.response.status]).toEqual([401, 401]);
      expect(missing.body).toBe(incorrect.body);
      expect(JSON.parse(missing.body)).toEqual({ ok: false, error: "unauthorized" });

      const query = await get(running, `${CODEX_CAPABILITY_ROUTE}?include=payloads`, running.token);
      expect(query.response.status).toBe(400);
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
      const { response, body } = await get(running, CODEX_CAPABILITY_ROUTE, running.token);
      expect(response.status).toBe(500);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(JSON.parse(body)).toEqual({ ok: false, error: "projection_failed" });
      expect(body).not.toContain("fixture-private-inspection-stack");
    } finally {
      await running.close();
    }
  });
});
