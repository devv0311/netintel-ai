# CIPHER — Requirements Specification

**Status**: Authoritative functional requirements. This document is implementation-neutral: it defines *what* the system must do and *what must be true* of its outputs, never *which technology* performs the work. Technology selection is deferred to a later, dedicated phase (see `docs/architecture/README.md`).

This document supersedes informal descriptions elsewhere in the repository where they conflict; other documents (`README.md`, `docs/*/README.md`) should be read as summaries that point back here.

---

## 1. Project Objective

CIPHER demonstrates, end-to-end and on synthetic data only, how an investigative-intelligence platform can take raw case evidence and turn it into a corroborated, explainable, source-traceable picture of a case — from ingestion through entity resolution, relationship graphing, analytics, spatial/temporal corroboration, a grounded investigation copilot, and a final dossier/report. The objective is to prove the workflow and its guarantees (provenance, evidence/inference separation, explainability), not to ship a production investigative tool.

## 2. Problem Statement

Real investigations accumulate evidence from many heterogeneous sources — FIRs, call detail records (CDRs), bank/financial records, witness statements, and more — faster than an investigator can manually cross-reference. Key facts (a shared phone, an alias, a co-location, a money trail) are often buried across dozens of documents and thousands of records, sometimes assembled through synonyms, ambiguous identities, indirect relationships, and misleading noise. CIPHER demonstrates a system that ingests such evidence, extracts and resolves entities, synthesizes them into a relationship graph, applies analytics to surface signals a human might miss, corroborates or contradicts claims using spatial/temporal evidence, and lets an investigator ask grounded questions and receive answers that are traceable back to source evidence — while keeping every AI-derived conclusion clearly distinguished from verified fact.

## 3. Target User

The demonstration is built around a single persona: an **investigator/analyst** working a case who:

- receives raw, heterogeneous evidence for a case (documents, records, statements) and needs it turned into a structured, queryable picture of the case;
- needs to know, for any fact the system shows them, where it came from and how confident the system is in it;
- needs to distinguish what has been directly observed/corroborated from what the system has merely inferred or flagged as a lead;
- needs to explore relationships and networks visually, ask natural-language investigative questions, and produce a defensible summary report (dossier) at the end.

This persona is a demonstration stand-in only — no real investigator, agency, or case is represented.

## 4. Core User Journey

```text
Upload Evidence
      ↓
Ingestion
      ↓
Extraction
      ↓
Entity Resolution
      ↓
Graph Synthesis
      ↓
Analytics
      ↓
Spatial / Temporal Corroboration
      ↓
Investigation Copilot
      ↓
Dossier / Report
```

For each stage:

### Upload Evidence → Ingestion

- **Input**: raw synthetic evidence files/records (documents, CDRs, financial transactions, witness statements, etc.), each already labeled synthetic.
- **Processing responsibility**: accept, validate, and normalize incoming evidence into a consistent internal representation; assign each item a stable identifier and initial provenance record.
- **Output**: normalized evidence items with provenance attached, ready for extraction.
- **Observable status**: per-item ingestion status (accepted / rejected / needs-review), visible to the investigator.
- **Failure behavior**: malformed or unsupported evidence is rejected with a clear, item-level reason; ingestion failure of one item must not block others.
- **Provenance requirement**: original source reference, ingestion timestamp, and ingestion method are recorded and never discarded.

### Ingestion → Extraction

- **Input**: normalized evidence items.
- **Processing responsibility**: extract structured information (entities, attributes, events, mentions, relationships-in-text) from each evidence item.
- **Output**: extracted candidate entities/events/relationships, each linked back to the evidence item and location within it that produced them.
- **Observable status**: per-item extraction status and a count/summary of what was extracted.
- **Failure behavior**: partial extraction is allowed and must be reported as partial, not silently dropped or presented as complete.
- **Provenance requirement**: every extracted item carries a reference to the exact source evidence and extraction method/confidence.

### Extraction → Entity Resolution

- **Input**: extracted candidate entities (people, phones, IMEIs, vehicles, accounts, locations, etc.) across all evidence.
- **Processing responsibility**: determine which candidate entities refer to the same real-world (synthetic) entity, including across aliases and ambiguous/duplicate mentions.
- **Output**: resolved entities, each with the set of source mentions that were merged into it, a merge confidence, and justification for the merge.
- **Observable status**: resolved-entity count, pending/low-confidence merge count requiring review.
- **Failure behavior**: low-confidence merges must be surfaced as candidates for review, never silently auto-merged past a defined confidence floor (floor to be defined during implementation).
- **Provenance requirement**: every resolved entity retains the full list of contributing source mentions and evidence.

### Entity Resolution → Graph Synthesis

- **Input**: resolved entities and the relationships extracted or inferred between them.
- **Processing responsibility**: assemble entities and relationships into a connected graph structure representing the case.
- **Output**: a graph of entities (nodes) and relationships (edges), each edge carrying its supporting evidence.
- **Observable status**: graph size (node/edge counts), last-synthesis timestamp.
- **Failure behavior**: relationships without supporting evidence must not be added to the graph as if corroborated; they must be flagged per the evidence classification in §7.
- **Provenance requirement**: every node and edge is traceable to the resolved entities/evidence that produced it.

### Graph Synthesis → Analytics

- **Input**: the case graph.
- **Processing responsibility**: compute network/topology signals over the graph (e.g. centrality, communities, paths) to surface structurally significant entities and relationships.
- **Output**: analytical signals attached to graph elements, each with an explanation of what produced it.
- **Observable status**: which analyses have been run and when, against which graph version.
- **Failure behavior**: analytics that cannot complete (e.g. disconnected/too-small graph) must report why, not silently return empty results presented as "nothing found."
- **Provenance requirement**: every signal references the graph elements and algorithm/method that produced it.

### Analytics → Spatial / Temporal Corroboration

- **Input**: events, locations, timestamps, and relationships from the graph and underlying evidence.
- **Processing responsibility**: identify spatial and temporal correlations (e.g. co-location, sequence, overlap) that corroborate or contradict claims in the evidence.
- **Output**: corroboration or contradiction findings, each with the evidence references and confidence that produced it.
- **Observable status**: count of corroborations vs. contradictions found, per case.
- **Failure behavior**: insufficient spatial/temporal data must be reported as "insufficient data," not as "no contradiction found."
- **Provenance requirement**: every finding cites the specific events/evidence being compared.

### Spatial/Temporal Corroboration → Investigation Copilot

- **Input**: an investigator's natural-language investigative question, plus the full derived intelligence (entities, graph, analytics, corroboration findings) and underlying evidence.
- **Processing responsibility**: answer the question using only the case's evidence and derived intelligence, grounding the answer in specific citations.
- **Output**: a grounded answer, its supporting evidence references, a confidence level, and an evidence classification (§7) for each claim in the answer.
- **Observable status**: whether an answer was fully grounded, partially grounded, or could not be answered from available evidence.
- **Failure behavior**: when the evidence does not support an answer, the Copilot must say so rather than fabricate a plausible-sounding answer.
- **Provenance requirement**: every claim in a Copilot answer is traceable to the evidence/derived intelligence that supports it.

### Investigation Copilot → Dossier / Report

- **Input**: the case's evidence, derived intelligence, analytics, corroboration findings, and (optionally) Copilot Q&A used during the investigation.
- **Processing responsibility**: assemble a human-readable summary report of the case suitable for review.
- **Output**: a dossier/report document, with every fact/finding in it labeled per the evidence classification in §7 and traceable to its source.
- **Observable status**: report generation status and the case/graph version it was generated from.
- **Failure behavior**: a report must never present an unlabeled inference as an established fact; generation must fail loudly rather than emit an unclassified report.
- **Provenance requirement**: the report itself, or an attached appendix, must let a reader trace every claim back to originating evidence.

## 5. Functional Requirements

Requirements below describe required *capabilities*, not implementations.

### Evidence ingestion
- Must accept heterogeneous synthetic evidence types (documents, structured records, statements).
- Must assign every ingested item a stable identifier and initial provenance record.
- Must report per-item ingestion status and reject malformed items without blocking others.

### Information extraction
- Must extract entities, attributes, events, and relationship mentions from ingested evidence.
- Must attach source location (which evidence item, and where within it) to every extraction.
- Must report extraction confidence and support partial/failed extraction reporting.

### Entity resolution
- Must identify when multiple mentions (including aliases, spelling variants, and partial identifiers) refer to the same synthetic entity.
- Must produce a merge confidence and human-readable justification for every merge.
- Must retain all contributing source mentions on the resolved entity — merges must not discard evidence.
- Must surface low-confidence merges for review rather than auto-merging silently.

### Relationship extraction
- Must extract explicit relationships stated in evidence (e.g. "X called Y", "X owns account Y") and infer implicit relationships from correlated data (e.g. shared phone activity), each labeled by how it was derived.
- Must attach evidence references and confidence to every relationship.

### Graph construction
- Must assemble resolved entities and relationships into a connected graph structure.
- Must version or timestamp the graph so analytics/reports can reference the exact graph state they were computed against.
- Must never add an edge to the graph without at least one supporting evidence reference or explicit inference label.

### Graph exploration
- Must allow an investigator to browse/query the graph (entities, relationships, neighborhoods) and see the provenance of any element they inspect.

### Network/topology analytics
- Must compute structural signals over the graph (e.g. importance/centrality of an entity, groupings/communities, paths connecting two entities).
- Must explain, for each signal, what graph elements and method produced it.

### Temporal analysis
- Must identify temporal patterns relevant to the case: event sequences, overlapping time windows, and timing correlations between entities/events.
- Must flag temporal impossibilities or inconsistencies (e.g. conflicting timestamps for the same entity) as contradictions.

### Spatial analysis
- Must identify spatial patterns relevant to the case: co-location of entities/events, proximity, and movement patterns where location data exists.
- Must flag spatial impossibilities or inconsistencies as contradictions.

### Contradiction detection
- Must detect and surface conflicts between evidence items (e.g. two statements that cannot both be true, a timestamp/location combination that is physically impossible).
- Must never silently resolve a contradiction in favor of one source without flagging that a contradiction existed.

### Investigation Copilot
- Must answer natural-language investigative questions using only the case's evidence and derived intelligence.
- Must refuse or hedge when evidence is insufficient rather than fabricate an answer.
- Must classify every claim in its answer per the evidence classification in §7.

### Evidence-grounded answers
- Every Copilot answer must cite the specific evidence/derived-intelligence items that support each claim.
- An answer with no supporting evidence must be presented as ungrounded, never as a grounded fact.

### Dossier/report generation
- Must assemble a human-readable report summarizing case findings.
- Must label every claim in the report per the evidence classification in §7.
- Must be traceable, in full, back to source evidence.

## 6. Non-Functional Requirements

- **Reproducibility**: given the same synthetic evidence input, the pipeline's structural outputs (entities extracted, graph built, analytics computed) must be reproducible run-to-run; any nondeterminism (e.g. from a generative model) must be isolated and disclosed, not silently mixed into deterministic steps.
- **Deterministic synthetic demo**: the demonstration case (see `docs/data/synthetic-investigation-spec.md`) must be a fixed, versioned synthetic dataset — not regenerated randomly on every run — so the demo is repeatable.
- **Explainability**: every derived output (merge, relationship, analytic signal, corroboration/contradiction, Copilot answer) must be accompanied by a human-readable explanation of how it was produced.
- **Provenance**: see §8 — provenance is mandatory at every stage, not optional metadata.
- **Observability**: each pipeline stage must expose its status (per §4) so the investigator/operator can see what has run, what succeeded, and what failed or is pending.
- **Validation**: each stage's output must be validated before being passed downstream; invalid output must halt propagation for that item and be reported, not silently passed on.
- **Performance targets**: no numeric performance target (latency, throughput) is defined at this stage, because none is yet justified by implementation or hardware decisions. Performance requirements will be added once an architecture and target hardware are selected (see `docs/evaluation/evaluation-spec.md`, which marks this explicitly `TO BE DEFINED BEFORE IMPLEMENTATION`).
- **Graceful failure**: failure at any stage must be reported per-item/per-stage, must not corrupt already-processed data, and must never be silently swallowed.
- **Modularity**: each pipeline stage (ingestion, extraction, entity resolution, graph synthesis, analytics, corroboration, copilot, reporting) must be conceptually separable, with a defined input/output contract (see `docs/contracts/agent-contracts.md`), so stages can be implemented, tested, and replaced independently.
- **Visual demonstrability**: see §11 — every major implemented feature must be visually demonstrable and evidenced.

## 7. Evidence Classification

Every fact, finding, or answer the system produces must be labeled with exactly one of the following classifications. This classification must be visible wherever the item is displayed (graph, analytics, corroboration findings, Copilot answers, reports).

| Classification | Definition |
| --- | --- |
| **Observed Fact** | Directly stated in a single piece of source evidence, with no inference applied (e.g. "the FIR states suspect X's phone number is Y"). |
| **Corroborated Fact** | An observed fact independently supported by two or more distinct evidence sources or by spatial/temporal corroboration. |
| **Algorithmic Signal** | A structural or statistical output of an analytical method (e.g. centrality score, community membership) that describes the graph/data but is not itself a claim about the world. |
| **AI Inference** | A conclusion produced by extraction, entity resolution, relationship inference, or the Copilot that goes beyond directly observed evidence (e.g. "these two aliases likely refer to the same person"). |
| **Investigative Lead** | A suggestion for further investigation surfaced by the system (e.g. an unusual pattern worth checking) that is explicitly not a claim of fact at any confidence level. |

**It is prohibited, at every stage of the system and in every output surface, to present an Algorithmic Signal, AI Inference, or Investigative Lead as an established fact.** Established-fact language ("X is Y") is reserved for Observed Fact and Corroborated Fact; every other classification must be presented with hedged, attributed language (e.g. "the system infers...", "flagged as a possible lead...") and its confidence.

## 8. Provenance Requirements

Every extracted or derived intelligence item — entity, relationship, graph element, analytic signal, corroboration/contradiction finding, Copilot claim, or report claim — must carry provenance sufficient to trace it back to its origin. The following fields are required conceptually (no database schema is chosen here):

- **Source**: the originating evidence item(s) or upstream derived item(s).
- **Location/reference**: where within the source the item was found (e.g. document section, record ID, field).
- **Extraction/derivation method**: what process produced this item (e.g. which extraction step, which resolution rule, which analytic algorithm).
- **Confidence**: the system's confidence in the item, using a consistent scale to be defined at implementation time.
- **Processing history**: the chain of upstream items/steps that contributed to this item, sufficient to reconstruct how it was derived.
- **Timestamp**: when the item was produced/derived (distinct from any in-evidence event timestamp).

Provenance must never be discarded during merges, transformations, or summarization — it may be aggregated or referenced, but the underlying chain must remain reconstructable.

## 9. Synthetic Data Requirements

**The demonstration must use exclusively synthetic, fabricated data.** See `docs/data/synthetic-investigation-spec.md` for the canonical demonstration case and its detailed data requirements.

The demonstration must **never** use:

- real First Information Reports (FIRs)
- real Call Detail Records (CDRs)
- real bank statements
- Aadhaar or other real government identity data
- real phone numbers
- real financial identifiers
- real investigative records
- classified information

Every synthetic investigative entity (suspect, witness, account, phone, vehicle, etc.) must have a **stable synthetic identity** — a consistent synthetic identifier and attribute set that does not change between generation runs of the canonical dataset, so that ground truth, evaluation, and demos remain valid against it.

## 10. Security / Privacy Requirements

- **Secret handling**: no real credential, API key, token, or certificate may ever be committed. See `.gitignore`, `.env.example`, and `docs/repository-governance.md`.
- **Public repository constraints**: because this repository is public, nothing sensitive — real or synthetic-but-realistic-enough-to-mislead — may be committed without being unambiguously labeled synthetic.
- **Synthetic-only demonstration**: reiterated from §9 — no real investigative data of any kind.
- **No accidental PII**: synthetic entities must be generated so as not to coincide with real, identifiable individuals (e.g. avoid real phone number ranges, real Aadhaar-format numbers, real bank IFSC/account formats where avoidable) and must be clearly labeled as fictional.
- **No credentials in source**: enforced by `.gitignore` patterns and the secret-safety validation step in the project's development workflow.
- **No sensitive investigative data**: no classified, privileged, or real law-enforcement data of any kind enters the repository at any phase.

## 11. Visual Demonstration Requirements

**Every implemented major feature must have visual evidence**, per the convention in `docs/progress/visual-evidence-convention.md`. Where applicable, visual evidence must provide:

- the intended/reference state (design, spec, or prior version) where one exists;
- the implemented state as actually running;
- a side-by-side comparison between the two;
- a screenshot of the feature's working state;
- an interaction recording where interaction matters (multi-step flows, live queries);
- a reference to the implementation/Git commit the evidence corresponds to.

No fabricated or placeholder visual evidence may be labeled as implementation evidence.

## 12. GitHub Synchronization Requirement

This is a hard project invariant, unconditional on the feature or phase being worked:

```text
Implement
  → validate locally
  → commit
  → push immediately
  → verify remote synchronization
```

No accepted implementation may remain only local. GitHub is the canonical, authoritative record of project progress at all times.

## 13. Completion Definition

A feature is considered **complete** only when all of the following are true, as applicable to that feature:

- **Implementation**: the feature works as specified in this document (or its downstream contract document).
- **Validation**: local validation (tests, manual verification, or both) has been performed and passed.
- **Test evidence**: automated tests exist and pass where the feature's nature supports automated testing.
- **Visual evidence**: visual proof exists per §11, for any feature with an observable/visual surface.
- **Documentation**: the feature is documented per its relevant contract/spec document.
- **Git commit**: the work is committed with a clear, accurate commit message.
- **GitHub synchronization**: the commit is pushed and verified synchronized with `origin/master`, per §12.

A feature lacking any applicable item above is **not** complete and must not be reported as such in `docs/progress/implementation-ledger.md`.
