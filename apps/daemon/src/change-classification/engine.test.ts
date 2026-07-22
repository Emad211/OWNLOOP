import { describe, expect, it } from "vitest";

import type { GitReconciliationEntry } from "../persistence/index.js";
import { aggregateClassificationLabels, classifyReconciliationEntries } from "./engine.js";
import { CHANGE_CLASSIFICATION_RULES } from "./rules.js";

function entry(
  path: string | null,
  sensitivity: "normal" | "secret" = "normal",
): GitReconciliationEntry {
  return {
    reconciliationId: "reconciliation-1",
    entryIndex: 0,
    fileEventId: "file-event-1",
    pathIdentitySha256: "a".repeat(64),
    relativePath: path,
    changeKind: "modified",
    staged: true,
    unstaged: false,
    sensitivity,
    attribution: "run_relative",
  };
}

function labels(path: string): readonly string[] {
  return classifyReconciliationEntries([entry(path)])[0]?.labels.map((item) => item.label) ?? [];
}

describe("deterministic file/change rule engine", () => {
  it("publishes a frozen, unique and confidence-bounded rule set", () => {
    expect(Object.isFrozen(CHANGE_CLASSIFICATION_RULES)).toBe(true);
    expect(CHANGE_CLASSIFICATION_RULES.every((rule) => Object.isFrozen(rule))).toBe(true);
    expect(new Set(CHANGE_CLASSIFICATION_RULES.map((rule) => rule.ruleId)).size).toBe(
      CHANGE_CLASSIFICATION_RULES.length,
    );
    expect(CHANGE_CLASSIFICATION_RULES.map((rule) => rule.precedence)).toEqual(
      CHANGE_CLASSIFICATION_RULES.map((_, index) => index),
    );
    expect(
      CHANGE_CLASSIFICATION_RULES.every(
        (rule) =>
          Number.isInteger(rule.confidenceBasisPoints) &&
          rule.confidenceBasisPoints >= 1 &&
          rule.confidenceBasisPoints <= 10_000,
      ),
    ).toBe(true);
  });

  it.each([
    ["apps/web/src/components/LoginForm.tsx", ["ui", "behavior"]],
    ["apps/daemon/src/auth/session.ts", ["behavior", "authentication_authorization"]],
    ["apps/daemon/src/routes/users.ts", ["behavior", "public_api"]],
    ["packages/contracts/tests/replay.test.ts", ["tests", "public_api"]],
    ["prisma/migrations/001_init/migration.sql", ["database_migration"]],
    [".github/workflows/ci.yml", ["configuration_infrastructure"]],
    ["package.json", ["dependency"]],
    ["package-lock.json", ["dependency"]],
    ["pnpm-lock.yaml", ["dependency"]],
    ["yarn.lock", ["dependency"]],
    ["bun.lockb", ["dependency"]],
    ["docs/architecture.md", ["documentation"]],
    [".eslintrc.json", ["configuration_infrastructure"]],
    ["vite.config.ts", ["configuration_infrastructure"]],
    ["biome.json", ["configuration_infrastructure"]],
    ["tsconfig.build.json", ["configuration_infrastructure"]],
    ["apps/api/src/controllers/users.ts", ["behavior", "public_api"]],
    ["apps/api/src/routes/auth.ts", ["behavior", "authentication_authorization", "public_api"]],
    ["prisma/schema.prisma", ["database_migration"]],
    ["docker-compose.yaml", ["configuration_infrastructure"]],
    ["src/api.ts", ["behavior", "public_api"]],
    ["src/database/client.ts", ["behavior", "database_migration"]],
    ["src/schemas/user.ts", ["behavior"]],
    ["Dockerfile", ["configuration_infrastructure"]],
    ["README", ["documentation"]],
  ])("classifies %s with deterministic multi-label rules", (path, expected) => {
    expect(labels(path)).toEqual(expected);
  });

  it("emits unknown with zero confidence for hidden and unmatched paths", () => {
    const hidden = classifyReconciliationEntries([entry(null, "secret")])[0];
    const unmatched = classifyReconciliationEntries([entry("misc/blob.bin")])[0];
    for (const classified of [hidden, unmatched]) {
      expect(classified?.labels).toEqual([
        {
          label: "unknown",
          confidenceBasisPoints: 0,
          evidence: [{ ruleId: "fallback.no_supported_rule", kind: "fallback" }],
        },
      ]);
    }
  });

  it("sorts evidence and aggregate labels canonically", () => {
    const classified = classifyReconciliationEntries([
      entry("apps/web/src/pages/auth/Login.test.tsx"),
    ]);
    expect(classified[0]?.labels.map((item) => item.label)).toEqual([
      "ui",
      "tests",
      "authentication_authorization",
    ]);
    expect(aggregateClassificationLabels(classified)).toEqual([
      { label: "ui", entryCount: 1, maximumConfidenceBasisPoints: 8500 },
      { label: "tests", entryCount: 1, maximumConfidenceBasisPoints: 9500 },
      {
        label: "authentication_authorization",
        entryCount: 1,
        maximumConfidenceBasisPoints: 8500,
      },
    ]);
  });

  it.each([
    "/absolute.ts",
    "C:/absolute.ts",
    "../escape.ts",
    "a/../escape.ts",
    "a//b.ts",
    "a\\b.ts",
    "a/b/",
    " a.ts",
    "a.ts ",
    "a\u0000b.ts",
    "cafe\u0301.ts",
  ])("rejects non-canonical persisted path %s", (path) => {
    expect(() => classifyReconciliationEntries([entry(path)])).toThrowError(
      expect.objectContaining({ code: "invalid_persisted_row" }),
    );
  });

  it("enforces the 2000-entry classification bound", () => {
    const entries = Array.from({ length: 2001 }, (_, index) => ({
      ...entry(`src/file-${index}.ts`),
      entryIndex: index,
      fileEventId: `file-event-${index}`,
    }));
    expect(() => classifyReconciliationEntries(entries)).toThrowError(
      expect.objectContaining({ code: "invalid_persisted_row" }),
    );
  });

  it("rejects a secret entry that exposes a path", () => {
    expect(() => classifyReconciliationEntries([entry("secret.env", "secret")])).toThrowError(
      expect.objectContaining({ code: "invalid_persisted_row" }),
    );
  });
});
