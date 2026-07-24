import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export type CandidateGenerationTransportRequest = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignal;
}>;

export type CandidateGenerationTransportResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
}>;

export type CandidateGenerationTransport = (
  request: CandidateGenerationTransportRequest,
) => Promise<CandidateGenerationTransportResponse>;

type ResolveProviderAddresses = (hostname: string) => Promise<LookupAddress[]>;

export type NodeHttpsCandidateGenerationTransportDependencies = Readonly<{
  resolveAddresses?: ResolveProviderAddresses;
  request?: typeof httpsRequest;
}>;

export type CandidateGenerationTransportErrorCode =
  | "aborted"
  | "timeout"
  | "network_error"
  | "response_too_large"
  | "unsafe_resolution";

export class CandidateGenerationTransportError extends Error {
  readonly code: CandidateGenerationTransportErrorCode;

  constructor(code: CandidateGenerationTransportErrorCode) {
    super("The provider transport failed.");
    this.name = "CandidateGenerationTransportError";
    this.code = code;
  }
}

const BLOCKED_IPV4_NETWORKS = new BlockList();
const BLOCKED_IPV6_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_IPV4_NETWORKS.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_IPV6_NETWORKS.addSubnet(network, prefix, "ipv6");
}

export function isPublicProviderAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED_IPV4_NETWORKS.check(address, "ipv4");
  if (family === 6) return !BLOCKED_IPV6_NETWORKS.check(address, "ipv6");
  return false;
}

function normalizedHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : value;
  }
  return result;
}

async function resolvePublicAddresses(
  resolveAddresses: ResolveProviderAddresses,
  hostname: string,
  deadlineAt: number,
  signal: AbortSignal | undefined,
): Promise<LookupAddress[]> {
  return new Promise<LookupAddress[]>((resolve, reject) => {
    let settled = false;
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      reject(new CandidateGenerationTransportError("timeout"));
      return;
    }
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      operation();
    };
    const timer = setTimeout(
      () => finish(() => reject(new CandidateGenerationTransportError("timeout"))),
      remaining,
    );
    const abort = () => finish(() => reject(new CandidateGenerationTransportError("aborted")));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    resolveAddresses(hostname).then(
      (addresses) => finish(() => resolve(addresses)),
      () => finish(() => reject(new CandidateGenerationTransportError("network_error"))),
    );
  });
}

export function createNodeHttpsCandidateGenerationTransport(
  dependencies: NodeHttpsCandidateGenerationTransportDependencies = {},
): CandidateGenerationTransport {
  const resolveAddresses =
    dependencies.resolveAddresses ??
    ((hostname: string) => lookup(hostname, { all: true, verbatim: true }));
  const requestFactory = dependencies.request ?? httpsRequest;
  return async (input) => {
    if (input.signal?.aborted) throw new CandidateGenerationTransportError("aborted");
    const deadlineAt = Date.now() + input.timeoutMs;
    const url = new URL(input.url);
    const addresses = await resolvePublicAddresses(
      resolveAddresses,
      url.hostname,
      deadlineAt,
      input.signal,
    );
    if (
      addresses.length === 0 ||
      addresses.some((item) => !isPublicProviderAddress(item.address))
    ) {
      throw new CandidateGenerationTransportError("unsafe_resolution");
    }
    const selected = addresses[0];
    if (selected === undefined) throw new CandidateGenerationTransportError("unsafe_resolution");
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new CandidateGenerationTransportError("timeout");

    return new Promise<CandidateGenerationTransportResponse>((resolve, reject) => {
      let settled = false;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
        operation();
      };
      const fail = (code: CandidateGenerationTransportErrorCode) =>
        finish(() => reject(new CandidateGenerationTransportError(code)));

      let request: ReturnType<typeof httpsRequest>;
      try {
        request = requestFactory(
          url,
          {
            method: "POST",
            agent: false,
            headers: input.headers,
            signal: input.signal,
            servername: url.hostname,
            lookup: (_hostname, options, callback) => {
              if (typeof options === "object" && options.all) {
                callback(null, [selected]);
                return;
              }
              callback(null, selected.address, selected.family);
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              if (settled) return;
              size += chunk.byteLength;
              if (size > input.maxResponseBytes) {
                response.destroy();
                fail("response_too_large");
                return;
              }
              chunks.push(Buffer.from(chunk));
            });
            response.on("end", () => {
              if (settled) return;
              const statusCode = response.statusCode;
              if (statusCode === undefined) {
                fail("network_error");
                return;
              }
              const body = Buffer.concat(chunks, size);
              finish(() =>
                resolve({
                  statusCode,
                  headers: normalizedHeaders(response.headers),
                  body: new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
                }),
              );
            });
            response.on("error", () => fail("network_error"));
            response.on("aborted", () => fail("network_error"));
          },
        );
      } catch {
        fail("network_error");
        return;
      }
      deadlineTimer = setTimeout(() => {
        fail("timeout");
        request.destroy();
      }, remaining);
      request.on("error", () => fail(input.signal?.aborted ? "aborted" : "network_error"));
      request.end(Buffer.from(input.body));
    });
  };
}
