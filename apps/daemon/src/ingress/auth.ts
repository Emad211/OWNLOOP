import { Buffer } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { FastifyRequest } from "fastify";

const MINIMUM_INSTALLATION_TOKEN_BYTES = 32;
const BASE64URL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]+)$/;

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!BASE64URL_TOKEN_PATTERN.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < MINIMUM_INSTALLATION_TOKEN_BYTES) {
    return null;
  }
  return decoded.toString("base64url") === value ? decoded : null;
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function generateInstallationToken(): string {
  return randomBytes(MINIMUM_INSTALLATION_TOKEN_BYTES).toString("base64url");
}

export type InstallationTokenVerifier = Readonly<{
  verifyRequest(request: FastifyRequest): boolean;
}>;

export function createInstallationTokenVerifier(
  installationToken: string,
): InstallationTokenVerifier {
  if (decodeCanonicalBase64Url(installationToken) === null) {
    throw new Error("The installation token must be canonical base64url for at least 32 bytes.");
  }
  const expectedDigest = digestToken(installationToken);

  return Object.freeze({
    verifyRequest(request: FastifyRequest): boolean {
      const values = request.raw.headersDistinct.authorization;
      if (values === undefined || values.length !== 1) {
        return false;
      }

      const match = values[0]?.match(BEARER_PATTERN);
      const presentedToken = match?.[1];
      if (presentedToken === undefined || decodeCanonicalBase64Url(presentedToken) === null) {
        return false;
      }

      const presentedDigest = digestToken(presentedToken);
      return (
        presentedDigest.length === expectedDigest.length &&
        timingSafeEqual(presentedDigest, expectedDigest)
      );
    },
  });
}
