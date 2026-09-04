# Contracts

## Purpose

This directory will hold the interface and data contracts between CIPHER components — the agreed shapes of data as it moves through the pipeline (e.g. what an "extracted entity" or "evidence record" looks like), independent of any specific implementation.

## What Will Eventually Live Here

- Data schema definitions for evidence, entities, relationships, and analytical outputs
- API/interface contracts between pipeline stages (ingestion, extraction, entity resolution, graph synthesis, analytics, corroboration, copilot, reporting)
- Versioning conventions for contracts as they evolve

## Current Status

**Empty.** No contracts have been defined. This repository is currently in the pre-setup / foundation phase.

## What Must NOT Be Prematurely Decided

- The serialization format or schema language tied to a specific framework
- API transport details (REST vs. GraphQL vs. RPC, etc.)
- Any contract that presumes a specific database or storage technology

Contracts documented here should describe *what* data must look like, not *how* a particular technology stack will implement it.
