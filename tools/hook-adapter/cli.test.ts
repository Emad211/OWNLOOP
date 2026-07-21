import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createSecretKey } from "node:crypto";
import { access } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validClaudeHookFixtures } from "@ownloop/test-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateInstallationToken } from "../../apps/daemon/src/ingress/auth.js";
import type { IngressDiagnosticEvent } from "../../apps/daemon/src/ingress/diagnostics.js";
import {
  createLoopbackIngressServer,
  startLoopbackIngressServer,
} from "../../apps/daemon/src/ingress/server.js";
import { openPersistence } from "../../apps/daemon/src/persistence/index.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ADAPTER_ENTRY = join(REPOSITORY_ROOT, "tools/hook-adapter/dist/index.js");
const TYPESCRIPT_ENTRY = join(REPOSITORY_ROOT, "node_modules/typescript/bin/tsc");
const HMAC_KEY = createSecretKey(Buffer.alloc(32, 11));

function compileProject(projectPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [TYPESCRIPT_ENTRY, "-p", projectPath], {
      cwd: REPOSITORY_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Fixture build failed with code ${String(code)}: ${stderr}`));
      }
    });
  });
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Fixture server did not bind to a TCP port.");
  }
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
  });
  return port;
}

async function listenOnLoopback(
  server: ReturnType<typeof createNetServer> | ReturnType<typeof createHttpServer>,
): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not bind to a TCP port.");
  }
  return address.port;
}

async function closeServer(
  server: ReturnType<typeof createNetServer> | ReturnType<typeof createHttpServer>,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
  });
}

type ChildResult = Readonly<{
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
}>;

function runAdapter(input: string | Buffer, environment: NodeJS.ProcessEnv): Promise<ChildResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [ADAPTER_ENTRY], {
      cwd: REPOSITORY_ROOT,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Hook Adapter child fixture timed out."));
    }, 5_000);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    child.stdin.end(input);
  });
}

function childEnvironment(port?: number, token?: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  if (port !== undefined) {
    environment.OWNLOOP_INGRESS_PORT = String(port);
  }
  if (token !== undefined) {
    environment.OWNLOOP_INSTALLATION_TOKEN = token;
  }
  return environment;
}

beforeAll(async () => {
  await compileProject("packages/event-model/tsconfig.json");
  await compileProject("packages/contracts/tsconfig.json");
  await compileProject("tools/hook-adapter/tsconfig.json");
  await access(ADAPTER_ENTRY);
}, 30_000);

afterAll(() => {
  // Build artifacts are intentionally left for the repository build step that follows tests in CI.
});

describe("production Hook Adapter CLI", () => {
  it.each([
    {
      name: "missing configuration",
      input: JSON.stringify(validClaudeHookFixtures[0].input),
      env: {},
    },
    {
      name: "malformed input",
      input: "{",
      env: childEnvironment(9, generateInstallationToken()),
    },
  ])("exits 0 silently for $name", async ({ input, env }) => {
    const result = await runAdapter(input, env);
    expect(result.code).toBe(0);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
  });

  it("exits 0 silently for oversized stdin", async () => {
    const result = await runAdapter(
      Buffer.alloc(1_000_001, 0x20),
      childEnvironment(9, generateInstallationToken()),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
  });

  it("exits 0 silently when delivery times out", async () => {
    const sockets = new Set<Socket>();
    const server = createNetServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("data", () => undefined);
    });
    const port = await listenOnLoopback(server);

    try {
      const result = await runAdapter(
        JSON.stringify(validClaudeHookFixtures[0].input),
        childEnvironment(port, generateInstallationToken()),
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toHaveLength(0);
      expect(result.stderr).toHaveLength(0);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      await closeServer(server);
    }
  });

  it("exits 0 silently for an invalid accepted response", async () => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(202, { "content-type": "application/json" });
      response.end("{");
    });
    const port = await listenOnLoopback(server);

    try {
      const result = await runAdapter(
        JSON.stringify(validClaudeHookFixtures[0].input),
        childEnvironment(port, generateInstallationToken()),
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toHaveLength(0);
      expect(result.stderr).toHaveLength(0);
    } finally {
      await closeServer(server);
    }
  });

  it("exits 0 silently when the daemon is unavailable", async () => {
    const port = await unusedLoopbackPort();
    const result = await runAdapter(
      JSON.stringify(validClaudeHookFixtures[0].input),
      childEnvironment(port, generateInstallationToken()),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
  });

  it("delivers to a real daemon and remains silent", async () => {
    const persistence = openPersistence(":memory:");
    const token = generateInstallationToken();
    const diagnostics: IngressDiagnosticEvent[] = [];
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey: HMAC_KEY,
      receiptIdGenerator: () => "01987f50-4444-7444-8444-444444444444",
      diagnostics: (event) => diagnostics.push(event),
    });

    try {
      const address = await startLoopbackIngressServer(server, 0);
      const payload = validClaudeHookFixtures[1].input;
      const result = await runAdapter(
        JSON.stringify(payload),
        childEnvironment(address.port, token),
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toHaveLength(0);
      expect(result.stderr).toHaveLength(0);
      const accepted = diagnostics.find(
        (event): event is Extract<IngressDiagnosticEvent, { type: "receipt.accepted" }> =>
          event.type === "receipt.accepted",
      );
      expect(accepted).toEqual({
        type: "receipt.accepted",
        receiptId: "01987f50-4444-7444-8444-444444444444",
        hookName: "UserPromptSubmit",
        duplicate: false,
      });
      expect(persistence.ingressReceipts.get(accepted?.receiptId ?? "missing")).toMatchObject({
        preparationStatus: "prepared",
        sourceEventName: "UserPromptSubmit",
        processingStatus: "pending",
      });
    } finally {
      await server.close();
      persistence.close();
    }
  });

  it("keeps duplicate child-process delivery idempotent", async () => {
    const persistence = openPersistence(":memory:");
    const token = generateInstallationToken();
    const diagnostics: IngressDiagnosticEvent[] = [];
    let idCounter = 0;
    const server = createLoopbackIngressServer({
      persistence,
      installationToken: token,
      hmacKey: HMAC_KEY,
      receiptIdGenerator: () => {
        idCounter += 1;
        return idCounter === 1
          ? "01987f50-5555-7555-8555-555555555555"
          : "01987f50-6666-7666-8666-666666666666";
      },
      diagnostics: (event) => diagnostics.push(event),
    });

    try {
      const address = await startLoopbackIngressServer(server, 0);
      const sourcePayload = JSON.stringify(validClaudeHookFixtures[0].input);
      const first = await runAdapter(sourcePayload, childEnvironment(address.port, token));
      const second = await runAdapter(sourcePayload, childEnvironment(address.port, token));

      for (const result of [first, second]) {
        expect(result.code).toBe(0);
        expect(result.stdout).toHaveLength(0);
        expect(result.stderr).toHaveLength(0);
      }
      const accepted = diagnostics.filter(
        (event): event is Extract<IngressDiagnosticEvent, { type: "receipt.accepted" }> =>
          event.type === "receipt.accepted",
      );
      expect(accepted).toEqual([
        {
          type: "receipt.accepted",
          receiptId: "01987f50-5555-7555-8555-555555555555",
          hookName: "SessionStart",
          duplicate: false,
        },
        {
          type: "receipt.accepted",
          receiptId: "01987f50-5555-7555-8555-555555555555",
          hookName: "SessionStart",
          duplicate: true,
        },
      ]);
      expect(persistence.ingressReceipts.get("01987f50-6666-7666-8666-666666666666")).toBeNull();
    } finally {
      await server.close();
      persistence.close();
    }
  });
});
