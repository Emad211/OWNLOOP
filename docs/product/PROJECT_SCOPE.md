# OwnLoop — Project Scope

**Document status:** Proposed  
**Version:** 0.1  
**Date:** 2026-07-19  
**Product stage:** Technical prototype / Pre-alpha  
**Working product name:** OwnLoop

---

## 1. Purpose

This document defines the scope of the first OwnLoop release and is the baseline for product, architecture, design, implementation, and evaluation decisions.

Anything not explicitly included here is out of scope until this document is revised or a new Architecture Decision Record (ADR) authorizes the change.

---

## 2. Product summary

OwnLoop is a human-understanding layer for AI-assisted software development.

It observes a coding-agent session, extracts verifiable changes and evidence, and converts only the most meaningful changes, decisions, risks, and understanding checks into short interactive **Ownership Moments**.

OwnLoop is not intended to make users watch every tool call or log line. Its purpose is to help a developer retain enough understanding and decision ownership to explain, review, and maintain the code produced with an agent.

---

## 3. Problem statement

Coding agents can change many files and make implementation decisions faster than a human can inspect and understand them.

A task may compile and pass initial tests while still introducing code whose rationale, assumptions, risks, and maintenance implications are not clearly owned by any person.

This can produce:

- comprehension debt;
- loss of developer mental models;
- hidden implementation and product decisions;
- more difficult code review and debugging;
- expensive handoffs and onboarding;
- increasing dependence on the coding agent;
- AI-generated areas with no identifiable human owner.

---

## 4. Product thesis

> If a coding-agent session is compressed into a small number of evidence-backed, interactive moments, developers can preserve useful understanding and ownership without reading the full transcript and diff.

OwnLoop must not optimize for time spent in the application. It must optimize for useful understanding per unit of user attention.

---

## 5. Primary user

The initial user is a developer or technical founder who:

- regularly uses a coding agent;
- works on a real, maintained codebase;
- remains accountable for the final software;
- cannot continuously follow the agent;
- wants to understand the most important changes and decisions;
- is concerned about the maintainability of large AI-generated diffs.

Future secondary users may include technical leads, engineering managers, reviewers, maintainers, software agencies, and developers receiving a project handoff.

---

## 6. Primary job to be done

> When a coding agent works on my project, show me only the changes and decisions that are necessary for understanding, control, or future maintenance, and provide enough evidence for me to make a useful decision quickly.

---

## 7. Core concepts

### 7.1 Agent Session

A bounded coding-agent execution that begins with a user task and ends in completion, failure, cancellation, or interruption.

### 7.2 Observable Event

A verifiable event emitted or derived from the session, including:

- task prompt;
- agent plan;
- tool request or result;
- file read, creation, modification, or deletion;
- command execution;
- Git diff;
- test or build result;
- session completion or failure.

### 7.3 Evidence

A concrete artifact supporting a product claim, such as:

- file path and line range;
- Git diff hunk;
- test result;
- command output;
- dependency change;
- database migration;
- public API contract change.

### 7.4 Ownership Moment

A short interactive unit that communicates one meaningful change, decision, risk, or understanding check.

Every Ownership Moment must:

- be derived from one or more observable events;
- include at least one evidence reference;
- be consumable in under 60 seconds;
- communicate one clear point;
- ask for a response only when the response has value.

### 7.5 Build Replay

A finite end-of-session summary of the task goal, meaningful changes, decisions, risks, evidence, tests, and unresolved items.

### 7.6 Human Ownership Record

A record showing whether a user has seen, investigated, explained, validated, approved, or corrected a meaningful change or decision.

In the MVP, this record is not a formal certification of competence or proof of understanding.

---

## 8. MVP goals

The MVP must be able to:

1. Capture one real coding-agent session.
2. Normalize observable session events.
3. Extract changed files, Git diff, commands, tests, and build outcomes.
4. Separate potentially meaningful changes from low-value activity.
5. Generate a small number of evidence-backed Ownership Moments.
6. Record user responses and evidence views.
7. Produce a finite Build Replay.
8. Preserve enough event history to reprocess a session later.

---

## 9. Functional scope

### 9.1 Session capture

Capture at minimum:

- session identifier;
- repository path;
- start and end time;
- original user task;
- session status;
- files read, created, modified, and deleted;
- commands executed;
- Git baseline and final diff;
- test and build results;
- final agent summary when available.

### 9.2 Event normalization

All source-specific data must be converted to a versioned internal event schema.

```json
{
  "eventId": "evt_001",
  "sessionId": "ses_001",
  "type": "file.modified",
  "occurredAt": "2026-07-19T12:00:00Z",
  "source": "claude_code",
  "schemaVersion": 1,
  "payload": {
    "path": "src/auth/session.ts"
  }
}
```

### 9.3 Change analysis

The MVP should classify changes into at least:

- user interface;
- application behavior;
- tests;
- dependency;
- authentication or authorization;
- public API;
- database or migration;
- configuration or infrastructure;
- documentation;
- unknown.

Classification may be multi-label and confidence-scored.

### 9.4 Ownership Moment types

The MVP supports exactly four types:

#### Change

Explains a meaningful behavior or structure change.

#### Decision

Surfaces an explicit or implicit implementation decision and relevant trade-off.

#### Risk

Surfaces a concrete risk, missing evidence, untested condition, or important assumption.

#### Check

Asks one short question to test or reinforce the user's understanding of the actual project change.

### 9.5 Evidence presentation

A user must be able to open the supporting:

- file and line range;
- diff hunk;
- command output;
- test or build result;
- related files.

### 9.6 User interaction

Depending on the moment type, the user may:

- acknowledge it;
- answer a check;
- open evidence;
- request a deeper explanation;
- mark it useful or not useful;
- approve or reject a surfaced decision as an ownership record only.

The MVP does not directly change agent behavior or source code.

### 9.7 Build Replay

At session completion, generate a replay containing:

- original goal;
- completion status;
- meaningful changed files;
- key changes and decisions;
- test and build status;
- remaining risks or evidence gaps;
- reviewed and unreviewed moments.

### 9.8 Basic ownership history

Record at minimum:

- moments shown;
- moments acknowledged;
- evidence opened;
- checks answered and outcome;
- decisions approved or rejected;
- user feedback on usefulness.

---

## 10. Technical boundaries for v0.1

The first implementation supports:

- one user;
- one local device;
- one repository per session;
- Git repositories;
- Claude Code as the first adapter;
- JavaScript and TypeScript projects;
- Node.js-based projects;
- local-first storage and processing;
- a local browser-based user interface.

---

## 11. Explicitly out of scope

The following are not part of v0.1:

- multiple coding-agent integrations;
- Cursor, Codex, or GitHub Copilot adapters;
- native mobile or desktop applications;
- public social network or infinite feed;
- marketplace, leaderboard, or complex gamification;
- coding-agent orchestration;
- creation of a new coding agent;
- autonomous code editing by OwnLoop;
- automatic agent blocking, pausing, or redirection;
- merge or deployment automation;
- complete AI code review;
- security certification or vulnerability guarantees;
- enterprise governance, SSO, SCIM, or organization policy management;
- cloud synchronization;
- team workspaces and billing;
- formal ownership certification;
- claims of scientifically proven human understanding.

---

## 12. Product principles

### 12.1 Evidence before explanation

No important factual claim is shown without traceable evidence.

### 12.2 AI proposes; deterministic systems verify

AI may propose a moment or explanation. Observable facts must be verified against stored events and artifacts.

### 12.3 Finite experience

A session may produce zero moments. A normal target is one to five, with a hard maximum of seven for v0.1.

### 12.4 No artificial engagement

The system must not generate filler moments to increase engagement.

### 12.5 Local-first privacy

Repository data and raw session events remain local by default.

### 12.6 Non-blocking observer

OwnLoop must not be in the coding agent's critical execution path in v0.1.

### 12.7 User attention is scarce

Every interruption or question must justify its attention cost.

---

## 13. Non-functional requirements

### 13.1 Privacy

- Store raw events locally.
- Do not upload the full repository.
- Support full session deletion.
- Do not use user data for model training.
- Support a user-provided model API key.
- Redact known secret files and values before external model calls.

### 13.2 Performance

- Event capture must not perceptibly slow the agent.
- Deterministic event processing should be near real time.
- AI analysis may run outside the agent's critical path.
- Build Replay should become available shortly after session completion.

### 13.3 Reliability

- OwnLoop failure must not terminate the coding agent.
- Source events are append-only.
- Sessions must be reprocessable.
- Derived moments and summaries must be reproducible from stored inputs.

### 13.4 Security

- OwnLoop has no source-code write capability in v0.1.
- Secrets must not be sent to external providers.
- API credentials are stored in operating-system secure storage or environment variables.
- Repository traversal must remain inside the selected workspace.

### 13.5 Cost control

- Limit model calls per session.
- Do not send raw transcripts without filtering.
- Preprocess and reduce diffs before model calls.
- Record estimated analysis cost per session.

---

## 14. Technical acceptance criteria

The v0.1 technical prototype is complete when:

1. A real Claude Code session is captured successfully.
2. At least 95% of session-changed files are detected in controlled tests.
3. Baseline and final Git diffs are retained.
4. All four moment types can be represented and rendered.
5. Every displayed moment contains valid evidence.
6. The user can open evidence from the moment.
7. User answers and decisions are persisted.
8. A Build Replay is produced from stored session data.
9. The full repository is not uploaded to a cloud service.
10. OwnLoop failure does not stop the Claude Code session.

---

## 15. Initial product metrics

Metrics to collect without treating them as validated success criteria yet:

- sessions containing at least one useful moment;
- Build Replay open rate;
- moment interaction rate;
- evidence open rate;
- moments marked useful or not useful;
- moments causing further investigation or correction;
- unsupported or incorrect claim rate;
- average processing cost per session;
- average Build Replay consumption time;
- weekly return rate.

---

## 16. Key risks

### Product risks

- Users may prefer only the final agent summary.
- Moments may become repetitive or feel like a test.
- Users may not pay for a separate understanding layer.
- Numerical ownership scores may create false confidence.

### Technical risks

- Claude Code hooks may not expose enough context.
- Semantic analysis may misinterpret a multi-file change.
- AI-generated moments may contain unsupported claims.
- Session size may make analysis slow or expensive.

### Strategic risks

- Coding-agent vendors may add similar experiences.
- Code-review products may enter the same category.
- The interface is easy to copy before an ownership graph exists.

---

## 17. Delivery phases

### Phase 0 — Internal prototype

- Capture a session manually or semi-automatically.
- Store task, events, diff, tests, and summary.
- Generate candidate moments.
- Render a basic Build Replay.

### Phase 1 — Local alpha

- Claude Code adapter;
- local event store;
- JavaScript/TypeScript analysis;
- evidence validation;
- local web UI;
- automatic Build Replay.

### Phase 2 — Closed beta

- multiple repositories;
- personal ownership history;
- improved moment ranking;
- limited GitHub integration.

### Phase 3 — Team product

- multiple users;
- Human Coverage Map;
- reviewer routing;
- handoff reports;
- shared ownership records.

---

## 18. Open questions requiring future ADRs

- Exact event schema and session lifecycle.
- Browser UI versus VS Code extension after the prototype.
- External AI provider and BYOK strategy.
- Live moments versus end-of-step or end-of-session generation.
- Definition and representation of human ownership.
- Retention and deletion policy.
- Transcript storage policy.
- TypeScript Compiler API versus Tree-sitter.
- Candidate-moment validation and versioning.

---

## 19. Scope change process

A new or superseding ADR is required for changes to:

- product thesis;
- primary user;
- supported coding agent;
- storage and privacy model;
- blocking behavior;
- cloud processing;
- AI provider strategy;
- ownership measurement;
- team architecture.

Small implementation choices may be handled by issues and pull requests when they do not change these boundaries.
