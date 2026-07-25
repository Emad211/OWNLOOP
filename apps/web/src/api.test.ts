import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMomentInteractionId, createReplayApiClient, ReplayApiError } from "./api.js";

const TOKEN = "A".repeat(43);
const PAGE_ORIGIN = "http://127.0.0.1:4021";

const VALIDATION_ID = `val_${"b".repeat(48)}`;
const MOMENT_ID = `mom_${"c".repeat(48)}`;
const INTERACTION_ID = `ix_${"d".repeat(48)}`;
const FINGERPRINT = `sha256:${"e".repeat(64)}`;
const STATE = {
  momentId: MOMENT_ID,
  sourceIndex: 0,
  sourceCandidateFingerprint: FINGERPRINT,
  momentType: "change",
  viewCount: 1,
  evidenceViewCount: 0,
  acknowledgement: null,
  decisionResponse: null,
  riskResponse: null,
  checkChoiceId: null,
  usefulness: "unset",
  latestInteractionAt: "2026-07-25T15:00:00.000Z",
  interactionCount: 1,
  ownershipRecordCount: 0,
} as const;
const STATE_RESPONSE = {
  ok: true,
  schemaVersion: 1,
  runId: "run-1",
  validationId: VALIDATION_ID,
  states: [STATE],
  totalInteractionCount: 1,
  totalOwnershipRecordCount: 0,
  recentInteractions: [
    {
      schemaVersion: 1,
      interactionId: INTERACTION_ID,
      actor: "local_user",
      runId: "run-1",
      validationId: VALIDATION_ID,
      momentId: MOMENT_ID,
      sourceIndex: 0,
      sourceCandidateFingerprint: FINGERPRINT,
      momentType: "change",
      action: { kind: "moment_viewed" },
      requestFingerprint: FINGERPRINT,
      createdAt: "2026-07-25T15:00:00.000Z",
    },
  ],
  recentOwnershipRecords: [],
  interactionHistoryTruncated: false,
  ownershipRecordHistoryTruncated: false,
} as const;

const listResponse = {
  ok: true,
  schemaVersion: 1,
  runs: [],
  nextCursor: null,
} as const;

beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: PAGE_ORIGIN } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("replay browser API client", () => {
  it("uses only the current page origin and sends the token only as a Bearer header", async () => {
    const calls: Array<Readonly<{ url: string; authorization: string | null }>> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: input instanceof URL ? input.toString() : String(input),
        authorization: headers.get("authorization"),
      });
      return new Response(JSON.stringify(listResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createReplayApiClient(TOKEN, { fetcher });
    expect(await client.listRuns()).toEqual(listResponse);
    expect(calls).toEqual([
      {
        url: `${PAGE_ORIGIN}/v1/replay/runs?limit=25`,
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
    expect(calls[0]?.url).not.toContain(TOKEN);
  });

  it("rejects non-loopback page origins and invalid response contracts", async () => {
    vi.stubGlobal("window", { location: { origin: "https://example.com" } });
    expect(() => createReplayApiClient(TOKEN)).toThrowError(ReplayApiError);
    vi.stubGlobal("window", { location: { origin: PAGE_ORIGIN } });
    const client = createReplayApiClient(TOKEN, {
      fetcher: async () =>
        new Response(JSON.stringify({ ok: true, runs: [{ repositoryRoot: "/private" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(client.listRuns()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("loads Moments through the current Run-scoped read-only route", async () => {
    const calls: string[] = [];
    const projection = {
      ok: true,
      schemaVersion: 1,
      projectionVersion: "0.1.0",
      runId: "run-1",
      outcome: "not_available",
      diagnosticCode: "validation_not_available",
      limitations: [],
      finalizationId: null,
      generationId: null,
      validationId: null,
      validationKey: null,
      sourceCandidateArtifactId: null,
      sourceCandidateFingerprint: null,
      reportArtifactId: null,
      reportFingerprint: null,
      evidenceGraphArtifactId: null,
      evidenceGraphInputFingerprint: null,
      sourceVersions: null,
      policyVersions: null,
      selectedCount: 0,
      moments: [],
    } as const;
    const client = createReplayApiClient(TOKEN, {
      fetcher: async (input, init) => {
        calls.push(input instanceof URL ? input.toString() : String(input));
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify(projection), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(await client.getMoments("run-1")).toEqual(projection);
    expect(calls).toEqual([`${PAGE_ORIGIN}/v1/replay/runs/run-1/moments`]);
    await expect(client.getMoments("../run")).rejects.toMatchObject({ code: "not_found" });
  });

  it("resolves evidence only through the current Run-scoped loopback route", async () => {
    const evidenceId = `ev_${"a".repeat(48)}`;
    const calls: string[] = [];
    const client = createReplayApiClient(TOKEN, {
      fetcher: async (input) => {
        calls.push(input instanceof URL ? input.toString() : String(input));
        return new Response(
          JSON.stringify({
            ok: true,
            schemaVersion: 1,
            runId: "run-1",
            evidenceId,
            nodeKind: "changed_file",
            graphOutcome: "partial",
            limitations: ["diff_hunks_not_retained"],
            anchor: { kind: "changed_file", sectionId: "changed-files", sourceId: "file-event" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(await client.resolveEvidence("run-1", evidenceId)).toMatchObject({
      runId: "run-1",
      evidenceId,
    });
    expect(calls).toEqual([`${PAGE_ORIGIN}/v1/replay/runs/run-1/evidence/${evidenceId}`]);
    await expect(client.resolveEvidence("../run", evidenceId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("loads exact validation interaction state and records strict POST bodies", async () => {
    const calls: Array<
      Readonly<{ url: string; method: string; contentType: string | null; body: string | null }>
    > = [];
    const receipt = {
      ok: true,
      schemaVersion: 1,
      interactionId: INTERACTION_ID,
      runId: "run-1",
      validationId: VALIDATION_ID,
      momentId: MOMENT_ID,
      actionKind: "moment_viewed",
      createdAt: "2026-07-25T15:00:00.000Z",
      ownershipRecordId: null,
      idempotentReplay: false,
      state: STATE,
    } as const;
    const fetcher: typeof fetch = async (input, init) => {
      const url = input instanceof URL ? input.toString() : String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        contentType: headers.get("content-type"),
        body: typeof init?.body === "string" ? init.body : null,
      });
      return new Response(JSON.stringify(init?.method === "POST" ? receipt : STATE_RESPONSE), {
        status: init?.method === "POST" ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createReplayApiClient(TOKEN, { fetcher });
    expect(await client.getMomentInteractionState("run-1", VALIDATION_ID)).toEqual(STATE_RESPONSE);
    const request = {
      schemaVersion: 1,
      interactionId: INTERACTION_ID,
      validationId: VALIDATION_ID,
      action: { kind: "moment_viewed" },
    } as const;
    expect(await client.recordMomentInteraction("run-1", MOMENT_ID, request)).toEqual(receipt);
    expect(calls).toEqual([
      {
        url: `${PAGE_ORIGIN}/v1/replay/runs/run-1/moment-interactions?validationId=${VALIDATION_ID}`,
        method: "GET",
        contentType: null,
        body: null,
      },
      {
        url: `${PAGE_ORIGIN}/v1/replay/runs/run-1/moments/${MOMENT_ID}/interactions`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(request),
      },
    ]);
  });

  it("rejects valid-shaped interaction responses for another context", async () => {
    const wrongState = { ...STATE_RESPONSE, runId: "run-2" } as const;
    const stateClient = createReplayApiClient(TOKEN, {
      fetcher: async () =>
        new Response(JSON.stringify(wrongState), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(
      stateClient.getMomentInteractionState("run-1", VALIDATION_ID),
    ).rejects.toMatchObject({ code: "invalid_response" });

    const wrongReceipt = {
      ok: true,
      schemaVersion: 1,
      interactionId: INTERACTION_ID,
      runId: "run-1",
      validationId: VALIDATION_ID,
      momentId: MOMENT_ID,
      actionKind: "usefulness_set",
      createdAt: "2026-07-25T15:00:00.000Z",
      ownershipRecordId: null,
      idempotentReplay: false,
      state: STATE,
    } as const;
    const receiptClient = createReplayApiClient(TOKEN, {
      fetcher: async () =>
        new Response(JSON.stringify(wrongReceipt), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(
      receiptClient.recordMomentInteraction("run-1", MOMENT_ID, {
        schemaVersion: 1,
        interactionId: INTERACTION_ID,
        validationId: VALIDATION_ID,
        action: { kind: "moment_viewed" },
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("creates 48-hex page-memory interaction IDs from Web Crypto bytes", () => {
    const cryptoValue = {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (!(array instanceof Uint8Array)) throw new Error("unexpected array");
        array.forEach((_, index) => {
          array[index] = index;
        });
        return array as T;
      },
    } as Crypto;
    expect(createMomentInteractionId(cryptoValue)).toBe(
      "ix_000102030405060708090a0b0c0d0e0f1011121314151617",
    );
  });

  it("maps interaction conflict and rejection statuses without exposing response content", async () => {
    for (const [status, code] of [
      [409, "conflict"],
      [400, "rejected"],
      [413, "rejected"],
      [415, "rejected"],
    ] as const) {
      const client = createReplayApiClient(TOKEN, {
        fetcher: async () =>
          new Response(JSON.stringify({ internal: "/private/path", status }), {
            status,
            headers: { "content-type": "application/json" },
          }),
      });
      await expect(
        client.recordMomentInteraction("run-1", MOMENT_ID, {
          schemaVersion: 1,
          interactionId: INTERACTION_ID,
          validationId: VALIDATION_ID,
          action: { kind: "moment_viewed" },
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("maps unauthorized and unavailable responses to fixed content-free errors", async () => {
    const unauthorized = createReplayApiClient(TOKEN, {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "unauthorized", message: "The request is not authorized." },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(unauthorized.listRuns()).rejects.toMatchObject({ code: "unauthorized" });
  });
});
