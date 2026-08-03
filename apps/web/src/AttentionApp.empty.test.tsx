/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";

import { attentionEmptyState } from "./AttentionApp.js";

describe("Attention zero state", () => {
  it("routes an unconfigured provider directly to the focused AvalAI setup", () => {
    expect(attentionEmptyState(false)).toEqual({
      kind: "configure_avalai",
      title: "اول مغز لحظه‌ها را آماده کن.",
      message:
        "هنوز ارائه‌دهندهٔ LLM کامل تنظیم نشده است. دامنه، مدل و کلید حافظه‌ای AvalAI را ثبت کن؛ حقیقت همچنان از Git و Evidence می‌آید.",
      actionLabel: "تنظیم AvalAI",
      actionHref: "/?view=avalai",
    });
  });

  it("routes a configured provider without Moments to the real-run path", () => {
    const state = attentionEmptyState(true);

    expect(state.kind).toBe("await_run");
    expect(state.actionHref).toBe("/");
    expect(state.message).toContain("Run دارای Moment معتبر");
    expect(state.message).not.toContain("موفقیت کامل");
    expect(state.message).not.toContain("بدون ریسک");
  });
});
