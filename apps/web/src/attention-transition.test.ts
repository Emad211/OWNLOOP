import { describe, expect, it } from "vitest";

import {
  ATTENTION_TRANSITION_DURATION_MS,
  attentionTransitionDelay,
  attentionTransitionReceipt,
} from "./attention-transition.js";

describe("Attention moment transition", () => {
  it("uses a short bounded delay and removes it for reduced motion", () => {
    expect(attentionTransitionDelay(false)).toBe(ATTENTION_TRANSITION_DURATION_MS);
    expect(ATTENTION_TRANSITION_DURATION_MS).toBeGreaterThanOrEqual(350);
    expect(ATTENTION_TRANSITION_DURATION_MS).toBeLessThanOrEqual(500);
    expect(attentionTransitionDelay(true)).toBe(0);
  });

  it("describes an open follow-up without judging the response", () => {
    const receipt = attentionTransitionReceipt(true, true);

    expect(receipt.needsFollowUp).toBe(true);
    expect(receipt.hasNext).toBe(true);
    expect(receipt.title).toContain("پیگیری");
    expect(receipt.message).toContain("Moment بعدی");
    expect(`${receipt.title} ${receipt.message}`).not.toContain("پاسخ درست");
    expect(`${receipt.title} ${receipt.message}`).not.toContain("پاسخ غلط");
  });

  it("describes a resolved Moment without claiming understanding", () => {
    const receipt = attentionTransitionReceipt(false, true);

    expect(receipt.needsFollowUp).toBe(false);
    expect(receipt.message).toContain("پیگیری بازی ثبت نشد");
    expect(`${receipt.title} ${receipt.message}`).not.toContain("فهمیدی");
  });

  it("uses an honest closing message for the last Moment", () => {
    const followed = attentionTransitionReceipt(true, false);
    const resolved = attentionTransitionReceipt(false, false);

    expect(followed.message).toContain("جلسه در حال بسته‌شدن");
    expect(resolved.message).toContain("جلسه در حال بسته‌شدن");
    expect(followed.hasNext).toBe(false);
    expect(resolved.hasNext).toBe(false);
  });
});
