import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

import { ClaudeAdapterIngressSchema, IngestionAcceptedResponseSchema } from "@ownloop/contracts";
import { invalidClaudeHookPayloadFixtures, validClaudeHookFixtures } from "@ownloop/test-fixtures";
import { describe, expect, it, vi } from "vitest";

import { deliverHook } from "./src/adapter.js";
import { readHookAdapterConfiguration } from "./src/configuration.js";
import {
  HOOK_ADAPTER_MAX_RESPONSE_BYTES,
  HOOK_ADAPTER_MAX_STDIN_BYTES,
  HOOK_ADAPTER_VERSION,
} from "./src/constants.js";
import { readSupportedHookPayload } from "./src/input.js";

const TOKEN = Buffer.alloc(32, 5).toString("base64url");
const ENVIRONMENT = {
  OWNLOOP_INGRESS_PORT: "43210",
  OWNLOOP_INSTALLATION_TOKEN: TOKEN,
};
const FIXED_DATE = new Date("2026-07-21T13:00:00.000Z");

function input(value: unknown): Readable {
  return Readable.from([Buffer.from(JSON.stringify(value), "utf8")]);
}

function acceptedResponse(): Response {
  return Response.json(
    { ok: true, status: "accepted", receiptId: "receipt-fixture-001", duplicate: false },
    { status: 202 },
  );
}

describe("hook adapter configuration", () => {
  it("constructs only the fixed IPv4-loopback endpoint", () => {
    expect(readHookAdapterConfiguration(ENVIRONMENT)).toEqual({
      endpoint: "http://127.0.0.1:43210/v1/ingress/claude",
      installationToken: TOKEN,
    });
  });

  it.each([
    {},
    { OWNLOOP_INGRESS_PORT: "0", OWNLOOP_INSTALLATION_TOKEN: TOKEN },
    { OWNLOOP_INGRESS_PORT: "65536", OWNLOOP_INSTALLATION_TOKEN: TOKEN },
    { OWNLOOP_INGRESS_PORT: "1.5", OWNLOOP_INSTALLATION_TOKEN: TOKEN },
    { OWNLOOP_INGRESS_PORT: "8080", OWNLOOP_INSTALLATION_TOKEN: "short" },
    { OWNLOOP_INGRESS_PORT: "8080", OWNLOOP_INSTALLATION_TOKEN: `${TOKEN}=` },
  ])("rejects missing or unsafe configuration %#", (environment) => {
    expect(readHookAdapterConfiguration(environment)).toBeNull();
  });
});

describe("bounded Hook input", () => {
  it("validates every supported Hook fixture", async () => {
    for (const fixture of validClaudeHookFixtures) {
      const result = await readSupportedHookPayload(input(fixture.input));
      expect(result?.hook_event_name).toBe(fixture.name);
    }
  });

  it.each([
    { name: "empty", source: Readable.from([]) },
    { name: "malformed JSON", source: Readable.from(["{"]) },
    { name: "trailing JSON", source: Readable.from(["{} {}"]) },
    { name: "array", source: Readable.from(["[]"]) },
    { name: "invalid UTF-8", source: Readable.from([Buffer.from([0xc3, 0x28])]) },
  ])("rejects $name", async ({ source }) => {
    await expect(readSupportedHookPayload(source)).resolves.toBeNull();
  });

  it("rejects all runtime-invalid Hook fixtures", async () => {
    for (const fixture of invalidClaudeHookPayloadFixtures) {
      await expect(readSupportedHookPayload(input(fixture.input))).resolves.toBeNull();
    }
  });

  it("stops consuming an oversized stream as soon as the limit is crossed", async () => {
    let yieldedAfterLimit = false;
    async function* chunks() {
      yield Buffer.alloc(HOOK_ADAPTER_MAX_STDIN_BYTES, 0x20);
      yield Buffer.from("x");
      yieldedAfterLimit = true;
      yield Buffer.from("should-not-be-read");
    }

    await expect(readSupportedHookPayload(chunks())).resolves.toBeNull();
    expect(yieldedAfterLimit).toBe(false);
  });

  it("returns null when the input iterator throws", async () => {
    async function* failingInput() {
      yield Buffer.from("{");
      throw new Error("fixture iterator failure");
    }

    await expect(readSupportedHookPayload(failingInput())).resolves.toBeNull();
  });
});

describe("Hook delivery", () => {
  it("wraps and delivers all nine source Hook payloads unchanged", async () => {
    for (const fixture of validClaudeHookFixtures) {
      let capturedRequest: { url: string; init: RequestInit } | undefined;
      const fetchImplementation: typeof fetch = vi.fn(async (url, init) => {
        capturedRequest = { url: String(url), init: init ?? {} };
        return acceptedResponse();
      });
      const before = structuredClone(fixture.input);

      await expect(
        deliverHook({
          input: input(fixture.input),
          environment: ENVIRONMENT,
          fetchImplementation,
          clock: () => FIXED_DATE,
        }),
      ).resolves.toBe("delivered");

      expect(fixture.input).toEqual(before);
      expect(capturedRequest?.url).toBe("http://127.0.0.1:43210/v1/ingress/claude");
      expect(capturedRequest?.init.method).toBe("POST");
      expect(capturedRequest?.init.redirect).toBe("error");
      expect(capturedRequest?.init.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      });
      const body = JSON.parse(String(capturedRequest?.init.body));
      expect(ClaudeAdapterIngressSchema.parse(body)).toEqual({
        contractVersion: 1,
        source: "claude_code",
        adapterVersion: HOOK_ADAPTER_VERSION,
        receivedAt: FIXED_DATE.toISOString(),
        payload: fixture.input,
      });
    }
  });

  it("preserves forward-compatible source fields inside the wrapper", async () => {
    const source = {
      ...validClaudeHookFixtures[0].input,
      future_common_field: { enabled: true },
    };
    let forwardedPayload: unknown;
    const fetchImplementation: typeof fetch = vi.fn(async (_url, init) => {
      forwardedPayload = JSON.parse(String(init?.body)).payload;
      return acceptedResponse();
    });

    await expect(
      deliverHook({
        input: input(source),
        environment: ENVIRONMENT,
        fetchImplementation,
        clock: () => FIXED_DATE,
      }),
    ).resolves.toBe("delivered");
    expect(forwardedPayload).toEqual(source);
  });

  it("never throws when configuration access fails", async () => {
    const environment = new Proxy(
      {},
      {
        get() {
          throw new Error("fixture environment failure");
        },
      },
    );

    await expect(
      deliverHook({
        input: input(validClaudeHookFixtures[0].input),
        environment,
      }),
    ).resolves.toBe("skipped_configuration");
  });

  it("skips invalid configuration before reading stdin or invoking fetch", async () => {
    let inputRead = false;
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<unknown>> {
            inputRead = true;
            throw new Error("input must not be read");
          },
        };
      },
    };
    const fetchImplementation: typeof fetch = vi.fn();

    await expect(
      deliverHook({ input: source, environment: {}, fetchImplementation }),
    ).resolves.toBe("skipped_configuration");
    expect(inputRead).toBe(false);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("skips invalid input without invoking fetch", async () => {
    const fetchImplementation: typeof fetch = vi.fn();
    await expect(
      deliverHook({
        input: Readable.from(["{"]),
        environment: ENVIRONMENT,
        fetchImplementation,
      }),
    ).resolves.toBe("skipped_input");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([200, 201, 204, 400, 401, 409, 413, 415, 500, 503])(
    "skips HTTP status %s",
    async (status) => {
      const fetchImplementation: typeof fetch = vi.fn(async () => new Response("", { status }));
      await expect(
        deliverHook({
          input: input(validClaudeHookFixtures[0].input),
          environment: ENVIRONMENT,
          fetchImplementation,
        }),
      ).resolves.toBe("skipped_delivery");
    },
  );

  it("cancels non-202 response bodies without reading them", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("must-not-be-read"));
      },
      cancel,
    });
    const fetchImplementation: typeof fetch = vi.fn(
      async () => new Response(body, { status: 503 }),
    );

    await expect(
      deliverHook({
        input: input(validClaudeHookFixtures[0].input),
        environment: ENVIRONMENT,
        fetchImplementation,
      }),
    ).resolves.toBe("skipped_delivery");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    { name: "invalid JSON", response: new Response("{", { status: 202 }) },
    { name: "wrong contract", response: Response.json({ ok: true }, { status: 202 }) },
    {
      name: "oversized response",
      response: new Response("x".repeat(HOOK_ADAPTER_MAX_RESPONSE_BYTES + 1), { status: 202 }),
    },
  ])("skips a 202 response with $name", async ({ response }) => {
    const fetchImplementation: typeof fetch = vi.fn(async () => response);
    await expect(
      deliverHook({
        input: input(validClaudeHookFixtures[0].input),
        environment: ENVIRONMENT,
        fetchImplementation,
      }),
    ).resolves.toBe("skipped_delivery");
  });

  it("skips redirect and network failures", async () => {
    for (const error of [new TypeError("redirect"), new Error("network")]) {
      const fetchImplementation: typeof fetch = vi.fn(async () => {
        throw error;
      });
      await expect(
        deliverHook({
          input: input(validClaudeHookFixtures[0].input),
          environment: ENVIRONMENT,
          fetchImplementation,
        }),
      ).resolves.toBe("skipped_delivery");
    }
  });

  it("aborts a delivery after the injected timeout", async () => {
    const fetchImplementation: typeof fetch = vi.fn((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    });
    await expect(
      deliverHook({
        input: input(validClaudeHookFixtures[0].input),
        environment: ENVIRONMENT,
        fetchImplementation,
        timeoutMs: 10,
      }),
    ).resolves.toBe("skipped_delivery");
  });

  it("never throws when the injected clock throws", async () => {
    const fetchImplementation: typeof fetch = vi.fn();
    await expect(
      deliverHook({
        input: input(validClaudeHookFixtures[0].input),
        environment: ENVIRONMENT,
        fetchImplementation,
        clock() {
          throw new Error("fixture clock failure");
        },
      }),
    ).resolves.toBe("skipped_delivery");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects invalid clock, timeout, and adapter-version dependencies", async () => {
    for (const options of [
      { clock: () => new Date(Number.NaN) },
      { timeoutMs: 0 },
      { adapterVersion: "invalid" },
    ]) {
      const fetchImplementation: typeof fetch = vi.fn();
      await expect(
        deliverHook({
          input: input(validClaudeHookFixtures[0].input),
          environment: ENVIRONMENT,
          fetchImplementation,
          ...options,
        }),
      ).resolves.toBe("skipped_delivery");
      expect(fetchImplementation).not.toHaveBeenCalled();
    }
  });

  it("accepts only a runtime-valid accepted response", async () => {
    expect(
      IngestionAcceptedResponseSchema.safeParse({
        ok: true,
        status: "accepted",
        receiptId: "receipt-fixture-001",
        duplicate: false,
      }).success,
    ).toBe(true);
  });
});
