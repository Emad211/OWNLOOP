import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

import { IngestionAcceptedResponseSchema } from "@ownloop/contracts";
import { CodexAdapterIngressSchema } from "@ownloop/contracts/codex";
import { invalidCodexHookPayloadFixtures, validCodexHookFixtures } from "@ownloop/test-fixtures";
import { describe, expect, it, vi } from "vitest";

import { deliverCodexHook } from "./src/adapter.js";
import { readCodexHookAdapterConfiguration } from "./src/configuration.js";
import {
  CODEX_HOOK_ADAPTER_MAX_RESPONSE_BYTES,
  CODEX_HOOK_ADAPTER_MAX_STDIN_BYTES,
  CODEX_HOOK_ADAPTER_VERSION,
} from "./src/constants.js";
import { readSupportedCodexHookPayload } from "./src/input.js";

const TOKEN = Buffer.alloc(32, 9).toString("base64url");
const ENVIRONMENT = {
  OWNLOOP_INGRESS_PORT: "43210",
  OWNLOOP_INSTALLATION_TOKEN: TOKEN,
  OWNLOOP_CODEX_SOURCE_VERSION: "codex-cli 0.133.0",
  OWNLOOP_CODEX_SOURCE_SURFACE: "cli",
};
const FIXED_DATE = new Date("2026-07-27T00:00:00.000Z");

function input(value: unknown): Readable {
  return Readable.from([Buffer.from(JSON.stringify(value), "utf8")]);
}

function acceptedResponse(): Response {
  return Response.json(
    IngestionAcceptedResponseSchema.parse({
      ok: true,
      status: "accepted",
      receiptId: "receipt-codex-fixture-001",
      duplicate: false,
    }),
    { status: 202 },
  );
}

describe("Codex hook adapter configuration", () => {
  it("constructs only the fixed Codex loopback endpoint", () => {
    expect(readCodexHookAdapterConfiguration(ENVIRONMENT)).toEqual({
      endpoint: "http://127.0.0.1:43210/v1/ingress/codex",
      installationToken: TOKEN,
      sourceVersion: "codex-cli 0.133.0",
      sourceSurface: "cli",
    });
  });

  it("uses controlled unknown source facts when optional values are absent", () => {
    expect(
      readCodexHookAdapterConfiguration({
        OWNLOOP_INGRESS_PORT: "43210",
        OWNLOOP_INSTALLATION_TOKEN: TOKEN,
      }),
    ).toMatchObject({ sourceVersion: null, sourceSurface: "unknown" });
  });

  it.each([
    {},
    { OWNLOOP_INGRESS_PORT: "0", OWNLOOP_INSTALLATION_TOKEN: TOKEN },
    { OWNLOOP_INGRESS_PORT: "65536", OWNLOOP_INSTALLATION_TOKEN: TOKEN },
    { OWNLOOP_INGRESS_PORT: "8080", OWNLOOP_INSTALLATION_TOKEN: "short" },
    {
      OWNLOOP_INGRESS_PORT: "8080",
      OWNLOOP_INSTALLATION_TOKEN: TOKEN,
      OWNLOOP_CODEX_SOURCE_SURFACE: "browser",
    },
    {
      OWNLOOP_INGRESS_PORT: "8080",
      OWNLOOP_INSTALLATION_TOKEN: TOKEN,
      OWNLOOP_CODEX_SOURCE_VERSION: "x".repeat(257),
    },
  ])("rejects missing or unsafe configuration %#", (environment) => {
    expect(readCodexHookAdapterConfiguration(environment)).toBeNull();
  });
});

describe("bounded Codex hook input", () => {
  it("validates all 11 official-shape fixtures", async () => {
    for (const fixture of validCodexHookFixtures) {
      const result = await readSupportedCodexHookPayload(input(fixture.input));
      expect(result?.hook_event_name).toBe(fixture.name);
    }
  });

  it.each([
    { name: "empty", source: Readable.from([]) },
    { name: "malformed JSON", source: Readable.from(["{"]) },
    { name: "trailing JSON", source: Readable.from(["{} {}"]) },
    { name: "array", source: Readable.from(["[]"]) },
    { name: "invalid UTF-8", source: Readable.from([Buffer.from([0xc3, 0x28])]) },
    {
      name: "duplicate object key",
      source: Readable.from([
        '{"session_id":"one","session_id":"two","transcript_path":null,"cwd":"C:/x","hook_event_name":"SessionEnd","reason":"other"}',
      ]),
    },
    {
      name: "escaped duplicate object key",
      source: Readable.from([
        '{"session_id":"one","\\u0073ession_id":"two","transcript_path":null,"cwd":"C:/x","hook_event_name":"SessionEnd","reason":"other"}',
      ]),
    },
  ])("rejects $name", async ({ source }) => {
    await expect(readSupportedCodexHookPayload(source)).resolves.toBeNull();
  });

  it("drops unknown source fields after validation", async () => {
    const result = await readSupportedCodexHookPayload(
      input({ ...validCodexHookFixtures[0].input, future_field: { content: "drop" } }),
    );
    expect(result).not.toHaveProperty("future_field");
  });

  it("rejects all runtime-invalid fixtures", async () => {
    for (const fixture of invalidCodexHookPayloadFixtures) {
      await expect(readSupportedCodexHookPayload(input(fixture.input))).resolves.toBeNull();
    }
  });

  it("stops consuming stdin after the byte bound", async () => {
    let yieldedAfterLimit = false;
    async function* chunks() {
      yield Buffer.alloc(CODEX_HOOK_ADAPTER_MAX_STDIN_BYTES, 0x20);
      yield Buffer.from("x");
      yieldedAfterLimit = true;
      yield Buffer.from("must-not-be-read");
    }
    await expect(readSupportedCodexHookPayload(chunks())).resolves.toBeNull();
    expect(yieldedAfterLimit).toBe(false);
  });
});

describe("Codex hook delivery", () => {
  it("wraps and delivers all 11 payloads to the fixed Codex route", async () => {
    for (const fixture of validCodexHookFixtures) {
      let captured: { url: string; init: RequestInit } | undefined;
      const fetchImplementation: typeof fetch = vi.fn(async (url, init) => {
        captured = { url: String(url), init: init ?? {} };
        return acceptedResponse();
      });

      await expect(
        deliverCodexHook({
          input: input(fixture.input),
          environment: ENVIRONMENT,
          fetchImplementation,
          clock: () => FIXED_DATE,
        }),
      ).resolves.toBe("delivered");

      expect(captured?.url).toBe("http://127.0.0.1:43210/v1/ingress/codex");
      expect(captured?.init.redirect).toBe("error");
      expect(captured?.init.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      });
      expect(CodexAdapterIngressSchema.parse(JSON.parse(String(captured?.init.body)))).toEqual({
        contractVersion: 1,
        source: "codex",
        adapterVersion: CODEX_HOOK_ADAPTER_VERSION,
        sourceVersion: "codex-cli 0.133.0",
        sourceSurface: "cli",
        receivedAt: FIXED_DATE.toISOString(),
        payload: fixture.input,
      });
    }
  });

  it("skips invalid configuration before reading stdin", async () => {
    let inputRead = false;
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            inputRead = true;
            throw new Error("must not read");
          },
        };
      },
    };
    const fetchImplementation: typeof fetch = vi.fn();
    await expect(
      deliverCodexHook({ input: source, environment: {}, fetchImplementation }),
    ).resolves.toBe("skipped_configuration");
    expect(inputRead).toBe(false);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("uses one delivery attempt and never retries", async () => {
    const fetchImplementation: typeof fetch = vi.fn(async () => {
      throw new Error("fixture transport failure");
    });
    await expect(
      deliverCodexHook({
        input: input(validCodexHookFixtures[0].input),
        environment: ENVIRONMENT,
        fetchImplementation,
      }),
    ).resolves.toBe("skipped_delivery");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([200, 400, 401, 409, 413, 415, 500, 503])("rejects HTTP status %s", async (status) => {
    const fetchImplementation: typeof fetch = vi.fn(async () => new Response("", { status }));
    await expect(
      deliverCodexHook({
        input: input(validCodexHookFixtures[0].input),
        environment: ENVIRONMENT,
        fetchImplementation,
      }),
    ).resolves.toBe("skipped_delivery");
  });

  it.each([
    { name: "invalid JSON", response: new Response("{", { status: 202 }) },
    { name: "wrong contract", response: Response.json({ ok: true }, { status: 202 }) },
    {
      name: "oversized response",
      response: new Response("x".repeat(CODEX_HOOK_ADAPTER_MAX_RESPONSE_BYTES + 1), {
        status: 202,
      }),
    },
  ])("rejects a 202 response with $name", async ({ response }) => {
    const fetchImplementation: typeof fetch = vi.fn(async () => response);
    await expect(
      deliverCodexHook({
        input: input(validCodexHookFixtures[0].input),
        environment: ENVIRONMENT,
        fetchImplementation,
      }),
    ).resolves.toBe("skipped_delivery");
  });
});
