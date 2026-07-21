# ADR-0007: Use a Silent Fail-Open Claude Code Command-Hook Adapter

**Status:** Proposed  
**Date:** 2026-07-21  
**Decision owner:** Project founder  
**Related documents:**

- `docs/adr/0002-local-first-claude-code-first-mvp.md`
- `docs/adr/0003-event-schema-and-session-lifecycle.md`
- `docs/adr/0004-durable-redacted-ingress-journal-and-sqlite.md`
- `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`
- `docs/adr/0006-authenticated-loopback-ingestion.md`
- GitHub issue #15

---

## Context

OwnLoop now exposes an authenticated IPv4-loopback endpoint that accepts a runtime-validated `ClaudeAdapterIngress`, prepares it through the canonical ingress-security boundary, and acknowledges only after durable SQLite insertion.

Claude Code command hooks receive event JSON on stdin. Their process exit code and output are not neutral implementation details:

- exit code 0 with no stdout reports no decision and allows normal Claude Code behavior to continue;
- exit code 2 can block events including `PreToolUse`, `UserPromptSubmit`, `Stop`, and `PostToolBatch`;
- other non-zero exit codes are non-blocking for most events but produce visible hook-error notices;
- stdout from `SessionStart` and `UserPromptSubmit` may be inserted into model context.

OwnLoop v0.1 is strictly observational. A transport failure, timeout, malformed payload, disabled daemon, or configuration problem must never alter Claude's execution or add content to the conversation.

The historical backlog said that the adapter should remove configured secret fields before delivery. That conflicts with ADR-0005. OwnLoop's keyed fingerprint is intentionally computed from the complete validated source payload before redaction. If the adapter removes values first, retries and conflict detection become dependent on an unversioned pre-filter and different source payloads may collapse before fingerprinting.

The adapter therefore needs one narrow purpose: receive, validate, wrap, and attempt a bounded loopback delivery—without persistence, logging, redaction, policy decisions, retries, or user-visible output.

---

## Decision

OwnLoop will implement a cross-platform **command-hook adapter** under `tools/hook-adapter`.

The production executable will:

```text
read one bounded JSON value from stdin
→ validate one of nine supported Claude Hook payloads
→ construct ClaudeAdapterIngress v1
→ POST to fixed authenticated IPv4-loopback endpoint
→ validate 202 accepted response
→ exit 0 silently for every outcome
```

### Supported events

Exactly:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PostToolBatch`
- `Stop`
- `StopFailure`
- `SessionEnd`

Adding another event requires a source contract and an explicit adapter/version decision.

### Fail-open process contract

The production CLI must always:

- exit with code 0;
- emit zero bytes to stdout;
- emit zero bytes to stderr;
- avoid JSON decision output;
- avoid global exception or rejection logging;
- catch configuration, input, validation, serialization, network, timeout, redirect, response, and internal failures;
- terminate after the bounded attempt.

Programmatic functions may return only a safe result enum for tests. No result may contain request values, identifiers, paths, status bodies, tokens, or exceptions.

### No adapter-side source redaction

The adapter does **not** redact or reduce the validated source Hook payload.

Reasons:

- ADR-0005 fingerprints the complete source payload before redaction;
- daemon-side policy is versioned and authoritative;
- two redaction layers can diverge and silently destroy evidence;
- delivery is fixed to authenticated loopback;
- the adapter persists and logs nothing.

The adapter may reject unsafe configuration and malformed input, but it must forward a successfully validated source payload unchanged inside the wrapper.

### Configuration

The adapter reads only:

- `OWNLOOP_INGRESS_PORT`
- `OWNLOOP_INSTALLATION_TOKEN`

The endpoint is constructed internally as:

```text
http://127.0.0.1:<validated-port>/v1/ingress/claude
```

No arbitrary host, URL, protocol, path, query, redirect, proxy, or endpoint environment variable exists.

Port must be an integer from 1 through 65535.

Token must be canonical base64url decoding to at least 32 bytes.

Missing or invalid configuration causes a silent skip before input buffering or network activity.

Configuration storage and rotation are deferred to installer/runtime orchestration.

### Input limits

The adapter reads a single JSON value from stdin with a raw UTF-8 byte limit of 1,000,000 bytes.

This leaves deterministic envelope overhead below the daemon's 1 MiB HTTP body limit.

The adapter rejects silently:

- empty input;
- invalid UTF-8;
- malformed JSON;
- trailing additional JSON/text;
- arrays or other non-object values;
- unsupported Hook names;
- runtime-invalid Hook payloads;
- input exceeding the limit during streaming.

Buffering stops as soon as the limit is crossed. The implementation does not accept an unbounded stream and check only after complete buffering.

### Wrapper

The adapter constructs and runtime-validates:

```ts
{
  contractVersion: 1,
  source: "claude_code",
  adapterVersion: <compiled SemVer>,
  receivedAt: <ISO datetime>,
  payload: <validated Hook payload>
}
```

The adapter version is a controlled compile-time constant.

### Delivery

The adapter uses Node.js built-in `fetch` with:

- POST;
- `Content-Type: application/json`;
- `Authorization: Bearer <installation-token>`;
- `redirect: "error"`;
- a 750-millisecond production timeout;
- no retry;
- a bounded response body.

A delivery is considered successful only when:

- status is 202;
- the response body stays within the adapter response limit;
- JSON parsing succeeds;
- the body runtime-validates as `IngestionAcceptedResponse`.

Everything else is a silent non-delivery.

### Claude settings example

The repository will provide a secret-free example, not an active project configuration.

It uses command-hook exec form:

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PROJECT_DIR}/tools/hook-adapter/dist/index.js"],
  "timeout": 2
}
```

Exec form avoids shell tokenization and is portable because Claude Code can launch the real Node executable directly.

The future installer will arrange daemon startup and inject the port/token into the parent Claude process environment.

---

## Alternatives considered

## Alternative 1: Use Claude Code HTTP hooks directly

Rejected for v0.1 because the current endpoint accepts a versioned `ClaudeAdapterIngress` wrapper containing adapter version and receipt time, while native HTTP hooks send the raw source event body. Changing the server to accept two boundary shapes would broaden OL-003 and complicate versioning.

This can be reconsidered later if Claude Code's HTTP hook contract can provide equivalent wrapper metadata or if OwnLoop intentionally adopts raw-source transport contracts.

## Alternative 2: Redact in both adapter and daemon

Rejected because it changes the source payload before the authoritative HMAC fingerprint and creates two potentially divergent policies.

## Alternative 3: Exit non-zero on delivery failure

Rejected because exit 1 produces hook-error notices and exit 2 can block Claude behavior. OwnLoop capture failure must be fail-open and silent.

## Alternative 4: Print diagnostic JSON or text

Rejected because stdout on some events becomes Claude context and stderr can surface hook errors. Adapter diagnostics are deferred until a privacy-safe local diagnostic channel is designed.

## Alternative 5: Retry inside the adapter

Rejected because retries increase Hook latency and process lifetime. The source may fire again, and the durable journal already provides exact idempotency/conflict semantics.

## Alternative 6: Accept arbitrary endpoint URL

Rejected because it could transmit source payloads off-device or through proxies. The adapter is hard-coded to IPv4 loopback.

---

## Consequences

### Positive

- OwnLoop failure cannot block Claude Code;
- no output can contaminate model context or user transcript;
- the full source payload reaches authoritative fingerprint/redaction policy unchanged;
- the adapter has no external runtime dependency;
- endpoint attack surface remains fixed to authenticated loopback;
- process lifetime and latency are bounded;
- the adapter can be integration-tested as a real child process.

### Negative

- failed capture is silent until a later diagnostics design exists;
- valid source payload temporarily exists in adapter memory and loopback transport;
- installation must provide environment configuration to the Claude process;
- the adapter adds a process spawn per Hook event;
- no internal retry occurs.

### Accepted risks

- silent data loss is preferable to altering agent behavior in the observer-only MVP;
- source payload exposure is constrained to process memory and authenticated loopback, with no adapter persistence or logs;
- 750 milliseconds is accepted as the initial delivery budget and may be revised with measured local latency.

---

## Implementation constraints

OL-004 must not implement:

- daemon lifecycle orchestration;
- secret storage, rotation, or installer behavior;
- real `.claude/settings.json` modification;
- adapter-side source redaction;
- retry queue or disk spool;
- diagnostic logs/files;
- pending-receipt processing;
- lifecycle or normalized events;
- Git or artifacts;
- AI or UI behavior;
- cloud, analytics, telemetry, billing, or authentication services.

---

## Validation

This decision is validated when tests prove:

- all nine source contracts wrap and deliver unchanged;
- endpoint is fixed to `127.0.0.1`;
- configuration/input/network/response failures skip silently;
- timeout and all reads are bounded;
- child-process stdout and stderr are empty and exit code is 0 for success and failure;
- a real child process delivers to a real OL-003 server and creates a durable receipt;
- duplicate invocations remain idempotent;
- sample settings are valid, exec-form, complete, and secret-free;
- standard quality gates pass.

---

## Reversibility

The adapter is isolated in one tool package. Moving to native Claude HTTP hooks, changing environment configuration, introducing a local diagnostics channel, changing timeout/retry behavior, or preprocessing source payloads requires a new or superseding ADR.

---

## References

- Claude Code Hooks reference: <https://code.claude.com/docs/en/hooks>
- Claude Code Settings reference: <https://code.claude.com/docs/en/settings>
