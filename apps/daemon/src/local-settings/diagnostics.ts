import type {
  DiagnosticsProcessSnapshotV1,
  IngestionErrorCode,
  IngressAgentSource,
  LOCAL_DIAGNOSTIC_EVENT_CODES,
  LocalDiagnosticMode,
  LocalDiagnosticsResponseV1,
  SupportedAgentHookName,
} from "@ownloop/contracts";

import type { IngressDiagnosticEvent, IngressDiagnosticSink } from "../ingress/diagnostics.js";

const eventCode = (
  event: IngressDiagnosticEvent,
): (typeof LOCAL_DIAGNOSTIC_EVENT_CODES)[number] => {
  switch (event.type) {
    case "server.started":
      return "server_started";
    case "server.stopped":
      return "server_stopped";
    case "receipt.accepted":
      return event.duplicate ? "receipt_duplicate" : "receipt_accepted";
    case "request.rejected":
      return "request_rejected";
  }
};

type HookCounter = Readonly<{
  source: IngressAgentSource;
  hookName: SupportedAgentHookName;
  count: number;
}>;

function hookCounterKey(source: IngressAgentSource, hookName: SupportedAgentHookName): string {
  return `${source}:${hookName}`;
}

function incrementHookCounter(
  target: Map<string, HookCounter>,
  source: IngressAgentSource,
  hookName: SupportedAgentHookName,
): void {
  const key = hookCounterKey(source, hookName);
  const current = target.get(key);
  target.set(key, {
    source,
    hookName,
    count: (current?.count ?? 0) + 1,
  });
}

function snapshotHookCounters(target: ReadonlyMap<string, HookCounter>) {
  return [...target.values()]
    .sort((left, right) =>
      hookCounterKey(left.source, left.hookName).localeCompare(
        hookCounterKey(right.source, right.hookName),
      ),
    )
    .map(({ source, hookName, count }) => ({
      ...(source === "claude_code" ? {} : { source }),
      hookName,
      count,
    }));
}

export class LocalDiagnosticCounters {
  #mode: LocalDiagnosticMode;
  readonly #counts = new Map<string, number>();
  readonly #rejections = new Map<IngestionErrorCode, number>();
  readonly #acceptedByHook = new Map<string, HookCounter>();
  readonly #duplicateByHook = new Map<string, HookCounter>();

  constructor(mode: LocalDiagnosticMode) {
    this.#mode = mode;
  }

  setMode(mode: LocalDiagnosticMode): void {
    this.#mode = mode;
    if (mode === "off") this.clear();
  }

  clear(): void {
    this.#counts.clear();
    this.#rejections.clear();
    this.#acceptedByHook.clear();
    this.#duplicateByHook.clear();
  }

  readonly sink: IngressDiagnosticSink = (event) => {
    if (this.#mode === "off") return;
    const code = eventCode(event);
    this.#counts.set(code, (this.#counts.get(code) ?? 0) + 1);
    if (event.type === "request.rejected") {
      this.#rejections.set(event.code, (this.#rejections.get(event.code) ?? 0) + 1);
    } else if (event.type === "receipt.accepted") {
      const target = event.duplicate ? this.#duplicateByHook : this.#acceptedByHook;
      incrementHookCounter(target, event.source ?? "claude_code", event.hookName);
    }
  };

  snapshot(): DiagnosticsProcessSnapshotV1 | null {
    if (this.#mode === "off") return null;
    const count = (code: string): number => this.#counts.get(code) ?? 0;
    return {
      serverStarted: count("server_started"),
      serverStopped: count("server_stopped"),
      acceptedReceipts: count("receipt_accepted"),
      duplicateReceipts: count("receipt_duplicate"),
      rejectedRequests: count("request_rejected"),
      acceptedByHook: snapshotHookCounters(this.#acceptedByHook),
      duplicateByHook: snapshotHookCounters(this.#duplicateByHook),
      rejectedByCode: [...this.#rejections]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, value]) => ({ code, count: value })),
    };
  }

  response(): LocalDiagnosticsResponseV1 {
    if (this.#mode === "off") {
      return { ok: true, schemaVersion: 1, mode: "off", counts: [], rejectedByCode: [] };
    }
    return {
      ok: true,
      schemaVersion: 1,
      mode: "counts_only",
      counts: [...this.#counts]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([code, count]) => ({
          code: code as (typeof LOCAL_DIAGNOSTIC_EVENT_CODES)[number],
          count,
        })),
      rejectedByCode: [...this.#rejections]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([errorCode, count]) => ({ errorCode, count })),
    };
  }
}
