import type { OwnLoopPumpState } from "@ownloop/contracts";

export const RUNTIME_STAGE_ORDER = [
  "lifecycle",
  "normalization",
  "baseline",
  "reconciliation",
  "finalization",
  "classification",
  "verification",
  "evidence_graph",
  "semantic_input",
  "candidate_generation",
  "candidate_validation",
] as const;
export type RuntimeStageName = (typeof RUNTIME_STAGE_ORDER)[number];

export type RuntimeStageContext = Readonly<{ signal: AbortSignal }>;
export type RuntimeStageOperation = (context: RuntimeStageContext) => unknown | Promise<unknown>;
export type RuntimeStageOperations = Readonly<Record<RuntimeStageName, RuntimeStageOperation>>;

export type RuntimeStageOutcome = Readonly<{
  stage: RuntimeStageName;
  outcome: "completed" | "failed" | "skipped";
}>;
export type RuntimeCycleReport = Readonly<{
  startedAt: string;
  completedAt: string;
  stages: readonly RuntimeStageOutcome[];
}>;

export type RuntimePumpDiagnostic =
  | Readonly<{ type: "cycle.started" | "cycle.completed" }>
  | Readonly<{ type: "stage.failed"; stage: RuntimeStageName }>;
export type RuntimePumpDiagnosticSink = (event: RuntimePumpDiagnostic) => void;

export type RuntimePumpOptions = Readonly<{
  operations: RuntimeStageOperations;
  idleDelayMs?: number;
  clock?: () => Date;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  diagnostics?: RuntimePumpDiagnosticSink;
}>;

function canonicalTimestamp(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("The runtime pump clock returned an invalid date.");
  }
  return value.toISOString();
}

async function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      signal.removeEventListener("abort", finish);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function boundedDelay(value: number | undefined): number {
  if (value === undefined) return 250;
  if (!Number.isInteger(value) || value < 10 || value > 60_000) {
    throw new TypeError("The runtime pump idle delay must be between 10 and 60000 milliseconds.");
  }
  return value;
}

export class SerializedRuntimePump {
  readonly #operations: RuntimeStageOperations;
  readonly #idleDelayMs: number;
  readonly #clock: () => Date;
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly #diagnostics: RuntimePumpDiagnosticSink | undefined;
  readonly #abortController = new AbortController();
  #state: OwnLoopPumpState = "idle";
  #activeCycle: Promise<RuntimeCycleReport> | null = null;
  #loop: Promise<void> | null = null;
  #stopRequested = false;

  constructor(options: RuntimePumpOptions) {
    this.#operations = options.operations;
    this.#idleDelayMs = boundedDelay(options.idleDelayMs);
    this.#clock = options.clock ?? (() => new Date());
    this.#sleep = options.sleep ?? defaultSleep;
    this.#diagnostics = options.diagnostics;
  }

  get state(): OwnLoopPumpState {
    return this.#state;
  }

  start(): void {
    if (this.#loop !== null || this.#stopRequested) return;
    this.#loop = this.#runLoop();
  }

  runCycle(): Promise<RuntimeCycleReport> {
    if (this.#activeCycle !== null) return this.#activeCycle;
    if (this.#stopRequested || this.#abortController.signal.aborted) {
      const now = canonicalTimestamp(this.#clock);
      return Promise.resolve({ startedAt: now, completedAt: now, stages: [] });
    }
    const cycle = this.#executeCycle();
    this.#activeCycle = cycle;
    void cycle.finally(() => {
      if (this.#activeCycle === cycle) this.#activeCycle = null;
    });
    return cycle;
  }

  async stop(graceMs = 5_000): Promise<boolean> {
    if (!Number.isInteger(graceMs) || graceMs < 1 || graceMs > 60_000) {
      throw new TypeError(
        "The runtime pump shutdown grace must be between 1 and 60000 milliseconds.",
      );
    }
    if (this.#state === "stopped") return true;
    this.#stopRequested = true;
    this.#state = "stopping";
    this.#abortController.abort();
    const pending = this.#loop ?? this.#activeCycle ?? Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      Promise.resolve(pending).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), graceMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    this.#state = "stopped";
    return !timedOut;
  }

  async #runLoop(): Promise<void> {
    try {
      while (!this.#stopRequested) {
        await this.runCycle();
        if (this.#stopRequested) break;
        await this.#sleep(this.#idleDelayMs, this.#abortController.signal);
      }
    } finally {
      if (this.#stopRequested) this.#state = "stopped";
    }
  }

  async #executeCycle(): Promise<RuntimeCycleReport> {
    const startedAt = canonicalTimestamp(this.#clock);
    this.#state = "running";
    this.#diagnostics?.({ type: "cycle.started" });
    const stages: RuntimeStageOutcome[] = [];
    try {
      for (const stage of RUNTIME_STAGE_ORDER) {
        if (this.#abortController.signal.aborted) {
          stages.push({ stage, outcome: "skipped" });
          continue;
        }
        try {
          await this.#operations[stage]({ signal: this.#abortController.signal });
          stages.push({ stage, outcome: "completed" });
        } catch {
          stages.push({ stage, outcome: "failed" });
          this.#diagnostics?.({ type: "stage.failed", stage });
        }
      }
      this.#diagnostics?.({ type: "cycle.completed" });
      return {
        startedAt,
        completedAt: canonicalTimestamp(this.#clock),
        stages,
      };
    } finally {
      if (!this.#stopRequested) this.#state = "idle";
    }
  }
}

export function createSerializedRuntimePump(options: RuntimePumpOptions): SerializedRuntimePump {
  return new SerializedRuntimePump(options);
}
