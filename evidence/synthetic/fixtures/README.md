# Synthetic Fixtures

**These are not Operation DarkNet Delhi.** This directory holds small, deterministic, clearly-fictional fixtures used only to test the domain/data foundation (P4.2) — entity kinds, evidence types, relationships, provenance — end to end.

The full canonical demonstration dataset (5 FIRs, 8 suspects, 1,000+ CDR records, 500+ transactions, per `docs/data/synthetic-investigation-spec.md`) now exists as `evidence/synthetic/operation-darknet-delhi.json` (P5.1) — generated deterministically by `src/lib/corpus/` and loaded by `loadInvestigationCorpus()`, not by the fixture loader. See `docs/data/corpus.md`.

Every fixture file is loaded and validated by `src/lib/fixtures/synthetic-loader.ts`.
