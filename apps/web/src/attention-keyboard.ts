export type AttentionKeyboardPhase =
  | "locked"
  | "loading"
  | "preview"
  | "ready"
  | "saving"
  | "complete"
  | "empty"
  | "error";

export type AttentionKeyboardAction =
  | Readonly<{ kind: "select"; optionIndex: number }>
  | Readonly<{ kind: "reveal" }>
  | Readonly<{ kind: "continue" }>;

export type AttentionKeyboardInput = Readonly<{
  key: string;
  phase: AttentionKeyboardPhase;
  revealed: boolean;
  selectionPresent: boolean;
  optionCount: number;
  targetTagName: string | null;
  targetEditable: boolean;
}>;

const BLOCKED_TARGET_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

export function attentionKeyboardAction(
  input: AttentionKeyboardInput,
): AttentionKeyboardAction | null {
  if (input.phase !== "ready" || input.targetEditable) return null;

  const tagName = input.targetTagName?.toUpperCase() ?? null;
  if (tagName !== null && BLOCKED_TARGET_TAGS.has(tagName)) return null;

  if (!input.revealed && /^[1-3]$/u.test(input.key)) {
    const optionIndex = Number(input.key) - 1;
    return optionIndex < input.optionCount ? { kind: "select", optionIndex } : null;
  }

  if (input.key !== "Enter") return null;
  if (input.revealed) return { kind: "continue" };
  return input.selectionPresent ? { kind: "reveal" } : null;
}
