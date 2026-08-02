export type ControlledAssertion = Readonly<{
  key: string;
  family: string;
}>;

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "candidate",
  "did",
  "does",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

const ENGLISH_CONTROLLED_WORDS = new Set([
  "abandoned",
  "acknowledge",
  "added",
  "agent",
  "all",
  "api",
  "application",
  "attribution",
  "authentication",
  "authorization",
  "behavior",
  "build",
  "change",
  "changed",
  "choice",
  "classification",
  "complete",
  "completed",
  "configuration",
  "confirm",
  "created",
  "database",
  "decision",
  "deleted",
  "dependency",
  "dismiss",
  "documentation",
  "evidence",
  "failed",
  "file",
  "files",
  "gap",
  "graph",
  "infrastructure",
  "label",
  "lint",
  "migration",
  "modified",
  "observed",
  "observation",
  "only",
  "partial",
  "passed",
  "plan",
  "public",
  "question",
  "recorded",
  "relative",
  "removed",
  "revise",
  "risk",
  "run",
  "source",
  "status",
  "summary",
  "succeeded",
  "test",
  "tests",
  "type",
  "typecheck",
  "ui",
  "uncertain",
  "unknown",
  "unavailable",
  "unmerged",
  "updated",
]);

const PERSIAN_ALLOWED_WORDS = new Set([
  "آیا",
  "آزمون",
  "آزمونها",
  "آن",
  "از",
  "است",
  "اضافه",
  "اصلاح",
  "اعتبارسنجی",
  "اعمال",
  "امنیت",
  "انتخاب",
  "انتساب",
  "انجام",
  "این",
  "با",
  "بازبینی",
  "بررسی",
  "برنامه",
  "بروز",
  "به",
  "بود",
  "پاس",
  "پایگاه",
  "پیکربندی",
  "تایپ",
  "تایپچک",
  "تغییر",
  "تأیید",
  "ثبت",
  "جمع",
  "خروج",
  "خطر",
  "خورد",
  "داده",
  "دادهها",
  "در",
  "رابط",
  "رفتار",
  "رها",
  "ریسک",
  "زیرساخت",
  "ساخت",
  "ساخته",
  "سبک",
  "سرچشمه",
  "شد",
  "شده",
  "شدن",
  "شکاف",
  "شکست",
  "شواهد",
  "عامل",
  "عمومی",
  "فایل",
  "فایلها",
  "فقط",
  "کامل",
  "کاربر",
  "کاربری",
  "کرد",
  "کرده",
  "کند",
  "کد",
  "که",
  "گراف",
  "گذر",
  "لینت",
  "ماند",
  "مجوزدهی",
  "مستندات",
  "مشاهده",
  "منبع",
  "مهاجرت",
  "موفق",
  "نامشخص",
  "ناموفق",
  "ناقص",
  "نسبت",
  "نشده",
  "نهایی",
  "نوع",
  "نیازمند",
  "و",
  "وابستگی",
  "ویرایش",
  "یا",
  "یک",
  "هویت",
]);

const ENGLISH_ABSENCE_PATTERNS = [
  /\bno\b/u,
  /\bnone\b/u,
  /\bnothing\b/u,
  /\bnever\b/u,
  /\bwithout\b/u,
  /\bnot\s+(?:tested|observed|changed|failed|run)\b/u,
  /\ball\s+(?:paths|tests|changes|risks|cases)\b/u,
  /\b(?:fully|completely)\s+(?:safe|secure|correct|covered|tested)\b/u,
  /\bguarantee(?:d|s)?\b/u,
  /\b(?:safe|secure|correct)\b/u,
];

const PERSIAN_ABSENCE_PHRASES = [
  "بدون",
  "تضمین",
  "هرگز",
  "هیچ",
  "همه مسیرها",
  "همه آزمونها",
  "همه تغییرها",
  "همه ریسکها",
  "کاملا امن",
  "کاملا درست",
  "کاملا صحیح",
  "کاملا پوشش داده شده",
] as const;

const PERSIAN_SCRIPT = /^\p{Script=Arabic}+$/u;

export function normalizeControlledText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("ي", "ی")
    .replaceAll("ك", "ک")
    .replace(/[\u064b-\u065f\u0670\u06d6-\u06ed]/gu, "")
    .replace(/\u200c/gu, " ")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function containsUnsupportedAbsenceClaim(text: string): boolean {
  const normalized = normalizeControlledText(text);
  return (
    ENGLISH_ABSENCE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    PERSIAN_ABSENCE_PHRASES.some((phrase) => hasPhrase(normalized, phrase))
  );
}

export function meaningfulUnknownControlledTokens(text: string): readonly string[] {
  const tokens = normalizeControlledText(text).split(" ").filter(Boolean);
  return [
    ...new Set(
      tokens.filter((token) => {
        if (ENGLISH_STOP_WORDS.has(token) || ENGLISH_CONTROLLED_WORDS.has(token)) return false;
        if (PERSIAN_SCRIPT.test(token) && PERSIAN_ALLOWED_WORDS.has(token)) return false;
        return true;
      }),
    ),
  ];
}

export function extractControlledAssertions(text: string): readonly ControlledAssertion[] {
  const normalized = normalizeControlledText(text);
  const values = new Map<string, ControlledAssertion>();
  const add = (key: string, family: string): void => {
    values.set(key, { key, family });
  };

  if (/\b(?:created|added)\b/u.test(normalized) || hasPhrase(normalized, "ایجاد شد") || hasPhrase(normalized, "اضافه شد") || hasPhrase(normalized, "ساخته شد")) {
    add("change_kind:created", "change_kind");
  }
  if (
    /\b(?:modified|updated)\b/u.test(normalized) ||
    (/\bchanged\b/u.test(normalized) && !/\btype\s+changed\b/u.test(normalized)) ||
    hasPhrase(normalized, "تغییر کرد") ||
    hasPhrase(normalized, "تغییر داده شد") ||
    hasPhrase(normalized, "ویرایش شد") ||
    hasPhrase(normalized, "بروز شد")
  ) {
    add("change_kind:modified", "change_kind");
  }
  if (/\b(?:deleted|removed)\b/u.test(normalized) || hasPhrase(normalized, "حذف شد") || hasPhrase(normalized, "پاک شد")) {
    add("change_kind:deleted", "change_kind");
  }
  if (/\btype\s+changed\b/u.test(normalized) || hasPhrase(normalized, "نوع تغییر کرد")) {
    add("change_kind:type_changed", "change_kind");
  }
  if (/\bunmerged\b/u.test(normalized) || hasPhrase(normalized, "ادغام نشده")) {
    add("change_kind:unmerged", "change_kind");
  }

  for (const status of ["completed", "partial", "abandoned", "failed"] as const) {
    const statusPattern = new RegExp(
      `(?:\\b(?:run|finalization)(?:\\s+status)?\\s+${status}\\b|\\b${status}\\s+(?:run|finalization)\\b)`,
      "u",
    );
    if (statusPattern.test(normalized)) {
      add(`terminal_status:${status[0]?.toUpperCase()}${status.slice(1)}`, "terminal_status");
    }
  }
  if (hasPhrase(normalized, "اجرا کامل شد") || hasPhrase(normalized, "نهایی سازی کامل شد")) {
    add("terminal_status:Completed", "terminal_status");
  }
  if (hasPhrase(normalized, "اجرا ناقص ماند") || hasPhrase(normalized, "منبع ناقص است")) {
    add("terminal_status:Partial", "terminal_status");
  }
  if (hasPhrase(normalized, "اجرا رها شد")) add("terminal_status:Abandoned", "terminal_status");
  if (hasPhrase(normalized, "اجرا شکست خورد")) add("terminal_status:Failed", "terminal_status");

  if (/\brun\s+relative\b/u.test(normalized) || hasPhrase(normalized, "نسبت به اجرا")) {
    add("attribution:run_relative", "attribution");
  }
  if (/\bobserved\s+only\b/u.test(normalized) || hasPhrase(normalized, "فقط مشاهده شده")) {
    add("attribution:observed_only", "attribution");
  }
  if (/\battribution\s+unavailable\b/u.test(normalized) || hasPhrase(normalized, "انتساب نامشخص")) {
    add("attribution:unavailable", "attribution");
  }

  const labels = [
    ["ui", ["ui", "رابط کاربری"]],
    ["behavior", ["behavior", "رفتار"]],
    ["tests", ["tests", "آزمون"]],
    ["dependency", ["dependency", "وابستگی"]],
    ["authentication_authorization", ["authentication authorization", "احراز هویت", "مجوزدهی"]],
    ["public_api", ["public api", "رابط برنامه نویسی عمومی"]],
    ["database_migration", ["database migration", "مهاجرت پایگاه داده"]],
    ["configuration_infrastructure", ["configuration infrastructure", "پیکربندی زیرساخت"]],
    ["documentation", ["documentation", "مستندات"]],
    ["unknown", ["unknown", "نامشخص"]],
  ] as const;
  for (const [label, phrases] of labels) {
    if (phrases.some((phrase) => hasPhrase(normalized, phrase))) {
      add(`classification_label:${label}`, "classification_label");
    }
  }

  const verificationKinds = [
    ["test", ["test", "tests", "آزمون"]],
    ["lint", ["lint", "لینت", "بررسی سبک"]],
    ["typecheck", ["typecheck", "type check", "تایپ چک", "تایپچک", "بررسی نوع"]],
    ["build", ["build", "ساخت"]],
  ] as const;
  for (const [kind, phrases] of verificationKinds) {
    if (!phrases.some((phrase) => hasPhrase(normalized, phrase))) continue;
    if (/\b(?:passed|succeeded)\b/u.test(normalized) || hasPhrase(normalized, "موفق شد") || hasPhrase(normalized, "پاس شد")) {
      add(`verification_status:${kind}:passed`, `verification_status:${kind}`);
    }
    if (/\bfailed\b/u.test(normalized) || hasPhrase(normalized, "شکست خورد") || hasPhrase(normalized, "ناموفق بود")) {
      add(`verification_status:${kind}:failed`, `verification_status:${kind}`);
    }
    if (/\bunknown\b/u.test(normalized) || hasPhrase(normalized, "نامشخص است")) {
      add(`verification_status:${kind}:unknown`, `verification_status:${kind}`);
    }
    if (/\bobserved\s+without\s+exit\s+code\b/u.test(normalized) || hasPhrase(normalized, "بدون کد خروج مشاهده شد")) {
      add(
        `verification_status:${kind}:observed_without_exit_code`,
        `verification_status:${kind}`,
      );
    }
  }

  if (/\bevidence\s+gap\b/u.test(normalized) || hasPhrase(normalized, "شکاف شواهد")) {
    add("evidence_gap:*", "evidence_gap");
  }
  if (
    /\b(?:decision|plan|summary)\s+(?:observed|recorded)\b/u.test(normalized) ||
    hasPhrase(normalized, "تصمیم مشاهده شد") ||
    hasPhrase(normalized, "برنامه ثبت شد") ||
    hasPhrase(normalized, "جمع بندی ثبت شد")
  ) {
    add("decision_observed:*", "decision_observed");
  }
  if (
    /\b(?:source|graph)\s+partial\b/u.test(normalized) ||
    hasPhrase(normalized, "منبع ناقص است") ||
    hasPhrase(normalized, "گراف ناقص است")
  ) {
    add("source_partial:true", "source_partial");
  }

  return [...values.values()].toSorted((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
}
