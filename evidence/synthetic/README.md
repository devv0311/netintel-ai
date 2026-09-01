# Synthetic Evidence

## `operation-darknet-delhi.json` — the canonical corpus

The full **Operation DarkNet Delhi** synthetic investigation corpus
(P5.1): 1,820 evidence items across 6 sources — 5 FIRs, 8 primary
suspects (with alias/phone/IMEI/vehicle/account/location records),
1,150 CDR events, 560 financial transactions, 10 witness statements,
4 crime events — plus 1,150 structured communication events, 560
structured financial transactions, and 14 locations.

This is the **application evidence**: what the pipeline is allowed to
process. Its answer key is held out under `evidence/ground-truth/` and is
never reachable from the loader.

- Generated deterministically from `(CORPUS_VERSION, CORPUS_SEED)` in
  `src/lib/corpus/config.ts` — rebuild with `npm run corpus:generate`.
- Loaded and validated by `src/lib/corpus/load.ts`
  (`loadInvestigationCorpus()`), persisted via `src/lib/corpus/persist.ts`
  through the P4.2 validated repository layer only.
- Full documentation: `docs/data/corpus.md`.
- Everything in it is fictional — synthetic `+99` phone numbers, `SYN-`
  identifiers, `ODD/SYN/2025/NNN` FIR numbers, generic Delhi-NCR
  coordinates with clearly-fictional labels.

## `fixtures/`

Small `foundation-smoke` fixtures for the P4.2 domain/data foundation —
not Operation DarkNet Delhi. See `fixtures/README.md`.
