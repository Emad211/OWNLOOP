import {
  LocalDiagnosticsResponseV1Schema,
  LocalProviderPublicSettingsV1Schema,
  LocalRetentionPreviewV1Schema,
  LocalRunDeletionResultV1Schema,
  LocalSecretFieldPatternsSchema,
  LocalSettingsDocumentV1Schema,
  LocalSettingsResponseV1Schema,
  LocalProviderSecretResponseV1Schema,
  LocalRetentionApplyResultV1Schema,
  LocalSettingsUpdateRequestV1Schema,
} from "@ownloop/contracts";
import { describe, expect, it } from "vitest";

const updatedAt = "2026-07-25T22:30:00.000Z";
const provider = {
  providerFamily: "responses_json_v1",
  baseUrl: "https://api.provider.example.org/v1",
  modelId: "model-1",
  modelRevision: null,
  timeoutMs: 30_000,
  maxResponseBytes: 65_536,
  retryPolicy: { maxAttempts: 2, baseDelayMs: 100, maxRetryAfterMs: 1_000 },
} as const;
const settings = {
  schemaVersion: 1,
  id: "local",
  revision: 1,
  externalAiEnabled: false,
  provider: null,
  retentionPolicy: "keep_until_deleted",
  diagnosticMode: "off",
  rawSourcePayloadRetention: "off",
  customSecretFieldPatterns: [],
  updatedAt,
} as const;

describe("Local settings contracts", () => {
  it("accepts the strict default settings and rejects durable secret fields", () => {
    expect(LocalSettingsDocumentV1Schema.parse(settings)).toEqual(settings);
    expect(() =>
      LocalSettingsDocumentV1Schema.parse({ ...settings, providerApiKey: "secret" }),
    ).toThrow();
    expect(() =>
      LocalSettingsDocumentV1Schema.parse({
        ...settings,
        rawSourcePayloadRetention: "on",
      }),
    ).toThrow();
  });

  it("accepts bounded public provider settings and rejects unsafe URL shapes", () => {
    expect(LocalProviderPublicSettingsV1Schema.parse(provider)).toEqual(provider);
    for (const baseUrl of [
      "http://api.provider.example.org/v1",
      "https://user:pass@api.provider.example.org/v1",
      "https://api.provider.example.org/v1?secret=x",
      "https://api.provider.example.org/v2",
    ]) {
      expect(() => LocalProviderPublicSettingsV1Schema.parse({ ...provider, baseUrl })).toThrow();
    }
  });

  it("requires canonical bounded field-name patterns", () => {
    expect(LocalSecretFieldPatternsSchema.parse(["*token", "apikey", "private*"])).toEqual([
      "*token",
      "apikey",
      "private*",
    ]);
    for (const invalid of [
      ["apikey", "apikey"],
      ["private*", "apikey"],
      ["*"],
      ["ab"],
      ["api*key"],
      ["api_key"],
      ["actual-secret-value!"],
    ]) {
      expect(() => LocalSecretFieldPatternsSchema.parse(invalid)).toThrow();
    }
  });

  it("validates complete compare-and-swap replacement requests", () => {
    const request = {
      schemaVersion: 1,
      expectedRevision: 1,
      replacement: {
        schemaVersion: 1,
        externalAiEnabled: true,
        provider,
        retentionPolicy: "delete_terminal_after_30_days",
        diagnosticMode: "counts_only",
        rawSourcePayloadRetention: "off",
        customSecretFieldPatterns: ["apikey"],
      },
    } as const;
    expect(LocalSettingsUpdateRequestV1Schema.parse(request)).toEqual(request);
    expect(() =>
      LocalSettingsUpdateRequestV1Schema.parse({
        ...request,
        replacement: { ...request.replacement, providerApiKey: "secret" },
      }),
    ).toThrow();
  });

  it("binds provider configured status to settings plus memory-only secret status", () => {
    const response = {
      ok: true,
      schemaVersion: 1,
      settings: { ...settings, externalAiEnabled: true, provider },
      providerSecretStatus: "loaded",
      providerGenerationConfigured: true,
    } as const;
    expect(LocalSettingsResponseV1Schema.parse(response)).toEqual(response);
    expect(() =>
      LocalSettingsResponseV1Schema.parse({ ...response, providerGenerationConfigured: false }),
    ).toThrow();
    expect(() =>
      LocalSettingsResponseV1Schema.parse({
        ...response,
        providerSecretStatus: "absent",
      }),
    ).toThrow();
  });

  it("keeps disabled diagnostics empty and canonicalizes enabled counts", () => {
    expect(
      LocalDiagnosticsResponseV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        mode: "off",
        counts: [],
        rejectedByCode: [],
      }),
    ).toBeDefined();
    expect(() =>
      LocalDiagnosticsResponseV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        mode: "off",
        counts: [{ code: "server_started", count: 1 }],
        rejectedByCode: [],
      }),
    ).toThrow();
    expect(() =>
      LocalDiagnosticsResponseV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        mode: "counts_only",
        counts: [
          { code: "server_stopped", count: 1 },
          { code: "server_started", count: 1 },
        ],
        rejectedByCode: [],
      }),
    ).toThrow();
  });

  it("enforces retention preview totals and terminal-only candidates", () => {
    const preview = {
      ok: true,
      schemaVersion: 1,
      policy: "delete_terminal_after_7_days",
      cutoff: "2026-07-18T22:30:00.000Z",
      totalEligible: 1,
      truncated: false,
      runs: [
        {
          runId: "run-1",
          conversationId: "conversation-1",
          runNumber: 1,
          status: "Completed",
          endedAt: "2026-07-10T22:30:00.000Z",
        },
      ],
    } as const;
    expect(LocalRetentionPreviewV1Schema.parse(preview)).toEqual(preview);
    expect(() =>
      LocalRetentionPreviewV1Schema.parse({
        ...preview,
        runs: [{ ...preview.runs[0], status: "Capturing" }],
      }),
    ).toThrow();
    expect(() =>
      LocalRetentionPreviewV1Schema.parse({ ...preview, totalEligible: 2, truncated: false }),
    ).toThrow();
    expect(
      LocalRetentionPreviewV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        policy: "keep_until_deleted",
        cutoff: null,
        totalEligible: 0,
        truncated: false,
        runs: [],
      }),
    ).toBeDefined();
  });

  it("prevents non-deletion results from claiming artifact deletion", () => {
    const result = {
      ok: true,
      schemaVersion: 1,
      runId: "run-1",
      outcome: "not_found",
      artifactGc: { scanned: 0, deleted: 0, retained: 0, failures: 0 },
    } as const;
    expect(LocalRunDeletionResultV1Schema.parse(result)).toEqual(result);
    expect(() =>
      LocalRunDeletionResultV1Schema.parse({
        ...result,
        artifactGc: { ...result.artifactGc, deleted: 1 },
      }),
    ).toThrow();
  });

  it("rejects inconsistent secret, deletion, GC, and retention aggregates", () => {
    expect(() =>
      LocalProviderSecretResponseV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        providerSecretStatus: "loaded",
        providerGenerationConfigured: false,
      }),
    ).toThrow();
    expect(() =>
      LocalRunDeletionResultV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        runId: "run-1",
        outcome: "not_found",
        artifactGc: { scanned: 1, deleted: 0, retained: 1, failures: 0 },
      }),
    ).toThrow();
    expect(() =>
      LocalRetentionApplyResultV1Schema.parse({
        ok: true,
        schemaVersion: 1,
        policy: "delete_terminal_after_30_days",
        cutoff: "2026-07-01T00:00:00.000Z",
        considered: 2,
        deletedRunIds: ["run-1"],
        retainedRunIds: ["run-1"],
        artifactGc: { scanned: 0, deleted: 0, retained: 0, failures: 0 },
      }),
    ).toThrow();
  });
});
