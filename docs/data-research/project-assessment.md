# CIPHER — Project Assessment and Phase 1 Revision

**Date:** 2026-09-03
**Repository inspected:** `devv0311/netintel-ai` @ `master` (`4493a3e`, shallow clone, depth 50)
**Supersedes:** parts of `recommendation-report.md` and `source-registry.md` — see §4

This is the Section 0 / Section 3 assessment that could not be produced earlier. It also
corrects my own Phase 1 output, which was written against assumptions the codebase contradicts.

---

## 1. Current project state

| Dimension | Finding |
|---|---|
| Stack | TypeScript · Next.js 16 App Router · React 19 · SQLite (`node:sqlite`) via Drizzle 1.0-rc · graphology · sigma.js · Zod · Vitest · Playwright |
| Repo shape | 173 `.ts`, 59 `.tsx`, 39 `.md`, 8 SQL migrations, 85 screenshots, 2 recordings |
| Ledger | 33 Completed, 3 In Progress. P0–P5.9 complete; P5.10.x (UI) in progress |
| Pipeline | Seven workflows implemented end-to-end: ingestion → extraction → resolution → graph synthesis → topology analytics → spatial/temporal corroboration → Copilot → dossier |
| Corpus | `evidence/synthetic/operation-darknet-delhi.json` — 1,820 evidence items, 1,150 communication events, 560 financial transactions, 14 locations, 6 sources, ~1 MB, seeded PRNG |
| Ground truth | `evidence/ground-truth/operation-darknet-delhi.ground-truth.json` (34 KB) |
| Secrets | Exactly one — `AI_PROVIDER_API_KEY`. No key committed. `.env` git-ignored |

The engineering discipline here is high: provenance is a column not a convention, IDs are
content-addressed, migrations are versioned, every milestone has visual evidence, and the ledger
records commit hashes rather than inventing them. None of what follows is a criticism of the
build quality.

---

## 2. The finding that changes the brief

### 2.1 There is no model, and no training code

The master prompt instructed: *"Do not blindly retrain the existing model"*, *"inspect the
existing model/training code"*, *"70/15/15 splits"*, *"prepare training data"*.

**None of that applies. There is nothing to train.**

- `package.json` contains no ML dependency. No torch, no transformers, no ONNX, no `@xenova`,
  no tokenizer, no embeddings library. The only AI dependency is `@anthropic-ai/sdk`.
- No Python file, no notebook, no `requirements.txt`, no `pyproject.toml` exists in the repo.
- `src/lib/ai/client.ts` is the entire AI integration boundary: a lazily constructed Anthropic
  client with `AI_MODEL_BASELINE = "claude-opus-5"`. Inference is a remote API call.
- `docs/architecture/stack-contract.md` states the intelligence layer explicitly:
  *"AI inference — Claude API via `@anthropic-ai/sdk` (remote)"*, *"Model — `claude-opus-5`"*.
- Searching the entire documentation set for training language returns **zero** hits for
  fine-tuning, model training, dataset splits or training sets. Embeddings appear only as an
  `Optional` fallback, gated on *"only if M8 shows paraphrase recall is insufficient"*.

Phases 6, 7 and 8 of the master prompt are premised on a component that does not exist and, per
ADR-001, is deliberately not planned.

### 2.2 The pipeline stages are deterministic, not learned

This matters more than the absence of a model, because it constrains what real data could even do.

| Stage | Implementation | Evidence |
|---|---|---|
| Extraction | **Deterministic structural field-reads.** Reads named fields from an evidence item's structured `content`. Never parses free text, never compares across items. `EXTRACTION_METHOD_PREFIX = "extraction:field-read"` | `src/lib/extraction/extract.ts` |
| Entity resolution | **Deterministic two-tier.** Tier A shared identifier (phone/account/vehicle); Tier B exact name match into exactly one Tier-A cluster. Explicitly *"never by fuzzy string similarity, never by re-parsing free text"*. Ambiguous cases flagged, never force-merged | `src/lib/resolution/resolve.ts` |
| Graph synthesis | Deterministic edge construction | `src/lib/graph/` |
| Analytics | graphology — Louvain, centrality, shortest path | `src/lib/analytics/` |
| Corroboration | Haversine + interval queries in TypeScript | `src/lib/corroboration/` |
| Copilot | **The only LLM call.** Structured retrieval over SQLite FTS5, then Claude synthesis over retrieved rows with a strict citation contract | `src/lib/copilot/synthesize.ts` |

Note also that the stack contract specifies *"LLM adjudication for the ambiguous band"* in entity
resolution. **That is not implemented.** Ambiguous pairs are flagged and left unmerged. So the
one place where a learned or LLM component was planned in the extraction/resolution path is still
a spec.

### 2.3 The corpus schema is closed, and closed around prohibited data

`EVIDENCE_ITEM_TYPES` in `src/lib/domain/evidence.ts` is a Zod enum of exactly twelve types:

```
fir · suspect_record · alias_record · phone_record · imei_record · vehicle_record
bank_account_record · location_record · cdr_event · financial_transaction_record
witness_statement · crime_event
```

Ingestion accepts an uploaded JSON payload that must validate against `CorpusManifestSchema` —
the same shape `scripts/generate-corpus.ts` emits. Anything else is rejected at the schema
boundary with an `itemType` error.

**This produces a direct collision with the project's own governance rules.**

The master prompt's §1.2 prohibits collecting FIR databases, CDRs, private bank records, private
phone records and confidential case files. Those are, almost item for item, the twelve types the
pipeline is built to consume. Meanwhile no legitimately obtainable public source emits data in
those shapes — Wikidata does not publish FIRs, SEC EDGAR does not publish CDRs, GLEIF does not
publish IMEI records.

So "move from synthetic to real public data" is blocked at the **type level**, before any
licensing question arises. Either the schema generalises to accept public-data shapes, or real
data cannot enter the pipeline at all. That is an architecture decision, not a data-sourcing one.

### 2.4 The evaluation harness does not exist

`docs/evaluation/evaluation-spec.md` opens with *"Specification only. No evaluator is implemented
by this document"*. Of ten evaluation categories, **eight** carry
`Pass threshold: TO BE DEFINED BEFORE IMPLEMENTATION`.

Searching `src/` and `tests/` for precision, recall or F1 computation returns nothing beyond two
copilot test assertions and one unrelated float-rounding comment. `evidence/ground-truth/` is
read only by `src/lib/corpus/` (the generator that produced it) — **no evaluator consumes it.**

Thirty-three features are marked Completed. Zero have a measured accuracy number.

---

## 3. Missing components, ranked by consequence

1. **Evaluation harness (Workstream K).** Ground truth exists, is well-specified, and nothing
   reads it. Without it the project cannot state whether entity resolution is 60% or 95%
   accurate on its *own* synthetic case.
2. **Free-text extraction path.** Specced in the stack contract (Claude structured outputs +
   `strict: true` tools), not built. This is the prerequisite for any real document ever
   entering the system.
3. **LLM adjudication band in entity resolution.** Specced, not built.
4. **Generalisation evidence.** Every number, screenshot and behaviour comes from one seeded
   corpus generated by the same codebase that consumes it.
5. **LLM response cache verification.** `src/lib/ai/cache.ts` exists; whether the composite key
   (model + prompt version + schema version + normalized input + generation config) is correct
   was not verified in this pass. Hard constraint #5 depends on it.

---

## 4. What this invalidates in my Phase 1 output

I ranked sources partly on **free supervision** — DocRED's labelled relations, FEVER's verdict
labels, Naamapadam's NER tags, MAVEN-ERE's temporal relations. That ranking assumed a trainable
model. There isn't one. **That weighting was wrong**, and these corpora drop sharply:

| Source | Phase 1 tier | Revised | Why |
|---|---|---|---|
| DocRED / Re-DocRED | A | **D** — no use | Labelled relation training data. Nothing trains. |
| FEVER | A | **C** — eval only | Could benchmark contradiction detection *if* free-text extraction is ever built |
| Naamapadam | A | **D** — no use | Token-level NER labels for a model that does not exist |
| MAVEN-ERE | B (GPL concern) | **D** — moot | The GPL question no longer needs answering |
| KILT | B | **C** — schema only | Its provenance schema is still a good reference; the datasets are not |
| Wikidata | A | **A** — role changed | No longer ER *supervision*. Now a runtime gazetteer and a generalisation test corpus |
| GLEIF | A | **A** — role changed | Same: reference data and real name/identifier variants for testing resolution |
| SEC EDGAR | A | **B** — blocked | Genuinely useful, but only after free-text extraction exists |
| Indian court judgments | B | **B** — unchanged | Same: blocked on free-text extraction *and* the privacy policy |
| NCRB, NIBRS, GDELT | D / D / B | **unchanged** | Still the wrong shape, for the original reasons |

The one part of the earlier analysis that survives unchanged is the rejection list, and the
observation that the brief selected sources by domain resonance rather than structure. That
error simply turned out to run deeper than I identified: the mismatch is not only between the
sources and the ML tasks, it is between the sources and the pipeline's input schema.

---

## 5. Revised recommendation

**Do not collect real-world data next. It is not the binding constraint, and in this
architecture it currently has nowhere to go.**

Ordered by value:

### 5.1 Build the evaluation harness first (Workstream K)

The highest-value work in the repository right now. Ground truth is written and unused; eight
thresholds are undefined; nothing measures anything. Concretely: an evaluator that reads
pipeline output and `operation-darknet-delhi.ground-truth.json` separately, after the fact, and
reports entity-resolution precision/recall, relationship accuracy, contradiction recall,
provenance completeness (target already fixed at 100%) and Copilot grounding.

This is also the strongest demo artifact the project could produce. "Our entity resolution is
94% precision / 88% recall against ground truth, and every claim in the dossier resolves to a
row" beats any amount of OSINT plumbing in front of a jury.

### 5.2 Decide the schema question explicitly

Either:

- **(a) Keep the closed twelve-type schema.** Then the system is a demonstrator over synthetic
  or authorised police data, real public OSINT never enters, and the Phase 1 registry becomes a
  compliance artifact showing the sourcing question was properly assessed — which is worth
  having, and worth saying out loud, but is not a data pipeline.
- **(b) Generalise the schema** to accept a public-data shape (a `public_record` /
  `filing` / `registry_record` type with its own extractor). Then real data has somewhere to
  land, and the Tier A sources below become usable.

This decision gates everything else. It should not be made implicitly by starting to collect.

### 5.3 If (b): the smallest useful real-data step

Not a collection pipeline — a **generalisation test**.

Take Wikidata and GLEIF, both CC0, both small, and generate a second corpus in the existing
manifest format: real Indian companies and persons with real identifier variants, real alias
spellings, real parent/subsidiary edges. Run the *existing deterministic resolver* over it.

The question that answers is the one that actually matters: **does Tier-A identifier matching
and Tier-B exact-name matching survive contact with real-world name variation?** My expectation
is that it will not — exact name match is brittle against real transliteration variance in Indian
names, and that is a finding worth having before the demo, not after.

Cost: two SPARQL queries and one bulk file, under 300 MB, no licensing risk, no PII exposure,
no new dependency.

### 5.4 Keep the synthetic corpus exactly where it is

Reinforced by the code, not just by argument. The pipeline reads a closed schema that the
generator emits; ground truth is designed against that case; the demo contract's canonical
questions are written for it. Operation DarkNet Delhi is not a placeholder to be replaced — it
is the system's specification made executable.

---

## 6. Answers to the master prompt's Phase 7 questions

Now answerable:

| Question | Answer |
|---|---|
| What does the current model expect? | There is no model. `claude-opus-5` via remote API, used only by the Copilot for grounded synthesis over retrieved rows. |
| Current input schema? | `CorpusManifestSchema` — a closed 12-type evidence enum with structured `content` per type. |
| Current training format? | None exists. |
| Tokenizer / representation assumptions? | None. Retrieval is SQLite FTS5 + structured SQL + graph traversal. Embeddings explicitly rejected as default. |
| Current labels? | None. Ground truth exists but no evaluator consumes it. |
| Loss / objective? | None. |
| Current evaluation? | Specification only; eight of ten thresholds undefined; no evaluator implemented. |
| Are public datasets directly compatible? | **No.** Blocked at the schema enum, before licensing. |
| What preprocessing adapter is required? | A new evidence type plus its extractor, i.e. decision 5.2(b). |

---

## 7. Governance note

No commits were made. No branch was created. No data was collected. The repository was cloned
read-only for inspection; `master` is untouched and this document is delivered as a file for you
to place and commit yourself.

One observation for the ledger: if you adopt §5.1, it belongs in the ledger as a Workstream K
row before any further UI increment, since P5.10.x is presentation work layered on stages whose
accuracy is still unmeasured.
