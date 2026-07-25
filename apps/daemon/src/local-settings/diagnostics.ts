import type {
  LOCAL_DIAGNOSTIC_EVENT_CODES,
  LocalDiagnosticsResponseV1,
  LocalDiagnosticMode,
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

export class LocalDiagnosticCounters {
  #mode: LocalDiagnosticMode;
  readonly #counts = new Map<string, number>();
  readonly #rejections = new Map<string, number>();

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
  }

  readonly sink: IngressDiagnosticSink = (event) => {
    if (this.#mode === "off") return;
    const code = eventCode(event);
    this.#counts.set(code, (this.#counts.get(code) ?? 0) + 1);
    if (event.type === "request.rejected") {
      this.#rejections.set(event.code, (this.#rejections.get(event.code) ?? 0) + 1);
    }
  };

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
