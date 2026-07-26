import { createSecretKey } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { LocalArtifactStore } from "../artifact-store/index.js";
import {
  createLoopbackIngressServer,
  generateInstallationToken,
  startLoopbackIngressServer,
} from "../ingress/index.js";
import { LocalSettingsService } from "../local-settings/index.js";
import { openPersistence } from "../persistence/index.js";

const servers: ReturnType<typeof createLoopbackIngressServer>[] = [];
const at = "2026-07-25T23:00:00.000Z";

function artifactStore(): LocalArtifactStore {
  return {
    readPreparedBytes: async () => {
      throw new Error("No diagnostic validation artifact should be read in this fixture.");
    },
    collectUnreferencedArtifacts: async () => ({
      candidates: 0,
      metadataDeleted: 0,
      objectsDeleted: 0,
      objectsMissing: 0,
      skippedReferenced: 0,
    }),
  } as unknown as LocalArtifactStore;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("diagnostics dashboard loopback routes", () => {
  it("authenticates before reads and returns strict no-store sanitized responses", async () => {
    const persistence = openPersistence(":memory:");
    const token = generateInstallationToken();
    const store = artifactStore();
    const updateAt = new Date(Date.parse(persistence.localSettings.get().updatedAt) + 1_000);
    const settings = new LocalSettingsService({
      persistence,
      artifactStore: store,
      clock: () => updateAt,
    });
    settings.update({
      schemaVersion: 1,
      expectedRevision: 1,
      replacement: {
        schemaVersion: 1,
        externalAiEnabled: false,
        provider: null,
        retentionPolicy: "keep_until_deleted",
        diagnosticMode: "counts_only",
        rawSourcePayloadRetention: "off",
        customSecretFieldPatterns: [],
      },
    });
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey: createSecretKey(Buffer.alloc(32, 4)),
      settings,
      replay: { persistence, artifactStore: store },
      clock: () => new Date(at),
    });
    servers.push(server);
    const address = await startLoopbackIngressServer(server, 0);
    const auth = { authorization: `Bearer ${token}` };

    expect((await fetch(`${address.url}/v1/diagnostics/dashboard`)).status).toBe(401);
    const invalidQuery = await fetch(`${address.url}/v1/diagnostics/dashboard?expand=1`, {
      headers: auth,
    });
    expect(invalidQuery.status).toBe(400);
    expect(invalidQuery.headers.get("cache-control")).toBe("no-store");
    expect(invalidQuery.headers.get("x-content-type-options")).toBe("nosniff");
    const invalidBundleQuery = await fetch(`${address.url}/v1/diagnostics/bundle?expand=1`, {
      headers: auth,
    });
    expect(invalidBundleQuery.status).toBe(400);
    expect(invalidBundleQuery.headers.get("cache-control")).toBe("no-store");
    expect(invalidBundleQuery.headers.get("x-content-type-options")).toBe("nosniff");

    const dashboard = await fetch(`${address.url}/v1/diagnostics/dashboard`, { headers: auth });
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get("cache-control")).toBe("no-store");
    expect(dashboard.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dashboard.headers.get("content-type")).toContain("application/json");
    expect(dashboard.headers.get("content-type")).toContain("charset=utf-8");
    const dashboardBody = await dashboard.text();
    expect(Number(dashboard.headers.get("content-length"))).toBe(
      Buffer.byteLength(dashboardBody, "utf8"),
    );
    const value = JSON.parse(dashboardBody) as Record<string, unknown>;
    expect(value).toMatchObject({
      diagnosticMode: "counts_only",
      runs: { totalRuns: 0 },
      recentRuns: [],
    });
    expect(JSON.stringify(value)).not.toMatch(/apiKey|redacted_payload_json|repositoryRoot/u);

    const bundle = await fetch(`${address.url}/v1/diagnostics/bundle`, { headers: auth });
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-disposition")).toBe(
      'attachment; filename="ownloop-diagnostics-v1.json"',
    );
    expect(bundle.headers.get("cache-control")).toBe("no-store");
    expect(bundle.headers.get("x-content-type-options")).toBe("nosniff");
    expect(bundle.headers.get("content-type")).toContain("application/json");
    expect(bundle.headers.get("content-type")).toContain("charset=utf-8");
    const bundleBody = await bundle.text();
    expect(Number(bundle.headers.get("content-length"))).toBe(
      Buffer.byteLength(bundleBody, "utf8"),
    );
    const bundleValue = JSON.parse(bundleBody) as {
      dashboard: { fingerprint: string };
      dashboardFingerprint: string;
      excludedDataClasses: string[];
    };
    expect(bundleValue.dashboard.fingerprint).toBe(bundleValue.dashboardFingerprint);
    expect(bundleValue.excludedDataClasses).toContain("source_payload_json");

    const unsupported = await fetch(`${address.url}/v1/diagnostics/dashboard`, {
      method: "POST",
      headers: auth,
    });
    expect(unsupported.status).toBe(404);
    expect(unsupported.headers.get("cache-control")).toBe("no-store");
    expect(unsupported.headers.get("x-content-type-options")).toBe("nosniff");

    await server.close();
    persistence.close();
  });
});
