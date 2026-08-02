import { describe, expect, it } from "vitest";

import {
  containsUnsupportedAbsenceClaim,
  extractControlledAssertions,
  meaningfulUnknownControlledTokens,
  normalizeControlledText,
} from "./controlled-language.js";

function keys(value: string): readonly string[] {
  return extractControlledAssertions(value).map((item) => item.key);
}

describe("controlled Candidate language", () => {
  it("normalizes Persian characters and zero-width joiners deterministically", () => {
    expect(normalizeControlledText("فایل\u200cها ايجاد شدند")).toBe("فایل ها ایجاد شدند");
  });

  it("extracts conservative Persian change facts", () => {
    expect(keys("یک فایل ایجاد شد")).toContain("change_kind:created");
    expect(keys("فایل ویرایش شد")).toContain("change_kind:modified");
    expect(keys("فایل حذف شد")).toContain("change_kind:deleted");
    expect(keys("نوع تغییر کرد")).toContain("change_kind:type_changed");
    expect(keys("تغییر ادغام نشده است")).toContain("change_kind:unmerged");
  });

  it("extracts Persian verification, decision, gap, and partial-source facts", () => {
    expect(keys("آزمون موفق شد")).toContain("verification_status:test:passed");
    expect(keys("ساخت شکست خورد")).toContain("verification_status:build:failed");
    expect(keys("تصمیم مشاهده شد")).toContain("decision_observed:*");
    expect(keys("شکاف شواهد ثبت شد")).toContain("evidence_gap:*");
    expect(keys("گراف ناقص است")).toContain("source_partial:true");
  });

  it("keeps the existing English controlled grammar", () => {
    expect(keys("A file was created")).toContain("change_kind:created");
    expect(keys("Test verification passed")).toContain("verification_status:test:passed");
    expect(keys("Decision observed")).toContain("decision_observed:*");
  });

  it("rejects Persian absence, certainty, and security claims", () => {
    expect(containsUnsupportedAbsenceClaim("هیچ ریسکی باقی نمانده است")).toBe(true);
    expect(containsUnsupportedAbsenceClaim("این تغییر کاملا امن است")).toBe(true);
    expect(containsUnsupportedAbsenceClaim("آزمون موفق شد")).toBe(false);
  });

  it("allows only the bounded Persian vocabulary", () => {
    expect(meaningfulUnknownControlledTokens("یک فایل ایجاد شد")).toEqual([]);
    expect(meaningfulUnknownControlledTokens("سرعت دو برابر شد")).toEqual([
      "سرعت",
      "دو",
      "برابر",
    ]);
  });
});
