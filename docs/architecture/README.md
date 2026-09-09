# Architecture

## Purpose

System architecture for CIPHER: the accepted technology stack, the implementation
baseline every agent builds against, and the boundaries that may not move without
a recorded decision.

## Current contents

- **[technology-stack.md](./technology-stack.md)** — ADR-001, the accepted stack:
  decision, component rationale, alternatives, tradeoffs, resource budget,
  rejected technologies, and fallbacks.
- **[stack-contract.md](./stack-contract.md)** — the concise implementation
  baseline. The short, definitive answer to "what do I use for X?"
- **[ml-integration.md](./ml-integration.md)** — how the advisory entity-resolution
  model is exposed, and the boundary that keeps it out of resolution decisions.
- **[current-system-assessment.md](./current-system-assessment.md)** —
  **historical.** A source-level assessment of the system as of 2026-09-03
  (`4493a3e`), kept as the record of what was verified then. It predates the P6
  ML work and the P6.29 corrections; read [`../progress/README.md`](../progress/README.md)
  for current state.
- **[public-data-schema-options.md](./public-data-schema-options.md)** —
  **historical.** The Option A / Option B decision memo for admitting real
  public-register data. Option B was taken and implemented; the memo is kept as
  the record of the reasoning.

## Status

**Stack selected and implemented (ADR-001).** Per-stage architecture — the data
flow through each pipeline module, its contract and its measured behaviour — is
documented where it is implemented, in [`../data/`](../data/) and
[`../contracts/agent-contracts.md`](../contracts/agent-contracts.md), rather than
duplicated here as diagrams that would drift.

## What must NOT be changed without a new ADR

The stack decisions in ADR-001 are binding. In particular, the technologies listed
in [ADR-001 §10 "Technologies/Patterns We Are NOT Using"](./technology-stack.md#technologiespatterns-we-are-not-using)
— including Neo4j, PostgreSQL, vector databases, Docker application services, and
LLM agent frameworks — must not be reintroduced by an implementation agent without
a new, recorded architecture decision.

Two further boundaries are binding and are stated in [`../../CLAUDE.md`](../../CLAUDE.md) §4:
the deterministic resolver is frozen, and the ML model is advisory only.
