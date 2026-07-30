import { randomBytes } from "node:crypto";

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { createInstallationTokenVerifier } from "../ingress/auth.js";
import { registerRuntimeRoutes, type RuntimeRouteController } from "./routes.js";

const token = randomBytes(32).toString("base64url");
const authorization = { authorization: `Bearer ${token}` };
const fingerprint = `sha256:${"a".repeat(64)}`;

function status() {
  return {
    ok: true as const,
    schemaVersion: 1 as const,
    installId: "install_1",
    instanceId: "instance_1",
    applicationVersion: "0.1.0" as const,
    daemonVersion: "0.1.0" as const,
    hookAdapterVersion: "0.1.0" as const,
    pid: 123,
    processStartIdentity: "123.456",
    port: 43123,
    phase: "ready" as const,
    pumpState: "idle" as const,
    startedAt: "2026-07-26T12:00:00.000Z",
    compatibility: {
      platform: "win32" as const,
      architecture: "x64" as const,
      nodeVersion: "24.18.0" as const,
      databaseSchemaVersion: 18 as const,
      installLayoutVersion: 1 as const,
      releaseManifestFingerprint: fingerprint,
    },
  };
}

function server(
  beginShutdown: RuntimeRouteController["beginShutdown"] = vi.fn(() => "accepted" as const),
  performShutdown: RuntimeRouteController["performShutdown"] = vi.fn(),
) {
  const instance = Fastify({ logger: false });
  registerRuntimeRoutes(instance, {
    tokenVerifier: createInstallationTokenVerifier(token),
    controller: { status, beginShutdown, performShutdown },
  });
  return { instance, beginShutdown, performShutdown };
}

describe("runtime routes", () => {
  it("authenticates status and returns controlled no-store data", async () => {
    const { instance } = server();
    expect((await instance.inject({ method: "GET", url: "/v1/runtime/status" })).statusCode).toBe(
      401,
    );
    const response = await instance.inject({
      method: "GET",
      url: "/v1/runtime/status",
      headers: authorization,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.json()).toMatchObject({ instanceId: "instance_1", port: 43123 });
    expect(response.body).not.toContain(token);
    await instance.close();
  });

  it("rejects query expansion and mismatched shutdown without side effects", async () => {
    const beginShutdown = vi.fn(() => "instance_mismatch" as const);
    const performShutdown = vi.fn();
    const { instance } = server(beginShutdown, performShutdown);
    expect(
      (
        await instance.inject({
          method: "GET",
          url: "/v1/runtime/status?detail=1",
          headers: authorization,
        })
      ).statusCode,
    ).toBe(400);
    const response = await instance.inject({
      method: "POST",
      url: "/v1/runtime/shutdown",
      headers: { ...authorization, "content-type": "application/json" },
      payload: { schemaVersion: 1, instanceId: "other" },
    });
    expect(response.statusCode).toBe(409);
    expect(performShutdown).not.toHaveBeenCalled();
    await instance.close();
  });

  it("acknowledges before scheduling graceful shutdown and rejects repeats", async () => {
    let accepted = false;
    const beginShutdown = vi.fn(() => {
      if (accepted) return "shutdown_in_progress" as const;
      accepted = true;
      return "accepted" as const;
    });
    const performShutdown = vi.fn();
    const { instance } = server(beginShutdown, performShutdown);
    const input = {
      method: "POST" as const,
      url: "/v1/runtime/shutdown",
      headers: { ...authorization, "content-type": "application/json" },
      payload: { schemaVersion: 1, instanceId: "instance_1" },
    };
    const first = await instance.inject(input);
    expect(first.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(performShutdown).toHaveBeenCalledTimes(1);
    expect((await instance.inject(input)).statusCode).toBe(409);
    await instance.close();
  });
});
