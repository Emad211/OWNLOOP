import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";

import { describe, expect, it, vi } from "vitest";

import {
  CandidateGenerationTransportError,
  createNodeHttpsCandidateGenerationTransport,
  isPublicProviderAddress,
} from "./transport.js";

const encoder = new TextEncoder();

function requestInput(timeoutMs = 100) {
  return {
    url: "https://provider.example/v1/responses",
    headers: { "Content-Type": "application/json" },
    body: encoder.encode("{}"),
    timeoutMs,
    maxResponseBytes: 1024,
  };
}

describe("Candidate provider address policy", () => {
  it("allows public addresses and rejects local, private, reserved, translated, and documentation ranges", () => {
    expect(isPublicProviderAddress("8.8.8.8")).toBe(true);
    expect(isPublicProviderAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of [
      "0.1.2.3",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:8.8.8.8",
      "64:ff9b::808:808",
      "64:ff9b:1::1",
      "100::1",
      "2001::1",
      "2001:db8::1",
      "2002:808:808::1",
      "3fff::1",
      "5f00::1",
      "fd00::1",
      "fe80::1",
      "fec0::1",
      "ff00::1",
    ]) {
      expect(isPublicProviderAddress(address)).toBe(false);
    }
  });

  it("applies the wall-clock deadline while DNS resolution is still pending", async () => {
    const transport = createNodeHttpsCandidateGenerationTransport({
      resolveAddresses: async () => new Promise(() => {}),
    });
    const error = await transport(requestInput(10)).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CandidateGenerationTransportError);
    expect((error as CandidateGenerationTransportError).code).toBe("timeout");
  });

  it("disables connection pooling and enforces the deadline despite response activity", async () => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const requestFactory = vi.fn(
      (_url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
        expect(options.agent).toBe(false);
        const request = new EventEmitter() as ClientRequest;
        const response = new EventEmitter() as IncomingMessage;
        response.statusCode = 200;
        response.headers = { "content-type": "application/json" };
        request.end = vi.fn(() => {
          callback(response);
          interval = setInterval(() => response.emit("data", Buffer.from("x")), 2);
          return request;
        }) as unknown as ClientRequest["end"];
        request.destroy = vi.fn(() => {
          if (interval !== undefined) clearInterval(interval);
          request.emit("error", new Error("destroyed"));
          return request;
        }) as ClientRequest["destroy"];
        return request;
      },
    ) as unknown as typeof import("node:https").request;
    const transport = createNodeHttpsCandidateGenerationTransport({
      resolveAddresses: async () => [{ address: "8.8.8.8", family: 4 }],
      request: requestFactory,
    });

    const error = await transport(requestInput(15)).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(CandidateGenerationTransportError);
    expect((error as CandidateGenerationTransportError).code).toBe("timeout");
    expect(requestFactory).toHaveBeenCalledTimes(1);
  });
});
