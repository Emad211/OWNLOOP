/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { attentionKeyboardAction } from "./attention-keyboard.js";

const ready = {
  phase: "ready" as const,
  revealed: false,
  selectionPresent: false,
  optionCount: 3,
  targetTagName: null,
  targetEditable: false,
};

describe("Attention keyboard shortcuts", () => {
  it("maps keys 1 through 3 to available option indexes", () => {
    expect(attentionKeyboardAction({ ...ready, key: "1" })).toEqual({
      kind: "select",
      optionIndex: 0,
    });
    expect(attentionKeyboardAction({ ...ready, key: "3" })).toEqual({
      kind: "select",
      optionIndex: 2,
    });
    expect(attentionKeyboardAction({ ...ready, key: "3", optionCount: 2 })).toBeNull();
  });

  it("uses Enter to reveal a selected answer and continue after reveal", () => {
    expect(
      attentionKeyboardAction({ ...ready, key: "Enter", selectionPresent: true }),
    ).toEqual({ kind: "reveal" });
    expect(
      attentionKeyboardAction({
        ...ready,
        key: "Enter",
        revealed: true,
        selectionPresent: true,
      }),
    ).toEqual({ kind: "continue" });
    expect(attentionKeyboardAction({ ...ready, key: "Enter" })).toBeNull();
  });

  it.each(["INPUT", "TEXTAREA", "SELECT", "BUTTON"])(
    "ignores shortcuts while %s has focus",
    (targetTagName) => {
      expect(
        attentionKeyboardAction({ ...ready, key: "1", targetTagName }),
      ).toBeNull();
      expect(
        attentionKeyboardAction({
          ...ready,
          key: "Enter",
          targetTagName,
          selectionPresent: true,
        }),
      ).toBeNull();
    },
  );

  it("ignores content-editable targets and non-ready phases", () => {
    expect(
      attentionKeyboardAction({ ...ready, key: "1", targetEditable: true }),
    ).toBeNull();

    for (const phase of [
      "locked",
      "loading",
      "saving",
      "complete",
      "empty",
      "error",
    ] as const) {
      expect(attentionKeyboardAction({ ...ready, key: "1", phase })).toBeNull();
      expect(
        attentionKeyboardAction({
          ...ready,
          key: "Enter",
          phase,
          selectionPresent: true,
        }),
      ).toBeNull();
    }
  });
});
