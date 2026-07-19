const baseNormalizedEvent = {
  eventId: "event-fixture-001",
  schemaVersion: 1,
  workspaceId: "workspace-fixture-001",
  conversationId: "conversation-fixture-001",
  type: "conversation.started",
  source: "claude_code",
  sourceEventName: "SessionStart",
  sourceEventId: null,
  occurredAt: "2026-07-19T12:34:56Z",
  ingestedAt: "2026-07-19T12:34:55Z",
  sensitivity: "normal",
  payload: { source: "startup" },
  metadata: {
    collectorVersion: "0.1.0",
    sourceVersion: null,
  },
} as const;

export const validNormalizedEventFixtures = [
  {
    name: "conversation-level event",
    input: { ...baseNormalizedEvent, runId: null, sequence: null },
  },
  {
    name: "run-level event",
    input: {
      ...baseNormalizedEvent,
      eventId: "event-fixture-002",
      runId: "run-fixture-001",
      sequence: 1,
      type: "user.prompt_submitted",
    },
  },
] as const;

export const invalidNormalizedEventFixtures = [
  {
    name: "invalid normalized schema version",
    input: { ...baseNormalizedEvent, runId: null, sequence: null, schemaVersion: 2 },
  },
  {
    name: "invalid normalized event source",
    input: {
      ...baseNormalizedEvent,
      runId: null,
      sequence: null,
      source: "future_agent",
    },
  },
  {
    name: "invalid normalized event type",
    input: {
      ...baseNormalizedEvent,
      runId: null,
      sequence: null,
      type: "session.started",
    },
  },
  {
    name: "invalid sensitivity",
    input: {
      ...baseNormalizedEvent,
      runId: null,
      sequence: null,
      sensitivity: "private",
    },
  },
  {
    name: "runId without sequence",
    input: { ...baseNormalizedEvent, runId: "run-fixture-001", sequence: null },
  },
  {
    name: "sequence without runId",
    input: { ...baseNormalizedEvent, runId: null, sequence: 1 },
  },
  {
    name: "zero sequence",
    input: { ...baseNormalizedEvent, runId: "run-fixture-001", sequence: 0 },
  },
  {
    name: "negative sequence",
    input: { ...baseNormalizedEvent, runId: "run-fixture-001", sequence: -1 },
  },
  {
    name: "fractional sequence",
    input: { ...baseNormalizedEvent, runId: "run-fixture-001", sequence: 1.5 },
  },
  {
    name: "invalid occurredAt datetime",
    input: {
      ...baseNormalizedEvent,
      runId: null,
      sequence: null,
      occurredAt: "2026-07-19T12:34:56",
    },
  },
  {
    name: "non-JSON payload",
    input: {
      ...baseNormalizedEvent,
      runId: null,
      sequence: null,
      payload: { invalid: undefined },
    },
  },
  {
    name: "unknown internal field",
    input: {
      ...baseNormalizedEvent,
      runId: null,
      sequence: null,
      schemaVerzion: 1,
    },
  },
] as const;
