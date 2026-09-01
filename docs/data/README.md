# Data

## Purpose

This directory will hold the specification for the synthetic investigative dataset used to demonstrate NetIntel AI — its design, generation methodology, and documentation of what the dataset contains.

## What Will Eventually Live Here

- Specification of the synthetic scenario(s) used for demonstration
- Data generation methodology and provenance for synthetic evidence
- Documentation of entity types, relationship types, and evidence categories represented in the dataset
- Ground-truth documentation supporting evaluation

## Current Status

**Generated (P5.1).** The Operation DarkNet Delhi corpus now exists:

- `synthetic-investigation-spec.md` — the case specification (design intent).
- `ground-truth-spec.md` — the ground-truth specification.
- `corpus.md` — the generated corpus: version `1.0.0`, seed `20260901`,
  1,820 evidence items (5 FIRs, 8 suspects, 1,150 CDRs, 560 transactions,
  10 witness statements, 4 crime events, plus registry/location records),
  and the held-out ground truth. Deterministic — rebuild with
  `npm run corpus:generate`.

The corpus data lives under `evidence/synthetic/` and
`evidence/ground-truth/`; the generator is `src/lib/corpus/`.

Still **not** built here: any pipeline stage (extraction, entity
resolution, graph synthesis, analytics, corroboration, Copilot,
reporting).

## Invariants (prohibited at every phase)

- No data that resembles, references, or is derived from real FIRs, CDRs,
  bank records, Aadhaar information, real phone numbers, real financial
  identifiers, or any other real investigative or classified data. The
  corpus uses the unassigned `+99` country code and explicit `SYN-` /
  `ODD/SYN/` markers throughout.
