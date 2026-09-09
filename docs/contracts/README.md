# Contracts

## Purpose

The interface and data contracts between CIPHER components — the agreed shapes of
data as it moves through the pipeline, independent of any specific implementation.

## Current contents

- **[agent-contracts.md](./agent-contracts.md)** — the input/output contract for
  every pipeline stage (ingestion → extraction → resolution → graph synthesis →
  analytics → corroboration → Copilot → dossier), stated implementation-neutrally.
  "Agent" means a conceptual processing stage, not an agent framework.

## Status

**Defined and implemented.** Every stage in `agent-contracts.md` has a running
implementation; see [`../progress/README.md`](../progress/README.md) for what is
built and [`../data/`](../data/) for how each stage actually behaves.

The **executable** form of these contracts is Zod, at every stage boundary — the
schemas in `src/lib/domain/` are the enforcement, this document is the intent. If
the two ever disagree, the code is what runs and the document is the defect.

## What must NOT be prematurely decided

- The serialization format or schema language tied to a specific framework
- API transport details (REST vs. GraphQL vs. RPC, etc.)
- Any contract that presumes a specific database or storage technology

Contracts documented here describe *what* data must look like, not *how* a
particular technology stack implements it.
