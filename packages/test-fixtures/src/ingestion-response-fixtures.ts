export const validIngestionResponseFixtures = [
  {
    name: "accepted response",
    input: {
      ok: true,
      status: "accepted",
      receiptId: "receipt-fixture-001",
      duplicate: false,
    },
  },
  {
    name: "rejected response",
    input: {
      ok: false,
      status: "rejected",
      error: {
        code: "invalid_payload",
        message: "Fixture payload is invalid.",
        issues: [
          {
            path: ["payload", "tool_calls", 0, "tool_name"],
            code: "too_small",
            message: "Expected a non-empty string.",
          },
        ],
      },
    },
  },
] as const;

export const invalidIngestionResponseFixtures = [
  {
    name: "accepted response with empty receiptId",
    input: { ok: true, status: "accepted", receiptId: "", duplicate: false },
  },
  {
    name: "accepted response with rejected status",
    input: {
      ok: true,
      status: "rejected",
      receiptId: "receipt-fixture-002",
      duplicate: false,
    },
  },
  {
    name: "rejected response with unsupported error code",
    input: {
      ok: false,
      status: "rejected",
      error: { code: "network_failed", message: "Fixture failure." },
    },
  },
  {
    name: "rejected response with empty message",
    input: {
      ok: false,
      status: "rejected",
      error: { code: "internal_error", message: "" },
    },
  },
  {
    name: "rejected response with malformed issue path",
    input: {
      ok: false,
      status: "rejected",
      error: {
        code: "invalid_payload",
        message: "Fixture failure.",
        issues: [{ path: [{ field: "payload" }], code: "custom", message: "Invalid path." }],
      },
    },
  },
] as const;
