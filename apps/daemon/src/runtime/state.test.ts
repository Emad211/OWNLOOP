import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { OwnLoopRuntimeStateV1 } from "@ownloop/contracts";

import {
  readRuntimeState,
  removeOwnedRuntimeState,
  RuntimeStateController,
  RuntimeStateError,
  writeRuntimeStateAtomic,
} from "./state.js";

const roots: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function state(phase: OwnLoopRuntimeStateV1["phase"] = "starting"): OwnLoopRuntimeStateV1 {
  return {
    schemaVersion: 1,
    installId: "install_1",
    applicationVersion: "0.1.0",
    daemonVersion: "0.1.0",
    hookAdapterVersion: "0.1.0",
    installLayoutVersion: 1,
    instanceId: "instance_1",
    pid: 123,
    processStartIdentity: "123.456",
    port: 43123,
    phase,
    startedAt: "2026-07-26T12:00:00.000Z",
    updatedAt: phase === "starting" ? "2026-07-26T12:00:00.000Z" : "2026-07-26T12:00:01.000Z",
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ownloop-runtime-state-"));
  roots.push(root);
  return { root, path: join(root, "run", "runtime-v1.json") };
}

describe("runtime state", () => {
  it("writes canonical state atomically and reads it strictly", async () => {
    const { path } = await fixture();
    await writeRuntimeStateAtomic(path, state());
    expect(await readRuntimeState(path)).toEqual(state());
    const text = await readFile(path, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toContain("token");
  });

  it("rejects a symlink target and an invalid document", async () => {
    const { root, path } = await fixture();
    const target = join(root, "target.json");
    await writeRuntimeStateAtomic(target, state());
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(join(root, "run"), { recursive: true }),
    );
    await symlink(target, path);
    await expect(readRuntimeState(path)).rejects.toMatchObject({ code: "unsafe_path" });
  });

  it("allows only forward phase transitions for one instance", async () => {
    const { path } = await fixture();
    const controller = new RuntimeStateController(path);
    await controller.publish(state("starting"));
    await controller.publish(state("ready"));
    await expect(controller.publish(state("starting"))).rejects.toMatchObject({
      code: "invalid_transition",
    });
  });

  it("removes only the exact owned instance", async () => {
    const { path } = await fixture();
    await writeRuntimeStateAtomic(path, state());
    await expect(removeOwnedRuntimeState(path, "other_instance")).rejects.toBeInstanceOf(
      RuntimeStateError,
    );
    expect(await removeOwnedRuntimeState(path, "instance_1")).toBe(true);
    expect(await readRuntimeState(path)).toBeNull();
  });
});
