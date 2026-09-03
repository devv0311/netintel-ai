# Current System Assessment

**Date:** 2026-09-03 · **Commit inspected:** `4493a3e` (`master`)
**Method:** direct source inspection plus a full pipeline run against the built-in corpus (`npm run evaluate`). Every claim below cites a repository path; every count is from the run, not from documentation.

This document independently re-verifies the earlier assessment rather than restating it. Where the earlier assessment was right, it is confirmed with a path. Where it was imprecise, it is corrected.

---

## 1. Verdict on the earlier assessment

| Earlier claim | Verified? | Evidence |
|---|---|---|
| No local trainable ML model | **Confirmed** | `package.json` dependencies: `@anthropic-ai/sdk`, `drizzle-orm`, `graphology*`, `next`, `react`, `sigma`, `zod`. No ML runtime. No `.py`, `.ipynb`, `requirements.txt` or `pyproject.toml` anywhere in the tree. |
| No training code, tokenizer, loss, split, or training data format | **Confirmed** | No occurrence of fine-tuning, model training, dataset split or tokenizer anywhere in `docs/` or `src/`. Embeddings appear only as an `Optional` fallback in `docs/architecture/stack-contract.md`, gated on "only if M8 shows paraphrase recall is insufficient". |
| AI layer is the remote Claude API, used for Copilot synthesis | **Confirmed, and narrower than stated** | `src/lib/ai/client.ts` is the only client. The only call site in the whole tree is `src/lib/copilot/synthesize.ts:121` (`messages.parse`). Extraction, resolution, graph, analytics, corroboration and dossier make **zero** model calls. |
| Extraction is deterministic structural field-reading | **Confirmed** | `src/lib/extraction/extract.ts` (447 lines), `EXTRACTION_METHOD_PREFIX = "extraction:field-read"`. `EXTRACTORS` is a `Record<EvidenceItemType, …>` — one function per evidence type, reading named fields. No free-text parsing. |
| Entity resolution is deterministic | **Confirmed** | `src/lib/resolution/resolve.ts` (493 lines). Two tiers: shared identifier, then exact name match into exactly one Tier-A cluster. The header states "never by fuzzy string similarity, never by re-parsing free text". |
| Corpus schema is a closed set matching prohibited data categories | **Confirmed** | `src/lib/domain/evidence.ts:38` — `EVIDENCE_ITEM_TYPES` is a 12-value `as const` tuple wrapped in `z.enum`. |
| Operation DarkNet Delhi is the only complete ground truth | **Confirmed** | `evidence/ground-truth/operation-darknet-delhi.ground-truth.json` (34 KB) plus a `foundation-smoke` fixture. Nothing else. |
| **"No evaluation harness exists"** | **Was correct; no longer true** | It is now implemented — `src/lib/evaluation/`, `scripts/evaluate.ts`, `tests/unit/evaluation.test.ts`. See §6. |

One correction to the earlier assessment: it said the stack contract's *"LLM adjudication for the ambiguous band"* is unimplemented. That is right, and the consequence is worth stating precisely — `src/lib/resolution/resolve.ts:434` writes `status: "ambiguous"` and stops. Nothing downstream ever revisits an ambiguous decision, so an ambiguous entity is permanent, not queued.

---

## 2. Evidence schema

`src/lib/domain/evidence.ts`

- `EVIDENCE_SOURCE_TYPES` = `document`, `structured_dataset`, `statement` (line 16)
- `EVIDENCE_ITEM_TYPES` (line 38), all twelve:
  `fir`, `suspect_record`, `alias_record`, `phone_record`, `imei_record`, `vehicle_record`,
  `bank_account_record`, `location_record`, `cdr_event`, `financial_transaction_record`,
  `witness_statement`, `crime_event`
- `EvidenceItemSchema.content` is `z.record(z.string(), z.unknown())` — the container is open, but which *shapes* are meaningful is fixed by whichever extractor is registered for that `itemType`.

**`CorpusManifestSchema`** (`src/lib/corpus/manifest-schema.ts`) is the ingestion gate. `src/lib/ingestion/service.ts` → `validateCorpusSchema` rejects anything that fails it, with a specific error path when the failure mentions `itemType` (`src/lib/ingestion/normalize.ts`). `src/app/api/ingestion/route.ts` accepts `{kind: "uploaded", contents}` — so an external file **can** be ingested, but only if it is already shaped as this manifest.

**The governance collision, restated precisely.** Seven of the twelve types (`fir`, `suspect_record`, `phone_record`, `imei_record`, `bank_account_record`, `cdr_event`, `witness_statement`) name categories the project's own rules forbid collecting. No legitimately obtainable public source publishes data in those shapes. Real public data is therefore blocked at the Zod enum, before any licensing question is reached.

---

## 3. Pipeline implementation

| Stage | Module | Approach | Model calls |
|---|---|---|---|
| Ingestion | `src/lib/ingestion/` | Manifest validation → normalisation → content-addressed ids → provenance → persist | none |
| Extraction | `src/lib/extraction/extract.ts` | Per-type structural field-read; provenance location `${recordRef}#${fieldPath}` | none |
| Entity resolution | `src/lib/resolution/resolve.ts` | Tier A shared identifier (0.95 confidence), Tier B exact name match (0.60); ambiguous never force-merged | none |
| Graph synthesis | `src/lib/graph/build.ts` | Direct edges from records; person↔person edges derived by chaining ownership + event edges, always classified `ai_inference` | none |
| Topology analytics | `src/lib/analytics/build.ts` | graphology: degree, betweenness, articulation points, Louvain, composite ranking | none |
| Spatial/temporal | `src/lib/corroboration/build.ts` | Haversine + interval overlap over persisted activity | none |
| Copilot | `src/lib/copilot/` | FTS5 + structured retrieval, then **Claude** synthesis under a strict citation contract | **yes — the only one** |
| Dossier | `src/lib/dossier/` | Deterministic assembly with write-time id verification (`verify.ts`) | none |

### Observed output, one full run against the built-in corpus

| Table | Rows |
|---|---|
| `evidence_items` | 1,820 |
| `extracted_records` | 1,996 (1,714 event · 123 relationship · 99 entity · 60 attribute mentions) |
| `entities` | **54** — 14 phone, 14 imei, 12 bank_account, **10 person**, 4 vehicle |
| `aliases` | 25 |
| `resolution_decisions` | 85 — 45 canonicalized_identifier, 23 exact_name_match, 10 shared_identifier_merge, 7 new_entity |
| `relationships` | 196 — 69 communication, 63 co_location, 38 ownership, 26 financial |
| classification split | 156 corroborated_fact, 38 ai_inference, 2 observed_fact |
| `analytical_signals` | 234 |
| `corroboration_findings` | 456 |

**Ten person entities against twelve documented actors.** The three money mules M1, M2 and M3 never become people. They appear in the corpus only as `phone_record.subscriberName` and `bank_account_record.holderName`, and neither extractor emits a person `entity_mention` from those fields (`src/lib/extraction/extract.ts:203`, `:251` and the account extractor) — they emit the identifier plus a `relationship_mention`. The laundering chain therefore exists in the graph as account-to-account transfers with no human on either end. This is a concrete, previously unrecorded defect, and it is what the new `er.mentionCoverage` metric measures.

---

## 4. Ground truth

`evidence/ground-truth/operation-darknet-delhi.ground-truth.json` — 12 expected entity merges (46 source mentions), 44 expected relationships, 18 aliases, 4 temporal correlations, 3 spatial correlations, 3 contradictions, 3 communities, 3 expected signals, 1 hidden connection, 1 must-not-merge rule, 8 canonical Copilot questions, plus `keyActors` and `moneyMulePaths`.

Two structural notes that affect any evaluator built on it:

- **Mentions are written three different ways** — `subscriber-registry:suspect:S1`, `fir:001:accused`, `witness:W1` — and one record ref can be claimed by several clusters (`fir:001` by S1 and S3). Both must be handled explicitly; see `docs/evaluation/evaluation-methodology.md` §2.
- **`expectedCommunities` overlap.** S1 and X1 each appear in two communities, so the reference is a cover, not a partition, while Louvain produces a partition. A perfect community score is impossible by construction.

Before this work, ground truth was read by `src/lib/corpus/` (the generator that wrote it) and by two assertions in `tests/unit/copilot.test.ts`. **No evaluator consumed it.**

---

## 5. Training code and local model — negative findings, stated explicitly

- **Training code:** none. No optimiser, loss, epoch loop, dataset split, checkpoint or tokenizer anywhere in `src/`, `scripts/` or `tests/`.
- **Local model:** none. No weights file, no `.onnx`, `.gguf`, `.safetensors` or `.pt`. Ollama appears in `stack-contract.md` as an emergency `Fallback` only, and is not wired up.
- **The only model** is `AI_MODEL_BASELINE = "claude-opus-5"` (`src/lib/ai/client.ts`), reached over the network.
- **Response cache:** `src/lib/ai/cache.ts` exists. Whether its composite key matches hard constraint #5 of the stack contract was **not verified** in this pass and remains open.

---

## 6. Evaluation harness — now implemented

`src/lib/evaluation/` (types, ground-truth loader, snapshot loader, six metric modules, runner, report renderer), entry point `scripts/evaluate.ts`, `npm run evaluate`, 20 unit tests in `tests/unit/evaluation.test.ts`.

19 of 21 metrics are computed; 2 are reported `NOT IMPLEMENTABLE YET` with the reason and the work needed. Exactly one metric carries a pass/fail threshold, because exactly one is fixed by the project. Results: `reports/evaluation/`.

---

## 7. Pre-existing issues found while verifying, not introduced here

1. **`npm ci` fails on a clean checkout.** `package-lock.json` is out of sync with `package.json`: `esbuild@0.28.2` and its 20+ platform packages are missing from the lock file (pulled in transitively by `vite` under `vitest`). `npm install` succeeds and rewrites the lock. **`package-lock.json` was restored to its committed state and is not part of this change** — it deserves its own commit and its own review.
2. **`npm run typecheck` fails on a clean checkout.** Five API route files reference the `RouteContext` type that Next.js only generates into `.next/types` during `next dev`/`next build`:
   `src/app/api/analytics/entities/[id]/route.ts:15`, `corroboration/findings/[id]/route.ts:17`,
   `graph/edges/[id]/route.ts:15`, `graph/nodes/[id]/route.ts:15`,
   `resolution/entities/[id]/route.ts:14`. Nothing in this change touches those files; the new
   evaluation modules typecheck clean.
3. **`node:sqlite` runs under Node 22.22** with an experimental warning, despite the stack contract naming Node 26.8.1 as the verified runtime. Useful to know: the pipeline is not actually pinned to 26.

---

## 8. What remains unverified

- The LLM response cache key (stack contract hard constraint #5).
- The dossier stage — not exercised by the evaluator, since `src/lib/dossier/verify.ts` enforces id resolvability at write time.
- The Copilot end to end — no `AI_PROVIDER_API_KEY` in the environment used for this assessment.
- Anything about behaviour on data other than this one corpus at seed 20260901.
