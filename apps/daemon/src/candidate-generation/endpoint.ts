import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { PersistenceError } from "../persistence/index.js";
import { CANDIDATE_GENERATION_ENDPOINT_PATH } from "./constants.js";

const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const FORBIDDEN_HOSTS = new Set(["localhost", "localhost.localdomain"]);
const FORBIDDEN_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".test",
  ".invalid",
  ".example",
];

export type NormalizedCandidateGenerationEndpoint = Readonly<{
  baseUrl: string;
  responseUrl: string;
  originFingerprint: string;
  hostname: string;
}>;

function invalidEndpoint(): never {
  throw new PersistenceError("operation_failed", "The provider endpoint configuration is invalid.");
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/u, "");
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    isIP(normalized) !== 0 ||
    FORBIDDEN_HOSTS.has(normalized) ||
    FORBIDDEN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    return invalidEndpoint();
  }
  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) => !HOST_LABEL_PATTERN.test(label))) {
    return invalidEndpoint();
  }
  return normalized;
}

export function normalizeCandidateGenerationEndpoint(
  value: string,
): NormalizedCandidateGenerationEndpoint {
  if (typeof value !== "string" || value.trim() !== value || value.length > 2048) {
    return invalidEndpoint();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidEndpoint();
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.pathname !== "/v1" && url.pathname !== "/v1/")
  ) {
    return invalidEndpoint();
  }
  const hostname = normalizeHostname(url.hostname);
  const port = url.port === "443" ? "" : url.port;
  if (port !== "" && (!/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    return invalidEndpoint();
  }
  const origin = `https://${hostname}${port === "" ? "" : `:${port}`}`;
  const baseUrl = `${origin}/v1`;
  return {
    baseUrl,
    responseUrl: `${origin}${CANDIDATE_GENERATION_ENDPOINT_PATH}`,
    originFingerprint: `sha256:${createHash("sha256").update(origin).digest("hex")}`,
    hostname,
  };
}
