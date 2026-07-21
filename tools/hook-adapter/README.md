# OwnLoop Claude Code Hook Adapter

A silent, fail-open command-hook adapter for OwnLoop.

The adapter reads one supported Claude Code Hook payload from stdin, validates it, wraps it as `ClaudeAdapterIngress` v1, and attempts one authenticated POST to:

```text
http://127.0.0.1:$OWNLOOP_INGRESS_PORT/v1/ingress/claude
```

## Production behavior

- always exits with code `0`;
- writes nothing to stdout;
- writes nothing to stderr;
- never returns a Claude hook decision;
- uses a 750 ms delivery timeout;
- performs no retry;
- persists and logs nothing;
- skips silently on missing configuration, invalid input, daemon failure, timeout, redirect, non-202 response, or invalid response body.

The production entry point catches configuration, iterator, clock, serialization, network, timeout, redirect, response, and unexpected failures. Programmatic delivery returns only a content-free result enum and does not reject for those failure families.

## Bounded I/O

- stdin is read incrementally and stops at 1,000,000 UTF-8 bytes;
- invalid UTF-8, empty input, malformed/trailing JSON, unsupported Hooks, and runtime-invalid Hook payloads are skipped before fetch;
- response bodies are capped at 65,536 bytes;
- non-202 bodies are cancelled without being parsed;
- redirects are rejected;
- the adapter performs one delivery attempt only.

These limits keep the wrapped request below the daemon's 1 MiB transport boundary and prevent unbounded buffering in the short-lived Hook process.

## Configuration

The parent Claude Code process must receive:

- `OWNLOOP_INGRESS_PORT`
- `OWNLOOP_INSTALLATION_TOKEN`

The port must be an integer from 1 through 65535. The token must be canonical base64url decoding to at least 32 bytes.

The endpoint host, protocol, and route are not configurable. Token and daemon lifecycle orchestration are future installer responsibilities.

## Source-payload policy

The adapter forwards the runtime-validated source Hook payload unchanged inside the versioned wrapper. It does not redact source fields before delivery because the daemon computes the authoritative keyed fingerprint from the complete source payload before applying OL-005A redaction.

Forward-compatible unknown source fields remain part of the payload and are handled by the daemon's versioned allowlist/redaction policy. The adapter does not mutate the source object before serialization.

## Verification boundary

The test suite exercises the built adapter as a real child process and proves exit code `0` with empty stdout/stderr for successful delivery, missing configuration, malformed and oversized stdin, daemon unavailability, timeout, and invalid accepted responses. A real OL-003 daemon integration confirms durable insertion and duplicate idempotency.

See `examples/claude-settings.json` for a secret-free exec-form configuration covering the nine v0.1 Hook events. Do not copy credentials into that file.
