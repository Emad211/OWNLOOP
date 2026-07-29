import type { FastifyRequest } from "fastify";

/**
 * Returns every occurrence of one request header without trusting Fastify's
 * flattened header view. Node exposes `headersDistinct` for real sockets, while
 * Fastify injection and some test transports only populate `rawHeaders`.
 */
export function getDistinctRequestHeaderValues(
  request: FastifyRequest,
  headerName: string,
): readonly string[] | undefined {
  const normalizedName = headerName.toLowerCase();
  const raw = request.raw as typeof request.raw & {
    headersDistinct?: Readonly<Record<string, readonly string[] | undefined>>;
  };
  const distinctValues = raw.headersDistinct?.[normalizedName];
  if (distinctValues !== undefined) {
    return distinctValues;
  }

  const rawValues: string[] = [];
  const rawHeaders = raw.rawHeaders;
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name?.toLowerCase() === normalizedName && value !== undefined) {
      rawValues.push(value);
    }
  }
  return rawValues.length === 0 ? undefined : rawValues;
}
