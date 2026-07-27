import { Buffer } from "node:buffer";
import { createSecretKey } from "node:crypto";

import {
  type CodexAdapterIngress,
  CodexAdapterIngressSchema,
} from "@ownloop/contracts/codex";
import { describe, expect, it } from "vitest";

import { openPersistence, type OwnLoopPersistence } from "../persistence/index.js";
import { generateInstallationToken } from "./auth.js";
import {
  CODEX_INGRESS_ROUTE,
  createLoopbackIngressServer,
  startLoopbackIngressServer,
  type IngressServerAddress,
} from "./server.js";

const TOKEN = generateInstallationToken();
const HMAC_KEY = createSecretKey(Buffer.alloc(32, 41));
const CREATED_AT = "2026-07-27T13:00:00.000Z";

function preToolIngress(command = "git status --short"): CodexAdapterIngress {
  return CodexAdapterIngressSchema.parse({
    contractVersion: 1,
    source: "codex",
    adapterVersion: "0.1.0",
    sourceVersion: "codex-cli 0.133.0",
    sourceSurface: "cli",
    receivedAt: "2026-07-27T12:59:59.000Z",
    payload: {
      session_id: "session-codex-route",
      transcript_path: null,
      cwd: "/workspace/project",
      turn_id: "turn-codex-route",
      model: "gpt-5.6-codex",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "shell_command",
      tool_input: { command },
      tool_use_id: "tool-codex-route",
    },
  });
}

function ids(values: string[]): () => string {
  return () => {
    const next = values.shift();
    if (next === undefined) throw new Error("Codex receipt ID fixture is exhausted.");
    return next;
  };
}

type Running = Readonly<{
  persistence: OwnLoopPersistence;
  server: ReturnType<typeof createLoopbackIngressServer>;
  address: IngressServerAddress;
}>;

async function start(idsToUse = ["receipt-codex-route-001", "receipt-codex-route-002"]): Promise<Running> {
  const persistence = openPersistence(":memory:");
  const server = createLoopbackIngressServer({
    persistence,
    installationToken: TOKEN,
    hmacKey: HMAC_KEY,
    homePath: "/home/fixture",
    clock: () => new Date(CREATED_AT),
    receiptIdGenerator: ids([...idsToUse]),
  });
  const address = await startLoopbackIngressServer(server, 0);
  return { persistence, server, address };
}

async function stop(running: Running): Promise<void> {
  await running.server.close();
  running.persistence.close();
}

async function post(
  address: IngressServerAddress,
  body: unknown,
  token = TOKEN,
): Promise<Response> {
  return fetch(`${address.url}${CODEX_INGRESS_ROUTE}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("Codex loopback ingress route", () => {
  it("returns 202 only after a redacted Codex receipt is durable", async () => {
    const running = await start();
    try {
      const response = await post(running.address, preToolIngress());
      expect(response.status).toBe(202);
      const body = (await response.json()) as {
        ok: boolean;
        receiptId: string;
        duplicate: boolean;
      };
      expect(body).toMatchObject({
        ok: true,
        receiptId: "receipt-codex-route-001",
        duplicate: false,
      });
      const receipt = running.persistence.ingressReceipts.get(body.receiptId);
      expect(receipt).toMatchObject({
        preparationStatus: "prepared",
        source: "codex",
        sourceEventName: "PreToolUse",
        sourceEventId: "tool-codex-route",
        processingStatus: "pending",
      });
      expect(receipt?.redactedPayloadJson).not.toContain("/workspace/project");
      expect(receipt?.redactedPayloadJson).not.toContain("transcript_path");
    } finally {
      await stop(running);
    }
  });

  it("returns the original receipt for an exact duplicate", async () => {
    const running = await start();
    try {
      const first = await post(running.address, preToolIngress());
      const second = await post(running.address, preToolIngress());
      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(await second.json()).toMatchObject({
        ok: true,
        receiptId: "receipt-codex-route-001",
        duplicate: true,
      });
      expect(running.persistence.ingressReceipts.get("receipt-codex-route-002")).toBeNull();
    } finally {
      await stop(running);
    }
  });

  it("returns 409 for the same Codex source identity with a changed payload", async () => {
    const running = await start();
    try {
      expect((await post(running.address, preToolIngress())).status).toBe(202);
      const conflict = await post(running.address, preToolIngress("git diff --stat"));
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({
        ok: false,
        error: { code: "deduplication_conflict" },
      });
      expect(running.persistence.ingressReceipts.get("receipt-codex-route-002")).toBeNull();
    } finally {
      await stop(running);
    }
  });

  it("uses the same authorization and strict contract boundary as Claude ingress", async () => {
    const running = await start();
    try {
      const unauthorized = await post(running.address, preToolIngress(), generateInstallationToken());
      expect(unauthorized.status).toBe(401);

      const unknownWrapper = await post(running.address, {
        ...preToolIngress(),
        future_wrapper: "reject",
      });
      expect(unknownWrapper.status).toBe(400);
      expect(await unknownWrapper.json()).toMatchObject({
        ok: false,
        error: { code: "invalid_payload" },
      });

      const unsupported = await post(running.address, {
        ...preToolIngress(),
        payload: {
          session_id: "session-codex-route",
          transcript_path: null,
          cwd: "/workspace/project",
          hook_event_name: "PostToolBatch",
          tool_calls: [],
        },
      });
      expect(unsupported.status).toBe(400);
      expect(await unsupported.json()).toMatchObject({
        ok: false,
        error: { code: "unsupported_hook" },
      });
    } finally {
      await stop(running);
    }
  });
});
