#!/usr/bin/env node

import { resolve } from "node:path";

import { buildWindowsReleasePackage } from "./package-builder.js";

async function main(): Promise<void> {
  try {
    const repositoryRoot = resolve(process.cwd());
    const outputRoot = resolve(process.argv[2] ?? "dist");
    const result = await buildWindowsReleasePackage({ repositoryRoot, outputRoot });
    process.stdout.write(
      `${JSON.stringify({ ok: true, fingerprint: result.fingerprint, fileCount: result.fileCount })}\n`,
    );
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "build_failed";
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
    process.exitCode = 1;
  }
}

void main();
