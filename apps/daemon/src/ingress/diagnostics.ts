import type { IngestionErrorCode, SupportedClaudeHookName } from "@ownloop/contracts";

export type IngressDiagnosticEvent =
  | Readonly<{ type: "server.started"; port: number }>
  | Readonly<{ type: "server.stopped" }>
  | Readonly<{
      type: "receipt.accepted";
      receiptId: string;
      hookName: SupportedClaudeHookName;
      duplicate: boolean;
    }>
  | Readonly<{ type: "request.rejected"; code: IngestionErrorCode }>;

export type IngressDiagnosticSink = (event: IngressDiagnosticEvent) => void;

export function emitIngressDiagnostic(
  sink: IngressDiagnosticSink | undefined,
  event: IngressDiagnosticEvent,
): void {
  if (sink === undefined) {
    return;
  }
  try {
    sink(Object.freeze(event));
  } catch {
    // Diagnostics are observational and must never alter ingestion behavior.
  }
}
