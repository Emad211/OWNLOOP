import { describe, expect, it } from "vitest";

import { createReplayApiClient, ReplayApiError } from "./api.js";

const TOKEN = "A".repeat(43);
const listResponse = {
  ok: true,
  schemaVersion: 1,
  runs: [],
  nextCursor: null,
} as const;

describe("replay browser API client", () => {
  it("uses only the supplied page origin and sends the token only as a Bearer header", async () => {
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
    const client = createReplayApiClient(TOKEN, {
      origin: "http://127.0.0.1:4021",
      fetcher,
    });
    expect(await client.listRuns()).toEqual(listResponse);
    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:4021/v1/replay/runs?limit=25",
        authorization: `Bearer ${TOKEN}`,
      },
    ]);
    expect(calls[0]?.url).not.toContain(TOKEN);
  });

  it("rejects non-origin base URLs and invalid response contracts", async () => {
    expect(() => createReplayApiClient(TOKEN, { origin: "https://example.com/path" })).toThrowError(
      ReplayApiError,
    );
    const client = createReplayApiClient(TOKEN, {
      origin: "http://127.0.0.1:4021",
      fetcher: async () =>
        new Response(JSON.stringify({ ok: true, runs: [{ repositoryRoot: "/private" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(client.listRuns()).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("maps unauthorized and unavailable responses to fixed content-free errors", async () => {
    const unauthorized = createReplayApiClient(TOKEN, {
      origin: "http://127.0.0.1:4021",
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
