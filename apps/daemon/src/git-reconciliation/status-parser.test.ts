import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseGitPorcelainV2Status } from "./status-parser.js";

const OID = "a".repeat(40);
const OID2 = "b".repeat(40);
const OID3 = "c".repeat(40);

function status(...records: string[]): Buffer {
  return Buffer.from(`${records.join("\0")}\0`, "utf8");
}

function identity(path: string): string {
  return createHash("sha256").update(`ownloop-reconciliation-path-v1\0${path}`).digest("hex");
}

describe("porcelain v2 status parser", () => {
  it("parses ordinary, unmerged, untracked, and extensible header records", () => {
    const result = parseGitPorcelainV2Status(
      status(
        `# branch.oid ${OID}`,
        `1 M. N... 100644 100644 100644 ${OID} ${OID2} staged file.txt`,
        `1 .D N... 100644 100644 000000 ${OID} ${OID2} deleted.txt`,
        `u UU N... 100644 100644 100644 100644 ${OID} ${OID2} ${OID3} conflict.txt`,
        "? new.txt",
      ),
    );

    expect(result.diagnosticCode).toBeNull();
    expect(result.entries).toHaveLength(4);
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "staged file.txt",
          changeKind: "modified",
          staged: true,
          unstaged: false,
        }),
        expect.objectContaining({
          relativePath: "deleted.txt",
          changeKind: "deleted",
          staged: false,
          unstaged: true,
        }),
        expect.objectContaining({
          relativePath: "conflict.txt",
          changeKind: "unmerged",
          staged: true,
          unstaged: true,
        }),
        expect.objectContaining({
          relativePath: "new.txt",
          changeKind: "created",
          staged: false,
          unstaged: true,
        }),
      ]),
    );
  });

  it("uses conservative change precedence for ordinary XY status", () => {
    const result = parseGitPorcelainV2Status(
      status(
        `1 AD N... 100644 100644 000000 ${OID} ${OID2} deleted-wins.txt`,
        `1 AT N... 100644 100644 120000 ${OID} ${OID2} created-wins.txt`,
        `1 TM N... 100644 120000 120000 ${OID} ${OID2} type-wins.txt`,
      ),
    );
    expect(result.diagnosticCode).toBeNull();
    expect(
      result.entries.find((entry) => entry.relativePath === "deleted-wins.txt")?.changeKind,
    ).toBe("deleted");
    expect(
      result.entries.find((entry) => entry.relativePath === "created-wins.txt")?.changeKind,
    ).toBe("created");
    expect(result.entries.find((entry) => entry.relativePath === "type-wins.txt")?.changeKind).toBe(
      "type_changed",
    );
  });

  it("sorts deterministically independent of Git output order", () => {
    const first = parseGitPorcelainV2Status(status("? z.txt", "? a.txt", "? m.txt"));
    const second = parseGitPorcelainV2Status(status("? m.txt", "? z.txt", "? a.txt"));
    expect(first).toEqual(second);
    expect(first.entries.map((entry) => entry.pathIdentitySha256)).toEqual(
      [...first.entries.map((entry) => entry.pathIdentitySha256)].sort(),
    );
  });

  it("redacts sensitive relative paths while retaining the versioned identity", () => {
    const result = parseGitPorcelainV2Status(status("? config/.env.production"));
    expect(result).toEqual({
      diagnosticCode: null,
      entries: [
        {
          pathIdentitySha256: identity("config/.env.production"),
          relativePath: null,
          changeKind: "created",
          staged: false,
          unstaged: true,
          sensitivity: "secret",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(".env.production");
  });

  it("returns a deterministic bounded prefix and an explicit limit diagnostic", () => {
    const result = parseGitPorcelainV2Status(status("? c.txt", "? a.txt", "? b.txt"), 2);
    expect(result.diagnosticCode).toBe("status_entry_limit_exceeded");
    expect(result.entries).toHaveLength(2);
    const all = ["a.txt", "b.txt", "c.txt"]
      .map((path) => ({ path, digest: identity(path) }))
      .sort((left, right) => left.digest.localeCompare(right.digest));
    expect(result.entries.map((entry) => entry.pathIdentitySha256)).toEqual(
      all.slice(0, 2).map((entry) => entry.digest),
    );
  });

  it.each([
    ["missing NUL terminator", Buffer.from("? path.txt", "utf8")],
    ["invalid UTF-8", Buffer.from([0x3f, 0x20, 0xff, 0x00])],
    ["unsupported record", status(`2 R. N... 100644 100644 100644 ${OID} ${OID2} R100 to.txt`)],
    ["malformed ordinary record", status("1 M. N... broken.txt")],
    ["malformed header", status("#bad header")],
    ["absolute path", status("? /absolute.txt")],
    ["drive absolute path", status("? C:/absolute.txt")],
    ["traversal", status("? parent/../secret.txt")],
    ["empty segment", status("? parent//file.txt")],
    ["backslash path", status("? parent\\file.txt")],
    ["duplicate path", status("? duplicate.txt", "? duplicate.txt")],
    ["empty record", Buffer.from("? one.txt\0\0", "utf8")],
  ])("rejects %s without retaining partial entries", (_name, input) => {
    expect(parseGitPorcelainV2Status(input)).toEqual({
      entries: [],
      diagnosticCode: "invalid_status_output",
    });
  });

  it("rejects invalid parser limits", () => {
    expect(parseGitPorcelainV2Status(status("? file.txt"), 0)).toEqual({
      entries: [],
      diagnosticCode: "invalid_status_output",
    });
  });
});
