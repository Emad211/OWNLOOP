import { describe, expect, it } from "vitest";

import { getDistinctRequestHeaderValues } from "./http-headers.js";

type RawLike = {
  headersDistinct?: Record<string, readonly string[] | undefined>;
  rawHeaders: string[];
};

function request(raw: RawLike) {
  return { raw } as never;
}

describe("getDistinctRequestHeaderValues", () => {
  it("prefers Node headersDistinct and preserves duplicates", () => {
    expect(
      getDistinctRequestHeaderValues(
        request({ headersDistinct: { authorization: ["one", "two"] }, rawHeaders: [] }),
        "Authorization",
      ),
    ).toEqual(["one", "two"]);
  });

  it("uses rawHeaders when headersDistinct is unavailable", () => {
    expect(
      getDistinctRequestHeaderValues(
        request({ rawHeaders: ["Content-Type", "application/json", "content-type", "text/plain"] }),
        "content-type",
      ),
    ).toEqual(["application/json", "text/plain"]);
  });

  it("returns undefined instead of trusting a flattened header view", () => {
    expect(
      getDistinctRequestHeaderValues(request({ rawHeaders: [] }), "authorization"),
    ).toBeUndefined();
  });
});
