# ADR-0001: Adopt Human Ownership Layer as the Product Direction

**Status:** Proposed  
**Date:** 2026-07-19  
**Decision owner:** Project founder  
**Related document:** `docs/product/PROJECT_SCOPE.md`

---

## Context

The original product idea started from a simple observation: after delegating a task to a coding agent, a developer may disengage from the project while the agent works and return later to a large body of changes that is difficult to understand.

Several product directions were considered:

1. a Reels-style feed of coding-agent activity;
2. a human-attention management layer;
3. a semantic scope firewall;
4. an agent-governance control plane;
5. enterprise agent-rollout assurance;
6. a layer for preserving human understanding and ownership of AI-generated software.

The firewall and governance directions may support high-value enterprise use cases, but they require high precision, complex integrations, security and compliance capabilities, and enterprise sales. They also face direct competition from coding-agent vendors and governance platforms.

A pure entertainment feed may be engaging, but it does not provide a strong or durable reason to pay.

The persistent problem across all explored directions is that faster code generation can outpace human understanding and leave important code without a clear human owner.

---

## Decision

OwnLoop will be developed as a **Human Ownership Layer for AI-generated software**.

It will observe a coding-agent session and convert a small number of meaningful, verifiable changes, decisions, risks, and understanding checks into evidence-backed Ownership Moments and a finite Build Replay.

The product will focus on:

- preserving developer understanding;
- surfacing meaningful implementation decisions;
- exposing concrete risks and evidence gaps;
- supporting fast inspection of evidence;
- recording meaningful human interaction with agent-generated changes;
- building the foundation for a future developer–code ownership graph.

The MVP will not:

- create a new coding agent;
- orchestrate or manage multiple agents;
- block or redirect agent execution;
- provide complete code review or security certification;
- act as an enterprise governance platform.

---

## Product positioning

### For individual developers

OwnLoop helps a developer understand the most meaningful parts of an agent-produced change without reading the complete transcript and diff.

### For future teams

OwnLoop aims to show which meaningful AI-assisted changes have a verified human interaction history and which areas may lack a clear human owner.

---

## Alternatives considered

### Alternative 1: Reels-style agent feed

**Advantages**

- Easy to explain.
- Visually distinctive.
- Potential for mobile engagement and organic sharing.

**Disadvantages**

- Easily copied.
- Weak willingness to pay.
- Risks optimizing for attention rather than understanding.
- Encourages low-value event generation.

**Reason not selected**

The feed may become an interaction pattern, but it is not the core economic value of the product.

### Alternative 2: Semantic change firewall

**Advantages**

- Clear risk and rework reduction story.
- Potential team and enterprise budget.

**Disadvantages**

- Requires very high precision.
- False positives can stop legitimate work.
- Existing and emerging competitors address scope drift and tool policies.
- Likely to be absorbed by coding-agent vendors.

**Reason not selected**

It is too competitive and operationally risky for the initial one-person team.

### Alternative 3: Enterprise agent governance

**Advantages**

- Large contracts and strong organizational need.
- High retention when deeply integrated.

**Disadvantages**

- Long sales cycles.
- Requires SSO, SCIM, audit, policy, compliance, and security infrastructure.
- Competes with platform vendors.

**Reason not selected**

It does not match the current team size, resources, or time-to-learning requirements.

### Alternative 4: General AI coding education platform

**Advantages**

- Large education market.
- Natural fit for quizzes and gamification.

**Disadvantages**

- Moves away from real development workflows.
- Risks attracting mostly low-paying educational users.
- Competes with broad EdTech products.

**Reason not selected**

OwnLoop should teach only from the user's real project changes rather than from a general curriculum.

---

## Consequences

### Positive

- The product scope is smaller and more suitable for a one-person team.
- A useful local-first prototype is possible.
- Only one initial coding-agent integration is required.
- Build Replay may provide value before team features exist.
- Session and interaction data can later support an ownership graph.
- The architecture remains reusable for future review, handoff, evaluation, and governance capabilities.

### Negative

- Willingness to pay is not proven.
- Users may perceive the product as optional education.
- Human understanding is difficult to measure without creating false confidence.
- Moment and replay interfaces are easy to copy.
- A meaningful data moat will take time to build.
- Some users may reject mid-session questions.

### Risks accepted

- Initial ownership records will be incomplete proxies rather than formal proof.
- Candidate moment generation will require a combination of deterministic analysis and AI.
- The individual product may precede a clear team business model.
- No scientific claim of verified comprehension will be made in the MVP.

---

## Reversibility

This decision is strategically important but technically reversible.

The event collector, evidence graph, and change analyzers may later support:

- handoff automation;
- agent evaluation;
- code review;
- scope-drift detection;
- team governance.

A major change to the product thesis must be recorded in a new ADR that supersedes this one.
