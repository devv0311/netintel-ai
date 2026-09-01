# Architecture

## Purpose

This directory will hold the system architecture documentation for NetIntel AI once the application technology stack has been selected: component diagrams, data flow, service boundaries, and design rationale.

## What Will Eventually Live Here

- High-level system architecture diagrams
- Component/service responsibilities and boundaries
- Data flow through the intended demonstration pipeline (ingestion → extraction → entity resolution → graph synthesis → analytics → corroboration → copilot → report)
- Design decisions and their rationale (architecture decision records)

## Current Contents

- **[technology-stack.md](./technology-stack.md)** — ADR-001, the accepted technology stack: decision, component rationale, alternatives, tradeoffs, resource budget, rejected technologies, and fallbacks.
- **[stack-contract.md](./stack-contract.md)** — the concise implementation baseline every implementation agent builds against.

## Current Status

**Technology stack selected (ADR-001).** Component-level system design — diagrams, module boundaries, and data-flow documentation — has not yet been written and will follow as implementation begins.

## What Must NOT Be Changed Without a New ADR

The stack decisions in ADR-001 are binding. In particular, the technologies listed in [ADR-001 §10 "Technologies/Patterns We Are NOT Using"](./technology-stack.md#technologiespatterns-we-are-not-using) — including Neo4j, PostgreSQL, vector databases, Docker application services, and LLM agent frameworks — must not be reintroduced by an implementation agent without a new, recorded architecture decision.
