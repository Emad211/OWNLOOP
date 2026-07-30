import { describe, expect, it, vi } from "vitest";

import {
  createSerializedRuntimePump,
  RUNTIME_STAGE_ORDER,
  type RuntimeStageOperations,
} from "./pump.js";

function operations(
  operation: (stage: string, signal: AbortSignal) => unknown,
): RuntimeStageOperations {
  return Object.fromEntries(
    RUNTIME_STAGE_ORDER.map((stage) => [
      stage,
      ({ signal }: { signal: AbortSignal }) => operation(stage, signal),
    ]),
  ) as unknown as RuntimeStageOperations;
}

describe("SerializedRuntimePump", () => {
  it("runs stages in fixed order and isolates one stage failure", async () => {
    const observed: string[] = [];
    const pump = createSerializedRuntimePump({
      operations: operations((stage) => {
        observed.push(stage);
        if (stage === "baseline") throw new Error("controlled fixture failure");
      }),
      clock: () => new Date("2026-07-26T12:00:00.000Z"),
    });
    const result = await pump.runCycle();
    expect(observed).toEqual(RUNTIME_STAGE_ORDER);
    expect(result.stages.find((item) => item.stage === "baseline")?.outcome).toBe("failed");
    expect(result.stages.at(-1)?.outcome).toBe("completed");
    expect(pump.state).toBe("idle");
  });

  it("coalesces concurrent cycle requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let lifecycleCalls = 0;
    const pump = createSerializedRuntimePump({
      operations: operations(async (stage) => {
        if (stage === "lifecycle") {
          lifecycleCalls += 1;
          await gate;
        }
      }),
    });
    const first = pump.runCycle();
    const second = pump.runCycle();
    expect(first).toBe(second);
    release();
    await Promise.all([first, second]);
    expect(lifecycleCalls).toBe(1);
  });

  it("aborts an in-flight stage and starts no later work after stop", async () => {
    const observed: string[] = [];
    const pump = createSerializedRuntimePump({
      operations: operations(async (stage, signal) => {
        observed.push(stage);
        if (stage === "lifecycle") {
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
      }),
      idleDelayMs: 10,
      sleep: vi.fn(async () => undefined),
    });
    pump.start();
    await Promise.resolve();
    expect(await pump.stop(500)).toBe(true);
    expect(observed).toEqual(["lifecycle"]);
    expect(pump.state).toBe("stopped");
  });

  it("recovers on the next cycle after a transient stage failure", async () => {
    let failures = 1;
    const pump = createSerializedRuntimePump({
      operations: operations((stage) => {
        if (stage === "normalization" && failures > 0) {
          failures -= 1;
          throw new Error("transient");
        }
      }),
    });
    expect((await pump.runCycle()).stages[1]?.outcome).toBe("failed");
    expect((await pump.runCycle()).stages[1]?.outcome).toBe("completed");
  });
});
