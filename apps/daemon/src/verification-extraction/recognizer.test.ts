import { describe, expect, it } from "vitest";

import { recognizeVerificationCommand } from "./recognizer.js";

describe("verification command recognizer", () => {
  it.each([
    ["npm test", "test", "npm"],
    ["npm run test:unit -- --runInBand", "test", "npm"],
    ["pnpm lint:ci", "lint", "pnpm"],
    ["yarn run typecheck", "typecheck", "yarn"],
    ["bun run build:prod", "build", "bun"],
    ["pnpm exec vitest run", "test", "vitest"],
    ["npm exec -- vitest run", "test", "vitest"],
    ["npx jest", "test", "jest"],
    ["bun x eslint src", "lint", "eslint"],
    ["node --test test/*.js", "test", "node_test"],
    ["tsc -p tsconfig.json --noEmit", "typecheck", "typescript"],
    ["biome lint apps", "lint", "biome"],
    ["vite build", "build", "vite"],
    ["next build", "build", "next"],
    ["rollup -c", "build", "rollup"],
    ["webpack --mode production", "build", "webpack"],
  ])("recognizes %s", (command, kind, family) => {
    expect(recognizeVerificationCommand(command)).toMatchObject({ kind, toolFamily: family });
  });

  it.each([
    "pnpm check",
    "npm run verify",
    "pnpm test && pnpm build",
    "pnpm test | tee output.txt",
    "$(pnpm test)",
    "pnpm test > result.txt",
    "pnpm test &",
    "echo test",
    "",
    "npm run test\\:unit",
  ])("keeps ambiguous or compound command unknown: %s", (command) => {
    expect(recognizeVerificationCommand(command)).toEqual({
      kind: "unknown",
      ruleId: "unknown.unsupported_command",
      toolFamily: "unknown",
    });
  });
});
