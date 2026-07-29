import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  OWNLOOP_APPLICATION_VERSION,
  OWNLOOP_RELEASE_MANIFEST_FILE,
  OWNLOOP_REQUIRED_NODE_VERSION,
  OWNLOOP_REQUIRED_PNPM_VERSION,
} from "@ownloop/contracts";

import { buildReleaseManifest, readAndVerifyReleasePackage } from "./manifest.js";

const execFileAsync = promisify(execFile);

export class PackageBuilderError extends Error {
  readonly code:
    | "invalid_configuration"
    | "runtime_incompatible"
    | "output_not_clean"
    | "build_failed"
    | "forbidden_file"
    | "package_verification_failed";
  constructor(code: PackageBuilderError["code"]) {
    super("The deterministic Windows release package could not be built.");
    this.name = "PackageBuilderError";
    this.code = code;
  }
}

export type PackageBuildRunner = (
  executable: string,
  args: readonly string[],
  options: Readonly<{ cwd: string }>,
) => Promise<{ stdout: string; stderr: string }>;

export type PackageBuildInvocation = Readonly<{
  executable: string;
  args: readonly string[];
}>;

export type PackageBuildInvocationOptions = Readonly<{
  platform?: NodeJS.Platform;
  environment?: Readonly<Record<string, string | undefined>>;
  nodeExecutable?: string;
}>;

const PNPM_JAVASCRIPT_ENTRYPOINT_PATTERN = /(?:^|[\/])pnpm(?:\.cjs|\.js)$/iu;

export function resolvePackageBuildInvocation(
  executable: string,
  args: readonly string[],
  options: PackageBuildInvocationOptions = {},
): PackageBuildInvocation {
  if ((options.platform ?? process.platform) !== "win32" || executable !== "pnpm") {
    return Object.freeze({ executable, args: Object.freeze([...args]) });
  }

  const environment = options.environment ?? process.env;
  const pnpmEntrypoint = environment.npm_execpath;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  if (
    pnpmEntrypoint === undefined ||
    !isAbsolute(pnpmEntrypoint) ||
    pnpmEntrypoint.includes("\0") ||
    !PNPM_JAVASCRIPT_ENTRYPOINT_PATTERN.test(pnpmEntrypoint) ||
    !isAbsolute(nodeExecutable) ||
    nodeExecutable.includes("\0")
  ) {
    throw new PackageBuilderError("runtime_incompatible");
  }

  return Object.freeze({
    executable: resolve(nodeExecutable),
    args: Object.freeze([resolve(pnpmEntrypoint), ...args]),
  });
}

async function defaultRunner(
  executable: string,
  args: readonly string[],
  options: { cwd: string },
) {
  const invocation = resolvePackageBuildInvocation(executable, args);
  const result = await execFileAsync(invocation.executable, [...invocation.args], {
    cwd: options.cwd,
    windowsHide: true,
    timeout: 10 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

function absolute(path: string): string {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new PackageBuilderError("invalid_configuration");
  return resolve(path);
}

function fsCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

async function optionalLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (fsCode(error) === "ENOENT") return null;
    throw new PackageBuilderError("build_failed");
  }
}

async function removeGeneratedFile(path: string): Promise<void> {
  const stats = await optionalLstat(path);
  if (stats === null) return;
  if (!stats.isFile()) throw new PackageBuilderError("forbidden_file");
  await rm(path, { force: true });
}

async function removeGeneratedDirectory(
  path: string,
  allowedEntries?: ReadonlySet<string>,
): Promise<void> {
  const stats = await optionalLstat(path);
  if (stats === null) return;
  if (!stats.isDirectory()) throw new PackageBuilderError("forbidden_file");
  if (allowedEntries !== undefined) {
    const entries = await readdir(path);
    if (entries.some((entry) => !allowedEntries.has(entry))) {
      throw new PackageBuilderError("forbidden_file");
    }
  }
  await rm(path, { recursive: true, force: true });
}

type JsonObject = Record<string, unknown>;

function jsonObject(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PackageBuilderError("forbidden_file");
  }
  return value as JsonObject;
}

function sortedStringRecord(
  value: unknown,
  mapValue: (name: string, specifier: string) => string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const record = jsonObject(value);
  const result: Record<string, string> = {};
  for (const name of Object.keys(record).sort()) {
    const specifier = record[name];
    if (typeof specifier !== "string") throw new PackageBuilderError("forbidden_file");
    result[name] = mapValue(name, specifier);
  }
  return result;
}

function canonicalRuntimeDependency(name: string, specifier: string): string {
  if (name.startsWith("@ownloop/")) {
    if (specifier !== "workspace:*") throw new PackageBuilderError("forbidden_file");
    return OWNLOOP_APPLICATION_VERSION;
  }
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(specifier)) {
    throw new PackageBuilderError("forbidden_file");
  }
  return specifier;
}

function canonicalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new PackageBuilderError("forbidden_file");
  }
  return [...value].sort();
}

async function rewriteDeployedPackageMetadata(
  repositoryRoot: string,
  sourcePackagePath: string,
  deploymentRoot: string,
  expectedName: string,
): Promise<void> {
  const sourcePath = join(repositoryRoot, sourcePackagePath);
  const deployedPath = join(deploymentRoot, "package.json");
  const sourceStats = await optionalLstat(sourcePath);
  const deployedStats = await optionalLstat(deployedPath);
  if (sourceStats?.isFile() !== true || deployedStats?.isFile() !== true) {
    throw new PackageBuilderError("forbidden_file");
  }
  let source: JsonObject;
  try {
    const bytes = await readFile(sourcePath);
    if (bytes.length > 64 * 1024) throw new PackageBuilderError("forbidden_file");
    source = jsonObject(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch (error) {
    if (error instanceof PackageBuilderError) throw error;
    throw new PackageBuilderError("forbidden_file");
  }
  if (
    source.name !== expectedName ||
    source.version !== OWNLOOP_APPLICATION_VERSION ||
    source.private !== true ||
    source.type !== "module"
  ) {
    throw new PackageBuilderError("forbidden_file");
  }
  const files = canonicalStringArray(source.files);
  const bin = sortedStringRecord(source.bin, (_name, path) => {
    if (!/^\.\/dist\/[A-Za-z0-9._/-]+$/u.test(path) || path.includes("../")) {
      throw new PackageBuilderError("forbidden_file");
    }
    return path;
  });
  const dependencies = sortedStringRecord(source.dependencies, canonicalRuntimeDependency);
  const optionalDependencies = sortedStringRecord(
    source.optionalDependencies,
    canonicalRuntimeDependency,
  );
  const canonical: JsonObject = {
    name: expectedName,
    version: OWNLOOP_APPLICATION_VERSION,
    private: true,
    type: "module",
  };
  if (files !== undefined) canonical.files = files;
  if (bin !== undefined) canonical.bin = bin;
  if (dependencies !== undefined) canonical.dependencies = dependencies;
  if (optionalDependencies !== undefined) canonical.optionalDependencies = optionalDependencies;
  await writeFile(deployedPath, `${JSON.stringify(canonical)}\n`, { mode: 0o600 });
}

async function copyTree(source: string, destination: string): Promise<void> {
  const stats = await lstat(source).catch(() => {
    throw new PackageBuilderError("build_failed");
  });
  if (stats.isSymbolicLink()) throw new PackageBuilderError("forbidden_file");
  if (stats.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    for (const entry of (await readdir(source)).sort()) {
      await copyTree(join(source, entry), join(destination, entry));
    }
    return;
  }
  if (!stats.isFile()) throw new PackageBuilderError("forbidden_file");
  await copyFile(source, destination);
}

function forbidden(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const filename = segments.at(-1)?.toLowerCase() ?? "";
  if (
    segments.includes(".git") ||
    filename === "secrets-v1.json" ||
    filename === "runtime-v1.json" ||
    filename === "install-manifest.json" ||
    filename === ".env" ||
    filename.startsWith(".env.") ||
    filename.endsWith(".sqlite") ||
    filename.endsWith(".sqlite3") ||
    filename.endsWith(".db")
  ) {
    return true;
  }
  const ownArea = segments[0];
  const beforeNodeModules = !segments.includes("node_modules");
  return (
    beforeNodeModules &&
    (segments.includes("src") ||
      segments.includes("tests") ||
      filename.includes(".test.") ||
      filename.includes(".spec.")) &&
    (ownArea === "daemon" || ownArea === "hook-adapter" || ownArea === "installer")
  );
}

async function assertNoForbiddenFiles(root: string, directory = root): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const value = relative(root, path).split(sep).join("/");
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new PackageBuilderError("forbidden_file");
    if (forbidden(value)) throw new PackageBuilderError("forbidden_file");
    if (entry.isDirectory()) await assertNoForbiddenFiles(root, path);
    else if (!entry.isFile()) throw new PackageBuilderError("forbidden_file");
  }
}

export type BuildWindowsPackageOptions = Readonly<{
  repositoryRoot: string;
  outputRoot: string;
  runner?: PackageBuildRunner;
  nodeVersion?: string;
}>;

export type BuiltWindowsPackage = Readonly<{
  packageRoot: string;
  fingerprint: string;
  fileCount: number;
}>;

const CRITICAL_FILES = [
  "daemon/dist/main.js",
  "hook-adapter/dist/index.js",
  "installer/dist/cli.js",
  "installer/dist/hook-main.js",
  "launchers/installed-ownloop-hook.cmd",
  "launchers/installed-ownloop.cmd",
  "launchers/ownloop.cmd",
  "launchers/ownloop.ps1",
  "web/index.html",
] as const;

export async function buildWindowsReleasePackage(
  options: BuildWindowsPackageOptions,
): Promise<BuiltWindowsPackage> {
  const repositoryRoot = absolute(options.repositoryRoot);
  const outputRoot = absolute(options.outputRoot);
  if ((options.nodeVersion ?? process.versions.node) !== OWNLOOP_REQUIRED_NODE_VERSION) {
    throw new PackageBuilderError("runtime_incompatible");
  }
  const runner = options.runner ?? defaultRunner;
  let pnpmVersion: string;
  try {
    pnpmVersion = (await runner("pnpm", ["--version"], { cwd: repositoryRoot })).stdout.trim();
  } catch {
    throw new PackageBuilderError("runtime_incompatible");
  }
  if (pnpmVersion !== OWNLOOP_REQUIRED_PNPM_VERSION)
    throw new PackageBuilderError("runtime_incompatible");

  const finalRoot = join(outputRoot, `ownloop-windows-${OWNLOOP_APPLICATION_VERSION}`);
  const stagingRoot = `${finalRoot}.staging`;
  if (
    (await lstat(finalRoot).catch(() => null)) !== null ||
    (await lstat(stagingRoot).catch(() => null)) !== null
  ) {
    throw new PackageBuilderError("output_not_clean");
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await mkdir(stagingRoot, { recursive: false, mode: 0o700 });
  try {
    await runner("pnpm", ["build"], { cwd: repositoryRoot });
    const deploys = [
      ["@ownloop/daemon", "daemon", "apps/daemon/package.json"],
      ["@ownloop/hook-adapter", "hook-adapter", "tools/hook-adapter/package.json"],
      ["@ownloop/local-installer", "installer", "tools/local-installer/package.json"],
    ] as const;
    for (const [workspace, destination, sourcePackagePath] of deploys) {
      const deploymentRoot = join(stagingRoot, destination);
      await runner(
        "pnpm",
        [
          "--config.node-linker=hoisted",
          "--config.inject-workspace-packages=true",
          "--filter",
          workspace,
          "deploy",
          "--prod",
          "--offline",
          deploymentRoot,
        ],
        { cwd: repositoryRoot },
      );
      const nodeModulesRoot = join(deploymentRoot, "node_modules");
      await removeGeneratedDirectory(join(nodeModulesRoot, ".bin"));
      await removeGeneratedFile(join(deploymentRoot, "pnpm-lock.yaml"));
      await removeGeneratedFile(join(nodeModulesRoot, ".modules.yaml"));
      await removeGeneratedFile(join(nodeModulesRoot, ".pnpm-workspace-state-v1.json"));
      await removeGeneratedDirectory(join(nodeModulesRoot, ".pnpm"), new Set(["lock.yaml"]));
      await rewriteDeployedPackageMetadata(
        repositoryRoot,
        sourcePackagePath,
        deploymentRoot,
        workspace,
      );
    }
    await copyTree(join(repositoryRoot, "apps", "web", "dist"), join(stagingRoot, "web"));
    await copyTree(
      join(repositoryRoot, "tools", "local-installer", "scripts"),
      join(stagingRoot, "launchers"),
    );
    await assertNoForbiddenFiles(stagingRoot);
    const manifest = await buildReleaseManifest(stagingRoot, CRITICAL_FILES);
    await writeFile(
      join(stagingRoot, OWNLOOP_RELEASE_MANIFEST_FILE),
      `${JSON.stringify(manifest)}\n`,
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    const verified = await readAndVerifyReleasePackage(stagingRoot).catch(() => {
      throw new PackageBuilderError("package_verification_failed");
    });
    await rename(stagingRoot, finalRoot);
    return {
      packageRoot: finalRoot,
      fingerprint: verified.fingerprint,
      fileCount: verified.files.length,
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof PackageBuilderError) throw error;
    throw new PackageBuilderError("build_failed");
  }
}
