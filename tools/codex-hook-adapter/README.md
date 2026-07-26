# OwnLoop Codex Hook Adapter

This workspace is the source-specific, fail-open command adapter for Codex lifecycle hooks.

It accepts one bounded JSON object on stdin, validates one of the 11 official Codex lifecycle events, drops unknown upstream fields, wraps the controlled source facts, and performs one authenticated delivery attempt to:

```text
POST http://127.0.0.1:$OWNLOOP_INGRESS_PORT/v1/ingress/codex
```

The production command is observational:

- no ordinary stdout or stderr;
- exit code zero for success and all failure modes;
- no retry;
- fixed loopback endpoint;
- installation token only in the child environment;
- duplicate JSON object keys rejected;
- bounded stdin, JSON depth, request, response, and timeout;
- no transcript-path reads;
- no permission decisions, tool blocking, input rewriting, or additional context.

The daemon Codex ingress route, normalization, configuration installation, trust diagnostics, and Windows launcher are separate OL-027 slices.
