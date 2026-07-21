import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export const GIT_COMMAND_FAILURES = [
  "executable_unavailable",
  "exit_nonzero",
  "timeout",
  "output_limit",
] as const;
export type GitCommandFailure = (typeof GIT_COMMAND_FAILURES)[number];

export class GitCommandError extends Error {
  readonly code: GitCommandFailure;

  constructor(code: GitCommandFailure) {
    super("A bounded Git command failed.");
    this.name = "GitCommandError";
    this.code = code;
  }
}

export type GitCommandMode = "buffer" | "hash";

export type GitCommandRequest = Readonly<{
  executable: string;
  cwd: string;
  args: readonly string[];
  mode: GitCommandMode;
  maximumStdoutBytes: number;
  maximumStderrBytes: number;
  timeoutMs: number;
}>;

export type GitCommandResult = Readonly<{
  stdout: Buffer | null;
  stdoutSha256: string;
  stdoutBytes: number;
}>;

export type GitCommandRunner = (request: GitCommandRequest) => Promise<GitCommandResult>;

function childEnvironment(): NodeJS.ProcessEnv {
  const source = process.env;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "TMPDIR",
    "TMP",
    "TEMP",
  ]) {
    const value = source[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  environment.LC_ALL = "C";
  environment.LANG = "C";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_PAGER = "cat";
  environment.GIT_EXTERNAL_DIFF = "";
  environment.GIT_CONFIG_COUNT = "2";
  environment.GIT_CONFIG_KEY_0 = "core.fsmonitor";
  environment.GIT_CONFIG_VALUE_0 = "false";
  environment.GIT_CONFIG_KEY_1 = "core.untrackedCache";
  environment.GIT_CONFIG_VALUE_1 = "false";
  return environment;
}

function validRequest(request: GitCommandRequest): boolean {
  return (
    request.executable.length > 0 &&
    request.args.every((argument) => !argument.includes("\0")) &&
    Number.isInteger(request.maximumStdoutBytes) &&
    request.maximumStdoutBytes >= 0 &&
    Number.isInteger(request.maximumStderrBytes) &&
    request.maximumStderrBytes >= 0 &&
    Number.isInteger(request.timeoutMs) &&
    request.timeoutMs > 0
  );
}

export const runGitCommand: GitCommandRunner = async (
  request: GitCommandRequest,
): Promise<GitCommandResult> => {
  if (!validRequest(request)) {
    throw new GitCommandError("exit_nonzero");
  }

  return await new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn(request.executable, request.args, {
      cwd: process.cwd(),
      env: childEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const hash = createHash("sha256");
    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finishFailure = (code: GitCommandFailure): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new GitCommandError(code));
    };

    const timer = setTimeout(() => finishFailure("timeout"), request.timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > request.maximumStdoutBytes) {
        finishFailure("output_limit");
        return;
      }
      hash.update(chunk);
      if (request.mode === "buffer") {
        stdoutChunks.push(Buffer.from(chunk));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      stderrBytes += chunk.byteLength;
      if (stderrBytes > request.maximumStderrBytes) {
        finishFailure("output_limit");
      }
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      finishFailure(error.code === "ENOENT" ? "executable_unavailable" : "exit_nonzero");
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(new GitCommandError("exit_nonzero"));
        return;
      }
      resolve({
        stdout: request.mode === "buffer" ? Buffer.concat(stdoutChunks, stdoutBytes) : null,
        stdoutSha256: hash.digest("hex"),
        stdoutBytes,
      });
    });
  });
};
