import { describe, expect, it } from "vitest";

import { Buffer } from "node:buffer";
import { createSecretKey } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request as createHttpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ClaudeAdapterIngress,
  IngestionResponseSchema,
  type IngestionResponse,
} from "@ownloop/contracts";

import {
  openPersistence,
  PersistenceError,
  type OwnLoopPersistence,
} from "../persistence/index.js";
import { generateInstallationToken } from "./auth.js";
import type { IngressDiagnosticEvent } from "./diagnostics.js";
import {
  createLoopbackIngressServer,
  INGRESS_BODY_LIMIT_BYTES,
  INGRESS_LOOPBACK_HOST,
  INGRESS_ROUTE,
  startLoopbackIngressServer,
  type IngressPersistence,
  type IngressServerAddress,
} from "./server.js";

const HMAC_KEY = createSecretKey(Buffer.alloc(32, 7));
const TOKEN = generateInstallationToken();
const CREATED_AT = "2026-07-21T12:30:00.000Z";
const RECEIPT_IDS = [
  "01987f50-1111-7111-8111-111111111111",
  "01987f50-2222-7222-8222-222222222222",
  "01987f50-3333-7333-8333-333333333333",
] as const;

const VALID_INGRESS_FIXTURE: ClaudeAdapterIngress = {
  contractVersion: 1,
  source: "claude_code",
  adapterVersion: "1.2.3-fixture.1+build.5",
  receivedAt: "2026-07-21T12:29:59+00:00",
  payload: {
    session_id: "session-fixture-001",
    transcript_path: "/workspace/.claude/transcript.jsonl",
    cwd: "/workspace/project",
    hook_event_name: "SessionStart",
    source: "startup",
    model: "claude-fixture-model",
  },
};

function cloneFixture(): ClaudeAdapterIngress {
  return structuredClone(VALID_INGRESS_FIXTURE);
}

function promptIngress(prompt: string): ClaudeAdapterIngress {
  return {
    contractVersion: 1,
    source: "claude_code",
    adapterVersion: "1.2.3",
    receivedAt: "2026-07-21T12:29:59+00:00",
    payload: {
      session_id: "session-network-fixture",
      transcript_path: "/workspace/.claude/network-transcript.jsonl",
      cwd: "/workspace/project",
      hook_event_name: "UserPromptSubmit",
      prompt_id: "d9428888-122b-11e1-b85c-61cd3cbb3210",
      prompt,
    },
  };
}

function receiptIdGenerator(ids: string[] = [...RECEIPT_IDS]): () => string {
  return () => {
    const value = ids.shift();
    if (value === undefined) {
      throw new Error("The receipt ID fixture is exhausted.");
    }
    return value;
  };
}

async function postJson(
  address: IngressServerAddress,
  token: string,
  body: unknown,
  contentType = "application/json",
): Promise<Response> {
  return fetch(`${address.url}${INGRESS_ROUTE}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": contentType,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function parseResponse(response: Response): Promise<IngestionResponse> {
  const result = IngestionResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new Error("The server returned an invalid ingestion response contract.");
  }
  return result.data;
}

async function rawRequest(
  address: IngressServerAddress,
  authorization: string[],
  body: string,
): Promise<Readonly<{ statusCode: number; body: string }>> {
  return new Promise((resolve, reject) => {
    const request = createHttpRequest(
      {
        host: address.host,
        port: address.port,
        path: INGRESS_ROUTE,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.setHeader("authorization", authorization);
    request.on("error", reject);
    request.end(body);
  });
}

type RunningServer = Readonly<{
  server: ReturnType<typeof createLoopbackIngressServer>;
  address: IngressServerAddress;
  persistence: OwnLoopPersistence;
}>;

async function startTestServer(
  options: {
    persistence?: OwnLoopPersistence;
    diagnostics?: (event: IngressDiagnosticEvent) => void;
    token?: string;
    ids?: string[];
  } = {},
): Promise<RunningServer> {
  const persistence = options.persistence ?? openPersistence(":memory:");
  const server = createLoopbackIngressServer({
    persistence,
    installationToken: options.token ?? TOKEN,
    hmacKey: HMAC_KEY,
    homePath: "/workspace",
    clock: () => new Date(CREATED_AT),
    receiptIdGenerator: receiptIdGenerator(options.ids ?? [...RECEIPT_IDS]),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
  });
  const address = await startLoopbackIngressServer(server, 0);
  return { server, address, persistence };
}

async function stopTestServer(running: RunningServer): Promise<void> {
  await running.server.close();
  running.persistence.close();
}

describe("loopback ingress server", () => {
  it("generates canonical base64url installation tokens with at least 32 bytes", () => {
    const token = generateInstallationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(Buffer.from(token, "base64url").toString("base64url")).toBe(token);
  });

  it("listens only on IPv4 loopback", async () => {
    const running = await startTestServer();
    try {
      expect(running.address.host).toBe(INGRESS_LOOPBACK_HOST);
      expect(running.address.url).toBe(`http://${INGRESS_LOOPBACK_HOST}:${running.address.port}`);
      const rawAddress = running.server.server.address();
      expect(rawAddress).toMatchObject({ address: "127.0.0.1", family: "IPv4" });
    } finally {
      await stopTestServer(running);
    }
  });

  it("returns 202 only after a prepared receipt is durable", async () => {
    const running = await startTestServer();
    try {
      const response = await postJson(running.address, TOKEN, cloneFixture());
      expect(response.status).toBe(202);
      const body = await parseResponse(response);
      expect(body).toEqual({
        ok: true,
        status: "accepted",
        receiptId: RECEIPT_IDS[0],
        duplicate: false,
      });
      if (!body.ok) {
        throw new Error("Expected an accepted response.");
      }
      expect(running.persistence.ingressReceipts.get(body.receiptId)).toMatchObject({
        receiptId: body.receiptId,
        preparationStatus: "prepared",
        processingStatus: "pending",
        createdAt: CREATED_AT,
      });
    } finally {
      await stopTestServer(running);
    }
  });

  it("returns identical 401 responses for missing and malformed authorization", async () => {
    const running = await startTestServer();
    try {
      const url = `${running.address.url}${INGRESS_ROUTE}`;
      const missing = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      const incorrect = await postJson(
        running.address,
        generateInstallationToken(),
        cloneFixture(),
      );
      const basic = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Basic ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(cloneFixture()),
      });
      const commaJoined = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}, Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(cloneFixture()),
      });
      const repeated = await rawRequest(
        running.address,
        [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`],
        JSON.stringify(cloneFixture()),
      );

      const bodies = await Promise.all([
        missing.text(),
        incorrect.text(),
        basic.text(),
        commaJoined.text(),
        Promise.resolve(repeated.body),
      ]);
      expect([
        missing.status,
        incorrect.status,
        basic.status,
        commaJoined.status,
        repeated.statusCode,
      ]).toEqual([401, 401, 401, 401, 401]);
      expect(new Set(bodies).size).toBe(1);
      expect(JSON.parse(bodies[0] ?? "{}")).toEqual({
        ok: false,
        status: "rejected",
        error: { code: "unauthorized", message: "The request is not authorized." },
      });
      expect(running.persistence.ingressReceipts.get(RECEIPT_IDS[0])).toBeNull();
    } finally {
      await stopTestServer(running);
    }
  });

  it("rejects non-JSON content before the handler", async () => {
    const running = await startTestServer();
    try {
      const response = await postJson(running.address, TOKEN, "fixture", "text/plain");
      expect(response.status).toBe(415);
      expect(await parseResponse(response)).toMatchObject({
        ok: false,
        error: { code: "unsupported_media_type" },
      });
      expect(running.persistence.ingressReceipts.get(RECEIPT_IDS[0])).toBeNull();
    } finally {
      await stopTestServer(running);
    }
  });

  it("maps malformed JSON, invalid contracts, and unsupported Hooks safely", async () => {
    const running = await startTestServer();
    try {
      const malformed = await postJson(running.address, TOKEN, "{");
      expect(malformed.status).toBe(400);
      expect(await parseResponse(malformed)).toMatchObject({
        ok: false,
        error: { code: "invalid_payload" },
      });

      const invalid = await postJson(running.address, TOKEN, {
        contractVersion: 1,
        source: "claude_code",
        adapterVersion: "invalid",
        receivedAt: "not-a-date",
        payload: { hook_event_name: "SessionEnd" },
      });
      expect(invalid.status).toBe(400);
      const invalidBody = await parseResponse(invalid);
      expect(invalidBody).toMatchObject({ ok: false, error: { code: "invalid_payload" } });
      if (invalidBody.ok) {
        throw new Error("Expected a rejected response.");
      }
      expect(invalidBody.error.issues?.length).toBeGreaterThan(0);
      expect(JSON.stringify(invalidBody)).not.toContain("not-a-date");

      const unsupported = await postJson(running.address, TOKEN, {
        ...cloneFixture(),
        payload: {
          session_id: "session-fixture",
          transcript_path: "/private/transcript.jsonl",
          cwd: "/private/workspace",
          hook_event_name: "PermissionRequest",
        },
      });
      expect(unsupported.status).toBe(400);
      expect(await parseResponse(unsupported)).toMatchObject({
        ok: false,
        error: { code: "unsupported_hook" },
      });
    } finally {
      await stopTestServer(running);
    }
  });

  it("maps prototype and constructor poisoning attempts to safe invalid-payload responses", async () => {
    const running = await startTestServer();
    try {
      for (const poisoned of [
        '{"__proto__":{"fixture-secret":"value"}}',
        '{"constructor":{"prototype":{"fixture-secret":"value"}}}',
      ]) {
        const response = await postJson(running.address, TOKEN, poisoned);
        expect(response.status).toBe(400);
        const body = await response.text();
        expect(body).not.toContain("fixture-secret");
        expect(JSON.parse(body)).toMatchObject({
          ok: false,
          error: { code: "invalid_payload" },
        });
      }
    } finally {
      await stopTestServer(running);
    }
  });

  it("rejects request bodies above one MiB", async () => {
    const running = await startTestServer();
    try {
      const oversizedBody = JSON.stringify({ value: "x".repeat(INGRESS_BODY_LIMIT_BYTES + 1) });
      const response = await postJson(running.address, TOKEN, oversizedBody);
      expect(response.status).toBe(413);
      expect(await parseResponse(response)).toMatchObject({
        ok: false,
        error: { code: "payload_too_large" },
      });
    } finally {
      await stopTestServer(running);
    }
  });

  it("maps ingress-security rejection without leaking fixture content", async () => {
    const diagnostics: IngressDiagnosticEvent[] = [];
    const running = await startTestServer({ diagnostics: (event) => diagnostics.push(event) });
    const secret = "fixture-ingress-secret-123456";
    try {
      const ingress = cloneFixture();
      (ingress.payload as { cwd: string }).cwd = `relative/${secret}`;
      const response = await postJson(running.address, TOKEN, ingress);
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).not.toContain(secret);
      expect(body).not.toContain("relative/");
      expect(JSON.stringify(diagnostics)).not.toContain(secret);
    } finally {
      await stopTestServer(running);
    }
  });

  it("returns the original receipt ID for an exact retry", async () => {
    const running = await startTestServer();
    const ingress = cloneFixture();
    const retry = { ...cloneFixture(), receivedAt: "2026-07-21T12:30:01+00:00" };
    try {
      const first = await parseResponse(await postJson(running.address, TOKEN, ingress));
      const second = await parseResponse(await postJson(running.address, TOKEN, retry));
      expect(first).toEqual({
        ok: true,
        status: "accepted",
        receiptId: RECEIPT_IDS[0],
        duplicate: false,
      });
      expect(second).toEqual({
        ok: true,
        status: "accepted",
        receiptId: RECEIPT_IDS[0],
        duplicate: true,
      });
      expect(running.persistence.ingressReceipts.get(RECEIPT_IDS[1])).toBeNull();
    } finally {
      await stopTestServer(running);
    }
  });

  it("commits one receipt when exact retries arrive concurrently", async () => {
    const running = await startTestServer();
    const ingress = cloneFixture();
    try {
      const responses = await Promise.all([
        postJson(running.address, TOKEN, ingress),
        postJson(running.address, TOKEN, ingress),
      ]);
      const bodies = await Promise.all(responses.map(parseResponse));
      expect(responses.map((response) => response.status)).toEqual([202, 202]);
      expect(bodies).toEqual(
        expect.arrayContaining([
          {
            ok: true,
            status: "accepted",
            receiptId: RECEIPT_IDS[0],
            duplicate: false,
          },
          {
            ok: true,
            status: "accepted",
            receiptId: RECEIPT_IDS[0],
            duplicate: true,
          },
        ]),
      );
      expect(running.persistence.ingressReceipts.get(RECEIPT_IDS[1])).toBeNull();
    } finally {
      await stopTestServer(running);
    }
  });

  it("returns 409 when a source-ID retry has different source content", async () => {
    const running = await startTestServer();
    try {
      const first = await postJson(running.address, TOKEN, promptIngress("First fixture prompt."));
      expect(first.status).toBe(202);
      const conflict = await postJson(
        running.address,
        TOKEN,
        promptIngress("Changed fixture prompt with the same prompt ID."),
      );
      expect(conflict.status).toBe(409);
      expect(await parseResponse(conflict)).toMatchObject({
        ok: false,
        error: { code: "deduplication_conflict" },
      });
      expect(running.persistence.ingressReceipts.get(RECEIPT_IDS[1])).toBeNull();
    } finally {
      await stopTestServer(running);
    }
  });

  it("maps unsafe server-generated receipt IDs to a content-free 500", async () => {
    const persistence = openPersistence(":memory:");
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: TOKEN,
      hmacKey: HMAC_KEY,
      receiptIdGenerator: () => "unsafe receipt id with spaces",
      clock: () => new Date(CREATED_AT),
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      const response = await postJson(address, TOKEN, cloneFixture());
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toContain("unsafe receipt id");
      expect(JSON.parse(body)).toMatchObject({
        ok: false,
        error: { code: "internal_error" },
      });
    } finally {
      await server.close();
      persistence.close();
    }
  });

  it("maps persistence failures to a content-free 503 response", async () => {
    const secret = "fixture-persistence-secret-123456";
    const persistence: IngressPersistence = {
      ingressReceipts: {
        insertPreparedOrGetExisting(): never {
          throw new PersistenceError("operation_failed", secret);
        },
      },
    };
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: TOKEN,
      hmacKey: HMAC_KEY,
      receiptIdGenerator: () => RECEIPT_IDS[0],
      clock: () => new Date(CREATED_AT),
    });
    const address = await startLoopbackIngressServer(server, 0);
    try {
      const response = await postJson(address, TOKEN, cloneFixture());
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).not.toContain(secret);
      expect(JSON.parse(body)).toMatchObject({
        ok: false,
        error: { code: "persistence_failed" },
      });
    } finally {
      await server.close();
    }
  });

  it("emits only allowlisted diagnostics and ignores sink failures", async () => {
    const events: IngressDiagnosticEvent[] = [];
    const secret = "fixture-diagnostic-secret-123456";
    const running = await startTestServer({
      diagnostics(event) {
        events.push(event);
        if (event.type === "receipt.accepted") {
          throw new Error(secret);
        }
      },
    });
    try {
      const response = await postJson(running.address, TOKEN, promptIngress(secret));
      expect(response.status).toBe(202);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain("session-network-fixture");
      expect(serialized).not.toContain("/workspace/project");
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "server.started", port: running.address.port }),
          expect.objectContaining({
            type: "receipt.accepted",
            receiptId: RECEIPT_IDS[0],
            hookName: "UserPromptSubmit",
            duplicate: false,
          }),
        ]),
      );
    } finally {
      await stopTestServer(running);
    }
  });

  it("persists to a file-backed database before the client observes 202", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ownloop-ingress-http-"));
    const databasePath = join(directory, "ownloop.sqlite");
    const persistence = openPersistence(databasePath);
    const running = await startTestServer({ persistence });
    let receiptId = "";
    try {
      const response = await postJson(running.address, TOKEN, cloneFixture());
      expect(response.status).toBe(202);
      const body = await parseResponse(response);
      if (!body.ok) {
        throw new Error("Expected an accepted response.");
      }
      receiptId = body.receiptId;
      await running.server.close();
      expect(persistence.ingressReceipts.get(receiptId)).not.toBeNull();
      persistence.close();

      const reopened = openPersistence(databasePath);
      try {
        expect(reopened.ingressReceipts.get(receiptId)).toMatchObject({
          receiptId,
          preparationStatus: "prepared",
        });
      } finally {
        reopened.close();
      }
    } finally {
      if (running.server.server.listening) {
        await running.server.close();
      }
      if (receiptId.length === 0) {
        persistence.close();
      }
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closing the server does not close caller-owned persistence", async () => {
    const running = await startTestServer();
    const response = await postJson(running.address, TOKEN, cloneFixture());
    const body = await parseResponse(response);
    if (!body.ok) {
      throw new Error("Expected an accepted response.");
    }

    await running.server.close();
    expect(running.persistence.ingressReceipts.get(body.receiptId)).not.toBeNull();
    running.persistence.close();
  });
});
