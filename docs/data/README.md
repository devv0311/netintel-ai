# Data

## Purpose

This directory documents the **synthetic** investigative dataset used to
demonstrate CIPHER, and how each implemented pipeline stage behaves on it. Each
stage document is the canonical home for that stage's measured counts.

Real public-register data (Wikidata, GLEIF, SEC EDGAR) is a **separate data
class** used only for resolver evaluation and ML training, never for the
demonstration narrative. It is documented elsewhere: provenance and licensing in
[`../data-research/source-registry.md`](../data-research/source-registry.md),
datasets in [`../evaluation/ml-dataset-card.md`](../evaluation/ml-dataset-card.md).

## Current Status

**Generated (P5.1).** The Operation DarkNet Delhi corpus exists:

- `synthetic-investigation-spec.md` — the case specification (design intent).
- `ground-truth-spec.md` — the ground-truth specification.
- `corpus.md` — the generated corpus: version `1.0.0`, seed `20260901`,
  1,820 evidence items (5 FIRs, 8 suspects, 1,150 CDRs, 560 transactions,
  10 witness statements, 4 crime events, plus registry/location records),
  and the held-out ground truth. Deterministic — rebuild with
  `npm run corpus:generate`.

The corpus data lives under `evidence/synthetic/` and
`evidence/ground-truth/`; the generator is `src/lib/corpus/`.

Each implemented pipeline stage is documented here, and each stage document
owns its own measured counts — resolved entities, graph nodes and edges, signals,
findings. Do not restate those numbers elsewhere; link to the stage document.
Overall project state is in [`../progress/README.md`](../progress/README.md).

- `ingestion.md` — evidence ingestion (P5.2)
- `extraction.md` — structured extraction (P5.3)
- `resolution.md` — entity resolution (P5.4)
- `graph.md` — graph synthesis (P5.5)
- `analytics.md` — topology analytics (P5.6)
- `corroboration.md` — spatial/temporal corroboration (P5.7)
- `copilot.md` — Investigation Copilot (P5.8)
- `dossier.md` — dossier / report generation (P5.9)

## Invariants (prohibited at every phase)

- No data that resembles, references, or is derived from real FIRs, CDRs,
  bank records, Aadhaar information, real phone numbers, real financial
  identifiers, or any other real investigative or classified data. The
  corpus uses the unassigned `+99` country code and explicit `SYN-` /
  `ODD/SYN/` markers throughout.
