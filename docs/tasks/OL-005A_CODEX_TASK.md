# OL-005A Codex Task — Canonical Ingress Security Boundary

## Task identity

- **Issue:** GitHub issue #10
- **Base branch:** `agent/ol-005a-ingress-security-plan`
- **Implementation branch:** `codex/ol-005a-ingress-security`
- **Target:** the base branch above, not `main`
- **Primary ADR:** `docs/adr/0005-canonical-ingress-reduction-redaction-and-fingerprinting.md`

---

## Required reading

Before changing code, read:

1. `AGENTS.md`
2. GitHub issue #10
3. ADR-0002
4. ADR-0003
5. ADR-0004
6. ADR-0005
7. `docs/architecture/C4.md`
8. `docs/product/BACKLOG_v0.1.0.md`
9. the current runtime contracts in `packages/contracts`
10. the persistence implementation and migration tests in `apps/daemon/src/persistence`
11. RFC 8785 and its verified errata
12. Node.js 24 Crypto documentation
13. OWASP Logging Cheat Sheet data-exclusion guidance

If the issue, ADRs, and old backlog order differ, ADR-0004 and ADR-0005 define the authoritative execution order.

---

## Restate before implementation

Before modifying files, report:

- why unknown source fields may be accepted but must not be persisted automatically;
- why a plain unkeyed hash is not used for source payloads;
- why canonical workspace path is dedicated local-sensitive metadata;
- why the existing migration version 1 must not change;
- every capability that remains out of scope.

---

## Implement exactly this scope

### 1. Contracts

In `packages/contracts`, add strict Zod schemas and inferred types for:

- `RedactionSummaryV1`;
- `PreparedIngressReceiptV1`;
- any public structured error representation required across package boundaries;
- exported version constants and safe pattern schemas.

Requirements:

- OwnLoop-owned objects use strict schemas;
- counts are non-negative integers;
- `rulesApplied` is a sorted unique array of stable rule IDs;
- HMAC fingerprint format is runtime-validated;
- deduplication-key format is bounded and runtime-validated;
- `redactedPayloadJson` is a string whose JSON validity is checked by the implementation before contract parsing;
- no handwritten public interface duplicates a schema-inferred type.

Do not place canonicalization or redaction behavior in `packages/contracts`.

### 2. Shared package

Create:

```text
packages/ingress-security/
├── package.json
├── tsconfig.json
├── src/
├── tests/
└── README.md
```

The package is Node-only and may use Node built-ins.

Add no external runtime dependency.

The package must not import from `apps/daemon` or `tools/hook-adapter`.

### 3. Canonical JSON v1

Implement a small reviewed canonicalizer for parsed JSON-compatible values.

Required rules are exactly those in ADR-0005 and issue #10.

Implementation guidance:

- build the canonical string recursively;
- sort object keys with JavaScript's deterministic UTF-16 code-unit comparison;
- use `JSON.stringify` only for already-validated primitive values and property names;
- use an identity-based `WeakSet` or equivalent for cycle detection;
- distinguish arrays from objects;
- require object prototype to be `Object.prototype` or `null`;
- inspect every array index so sparse arrays are rejected;
- reject lone UTF-16 surrogates in keys and values;
- reject `Object.is(number, -0)`;
- measure UTF-8 using `Buffer.byteLength`;
- do not normalize Unicode.

Do not copy an external implementation or add a dependency.

### 4. Fingerprinting

Implement HMAC-SHA-256 through Node built-ins.

The public entry point accepts a secret `KeyObject`.

Validate:

- key type is `secret`;
- symmetric key size is at least 32 bytes.

Fingerprint only the canonical source Hook payload, excluding wrapper receipt time.

Return exactly:

```text
hmac-sha256:<64 lowercase hex>
```

Do not expose canonical unredacted JSON from the high-level preparation API.

A low-level canonicalizer may be exported for focused tests only if its API is documented and does not log data.

### 5. Source IDs and dedup keys

Implement exhaustive Hook-name switching with a compile-time unreachable branch.

Source ID extraction and dedup formats must match ADR-0005.

Bound deduplication-key length and test every Hook.

### 6. Reduction policy

Create explicit per-Hook allowlist definitions.

Do not use broad object spreading from source payload to output.

The reducer must:

- move common routing values to dedicated output fields;
- retain only policy-approved event values;
- recursively process retained nested tool input/response values;
- drop unknown fields at every policy-controlled object level;
- count dropped fields;
- preserve future Hook parsing compatibility without future-field persistence.

Policy tables and rule IDs must be immutable exported constants or read-only definitions suitable for golden testing.

### 7. Secret redaction

Implement separate deterministic stages:

1. secret-bearing field-name replacement;
2. strong string-pattern replacement;
3. path replacement;
4. deterministic truncation;
5. output canonicalization and size verification.

Use one stable marker family and document it.

Do not include matched secret fragments in rule IDs or diagnostics.

Add tests for exact secret-field matching and safe non-matches such as `max_tokens`, `token_count`, and `token_limit`.

Regex rules must be reviewed for bounded behavior. Avoid nested ambiguous quantifiers and global expressions that can reprocess the same range indefinitely.

### 8. Path reduction

The high-level API receives optional path context rather than reading process-global home or cwd implicitly.

Do not call `process.cwd()` or `os.homedir()` inside the pure policy unless an explicit wrapper outside the core supplies those values.

Normalize separators to POSIX form in redacted payload output.

On Windows semantics, compare workspace/home prefixes case-insensitively while preserving a deterministic output form.

Do not perform filesystem access, `realpath`, Git discovery, or symlink resolution.

### 9. Limits

Export the ADR-0005 limit constants.

Ensure limits are checked at the documented stage.

Use byte lengths, not JavaScript character counts, for string and total sizes.

Truncation markers must be deterministic and must not contain removed text.

If deterministic truncation cannot safely bring an output under the final limit, return a typed `output_too_large` error.

### 10. Prepared-receipt API

Expose one high-level API similar to:

```ts
prepareIngressReceipt(validatedIngress, options): PreparedIngressReceiptV1
```

Options must explicitly include:

- secret HMAC `KeyObject`;
- optional home path context;
- optional test-only limit overrides only if those overrides cannot be used accidentally in production.

The function must return no raw input references and must not mutate the input object.

Freeze output only if it can be done consistently without expensive deep-freeze behavior; otherwise document immutability by type and copying.

### 11. Persistence migration version 2

Do not modify migration version 1.

Add migration version 2 with stable name and SQL.

Extend receipt persistence for:

- canonicalization version;
- redaction policy version;
- adapter version;
- canonical workspace path;
- redaction summary JSON.

Update repository types and mappings to use explicit prepared-receipt names.

The repository may accept a fully assembled pending receipt record, but it must not accept an unredacted input object.

Add migration upgrade tests that first apply only version 1, insert a representative legacy row if compatible, and then apply version 2.

Document how defaults for pre-version-2 rows are represented. Do not silently mark a legacy row as safely redacted if that statement is not true.

If a table rebuild is required to model legacy state honestly, implement it transactionally and test it.

### 12. Fixtures

Add only synthetic neutral fixture values.

Secret fixtures must be unmistakably fake, for example reserved-domain hosts and strings explicitly containing `fixture`.

Do not use token strings that could be mistaken for active credentials by scanners.

Use platform-neutral virtual paths plus explicit Windows and POSIX test cases.

---

## Required error properties

Errors must expose:

- stable error code;
- optional safe structural path;
- safe message independent of source value;
- optional rule ID.

Tests must recursively inspect enumerable properties, message, cause chain when present, and JSON serialization to prove known secret/path fixtures are absent.

Do not attach the original error from `JSON.stringify`, URL parsing, or crypto when that cause could contain source content.

---

## Required tests

Implement every test category in issue #10.

Additionally include:

- input immutability;
- null-prototype plain object support;
- class-instance rejection;
- object-key lone-surrogate rejection;
- negative zero nested inside object and array;
- multibyte UTF-8 limit boundaries;
- duplicate `rulesApplied` prevention;
- HMAC key object with insufficient length;
- HMAC key object with wrong key type;
- receivedAt change does not affect payload fingerprint;
- object key order does not affect fingerprint;
- redaction changes do not change the raw keyed fingerprint for the same source;
- two source payloads that reduce to the same redacted output still have different keyed fingerprints;
- prepared output passes its runtime schema;
- `redactedPayloadJson` parses and re-canonicalizes identically;
- no returned object contains the input HMAC key or input object by reference;
- migration checksum history remains valid after adding version 2.

Do not assert on complete platform-specific Node error text.

---

## Explicitly forbidden

Do not implement:

- Fastify, HTTP server, route, client, or token authentication;
- stdin handling;
- Hook delivery or spool behavior;
- Claude settings files;
- receipt ID generation;
- persistence orchestration or `accepted` response generation;
- pending-receipt worker;
- lifecycle resolution;
- normalized events;
- database deduplication decisions;
- sequence allocation;
- Git operations;
- artifact file storage;
- AI provider calls;
- web UI;
- telemetry, analytics, billing, auth, or cloud code.

Do not modify unrelated ADR decisions.

---

## Dependencies

Expected direct dependencies:

- workspace references to existing OwnLoop packages;
- no new external runtime dependency.

If an external dependency appears necessary, stop and report the reason instead of adding it.

---

## Quality commands

Run and report:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run focused tests for:

- ingress-security package;
- migration version-1 to version-2 upgrade;
- secret/path absence assertions;
- adversarial long-string patterns.

Never claim a command passed unless it completed successfully.

---

## Pull request requirements

Open a draft PR from:

```text
codex/ol-005a-ingress-security
```

into:

```text
agent/ol-005a-ingress-security-plan
```

The PR body must include:

1. package and trust-boundary summary;
2. canonicalization behavior and non-conformance limitations;
3. exact allowlists and redaction rule IDs;
4. path-reduction rules;
5. HMAC and deduplication behavior;
6. migration version 2 and legacy-row handling;
7. exported contracts and public APIs;
8. exact dependency changes;
9. test counts and commands;
10. known redaction false-negative and false-positive risks;
11. explicit out-of-scope confirmation;
12. `Closes #10`.
