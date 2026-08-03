import { LocalSettingsResponseV1Schema } from "@ownloop/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ReplayApiClient } from "./api.js";
import {
  AVALAI_BASE_URLS,
  AvalAiSetupPanel,
  avalAiRegionFromSettings,
  buildAvalAiSettingsUpdate,
} from "./AvalAiSetupApp.js";

const client = Object.freeze({}) as ReplayApiClient;

const response = LocalSettingsResponseV1Schema.parse({
  ok: true,
  schemaVersion: 1,
  settings: {
    schemaVersion: 1,
    id: "local",
    revision: 7,
    externalAiEnabled: false,
    provider: null,
    retentionPolicy: "delete_terminal_after_30_days",
    diagnosticMode: "counts_only",
    rawSourcePayloadRetention: "off",
    customSecretFieldPatterns: ["*credential", "private*"],
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  providerSecretStatus: "absent",
  providerGenerationConfigured: false,
});

describe("Persian AvalAI setup", () => {
  it("renders only the focused domain, model, and memory-only key controls", () => {
    const html = renderToStaticMarkup(
      <AvalAiSetupPanel
        client={client}
        initialResponse={response}
        onUnauthorized={() => undefined}
      />,
    );

    expect(html).toContain("AvalAI · مغز لحظه‌ها");
    expect(html).toContain("داخل ایران");
    expect(html).toContain("مسیر جهانی");
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("کلید فقط در حافظهٔ daemon می‌ماند");
    expect(html).toContain("Git + Evidence");
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("sessionStorage");
  });

  it("preserves unrelated privacy and retention settings while enabling AvalAI", () => {
    const request = buildAvalAiSettingsUpdate(response, "global", "  model/example-v1  ");

    expect(request.expectedRevision).toBe(7);
    expect(request.replacement.externalAiEnabled).toBe(true);
    expect(request.replacement.provider).toMatchObject({
      providerFamily: "responses_json_v1",
      baseUrl: AVALAI_BASE_URLS.global,
      modelId: "model/example-v1",
      modelRevision: null,
    });
    expect(request.replacement.retentionPolicy).toBe("delete_terminal_after_30_days");
    expect(request.replacement.diagnosticMode).toBe("counts_only");
    expect(request.replacement.rawSourcePayloadRetention).toBe("off");
    expect(request.replacement.customSecretFieldPatterns).toEqual(["*credential", "private*"]);
  });

  it("uses only the two official AvalAI routes and rejects unsafe model identifiers", () => {
    const globalResponse = LocalSettingsResponseV1Schema.parse({
      ...response,
      settings: {
        ...response.settings,
        externalAiEnabled: true,
        provider: {
          providerFamily: "responses_json_v1",
          baseUrl: AVALAI_BASE_URLS.global,
          modelId: "model-v1",
          modelRevision: null,
          timeoutMs: 30_000,
          maxResponseBytes: 256 * 1024,
          retryPolicy: { maxAttempts: 2, baseDelayMs: 250, maxRetryAfterMs: 5_000 },
        },
      },
      providerSecretStatus: "loaded",
      providerGenerationConfigured: true,
    });

    expect(avalAiRegionFromSettings(response)).toBe("iran");
    expect(avalAiRegionFromSettings(globalResponse)).toBe("global");
    expect(() => buildAvalAiSettingsUpdate(response, "iran", "bad model id")).toThrow(
      "invalid_model_id",
    );
  });
});
