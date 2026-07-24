import { describe, expect, it } from "vitest";

import { PersistenceError } from "../persistence/index.js";
import { canonicalSemanticAnalysisInput, parseCanonicalSemanticAnalysisInput } from "./artifact.js";
import { prepareDeterministicSemanticAnalysisInput } from "./reducer.js";
import { semanticInputFixture } from "./test-fixture.js";

describe("semantic-analysis input artifact", () => {
  it("round-trips exact canonical bytes and rejects tampering", () => {
    const prepared = prepareDeterministicSemanticAnalysisInput(semanticInputFixture());
    if (!("bytes" in prepared)) throw new Error("expected prepared semantic input");
    expect(canonicalSemanticAnalysisInput(prepared.value).bytes).toEqual(prepared.bytes);
    expect(parseCanonicalSemanticAnalysisInput(prepared.bytes)).toEqual(prepared.value);

    const tampered = new TextEncoder().encode(`${prepared.canonicalJson} `);
    expect(() => parseCanonicalSemanticAnalysisInput(tampered)).toThrow(PersistenceError);
  });
});
