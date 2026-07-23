import type { VerificationKind, VerificationToolFamily } from "@ownloop/contracts";

import { MAX_ACCEPTED_COMMAND_CODE_POINTS } from "./constants.js";

export type RecognizedVerificationCommand = Readonly<{
  kind: VerificationKind;
  ruleId: string;
  toolFamily: VerificationToolFamily;
}>;

const UNKNOWN: RecognizedVerificationCommand = Object.freeze({
  kind: "unknown",
  ruleId: "unknown.unsupported_command",
  toolFamily: "unknown",
});

const SCRIPT_PATTERN = /^(test|lint|typecheck|build)(?::[a-z0-9][a-z0-9._-]*)*$/u;
const SHELL_META_PATTERN = /[\n\r\0|;&<>`$(){}]/u;

function scriptKind(script: string): Exclude<VerificationKind, "unknown"> | null {
  const match = SCRIPT_PATTERN.exec(script);
  return (match?.[1] as Exclude<VerificationKind, "unknown"> | undefined) ?? null;
}

function tokenize(command: string): string[] | null {
  if (
    command.trim().length === 0 ||
    Array.from(command).length > MAX_ACCEPTED_COMMAND_CODE_POINTS ||
    SHELL_META_PATTERN.test(command) ||
    command.includes("\\")
  ) {
    return null;
  }
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (const character of command.trim()) {
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (quote !== null) {
    return null;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens.length === 0 ? null : tokens;
}

function packageScript(
  family: "npm" | "pnpm" | "yarn" | "bun",
  script: string | undefined,
): RecognizedVerificationCommand | null {
  if (script === undefined) return null;
  const kind = scriptKind(script.toLowerCase());
  if (kind === null) return null;
  return { kind, ruleId: `package_script.${family}.${kind}`, toolFamily: family };
}

function directTool(
  tokens: readonly string[],
  wrapper: "npx" | "npm_exec" | "pnpm_exec" | "pnpm_dlx" | "yarn_dlx" | "bun_x" | null,
): RecognizedVerificationCommand | null {
  const [tool, ...arguments_] = tokens;
  if (tool === undefined) return null;
  const executable = tool.toLowerCase().replace(/^.*\//u, "");
  const prefix = wrapper === null ? "direct" : `wrapper.${wrapper}`;

  if (executable === "vitest") {
    return { kind: "test", ruleId: `${prefix}.vitest`, toolFamily: "vitest" };
  }
  if (executable === "jest") {
    return { kind: "test", ruleId: `${prefix}.jest`, toolFamily: "jest" };
  }
  if (executable === "node" && arguments_.includes("--test")) {
    return { kind: "test", ruleId: `${prefix}.node_test`, toolFamily: "node_test" };
  }
  if ((executable === "tsc" || executable === "typescript") && arguments_.includes("--noEmit")) {
    return {
      kind: "typecheck",
      ruleId: `${prefix}.typescript_no_emit`,
      toolFamily: "typescript",
    };
  }
  if (executable === "eslint") {
    return { kind: "lint", ruleId: `${prefix}.eslint`, toolFamily: "eslint" };
  }
  if (executable === "biome" && arguments_[0]?.toLowerCase() === "lint") {
    return { kind: "lint", ruleId: `${prefix}.biome_lint`, toolFamily: "biome" };
  }
  if (executable === "vite" && arguments_[0]?.toLowerCase() === "build") {
    return { kind: "build", ruleId: `${prefix}.vite_build`, toolFamily: "vite" };
  }
  if (executable === "next" && arguments_[0]?.toLowerCase() === "build") {
    return { kind: "build", ruleId: `${prefix}.next_build`, toolFamily: "next" };
  }
  if (executable === "rollup") {
    return { kind: "build", ruleId: `${prefix}.rollup`, toolFamily: "rollup" };
  }
  if (executable === "webpack") {
    return { kind: "build", ruleId: `${prefix}.webpack`, toolFamily: "webpack" };
  }
  return null;
}

function wrappedArguments(arguments_: readonly string[]): readonly string[] {
  return arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
}

export function recognizeVerificationCommand(command: string): RecognizedVerificationCommand {
  const tokens = tokenize(command);
  if (tokens === null) return UNKNOWN;
  const [program, ...arguments_] = tokens;
  const executable = program?.toLowerCase().replace(/^.*\//u, "");

  if (executable === "npm") {
    if (arguments_[0]?.toLowerCase() === "test") return packageScript("npm", "test") ?? UNKNOWN;
    if (arguments_[0]?.toLowerCase() === "run") {
      return packageScript("npm", arguments_[1]) ?? UNKNOWN;
    }
    if (arguments_[0]?.toLowerCase() === "exec") {
      return directTool(wrappedArguments(arguments_.slice(1)), "npm_exec") ?? UNKNOWN;
    }
  }
  if (executable === "npx") {
    return directTool(arguments_, "npx") ?? UNKNOWN;
  }
  if (executable === "pnpm") {
    const first = arguments_[0]?.toLowerCase();
    if (first === "run") return packageScript("pnpm", arguments_[1]) ?? UNKNOWN;
    if (first === "exec")
      return directTool(wrappedArguments(arguments_.slice(1)), "pnpm_exec") ?? UNKNOWN;
    if (first === "dlx")
      return directTool(wrappedArguments(arguments_.slice(1)), "pnpm_dlx") ?? UNKNOWN;
    return packageScript("pnpm", arguments_[0]) ?? UNKNOWN;
  }
  if (executable === "yarn") {
    const first = arguments_[0]?.toLowerCase();
    if (first === "run") return packageScript("yarn", arguments_[1]) ?? UNKNOWN;
    if (first === "dlx")
      return directTool(wrappedArguments(arguments_.slice(1)), "yarn_dlx") ?? UNKNOWN;
    return packageScript("yarn", arguments_[0]) ?? UNKNOWN;
  }
  if (executable === "bun") {
    const first = arguments_[0]?.toLowerCase();
    if (first === "test") return packageScript("bun", "test") ?? UNKNOWN;
    if (first === "run") return packageScript("bun", arguments_[1]) ?? UNKNOWN;
    if (first === "x") return directTool(wrappedArguments(arguments_.slice(1)), "bun_x") ?? UNKNOWN;
  }
  return directTool(tokens, null) ?? UNKNOWN;
}
