import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

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
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}>;

export type CandidateGenerationTransport = (
  request: CandidateGenerationTransportRequest,
) => Promise<CandidateGenerationTransportResponse>;

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

function publicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function publicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("::ffff:")
  );
}

export function isPublicProviderAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? publicIpv4(address) : family === 6 ? publicIpv6(address) : false;
}

function normalizedHeaders(
  headers: import("node:http").IncomingHttpHeaders,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of ["content-type", "retry-after", "x-request-id"] as const) {
    const value = headers[name];
    if (typeof value === "string") result[name] = value;
    else if (Array.isArray(value) && value.length === 1 && value[0] !== undefined)
      result[name] = value[0];
  }
  return result;
}

export function createNodeHttpsCandidateGenerationTransport(): CandidateGenerationTransport {
  return async (input) => {
    if (input.signal?.aborted) throw new CandidateGenerationTransportError("aborted");
    const url = new URL(input.url);
    let addresses: LookupAddress[];
    try {
      addresses = await lookup(url.hostname, { all: true, verbatim: true });
    } catch {
      throw new CandidateGenerationTransportError("network_error");
    }
    if (
      addresses.length === 0 ||
      addresses.some((entry) => !isPublicProviderAddress(entry.address))
    ) {
      throw new CandidateGenerationTransportError("unsafe_resolution");
    }
    const selected = addresses[0];
    if (selected === undefined) throw new CandidateGenerationTransportError("unsafe_resolution");

    return await new Promise<CandidateGenerationTransportResponse>((resolve, reject) => {
      let settled = false;
      const fail = (code: CandidateGenerationTransportErrorCode) => {
        if (!settled) {
          settled = true;
          reject(new CandidateGenerationTransportError(code));
        }
      };
      const request = httpsRequest(
        url,
        {
          method: "POST",
          headers: input.headers,
          signal: input.signal,
          servername: url.hostname,
          rejectUnauthorized: true,
          lookup: (_hostname, _options, callback) => {
            callback(null, selected.address, selected.family);
          },
        },
        (response) => {
          const statusCode = response.statusCode;
          if (statusCode === undefined) {
            response.destroy();
            fail("network_error");
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > input.maxResponseBytes) {
              response.destroy();
              fail("response_too_large");
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => {
            if (settled) return;
            settled = true;
            resolve({
              statusCode,
              headers: normalizedHeaders(response.headers),
              body: Uint8Array.from(Buffer.concat(chunks)),
            });
          });
          response.on("error", () => fail("network_error"));
        },
      );
      request.setTimeout(input.timeoutMs, () => {
        request.destroy();
        fail("timeout");
      });
      request.on("error", (error) => {
        if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          fail("aborted");
        } else {
          fail("network_error");
        }
      });
      request.end(input.body);
    });
  };
}
