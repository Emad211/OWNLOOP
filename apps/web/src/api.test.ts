import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReplayApiClient, ReplayApiError } from "./api.js";

const TOKEN = "A".repeat(43);
const PAGE_ORIGIN = "http://127.0.0.1:4021";
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
