import {
  type PreparedIngressReceiptV1,
  PreparedIngressReceiptV1Schema,
} from "@ownloop/contracts";
import {
  type PreparedCodexIngressReceiptV1,
  PreparedCodexIngressReceiptV1Schema,
} from "@ownloop/contracts/codex";

export type PreparedAgentIngressReceiptV1 =
  | PreparedIngressReceiptV1
  | PreparedCodexIngressReceiptV1;

function sourceOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("source" in value)) {
    return null;
  }
  return typeof value.source === "string" ? value.source : null;
}

export function parsePreparedAgentIngressReceipt(
  value: unknown,
): PreparedAgentIngressReceiptV1 | null {
  const source = sourceOf(value);
  if (source === "claude_code") {
    const parsed = PreparedIngressReceiptV1Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  if (source === "codex") {
    const parsed = PreparedCodexIngressReceiptV1Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  return null;
}
