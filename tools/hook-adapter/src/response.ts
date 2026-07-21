import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import { IngestionAcceptedResponseSchema } from "@ownloop/contracts";

import { HOOK_ADAPTER_MAX_RESPONSE_BYTES } from "./constants.js";

async function readBoundedResponseText(
  response: Response,
  maximumBytes = HOOK_ADAPTER_MAX_RESPONSE_BYTES,
): Promise<string | null> {
  if (response.body === null) {
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        return null;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const combined = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    totalBytes,
  );
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(combined);
  } catch {
    return null;
  }
}

export async function isAcceptedIngressResponse(response: Response): Promise<boolean> {
  if (response.status !== 202) {
    try {
      await response.body?.cancel();
    } catch {
      // Non-accepted response bodies are intentionally discarded.
    }
    return false;
  }
  const text = await readBoundedResponseText(response);
  if (text === null) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  return IngestionAcceptedResponseSchema.safeParse(parsed).success;
}
