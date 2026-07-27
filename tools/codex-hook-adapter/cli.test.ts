import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validCodexHookFixtures } from "@ownloop/test-fixtures";
import { beforeAll, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ADAPTER_ENTRY = join(REPOSITORY_ROOT, "tools/codex-hook-adapter/dist/index.js");
const TYPESCRIPT_ENTRY = join(REPOSITORY_ROOT, "node_modules/typescript/bin/tsc");
const TOKEN = Buffer.alloc(32, 7).toString("base64url");

type ChildResult = Readonly<{ code: number | null; stdout: Buffer; stderr: Buffer }>;

function compileProject(projectPath: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [TYPESCRIPT_ENTRY, "-p", projectPath], {
      cwd: REPOSITORY_ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Fixture build failed: ${String(code)} ${stderr}`));
    });
  });
}

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
      reject(new Error("Codex adapter fixture timed out."));
    }, 5_000);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
    child.stdin.end(input);
  });
}

function environment(port?: number): NodeJS.ProcessEnv {
  const value: NodeJS.ProcessEnv = {};
  if (port !== undefined) {
    value.OWNLOOP_INGRESS_PORT = String(port);
    value.OWNLOOP_INSTALLATION_TOKEN = TOKEN;
    value.OWNLOOP_CODEX_SOURCE_SURFACE = "cli";
  }
  return value;
}

async function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No TCP address.");
  return address.port;
}

beforeAll(async () => {
  await compileProject("packages/event-model/tsconfig.json");
  await compileProject("packages/contracts/tsconfig.json");
  await compileProject("tools/codex-hook-adapter/tsconfig.json");
}, 30_000);

describe("production Codex hook adapter CLI", () => {
  it.each([
    {
      name: "missing configuration",
      input: JSON.stringify(validCodexHookFixtures[0].input),
      env: {},
    },
    { name: "malformed JSON", input: "{", env: environment(9) },
    {
      name: "duplicate key",
      input: '{"session_id":"a","session_id":"b"}',
      env: environment(9),
    },
    { name: "oversized stdin", input: Buffer.alloc(1_000_001, 0x20), env: environment(9) },
  ])("exits zero silently for $name", async ({ input, env }) => {
    const result = await runAdapter(input, env);
    expect(result.code).toBe(0);
    expect(result.stdout).toHaveLength(0);
    expect(result.stderr).toHaveLength(0);
  });

  it("exits zero silently after a successful accepted delivery", async () => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(202, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          status: "accepted",
          receiptId: "receipt-codex-cli-001",
          duplicate: false,
        }),
      );
    });
    const port = await listen(server);
    try {
      const result = await runAdapter(
        JSON.stringify(validCodexHookFixtures[0].input),
        environment(port),
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toHaveLength(0);
      expect(result.stderr).toHaveLength(0);
    } finally {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
      });
    }
  });
});
