# Agent Contracts

**Status**: Conceptual specification only. This document defines the input/output contract for each stage of the CIPHER pipeline, independent of implementation technology. "Agent" here means a conceptual processing stage/responsibility — it does not imply any specific agent framework, orchestration technology, or runtime. That selection happens in a later, dedicated phase.

Every agent below must obey the cross-cutting requirements from `docs/requirements.md`: provenance (§8), evidence classification (§7), graceful failure (§6), and observability (§6).

---

## Agent 1 — Ingestion

**Purpose**: Accept raw synthetic evidence and normalize it into a consistent internal representation with initial provenance attached, so downstream stages have a uniform starting point regardless of original evidence format.

- **Input**: Evidence files/records (heterogeneous formats — documents, structured records, statements), each already labeled synthetic per `docs/requirements.md` §9.
- **Output**: Normalized extracted evidence items, each with provenance (source, ingestion timestamp, ingestion method), a confidence value (typically high/certain for straightforward normalization, lower where the source format required interpretation), and a list of errors/warnings encountered.
- **Required metadata**: stable item identifier; original source reference; ingestion timestamp; ingestion method/pathway.
- **Confidence behavior**: confidence reflects how faithfully the item was normalized from its original form, not the truth of its content.
- **Error behavior**: per-item — a malformed item is rejected with a specific reason and does not block other items in the same batch.
- **Provenance**: see `docs/requirements.md` §8 — required in full on every output item.
- **Downstream dependency**: feeds Agent 2 (Entity Resolution) with normalized evidence; extraction of structured entities/relationships from within each item is a distinct downstream concern (see `docs/requirements.md` §5 "Information extraction"), which may sit between ingestion and resolution.

## Agent 2 — Entity Resolution

**Purpose**: Determine which entity mentions across all evidence refer to the same real-world (synthetic) entity, including across aliases and ambiguous/duplicate mentions, and produce resolved entities.

- **Input**: Normalized entities/evidence (the extracted entity mentions produced from Agent 1's output).
- **Output**: Resolved entities, each carrying its set of candidate merges, a merge confidence, a human-readable justification for the merge, and provenance linking back to every contributing mention.
- **Required metadata**: resolved-entity identifier; list of contributing source mentions with their own provenance; merge confidence; merge justification.
- **Confidence behavior**: confidence must reflect actual merge certainty; merges below a defined confidence floor (floor to be set during implementation) must be surfaced as candidates for human review, not auto-applied.
- **Error behavior**: an entity that cannot be confidently resolved is retained as an unresolved/ambiguous entity, never dropped and never force-merged.
- **Provenance**: every resolved entity retains full traceability to every mention that was merged into it.
- **Downstream dependency**: feeds Agent 3 (Graph Synthesis) with resolved entities and the relationships identified between them.

## Agent 3 — Graph Synthesis

**Purpose**: Assemble resolved entities and their relationships into a connected graph representing the case.

- **Input**: Resolved entities and relationships (explicit and inferred, each already labeled per how they were derived).
- **Output**: Graph entities (nodes) and relationships (edges), each with provenance; a graph version/timestamp.
- **Required metadata**: node/edge identifiers; graph version/timestamp; per-edge evidence classification (`docs/requirements.md` §7).
- **Confidence behavior**: edge confidence is carried over from the relationship's own derivation confidence (Agent 2 output or extraction output); synthesis does not itself invent confidence.
- **Error behavior**: a relationship without any supporting evidence or explicit inference label must not be added as an edge; it must be reported as rejected, with reason.
- **Provenance**: every node and edge traceable to the resolved entities/evidence that produced it.
- **Downstream dependency**: feeds Agent 4 (Topology Analytics) and Agent 5 (Spatial/Temporal Corroboration) with the versioned graph.

## Agent 4 — Topology Analytics

**Purpose**: Compute network/topology signals over the case graph to surface structurally significant entities and relationships.

- **Input**: The case graph (a specific version/timestamp from Agent 3).
- **Output**: Network signals (e.g. centrality, community membership, path analysis between entities) attached to graph elements, each with a human-readable explanation of the method and inputs that produced it.
- **Required metadata**: which graph version the analysis was run against; algorithm/method identifier; explanation text.
- **Confidence behavior**: signals are labeled as Algorithmic Signal (`docs/requirements.md` §7) — they describe the graph, they are not themselves claims about the world, and must never be presented as fact.
- **Error behavior**: when the graph is too small/disconnected for a given analysis to be meaningful, the agent must report that explicitly rather than return an empty result presented as "nothing found."
- **Provenance**: every signal references the exact graph elements and method used.
- **Downstream dependency**: feeds the Investigation Copilot (Agent 6) and report generation with analytical context; may also inform Agent 5's corroboration work where topology and timing/location intersect.

## Agent 5 — Spatial/Temporal Corroboration

**Purpose**: Identify spatial and temporal correlations that corroborate or contradict claims found in evidence and the graph.

- **Input**: Events, locations, timestamps, and relationships drawn from the graph and underlying evidence.
- **Output**: Correlation and contradiction findings, each with a confidence and the specific evidence references being compared.
- **Required metadata**: finding type (corroboration / contradiction); the evidence items compared; confidence; explanation of the spatial/temporal logic applied.
- **Confidence behavior**: a corroboration raises an Observed Fact to Corroborated Fact (`docs/requirements.md` §7) only when independent evidence sources agree; a contradiction is reported as a contradiction, never silently resolved in favor of one source.
- **Error behavior**: insufficient spatial/temporal data for a comparison must be reported as "insufficient data," distinct from "checked, no contradiction found."
- **Provenance**: every finding cites the exact events/evidence compared and the method used.
- **Downstream dependency**: feeds the Investigation Copilot (Agent 6) and report generation with corroboration/contradiction context.

## Agent 6 — Investigation Copilot

**Purpose**: Answer an investigator's natural-language investigative question, grounded exclusively in the case's evidence and derived intelligence (entities, graph, analytics, corroboration findings).

- **Input**: An investigative question (natural language) plus access to the case's evidence and all derived intelligence produced by Agents 1–5.
- **Output**: A grounded answer; the specific evidence/derived-intelligence references supporting each claim in the answer; a confidence level; an evidence classification (`docs/requirements.md` §7) per claim.
- **Required metadata**: question text; answer text; per-claim citations; per-claim classification; overall grounding status (fully grounded / partially grounded / insufficient evidence).
- **Confidence behavior**: confidence and classification must be assigned per claim, not as a single blanket value for the whole answer — an answer may mix Corroborated Fact and AI Inference claims and must label them distinctly.
- **Error behavior**: when the available evidence does not support an answer, the Copilot must say so explicitly rather than produce a plausible-sounding but ungrounded answer.
- **Provenance**: every claim in the answer traceable to the evidence/derived intelligence that supports it.
- **Downstream dependency**: Copilot Q&A may optionally be included as supporting material in the dossier/report; report generation itself is a separate downstream concern from this agent (see `docs/requirements.md` §5 "Dossier/report generation").

---

## Cross-Cutting Notes

- **No implementation technology is prescribed for any agent** — not a model, not a framework, not an orchestration layer, not a data store.
- Each agent's output is the next agent's input; the pipeline order matches the core user journey in `docs/requirements.md` §4, with the understanding that "information extraction" (from that document's §5) is the structured-extraction work that sits between Agent 1's normalization and Agent 2's resolution.
- Every agent must satisfy the Completion Definition in `docs/requirements.md` §13 before being considered done.
