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

## Configuration

The parent Claude Code process must receive:

- `OWNLOOP_INGRESS_PORT`
- `OWNLOOP_INSTALLATION_TOKEN`

The endpoint host, protocol, and route are not configurable. Token and daemon lifecycle orchestration are future installer responsibilities.

## Source-payload policy

The adapter forwards the runtime-validated source Hook payload unchanged inside the versioned wrapper. It does not redact source fields before delivery because the daemon computes the authoritative keyed fingerprint from the complete source payload before applying OL-005A redaction.

See `examples/claude-settings.json` for a secret-free exec-form configuration covering the nine v0.1 Hook events. Do not copy credentials into that file.
