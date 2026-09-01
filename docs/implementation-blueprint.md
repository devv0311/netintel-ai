# NetIntel AI — Implementation Blueprint

**Status**: Planning artifact. This is the authoritative execution plan future implementation agents must follow. It is **technology-stack agnostic** — it does not select a frontend, backend, database, LLM provider, orchestration framework, or any other technology. Those decisions are delegated to a dedicated stack-selection task (Milestone M1) executed by separate specialized agents, outside the scope of this document.

This blueprint does not implement anything. It does not generate the synthetic dataset. It decomposes already-agreed contracts into an executable plan.

---

## 1. Source Contracts and Consistency Audit

This blueprint is derived from, and must not contradict, the following existing documents (read in full before this blueprint was written):

- `docs/requirements.md` — functional/non-functional requirements, evidence classification, provenance, completion definition
- `docs/data/synthetic-investigation-spec.md` — Operation DarkNet Delhi, required entity categories and volumes
- `docs/data/ground-truth-spec.md` — ground-truth content and isolation requirement
- `docs/contracts/agent-contracts.md` — the six-agent pipeline contract
- `docs/demo/demo-contract.md` — minimum winning demonstration and canonical questions
- `docs/evaluation/evaluation-spec.md` — evaluation categories and threshold policy
- `docs/progress/implementation-ledger.md` — current completion state
- `docs/repository-governance.md` — branch protection and sync protocol
- `README.md` — public-facing summary and development rules

**Audit result: no contradictions found.** Terminology (Operation DarkNet Delhi, the six agent names, evidence classification labels), required volumes (5 FIRs, 8 primary suspects, 1,000+ CDR records, 500+ financial transactions), the synthetic-only rule, the provenance/confidence model, the GitHub synchronization invariant, and the technology-neutrality of prior documents are all consistent across the six contract documents and are preserved unchanged by this blueprint. Where this blueprint proposes something not explicitly stated in those contracts (e.g. a "walking skeleton" sequencing strategy, specific task boundaries, a risk register), it is marked **Proposed** rather than presented as a pre-existing requirement.

---

## 2. How This Blueprint Is Organized

- **§3** — the milestone map (M0–M13), each with objective, deliverables, dependencies, delegable tasks, acceptance criteria, tests, visual evidence, GitHub sync, integration risks, and definition of done.
- **§4** — full task decomposition, one card per AI-delegable task, organized by the required Workstreams A–L plus the stack-selection gate (M1.1).
- **§5** — parallelization strategy.
- **§6** — critical path (must-have / should-have / stretch) and scope-cut order.
- **§7** — the 36-hour relative schedule.
- **§8** — the agent delegation matrix.
- **§9** — the GitHub progress protocol (inherited, not redefined).
- **§10** — the visual evidence protocol (inherited, not redefined).
- **§11** — the global Definition of Done.
- **§12** — the risk register.
- **§13** — scope control.
- **§14** — explicit non-goals of this document.

**Guiding principle (Proposed sequencing strategy)**: prioritize a **functioning end-to-end vertical slice** — one FIR, two or three suspects, a small handful of CDR and transaction records, pushed through all eight pipeline stages — before scaling any single stage to full sophistication or full data volume. This is Milestone M2. It exists to surface integration failures early, when they are cheap to fix, rather than after every stage has been built in isolation and full-scale data has been generated.

---

## 3. Milestone Map

| ID | Milestone | Status |
| --- | --- | --- |
| M0 | Foundation & Contracts | **Complete** (P0.x, P1.x) |
| M1 | Technology Stack Selection & Environment Bootstrap | PLANNED — delegated, out of scope here |
| M2 | Vertical Slice Walking Skeleton | PLANNED |
| M3 | Synthetic Evidence at Full Scale (Workstream A) | PLANNED |
| M4 | Ingestion & Extraction Hardening (Workstream B) | PLANNED |
| M5 | Entity Resolution (Workstream C) | PLANNED |
| M6 | Graph Synthesis (Workstream D) | PLANNED |
| M7 | Network Analytics & Spatial/Temporal Corroboration (Workstreams E, F) | PLANNED |
| M8 | Investigation Copilot (Workstream G) | PLANNED |
| M9 | Dossier / Report (Workstream H) | PLANNED |
| M10 | UI / Visual Investigation Experience (Workstream I) | PLANNED |
| M11 | Integration Hardening (Workstream J) | PLANNED |
| M12 | Evaluation (Workstream K) | PLANNED |
| M13 | Stabilization, Demo Rehearsal & Presentation (Workstream L) | PLANNED |

### M0 — Foundation & Contracts
- **Objective**: Establish the repository, governance, and the full set of implementation-neutral contracts.
- **Deliverables**: repository structure, `.gitignore`/`.env.example`, README, LICENSE, governance docs, branch protection, `docs/requirements.md` and the five downstream contract documents.
- **Dependencies**: none.
- **AI-delegable tasks**: none remaining — complete.
- **Acceptance criteria**: met (see `docs/progress/implementation-ledger.md` rows P0.1–P0.18, P1.1–P1.6).
- **Test requirements**: N/A (specification/governance work).
- **Visual-evidence requirements**: N/A (no observable application surface yet).
- **GitHub sync requirements**: met — commits `df66560`, `ca693ec`, `fea8622`.
- **Critical integration risks**: none at this stage.
- **Definition of done**: satisfied.

### M1 — Technology Stack Selection & Environment Bootstrap
- **Objective**: Select the concrete technology stack (frontend, backend, database, vector/search store if needed, LLM/AI provider, orchestration approach, hosting/dev environment) and bootstrap a minimal running skeleton project, satisfying every constraint in `docs/requirements.md` (offline-capable-enough for a demo, reproducible, modular per-stage).
- **Expected deliverables**: an architecture decision record under `docs/architecture/`, a runnable empty project skeleton, updated `.env.example` entries for any newly-required configuration categories, a CI-free local dev-run script.
- **Dependencies**: M0.
- **AI-delegable tasks**: this milestone is **explicitly out of scope for this blueprint to decompose into tasks** — technology selection belongs to a separate specialized architecture agent per the project's constraints. This blueprint only records it as a hard dependency gate for every downstream milestone.
- **Acceptance criteria**: a stack is chosen and documented with rationale; the skeleton project runs locally; no milestone below can begin implementation until this gate closes.
- **Test requirements**: skeleton project boots without error.
- **Visual-evidence requirements**: one screenshot of the running skeleton (e.g. a health-check page or CLI output) as proof M1 is unblocking.
- **GitHub sync requirements**: standard — implement → validate → commit → push → verify.
- **Critical integration risks**: a stack choice that cannot run within the verified 18 GB RAM / Apple Silicon development environment (see Risk Register §12) would block every subsequent milestone; validate resource footprint before committing to the choice.
- **Definition of done**: architecture decision recorded, skeleton runs, pushed to GitHub, verified.

### M2 — Vertical Slice Walking Skeleton (Proposed)
- **Objective**: Prove the full pipeline — evidence upload → ingestion → extraction → entity resolution → graph synthesis → topology analytics → spatial/temporal corroboration → investigation Copilot → dossier/report — works end to end on a tiny hand-authored evidence fixture (not the full Operation DarkNet Delhi dataset).
- **Expected deliverables**: a minimal fixture (1 FIR-equivalent document, 2–3 suspects, a handful of CDR/transaction records, hand-authored, clearly separate from the eventual full dataset), and a thin implementation of every pipeline stage sufficient to move that fixture through to a generated one-page report.
- **Dependencies**: M1.
- **AI-delegable tasks**: one task per stage, thin-scope versions of B1, C1, D1/D2, E1, F1, G1/G2, H1/H2 (see §4); tracked here as milestone-level integration work, not separately carded.
- **Acceptance criteria**: the fixture evidence, uploaded once, produces a report referencing at least one entity merge, one graph relationship, one analytics signal, one corroboration finding, and one Copilot-answered question — all traceable to source.
- **Test requirements**: one integration test exercising the full pipeline against the fixture.
- **Visual-evidence requirements**: one screenshot/recording per stage showing the fixture's data at that stage, per `docs/progress/visual-evidence-convention.md`.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: contract mismatches between stages (e.g. Agent 2's output shape not matching what Agent 3 expects) are far cheaper to discover here than after M3–M9 have each been built to full sophistication in isolation.
- **Definition of done**: full pipeline demonstrably works on the fixture, evidenced, committed, pushed.

### M3 — Synthetic Evidence at Full Scale (Workstream A)
- **Objective**: Generate the complete Operation DarkNet Delhi dataset at the volumes fixed in `docs/data/synthetic-investigation-spec.md`, and author the corresponding ground truth, kept isolated per `docs/data/ground-truth-spec.md` §2.
- **Expected deliverables**: 5 FIR documents, 8 primary suspects with aliases, phones, IMEIs, vehicles, bank accounts, locations, witness statements, crime events, 1,000+ CDR records, 500+ financial transactions, under `evidence/synthetic/`; ground truth under `evidence/ground-truth/`.
- **Dependencies**: M1 (needs chosen generation tooling); conceptual case design (task A1) can start immediately after M0, in parallel with M1.
- **AI-delegable tasks**: A1–A5 (§4).
- **Acceptance criteria**: every required volume in `docs/data/synthetic-investigation-spec.md` §3 is met or exceeded; every required structural property in §4 of that document (aliases, ambiguous identities, contradictions, hidden relationships, money-mule patterns, misleading relationships, temporal correlations, intermediary actors) is present and documented; ground truth exists and is not reachable by the production pipeline.
- **Test requirements**: an automated volume/schema check (counts, required fields present, internal ID consistency) run against the generated dataset.
- **Visual-evidence requirements**: a sample rendering of one FIR, one CDR excerpt, one transaction excerpt, and the entity manifest, as proof of realistic structure (not a claim of pipeline functionality).
- **GitHub sync requirements**: standard; large generated files should be reviewed against `.gitignore`/repo size norms before committing.
- **Critical integration risks**: if entity identifiers are not stable (`docs/requirements.md` §9), ground truth and evaluation silently drift from the dataset it was written against.
- **Definition of done**: dataset and ground truth generated, validated, evidenced, committed, pushed.

### M4 — Ingestion & Extraction Hardening (Workstream B)
- **Objective**: Harden the thin M2 ingestion/extraction implementation to handle the full evidence type set and volume from M3, with complete provenance, confidence, and error/warning reporting.
- **Expected deliverables**: production-quality ingestion and extraction covering every evidence type in `docs/data/synthetic-investigation-spec.md` §2.
- **Dependencies**: M2 (thin implementation exists), M3 (full dataset to harden against).
- **AI-delegable tasks**: B1–B3 (§4).
- **Acceptance criteria**: 100% of M3's evidence items are ingested (accepted or explicitly rejected with reason); every extracted item carries full provenance per `docs/requirements.md` §8.
- **Test requirements**: unit tests per evidence-type parser/extractor; one malformed-evidence test per type confirming graceful rejection.
- **Visual-evidence requirements**: ingestion status screenshot showing per-item status across the full dataset.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: an extraction change that alters output shape breaks Entity Resolution (M5) silently unless contract tests (Workstream J) catch it.
- **Definition of done**: per §11.

### M5 — Entity Resolution (Workstream C)
- **Objective**: Harden entity resolution to correctly merge the 8 suspects and their aliases, and every other entity category, at full dataset scale, matching ground truth.
- **Expected deliverables**: resolution covering person/alias, phone, IMEI, vehicle, account, and location relationships; a review queue for low-confidence merges.
- **Dependencies**: M4.
- **AI-delegable tasks**: C1–C3 (§4).
- **Acceptance criteria**: resolution output compared against ground truth (`docs/data/ground-truth-spec.md`) meets whatever precision/recall threshold is set per `docs/evaluation/evaluation-spec.md` (currently `TO BE DEFINED BEFORE IMPLEMENTATION`); every merge has provenance and justification.
- **Test requirements**: entity-resolution unit tests against known alias/duplicate fixtures from M2 and M3.
- **Visual-evidence requirements**: screenshot of a resolved-entity view showing merged mentions and justification.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: over-merging (false positives) corrupts the graph in M6 in a way that is hard to detect later; the review-queue floor must be conservative by default.
- **Definition of done**: per §11.

### M6 — Graph Synthesis (Workstream D)
- **Objective**: Assemble resolved entities and relationships into the versioned case graph, and expose graph exploration.
- **Expected deliverables**: graph construction pipeline; a queryable graph exploration capability (backend only; UI is M10).
- **Dependencies**: M5.
- **AI-delegable tasks**: D1–D3 (§4).
- **Acceptance criteria**: graph contains the designed relationships including the deliberately hidden connection(s) from M3; every edge has provenance and evidence classification; graph is versioned.
- **Test requirements**: graph-integrity tests (no orphaned/unlabeled edges); a specific test asserting the hidden relationship is recoverable.
- **Visual-evidence requirements**: a rendered graph view (even minimal) of the full case, plus one of the M2 fixture for comparison.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: choosing a graph representation that cannot scale to full-dataset size within the 18 GB RAM constraint (Risk Register §12).
- **Definition of done**: per §11.

### M7 — Network Analytics & Spatial/Temporal Corroboration (Workstreams E, F)
- **Objective**: Compute network analytics (centrality, community, path, intermediary identification) and spatial/temporal corroboration/contradiction findings over the case graph.
- **Expected deliverables**: analytics signals labeled as Algorithmic Signal; corroboration/contradiction findings labeled per `docs/requirements.md` §7, explicitly flagged as requiring human verification (never presented as legal conclusions).
- **Dependencies**: M6. E and F are internally parallelizable with each other (both depend only on M6, not on each other).
- **AI-delegable tasks**: E1–E3, F1–F3 (§4).
- **Acceptance criteria**: analytics recover the structurally significant entities/communities expected by ground truth; corroboration recovers the designed temporal correlations and contradictions.
- **Test requirements**: reproducibility test (same graph version → same signals); contradiction-detection precision/recall against ground truth's designed contradictions.
- **Visual-evidence requirements**: analytics panel screenshot with an explanation attached to at least one signal; a timeline/corroboration view screenshot.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: presenting an Algorithmic Signal or corroboration finding without its "not a legal conclusion" / "requires human verification" label anywhere in the output surface is a contract violation, not a cosmetic bug — must be tested for explicitly.
- **Definition of done**: per §11.

### M8 — Investigation Copilot (Workstream G)
- **Objective**: Implement the grounded investigation Copilot per Agent 6's contract, answering the canonical questions from `docs/demo/demo-contract.md` §3.
- **Expected deliverables**: retrieval over evidence + derived intelligence; grounded answer generation with per-claim citation, confidence, and classification; explicit "insufficient evidence" handling.
- **Dependencies**: M4 (evidence), M6 (graph), M7 (analytics/corroboration) — the Copilot grounds on all of them.
- **AI-delegable tasks**: G1–G4 (§4).
- **Acceptance criteria**: all 8 canonical questions from the demo contract are answered correctly against ground truth, each fully cited; the Copilot demonstrably refuses/hedges on a question with no supporting evidence in a dedicated test.
- **Test requirements**: one test per canonical question; one adversarial test with a question the evidence cannot answer.
- **Visual-evidence requirements**: recording of a live Q&A session covering at least 3 canonical questions.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: hallucination (fabricated evidence citation) is the single highest-severity Copilot risk (Risk Register §12) — grounding must be verified, not assumed, before this milestone is marked done.
- **Definition of done**: per §11.

### M9 — Dossier / Report (Workstream H)
- **Objective**: Generate the case report/dossier summarizing findings with full classification and traceability.
- **Expected deliverables**: report covering case summary, suspect profiles, key relationships, analytical signals, timeline, spatial evidence, financial relationships, contradictions, supporting evidence, provenance, confidence, and explicit AI-inference qualification.
- **Dependencies**: M6, M7, M8 (report may optionally include Copilot Q&A per `docs/requirements.md` §5 "Dossier/report generation").
- **AI-delegable tasks**: H1–H3 (§4).
- **Acceptance criteria**: every claim in a generated report is labeled per evidence classification and traceable to source; report generation fails loudly rather than emitting an unclassified report, per `docs/requirements.md` §4.
- **Test requirements**: a test asserting 100% of report claims carry a classification label and a source reference.
- **Visual-evidence requirements**: full report preview screenshot; side-by-side of the M2 fixture's report vs. the full-dataset report.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: report generation silently omitting the AI-inference qualification is a direct contract violation (`docs/requirements.md` §7) and must be tested for, not just reviewed.
- **Definition of done**: per §11.

### M10 — UI / Visual Investigation Experience (Workstream I)
- **Objective**: Build the user-facing surfaces needed to observe and interact with every pipeline stage, without prescribing a frontend technology in this document.
- **Expected deliverables**: command dashboard, evidence upload/dropzone, processing status view, graph visualization, suspect profile view, timeline view, spatial map view, analytics panel, Copilot interface, report preview.
- **Dependencies**: incrementally parallelizable — each surface can be built once its backing stage's contract is stable (e.g. the upload/status UI can start once M4's ingestion contract is stable, well before M8/M9 are done); final integration/polish pass depends on all of M4–M9.
- **AI-delegable tasks**: I1–I4 (§4).
- **Acceptance criteria**: every listed surface exists and reflects real pipeline output (never fabricated data); every major feature has visual evidence with a side-by-side intended-vs-implemented comparison where a reference/mock exists.
- **Test requirements**: at minimum, manual verification per `superpowers` UI-testing norms — start the app, exercise the golden path, note edge cases; automated UI tests where the chosen stack supports them.
- **Visual-evidence requirements**: full set per `docs/progress/visual-evidence-convention.md` for each surface.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: building UI against a stage's contract before that contract has stabilized causes rework; sequence each surface's start against its dependency, not against calendar time.
- **Definition of done**: per §11.

### M11 — Integration Hardening (Workstream J)
- **Objective**: Verify the full pipeline holds together under the full dataset: contracts honored end to end, errors/provenance/confidence propagate correctly, the demo is deterministic and repeatable, and failures are recoverable.
- **Expected deliverables**: end-to-end pipeline run against the full Operation DarkNet Delhi dataset; contract-conformance tests between every adjacent agent pair; a documented failure-recovery/reset procedure.
- **Dependencies**: M4–M9 functionally complete.
- **AI-delegable tasks**: J1–J3 (§4).
- **Acceptance criteria**: a full run from upload to report completes without manual intervention; re-running produces structurally identical results (reproducibility, `docs/requirements.md` §6); a deliberately induced failure at one stage is reported, not silently swallowed, and does not corrupt already-processed data.
- **Test requirements**: full end-to-end integration test suite; a chaos-style test that fails one stage deliberately.
- **Visual-evidence requirements**: recording of one complete, unattended pipeline run.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: this is where every prior milestone's undetected contract drift surfaces at once — budget real time for it (see §7), not a token pass.
- **Definition of done**: per §11.

### M12 — Evaluation (Workstream K)
- **Objective**: Measure system output against ground truth per every category in `docs/evaluation/evaluation-spec.md`.
- **Expected deliverables**: an evaluation harness comparing pipeline output to `evidence/ground-truth/`, producing a report per evaluation category.
- **Dependencies**: M3 (ground truth), M11 (stable end-to-end output to evaluate).
- **AI-delegable tasks**: K1–K3 (§4).
- **Acceptance criteria**: every category in `docs/evaluation/evaluation-spec.md` §2 is measured and reported; where a threshold is still `TO BE DEFINED BEFORE IMPLEMENTATION`, the harness reports the raw metric and flags the threshold as pending, rather than silently passing or failing.
- **Test requirements**: the evaluation harness itself is tested against a fixture with a known expected score.
- **Visual-evidence requirements**: evaluation report/dashboard screenshot.
- **GitHub sync requirements**: standard.
- **Critical integration risks**: evaluating against a ground truth the pipeline had any access to during processing invalidates the entire evaluation (`docs/data/ground-truth-spec.md` §2) — verify isolation before trusting any result.
- **Definition of done**: per §11.

### M13 — Stabilization, Demo Rehearsal & Presentation (Workstream L)
- **Objective**: Lock the demo scenario, rehearse it, capture final visual evidence, and prepare the presentation narrative.
- **Expected deliverables**: demo script, scripted question sequence with expected answers, failure fallback plan, demo reset mechanism, final evidence capture pass, presentation narrative.
- **Dependencies**: M9, M10, M11 substantially complete; M12 results available to inform honest presentation claims.
- **AI-delegable tasks**: L1–L4 (§4).
- **Acceptance criteria**: the demo has been run at least twice end to end without manual data fixes; every claim in the presentation narrative is supported by the ledger and evaluation results, not aspirational.
- **Test requirements**: two full dry-run rehearsals.
- **Visual-evidence requirements**: final evidence set for every major feature, per `docs/progress/visual-evidence-convention.md`, dated at or after the rehearsal.
- **GitHub sync requirements**: standard; this is the last milestone, so the repository must be fully synchronized at its conclusion.
- **Critical integration risks**: discovering a stage-breaking bug during rehearsal with no buffer left — this is why §7 reserves explicit stabilization time rather than scheduling feature work through hour 36.
- **Definition of done**: per §11, plus: demo rehearsed twice successfully.

---

## 4. Task Decomposition

Every task below follows the required structure. Task IDs map to the Workstream letters (A–L) fixed by the project brief. "Depends on" references other task IDs or milestone gates (e.g. `M1`).

### Workstream A — Synthetic Evidence

#### Task A1 — Case Design & Entity Manifest
**Objective**: Produce the complete design of Operation DarkNet Delhi as a structured manifest — every entity (8 suspects with roles, aliases, phones, IMEIs, vehicles, accounts, locations), every relationship (explicit and deliberately hidden), the contradiction set, the money-mule chain(s), and the misleading/noise relationships — before any record is generated.
**Inputs**: `docs/data/synthetic-investigation-spec.md` (all sections).
**Expected Outputs**: `docs/data/case-manifest.md` (or equivalent) enumerating every entity, its stable synthetic identity, and every designed relationship, cross-referenced by the structural properties required in the spec §4.
**Execution Directives**: Design top-down from narrative to data, not bottom-up from random generation; ensure every required structural property (§4 of the spec) is deliberately represented at least once, and note where in the manifest each is realized.
**Must Not**: Reference any real case, real FIR numbers, real locations tied to real incidents, or real identifier formats presented as authentic; must not generate actual records yet.
**Dependencies**: M0. Parallelizable with M1.
**Acceptance Criteria**: manifest reviewed against spec §2–§4 checklist; every required category and structural property is accounted for with a specific manifest entry.
**Tests**: a checklist-validation script confirming manifest completeness against the spec.
**Visual Evidence**: N/A (design document, not an observable feature).
**Git**: standard commit/push on manifest completion.

#### Task A2 — Core Document & Record Generation
**Objective**: Generate the 5 FIR documents and all primary structured entities (8 suspects, aliases, phones, IMEIs, vehicles, bank accounts, locations, witness statements, crime events) per the A1 manifest.
**Inputs**: A1 manifest; chosen generation tooling from M1.
**Expected Outputs**: files/records under `evidence/synthetic/` for each category, internally cross-referenced per the manifest's stable identities.
**Execution Directives**: Generate deterministically from the manifest (same manifest → same output) to satisfy the reproducibility requirement (`docs/requirements.md` §6); ensure every cross-reference (e.g. a suspect's phone number appearing correctly in later CDR generation) is consistent.
**Must Not**: Invent entities not in the manifest; use any real-world identifier format that could be mistaken for authentic (see `docs/requirements.md` §10).
**Dependencies**: A1, M1.
**Acceptance Criteria**: exactly 5 FIR documents and 8 primary suspects exist, matching the manifest; every other required category (§2 of the spec) has at least one generated instance.
**Tests**: automated count/schema validation against A1's manifest.
**Visual Evidence**: sample rendering of one FIR and one suspect profile.
**Git**: standard.

#### Task A3 — CDR Record Generation at Scale
**Objective**: Generate 1,000+ synthetic CDR records consistent with the suspects/phones from A2, encoding the designed temporal correlations and money-mule/communication patterns from A1.
**Inputs**: A1 manifest, A2 phone/suspect records.
**Expected Outputs**: 1,000+ CDR records under `evidence/synthetic/`.
**Execution Directives**: Ensure the designed temporal correlations (e.g. co-active phones near a crime event) are actually present in the generated timestamps/locations, not merely intended.
**Must Not**: Use real phone number ranges or real telecom carrier identifiers presented as authentic.
**Dependencies**: A2, M1.
**Acceptance Criteria**: record count ≥ 1,000; every designed temporal correlation from A1 is verifiably present in the data (spot-checkable).
**Tests**: count assertion; a specific test asserting the designed correlation(s) are recoverable from the raw CDR data via simple query.
**Visual Evidence**: sample CDR excerpt rendering.
**Git**: standard.

#### Task A4 — Financial Transaction Generation at Scale
**Objective**: Generate 500+ synthetic financial transactions consistent with A2's bank accounts, encoding the designed money-mule chain(s) and misleading low-value relationships from A1.
**Inputs**: A1 manifest, A2 account records.
**Expected Outputs**: 500+ transaction records under `evidence/synthetic/`.
**Execution Directives**: Ensure the money-mule path(s) designed in A1 are actually reconstructable from the transaction graph (source → intermediary account(s) → destination), and that misleading/noise transactions exist without being flagged as such anywhere in the evidence itself (the pipeline must discover them, not read a label).
**Must Not**: Use real bank identifiers, IFSC-format codes, or account-number formats presented as authentic.
**Dependencies**: A2, M1.
**Acceptance Criteria**: record count ≥ 500; the designed money-mule path(s) are reconstructable from the raw data.
**Tests**: count assertion; a path-reconstruction test against the known-designed mule chain.
**Visual Evidence**: sample transaction excerpt rendering.
**Git**: standard.

#### Task A5 — Ground Truth Authoring & Isolation Verification
**Objective**: Author the ground-truth artifact per `docs/data/ground-truth-spec.md` §3, and verify it is not reachable by any pipeline component.
**Inputs**: A1 manifest (ground truth is authored from design intent, not from generated output, per the spec's authoring requirement §4), A2–A4 generated data (to confirm ground truth references real generated IDs).
**Expected Outputs**: ground-truth files under `evidence/ground-truth/`, covering every content category in the spec §3.
**Execution Directives**: Author from the A1 manifest's design intent; cross-check against A2–A4 output only to confirm referenced IDs exist, not to derive the "correct" answer from pipeline behavior.
**Must Not**: Grant the production pipeline any read access to `evidence/ground-truth/`; must not derive ground truth from a pipeline run's output.
**Dependencies**: A1, A2, A3, A4.
**Acceptance Criteria**: every content category in the ground-truth spec §3 is present; an isolation check confirms no pipeline configuration or code path reads from `evidence/ground-truth/`.
**Tests**: an automated isolation test (e.g. static check that no ingestion/pipeline config path includes `evidence/ground-truth/`).
**Visual Evidence**: N/A (internal evaluation artifact, not a user-facing feature).
**Git**: standard.

### Workstream B — Evidence Ingestion & Extraction

#### Task B1 — Evidence Intake & Validation
**Objective**: Implement the ingestion intake surface: accept evidence items, validate format, assign stable identifiers, and produce initial provenance, per Agent 1's contract.
**Inputs**: `docs/contracts/agent-contracts.md` (Agent 1); M2 fixture for initial testing.
**Expected Outputs**: an ingestion component accepting the evidence types in `docs/data/synthetic-investigation-spec.md` §2, producing normalized items with provenance.
**Execution Directives**: Reject malformed items per-item with a specific reason; never let one bad item block a batch.
**Must Not**: Silently drop or auto-correct malformed evidence without reporting it.
**Dependencies**: M1, M2 (thin version first).
**Acceptance Criteria**: every evidence type from the spec is accepted; a deliberately malformed item per type is rejected with a specific, correct reason.
**Tests**: one accept-path and one reject-path unit test per evidence type.
**Visual Evidence**: upload/intake screen showing per-item status.
**Git**: standard.

#### Task B2 — Structured Extraction
**Objective**: Extract entities, attributes, events, and relationship mentions from each normalized evidence item, per Agent 1/downstream extraction responsibilities in `docs/requirements.md` §5.
**Inputs**: B1 output; A2–A4 evidence for full-scale testing (M4), M2 fixture for thin testing.
**Expected Outputs**: extracted candidate entities/events/relationships, each linked to source location within the originating evidence item.
**Execution Directives**: Attach exact source location (document section, record field) to every extraction, not just the source item ID.
**Must Not**: Extract without a traceable source location; must not present a partial extraction as complete.
**Dependencies**: B1.
**Acceptance Criteria**: every extracted item has a source-location reference; partial extraction is reported as partial, not silently truncated.
**Tests**: extraction-accuracy fixture tests per evidence type against known expected extractions.
**Visual Evidence**: extraction result view for one evidence item, showing highlighted source location.
**Git**: standard.

#### Task B3 — Provenance, Confidence & Error Framework
**Objective**: Implement the shared provenance/confidence/error-reporting model used by B1 and B2 (and reused by downstream agents), per `docs/requirements.md` §8.
**Inputs**: `docs/requirements.md` §8, `docs/contracts/agent-contracts.md`.
**Expected Outputs**: a reusable provenance record structure (source, location/reference, method, confidence, processing history, timestamp) attached to every item produced by B1/B2.
**Execution Directives**: Design the structure to be reusable by Agents 2–6, not ingestion-specific, since every downstream agent must also carry provenance.
**Must Not**: Design a provenance model specific to one storage technology; keep the conceptual shape reusable regardless of stack (the shape is fixed by M0's contracts; the storage of it is an M1 decision).
**Dependencies**: B1, B2, M1.
**Acceptance Criteria**: 100% of B1/B2 output items carry all six required provenance fields.
**Tests**: a schema-completeness test over B1/B2 output.
**Visual Evidence**: N/A at this task's level (surfaced through B1/B2's own visual evidence).
**Git**: standard.

### Workstream C — Entity Resolution

#### Task C1 — Candidate Generation & Blocking
**Objective**: Generate candidate entity-merge pairs across all extracted mentions (person/alias, phone, IMEI, vehicle, account, location) for downstream scoring.
**Inputs**: B2 output.
**Expected Outputs**: candidate merge pairs with a preliminary similarity signal.
**Execution Directives**: Cast a deliberately wide net at this stage (recall over precision) — final merge decisions happen in C2.
**Must Not**: Make final merge decisions in this task.
**Dependencies**: B2 (M4 for full scale; M2 fixture for thin version).
**Acceptance Criteria**: every ground-truth-designed merge pair (from A5) appears among the generated candidates.
**Tests**: recall test against A5 ground truth's expected merges.
**Visual Evidence**: N/A (internal candidate list, not user-facing).
**Git**: standard.

#### Task C2 — Resolution Scoring, Merge Decision & Review Queue
**Objective**: Score candidate pairs, decide merges above a confidence floor, and route sub-floor candidates to a review queue, with justification, per Agent 2's contract.
**Inputs**: C1 candidates.
**Expected Outputs**: resolved entities with merge confidence and justification; a review queue of low-confidence candidates.
**Execution Directives**: Set and document the confidence floor explicitly (`docs/requirements.md` §5 requires it be defined at implementation time — record the chosen value and rationale here or in an ADR).
**Must Not**: Auto-merge below the documented floor; must not silently discard a low-confidence candidate instead of queuing it.
**Dependencies**: C1.
**Acceptance Criteria**: resolution output matches or exceeds the entity-resolution precision/recall metric measured in M12 against A5 ground truth (threshold per `docs/evaluation/evaluation-spec.md`, currently `TO BE DEFINED BEFORE IMPLEMENTATION`); every merge has a justification string.
**Tests**: precision/recall test against ground truth; a review-queue population test on a deliberately ambiguous fixture pair.
**Visual Evidence**: resolved-entity screen showing a merge and its justification.
**Git**: standard.

#### Task C3 — Resolution Provenance Propagation
**Objective**: Ensure every resolved entity retains full traceability to every contributing source mention, satisfying `docs/contracts/agent-contracts.md` Agent 2's provenance requirement.
**Inputs**: C2 output.
**Expected Outputs**: resolved entities where the complete list of contributing mentions, each with its own original provenance, is retrievable.
**Execution Directives**: Verify provenance survives merge operations — merging must aggregate references, never discard them.
**Must Not**: Collapse contributing-mention provenance into a single summary that loses individual traceability.
**Dependencies**: C2.
**Acceptance Criteria**: for any resolved entity, every contributing mention's original evidence item is retrievable.
**Tests**: a round-trip test — resolve, then trace back to source for a sample of entities.
**Visual Evidence**: N/A (covered by C2's visual evidence, which should already display provenance).
**Git**: standard.

### Workstream D — Graph Synthesis

#### Task D1 — Graph Contract & Provenance Model
**Objective**: Define the concrete (but storage-technology-neutral) node/edge/provenance/evidence-classification schema graph synthesis will populate, per Agent 3's contract.
**Inputs**: `docs/contracts/agent-contracts.md` Agent 3; B3's provenance model.
**Expected Outputs**: a documented graph schema (node types, edge types, required fields including evidence classification) that D2 implements against.
**Execution Directives**: Keep the schema implementable against more than one candidate graph storage approach, since the storage technology is an M1 decision this document does not make.
**Must Not**: Bind the schema to a specific database's query language or storage model.
**Dependencies**: M1, C3.
**Acceptance Criteria**: schema covers every relationship type required in Workstream D's brief (temporal, financial, communication, location) with evidence classification and provenance fields.
**Tests**: N/A at schema-definition stage (validated by D2's tests).
**Visual Evidence**: N/A (internal schema document).
**Git**: standard.

#### Task D2 — Graph Construction Pipeline
**Objective**: Populate the D1 schema from resolved entities and relationships, producing a versioned case graph.
**Inputs**: D1 schema, C3 resolved entities and their relationships.
**Expected Outputs**: a constructed, versioned graph.
**Execution Directives**: Reject any relationship lacking supporting evidence or an explicit inference label rather than adding it as an edge, per `docs/requirements.md` §4.
**Must Not**: Add an edge without provenance; must not silently overwrite a prior graph version instead of versioning it.
**Dependencies**: D1, C3 (M6 full scale; M2 fixture thin version).
**Acceptance Criteria**: the deliberately hidden relationship from A1 is present as an edge with correct provenance; graph integrity test (Workstream J) passes with zero orphaned/unlabeled edges.
**Tests**: graph-integrity test; hidden-relationship recoverability test.
**Visual Evidence**: rendered graph screenshot (minimal is acceptable at this task's level — full visualization is M10/I2).
**Git**: standard.

#### Task D3 — Graph Exploration Capability
**Objective**: Expose a query/traversal capability over the graph (backend logic; the UI surface for it is Task I2).
**Inputs**: D2 output.
**Expected Outputs**: a capability to fetch a node's neighborhood, a path between two nodes, and an element's full provenance, sufficient for both the Copilot (M8) and the UI (M10) to consume.
**Execution Directives**: Design the query surface generically enough that both G1 (Copilot retrieval) and I2 (graph UI) can use it without stage-specific hacks.
**Must Not**: Build a query surface coupled to a specific frontend rendering library.
**Dependencies**: D2.
**Acceptance Criteria**: neighborhood, path, and provenance queries all return correct results against the M2 fixture and the full graph.
**Tests**: unit tests for each query type.
**Visual Evidence**: N/A (consumed by downstream visual tasks).
**Git**: standard.

### Workstream E — Network Analytics

#### Task E1 — Centrality, Community & Path Algorithms
**Objective**: Compute structural network signals (centrality, community detection, path analysis) over the case graph, per Agent 4's contract.
**Inputs**: D2/D3 graph.
**Expected Outputs**: signals attached to graph elements.
**Execution Directives**: Report explicitly when the graph is too small/disconnected for a meaningful result, rather than returning an empty result silently.
**Must Not**: Present a signal without an attached method/explanation.
**Dependencies**: D2 (M7).
**Acceptance Criteria**: signals recover the structurally significant entities/communities expected by A5 ground truth.
**Tests**: reproducibility test (same graph version → same signals); recall test against ground-truth-expected communities.
**Visual Evidence**: analytics panel screenshot (backend-produced data; full panel UI is I2).
**Git**: standard.

#### Task E2 — Intermediary & Suspicious-Structure Ranking
**Objective**: Rank entities by structural significance/suspicion signal (e.g. betweenness as an intermediary indicator) with explainability.
**Inputs**: E1 output.
**Expected Outputs**: a ranked list with, for each entry, the specific graph structure that produced its rank.
**Execution Directives**: Keep ranking outputs labeled as Algorithmic Signal at every point they are surfaced.
**Must Not**: Rank without an attached explanation; must not describe a rank as a determination of guilt or involvement.
**Dependencies**: E1.
**Acceptance Criteria**: the designed intermediary actor(s) from A1 rank among the top structural results.
**Tests**: a specific test asserting the designed intermediary(s) surface in the ranking.
**Visual Evidence**: N/A at this task's level (surfaced via E1/I2 visual evidence).
**Git**: standard.

#### Task E3 — Analytics Classification Guardrail
**Objective**: Enforce, at the output boundary, that every analytics result is labeled Algorithmic Signal and never phrased as an established or legal conclusion, per `docs/requirements.md` §7 and the Workstream E brief's explicit requirement.
**Inputs**: E1, E2 output surfaces.
**Expected Outputs**: a guardrail check/wrapper applied to every analytics output before it reaches the Copilot, UI, or report.
**Execution Directives**: Implement as an enforced check (e.g. schema validation requiring a classification field), not a style convention that can be forgotten.
**Must Not**: Allow any analytics output to bypass the guardrail on any output surface (UI, Copilot, report).
**Dependencies**: E1, E2.
**Acceptance Criteria**: an automated check confirms 100% of analytics outputs reaching any user-facing surface carry the Algorithmic Signal label.
**Tests**: a negative test — attempt to emit an unlabeled analytics result and confirm it is rejected.
**Visual Evidence**: N/A (a backend correctness guarantee).
**Git**: standard.

### Workstream F — Spatial & Temporal Corroboration

#### Task F1 — Event Timeline & Temporal Overlap Engine
**Objective**: Build the timeline of case events and detect temporal overlaps/correlations, per Agent 5's contract.
**Inputs**: extracted events (B2), graph (D2).
**Expected Outputs**: a timeline structure; detected temporal correlations with confidence and cited evidence.
**Execution Directives**: Report insufficient temporal data explicitly, distinct from "checked, no correlation found."
**Must Not**: Infer a correlation without citing the specific compared evidence items.
**Dependencies**: B2, D2 (M7).
**Acceptance Criteria**: designed temporal correlations from A1/A3 are recovered.
**Tests**: recall test against A5 ground-truth temporal overlaps.
**Visual Evidence**: timeline view screenshot.
**Git**: standard.

#### Task F2 — Spatial Proximity & Co-location Engine
**Objective**: Detect spatial correlations (co-location, proximity, movement patterns) where location data exists, per Agent 5's contract.
**Inputs**: extracted location data (B2), graph (D2).
**Expected Outputs**: spatial correlation findings with confidence and cited evidence.
**Execution Directives**: Treat findings as investigative signals requiring human verification, per the Workstream F brief — never present as confirmed fact.
**Must Not**: Present a spatial correlation as a Corroborated Fact unless independently supported per the evidence-classification rules in `docs/requirements.md` §7.
**Dependencies**: B2, D2 (M7).
**Acceptance Criteria**: designed spatial correlations from A1 are recovered; every finding is labeled with a "requires human verification" qualifier.
**Tests**: recall test against ground truth; a labeling-presence test.
**Visual Evidence**: spatial/map view screenshot (map rendering technology is an M1/I2 decision — this task produces the underlying data).
**Git**: standard.

#### Task F3 — Contradiction Detection
**Objective**: Detect conflicts between evidence items (statements, timestamps, locations that cannot all be true), per Agent 5's contract.
**Inputs**: extracted statements/events (B2), F1/F2 outputs.
**Expected Outputs**: contradiction findings, each citing the specific conflicting sources.
**Execution Directives**: Never silently resolve a contradiction in favor of one source — report the conflict itself.
**Must Not**: Auto-resolve a contradiction without flagging it.
**Dependencies**: B2, F1, F2.
**Acceptance Criteria**: designed contradictions from A1 are recovered without inventing spurious ones (precision and recall both measured in M12).
**Tests**: precision/recall test against A5 ground-truth contradictions.
**Visual Evidence**: contradiction view screenshot showing both conflicting sources side by side.
**Git**: standard.

### Workstream G — Investigation Copilot

#### Task G1 — Grounded Retrieval Layer
**Objective**: Build the retrieval layer the Copilot uses to gather relevant evidence and derived intelligence for a given question, per Agent 6's contract.
**Inputs**: D3 graph exploration, E/F outputs, B evidence.
**Expected Outputs**: a retrieval capability returning the specific evidence/derived-intelligence items relevant to a question, with their existing provenance intact.
**Execution Directives**: Retrieval must return items with their provenance attached — the answer-generation task (G2) must not have to re-derive it.
**Must Not**: Return retrieved items without their provenance.
**Dependencies**: D3, E1–E3, F1–F3, B2 (M8).
**Acceptance Criteria**: for each canonical question (`docs/demo/demo-contract.md` §3), retrieval surfaces the evidence ground truth says is relevant.
**Tests**: retrieval-recall test against ground-truth "expected Copilot answers" evidence citations.
**Visual Evidence**: N/A (internal to G2's user-facing evidence).
**Git**: standard.

#### Task G2 — Grounded Answer Generation
**Objective**: Generate answers to investigative questions using only retrieved evidence, with per-claim citation, confidence, and evidence classification, per Agent 6's contract.
**Inputs**: G1 retrieval output; a question.
**Expected Outputs**: an answer object with per-claim citations, confidence, and classification; an overall grounding status.
**Execution Directives**: Explicitly refuse or hedge when retrieval returns insufficient evidence for the question — this is a required behavior, not a fallback to avoid.
**Must Not**: Fabricate a citation; must not present an AI Inference claim with established-fact phrasing.
**Dependencies**: G1.
**Acceptance Criteria**: all 8 canonical questions answered correctly against ground truth's expected answers, fully cited; the adversarial "unanswerable" test question is correctly refused/hedged.
**Tests**: one test per canonical question; one adversarial insufficient-evidence test.
**Visual Evidence**: Copilot Q&A interaction recording.
**Git**: standard.

#### Task G3 — Follow-up & Reasoning Modes
**Objective**: Support follow-up questions and the specific reasoning modes called out in the Workstream G brief: relationship explanation, timeline reasoning, financial-flow reasoning, contradiction explanation.
**Inputs**: G2, plus F1–F3 and D3 for the specific reasoning-mode data.
**Expected Outputs**: Copilot responses that correctly handle a follow-up referencing a prior answer, and correctly explain a relationship, a timeline, a financial flow, or a contradiction on request.
**Execution Directives**: Reuse G1/G2's grounding and classification machinery for every reasoning mode — do not build a separate ungrounded path for follow-ups.
**Must Not**: Answer a follow-up using conversational memory alone without re-grounding in evidence.
**Dependencies**: G2.
**Acceptance Criteria**: one test per reasoning mode, each grounded and cited.
**Tests**: per-mode grounded-response tests.
**Visual Evidence**: recording of a multi-turn Q&A session including at least one follow-up.
**Git**: standard.

#### Task G4 — Anti-Hallucination Guardrail
**Objective**: Enforce, at the output boundary, that the Copilot cannot emit a claim without a valid, real citation, per the Workstream G brief's explicit "must not invent evidence" requirement.
**Inputs**: G2, G3 output surfaces.
**Expected Outputs**: an enforced check rejecting/flagging any answer containing an uncited claim or a citation that does not resolve to real evidence.
**Execution Directives**: Implement as an automated check on every answer before it reaches the user, not a prompt-level instruction alone.
**Must Not**: Rely solely on prompting/instruction-following to prevent hallucination without a verifying check.
**Dependencies**: G2, G3.
**Acceptance Criteria**: a deliberately induced hallucination attempt (adversarial test) is caught by the guardrail in 100% of test cases exercised.
**Tests**: adversarial hallucination tests (e.g. asking about an entity that doesn't exist in the case).
**Visual Evidence**: N/A (a backend correctness guarantee, though a caught-hallucination example is good demo material for L1).
**Git**: standard.

### Workstream H — Dossier / Report

#### Task H1 — Report Content Model
**Objective**: Define the report's required content sections per the Workstream H brief (case summary, suspect profiles, key relationships, analytical signals, timeline, spatial evidence, financial relationships, contradictions, supporting evidence, provenance, confidence, AI-inference qualification).
**Inputs**: Workstream H brief; `docs/requirements.md` §5 "Dossier/report generation," §7, §8.
**Expected Outputs**: a documented report schema/template (content model, not final rendering).
**Execution Directives**: Ensure every section maps to a specific upstream data source (e.g. "key relationships" maps to D2/D3 output) so H2 has a clear source for each section.
**Must Not**: Include a section with no upstream data source.
**Dependencies**: M6–M9's upstream milestones conceptually complete enough to map sources; can start once M6/M7 contracts are stable.
**Acceptance Criteria**: content model covers every required section with a mapped source.
**Tests**: N/A at this stage.
**Visual Evidence**: N/A (internal schema document).
**Git**: standard.

#### Task H2 — Report Generation & Traceability Enforcement
**Objective**: Generate the actual report from the H1 content model and live pipeline output, enforcing that every claim is classified and traceable.
**Inputs**: H1 content model; D2/D3, E1–E3, F1–F3, G outputs; B evidence.
**Expected Outputs**: a generated report for a given case run.
**Execution Directives**: Fail report generation loudly (not silently) if any claim cannot be classified or traced, per `docs/requirements.md` §4.
**Must Not**: Emit a report with any unclassified or untraceable claim.
**Dependencies**: H1, and the upstream milestones it maps to.
**Acceptance Criteria**: 100% of claims in a generated report carry a classification label and a source reference (tested automatically).
**Tests**: the 100%-traceability test described above; a forced-failure test (deliberately break one upstream source and confirm generation fails loudly rather than emitting a partial report).
**Visual Evidence**: full report preview screenshot.
**Git**: standard.

#### Task H3 — Report Export/Rendering Surface
**Objective**: Provide a rendering/export surface for the report suitable for review and demo presentation (format left to M1's stack decision).
**Inputs**: H2 output.
**Expected Outputs**: a human-readable rendered report (e.g. viewable in the UI, exportable), still carrying classification/traceability visibly.
**Execution Directives**: Preserve classification/traceability visibly in the rendered form — do not let formatting strip the labels required by H2.
**Must Not**: Render a "clean" version of the report that drops classification labels for presentation polish.
**Dependencies**: H2.
**Acceptance Criteria**: rendered report retains 100% of H2's classification/traceability labels, spot-checked.
**Tests**: a rendering-fidelity test comparing labels present before/after rendering.
**Visual Evidence**: side-by-side of the raw H2 data and the rendered H3 output.
**Git**: standard.

### Workstream I — UI / Visual Investigation Experience

*(No frontend technology is chosen by this workstream — it defines required experiences, delegated to build once M1 selects the stack.)*

#### Task I1 — Command Dashboard, Upload & Status
**Objective**: Build the dashboard, evidence upload/dropzone, and processing-status view.
**Inputs**: B1 ingestion status output.
**Expected Outputs**: a working dashboard showing case status, an upload flow, and live per-item processing status.
**Execution Directives**: Reflect real backend status at all times — no mocked or hardcoded status values once B1 exists.
**Must Not**: Display fabricated progress/status not backed by real pipeline state.
**Dependencies**: M1, B1.
**Acceptance Criteria**: uploading the M2 fixture and then the full M3 dataset both produce accurate, live status in the UI.
**Tests**: manual golden-path verification (upload → observe status) plus automated UI tests where the stack supports them.
**Visual Evidence**: screenshot of dashboard + upload + status; recording of an upload interaction.
**Git**: standard.

#### Task I2 — Graph, Profile, Timeline, Map & Analytics Views
**Objective**: Build the graph visualization, suspect profile view, timeline view, spatial map view, and analytics panel.
**Inputs**: D3 graph exploration, E1–E3 analytics, F1–F3 corroboration.
**Expected Outputs**: five working views, each reflecting live backend data with provenance/classification visible on inspection.
**Execution Directives**: Every element a user can click/inspect must show its provenance and classification per `docs/requirements.md` §7/§8 — this is a UI requirement, not optional polish.
**Must Not**: Hide or omit classification labels in these views for visual cleanliness.
**Dependencies**: D3, E1–E3, F1–F3.
**Acceptance Criteria**: each view renders correctly against both the M2 fixture and the full M3 dataset; inspecting any element surfaces its provenance/classification.
**Tests**: manual golden-path + edge-case verification per view; automated UI tests where supported.
**Visual Evidence**: screenshot per view; side-by-side comparison against any design reference used; interaction recording for graph exploration and timeline scrubbing.
**Git**: standard.

#### Task I3 — Copilot & Report Preview Interface
**Objective**: Build the Copilot chat/query interface and the report preview surface.
**Inputs**: G2–G4, H2–H3 outputs.
**Expected Outputs**: a working Copilot interaction surface and a report preview surface, both reflecting real backend output.
**Execution Directives**: Surface confidence and classification per claim directly in the Copilot UI, not only in an underlying data model the user never sees.
**Must Not**: Simplify the Copilot UI in a way that drops per-claim classification/citation visibility.
**Dependencies**: G2–G4, H2–H3.
**Acceptance Criteria**: all 8 canonical questions produce a correctly rendered, cited answer in the UI; report preview matches H3's rendered output.
**Tests**: manual verification of all 8 canonical questions through the actual UI (not just the backend API).
**Visual Evidence**: recording of a live Copilot session through the UI; report preview screenshot.
**Git**: standard.

#### Task I4 — Visual Evidence Capture Tooling & Enforcement
**Objective**: Establish the actual process/tooling used to capture screenshots and recordings for every feature above, per `docs/progress/visual-evidence-convention.md`, and verify no fabricated evidence has been introduced anywhere in the ledger.
**Inputs**: `docs/progress/visual-evidence-convention.md`; all of I1–I3.
**Expected Outputs**: a working, repeatable capture process (script or documented manual procedure) and a verification pass over existing ledger entries.
**Execution Directives**: Verify, for a sample of prior ledger visual-proof entries, that the referenced evidence is real and matches its claimed commit.
**Must Not**: Introduce or tolerate a placeholder image/recording labeled as real implementation evidence.
**Dependencies**: I1–I3 producing real features to capture.
**Acceptance Criteria**: capture process is repeatable; sample audit finds zero fabricated evidence.
**Tests**: N/A (a process/audit task).
**Visual Evidence**: N/A (this task produces the capability, not a feature to capture).
**Git**: standard.

### Workstream J — Integration

#### Task J1 — End-to-End Pipeline Wiring & Contract Conformance
**Objective**: Wire all stages together into one runnable pipeline and verify every adjacent agent-pair contract (`docs/contracts/agent-contracts.md`) is honored.
**Inputs**: all of B–H.
**Expected Outputs**: a single entry point that runs evidence through to a report; a contract-conformance test suite between each adjacent pair (B→C, C→D, D→E/F, E/F→G, G/D/E/F→H).
**Execution Directives**: Test contracts at the interface (schema/shape), not just end-to-end behavior, so a break is localized to the specific stage boundary that caused it.
**Must Not**: Rely on end-to-end tests alone to catch contract breaks — that makes root-causing a failure far slower.
**Dependencies**: M4–M9.
**Acceptance Criteria**: a full run against both the M2 fixture and the M3 dataset completes without manual intervention; every contract-conformance test passes.
**Tests**: contract-conformance suite; one full end-to-end test per dataset.
**Visual Evidence**: recording of one complete unattended run.
**Git**: standard.

#### Task J2 — Provenance, Confidence & Error Propagation
**Objective**: Verify provenance, confidence, and error/warning information survive correctly from ingestion through report, with no silent loss at any stage boundary.
**Inputs**: J1's wired pipeline.
**Expected Outputs**: a propagation-verification test confirming a known provenance chain (from a specific A2 evidence item through to a specific H2 report claim) remains fully traceable.
**Execution Directives**: Pick a specific, known item and manually trace it through every stage as the test fixture — do not rely on aggregate statistics alone.
**Must Not**: Accept "most items have provenance" as sufficient — the requirement is complete traceability for every item.
**Dependencies**: J1.
**Acceptance Criteria**: the chosen trace item's provenance is intact and correct at every stage, end to end.
**Tests**: the trace test described above, plus a 100%-coverage automated check across all items.
**Visual Evidence**: N/A (a backend correctness guarantee).
**Git**: standard.

#### Task J3 — Deterministic Demo Execution & Failure Recovery
**Objective**: Ensure the full pipeline run is deterministic and repeatable for demo purposes, and that a mid-run failure is recoverable without corrupting state.
**Inputs**: J1's wired pipeline.
**Expected Outputs**: a documented and tested reset/re-run procedure; confirmation that re-running against the same M3 dataset produces structurally identical results.
**Execution Directives**: Isolate any inherent nondeterminism (e.g. from a generative model used in the Copilot) so it does not leak into deterministic stages' outputs, per `docs/requirements.md` §6.
**Must Not**: Ship a "demo mode" that fakes determinism by hardcoding output — determinism must be real.
**Dependencies**: J1, J2.
**Acceptance Criteria**: two consecutive full runs produce structurally identical graph/analytics/corroboration output; a deliberately induced mid-run failure is recoverable via the documented procedure without data corruption.
**Tests**: repeat-run comparison test; induced-failure recovery test.
**Visual Evidence**: recording of a recovery procedure after an induced failure.
**Git**: standard.

### Workstream K — Evaluation

#### Task K1 — Ground-Truth Comparison Harness
**Objective**: Build the harness that loads ground truth (`evidence/ground-truth/`) and pipeline output and produces category-by-category comparisons, per `docs/evaluation/evaluation-spec.md`.
**Inputs**: A5 ground truth, J1's pipeline output.
**Expected Outputs**: a harness capable of running every category listed in the evaluation spec §2.
**Execution Directives**: Read ground truth only after pipeline output is finalized for the run being evaluated — never during pipeline execution (isolation requirement, `docs/data/ground-truth-spec.md` §2).
**Must Not**: Give the harness any code path that could feed ground truth back into the pipeline.
**Dependencies**: A5, J1.
**Acceptance Criteria**: harness runs against a fixture with a known expected score and reproduces it.
**Tests**: the fixture-score test described above.
**Visual Evidence**: N/A (internal tooling; results are surfaced in K2/K3's outputs).
**Git**: standard.

#### Task K2 — Per-Category Evaluators
**Objective**: Implement the specific comparison logic for each category in `docs/evaluation/evaluation-spec.md` §2 (extraction, entity resolution, relationships, graph integrity, analytics reproducibility, contradiction detection, Copilot grounding, provenance completeness, report traceability).
**Inputs**: K1 harness.
**Expected Outputs**: a metric/result per category, and an explicit "threshold pending" flag for any category whose threshold is still `TO BE DEFINED BEFORE IMPLEMENTATION`.
**Execution Directives**: Never invent a threshold to make a category appear to "pass" — report the raw metric and the pending status honestly, per `docs/evaluation/evaluation-spec.md` §3.
**Must Not**: Silently pass or fail a category with no defined threshold.
**Dependencies**: K1, M4–M9 (each category needs its corresponding stage complete).
**Acceptance Criteria**: every category in the spec produces a result; provenance completeness and report traceability (the two categories with fixed 100% thresholds) are measured and reported precisely.
**Tests**: one test per evaluator category, against a fixture with a known expected result.
**Visual Evidence**: evaluation results screenshot/report.
**Git**: standard.

#### Task K3 — Latency/Throughput Measurement
**Objective**: Measure end-to-end and per-stage processing time for the full dataset, once an implementation and target hardware exist, per `docs/evaluation/evaluation-spec.md` §2.
**Inputs**: J1's wired pipeline, running on the verified development hardware (Apple Silicon, 18 GB RAM) or the M1-selected deployment target.
**Expected Outputs**: recorded timing per stage and end-to-end for a full M3-dataset run.
**Execution Directives**: Report measured numbers only — do not set a pass/fail threshold, since none is justified yet per `docs/requirements.md` §6.
**Must Not**: Invent a latency target not supported by existing project requirements.
**Dependencies**: J1.
**Acceptance Criteria**: timing is recorded for every stage and end to end, at least once.
**Tests**: N/A (measurement, not pass/fail testing).
**Visual Evidence**: N/A (a numeric report, referenced in K2's evaluation output).
**Git**: standard.

### Workstream L — Demo & Presentation

#### Task L1 — Canonical Demo Scenario & Script
**Objective**: Write the fixed demo sequence walking through the pipeline stages and the canonical investigative questions from `docs/demo/demo-contract.md` §3, with expected answers/visual moments called out.
**Inputs**: `docs/demo/demo-contract.md`; M2–M9 working features; K2 evaluation results (to keep claims honest).
**Expected Outputs**: a demo script document.
**Execution Directives**: Base every scripted claim on an actually-passing acceptance criterion or evaluation result, not aspiration.
**Must Not**: Script a claim about a feature that has not met its Definition of Done.
**Dependencies**: M9, M10 substantially complete; K2 available.
**Acceptance Criteria**: script covers every stage of the core user journey and every canonical question.
**Tests**: N/A (a document; validated by rehearsal in L1/L2 execution).
**Visual Evidence**: N/A (the script itself; evidence is captured during rehearsal, L3).
**Git**: standard.

#### Task L2 — Failure Fallback & Demo Reset Mechanism
**Objective**: Define and implement what happens if a live demo step fails (e.g. a query returns unexpectedly), and how the demo environment is reset between rehearsals/runs.
**Inputs**: J3's reset/recovery procedure; L1 script.
**Expected Outputs**: a documented fallback for each scripted step (e.g. a pre-captured recording to fall back to) and a tested reset procedure.
**Execution Directives**: Rehearse the fallback itself at least once, not just the happy path.
**Must Not**: Rely on an untested fallback.
**Dependencies**: J3, L1.
**Acceptance Criteria**: reset procedure tested at least once; fallback exists and has been exercised for every scripted step.
**Tests**: a reset-procedure execution test.
**Visual Evidence**: N/A (procedural).
**Git**: standard.

#### Task L3 — Final Evidence Capture Pass
**Objective**: Execute a final, complete visual-evidence capture pass across every major feature, dated at or after the M13 rehearsal, per `docs/progress/visual-evidence-convention.md`.
**Inputs**: I4's capture tooling; every prior milestone's features.
**Expected Outputs**: a complete, current set of screenshots/recordings, each correctly named and referenced from `docs/progress/implementation-ledger.md`.
**Execution Directives**: Recapture anything whose underlying feature changed since its last evidence was captured — stale evidence referencing outdated behavior is not acceptable final evidence.
**Must Not**: Reuse evidence captured before a feature's last meaningful change without re-verifying it still matches.
**Dependencies**: L1, L2, and every feature milestone.
**Acceptance Criteria**: every "Completed"/"Demo Ready" ledger row has current, correctly named visual evidence.
**Tests**: N/A (an audit pass).
**Visual Evidence**: this task's output *is* the visual evidence set.
**Git**: standard.

#### Task L4 — Presentation Narrative & Q&A Preparation
**Objective**: Write the presentation narrative (what the system demonstrates and why it matters) and prepare for likely judge/reviewer questions, grounded strictly in what was actually built and measured.
**Inputs**: L1–L3, K2 evaluation results, `docs/progress/implementation-ledger.md`.
**Expected Outputs**: a presentation narrative document; a prepared Q&A brief, including honest answers about known limitations and what was explicitly deferred (per §13 Scope Control).
**Execution Directives**: State limitations plainly rather than omitting them — a reviewer question about an unimplemented stretch item should have a ready, honest answer.
**Must Not**: Claim production readiness (prohibited by `README.md`) or overstate any metric beyond what K2 measured.
**Dependencies**: L1, L3, K2.
**Acceptance Criteria**: narrative reviewed against the ledger and evaluation results for accuracy; no unsupported claim present.
**Tests**: N/A (a document).
**Visual Evidence**: N/A.
**Git**: standard.

---

## 5. Parallelization Strategy

**Parallelizable** (Proposed groupings, subject to each item's own listed dependencies):

- A1 (case design) can start immediately after M0, in parallel with M1 (stack selection).
- Once M1 closes: A2–A5 (data generation) run in parallel with M2 (walking skeleton), since the walking skeleton uses a small hand-authored fixture, not the M3 dataset.
- E (analytics) and F (corroboration) are mutually parallel once M6 (graph) is done — neither depends on the other.
- I1 (dashboard/upload/status) can start as soon as B1's contract is stable, well before G/H are done; I2's sub-views can each start as soon as their respective backing stage (D3, E, F) stabilizes, rather than waiting for all of M4–M9.
- K1 (evaluation harness scaffolding) can be built as soon as A5 ground truth exists, in parallel with M4–M9, even though K2's category evaluators need each corresponding stage done.
- Documentation/contract-validation work (cross-referencing this blueprint against contracts) is parallelizable with any implementation work throughout.

**Must remain sequential**:

- M1 → everything else (no implementation can start without a chosen stack).
- M2 (walking skeleton) should complete, or at least prove the pipeline shape works, before M4–M9 invest in full sophistication — this is the core sequencing strategy of this blueprint (§2).
- B → C → D → (E, F) → G → H, because each is a literal data dependency on the one before it (per `docs/contracts/agent-contracts.md`).
- M11 (integration hardening) requires M4–M9 functionally complete — it cannot be meaningfully parallelized earlier than that.
- M12 (evaluation) requires M11's stable output.
- M13 (rehearsal) requires M9, M10, M11 substantially complete.

---

## 6. Critical Path

**Minimum chain to a functioning demo**: M0 → M1 → M2 → (M3 in parallel with M4 start) → M4 → M5 → M6 → M7 → M8 → M9 → M10 (at least I1–I3 minimally) → M11 → M12 (at least a partial pass) → M13.

### Must-Have
- Full pipeline (ingestion → extraction → entity resolution → graph synthesis → at least one analytics signal → at least basic temporal corroboration → grounded Copilot answering all 8 canonical questions → report generation) working end to end against the full Operation DarkNet Delhi dataset.
- Full dataset at the fixed required scale: 5 FIRs, 8 suspects, 1,000+ CDRs, 500+ transactions — **this scale is a contract requirement, not a scope-cut candidate** (see §13).
- Provenance and evidence classification correct and enforced everywhere they are required by `docs/requirements.md` §7–§8.
- Visual evidence for every major feature, per the visual-evidence convention.
- GitHub synchronization maintained throughout, per §9.

### Should-Have
- Community detection and path analysis (beyond basic centrality).
- Spatial corroboration (beyond temporal).
- Money-mule path detection surfaced explicitly in analytics/UI.
- Contradiction detection with full UI presentation.
- Copilot follow-up questions and all four specific reasoning modes (G3).
- Side-by-side intended-vs-implemented UI comparisons for every view.
- Full automated evaluation harness across every category in `docs/evaluation/evaluation-spec.md`.

### Stretch
- Polished graph/spatial-map visualization beyond functional correctness.
- Latency/throughput measurement and reporting (K3).
- Non-canonical, open-ended Copilot question robustness beyond the fixed 8 questions.
- Automated UI test coverage beyond manual golden-path verification.
- Reproducibility stress-testing beyond the two-run comparison in J3.

### Scope-Cut Order (if time runs short)

If the critical path is at risk, cut in this order — **stop cutting the moment the must-have list above is achievable**:

1. Stretch items (visualization polish, K3 latency measurement, non-canonical Copilot robustness, automated UI test coverage) — cut first, cost nothing to the demo's core proof.
2. Should-have items, in reverse order of demo visibility: automated evaluation harness completeness (keep a manual/partial K2 pass) → Copilot follow-up/reasoning modes beyond direct Q&A → side-by-side UI comparisons (keep single-state screenshots) → full contradiction UI (keep backend detection + minimal display) → spatial corroboration (keep temporal only) → community/path analytics (keep centrality only).
3. **Never cut**: the required dataset scale, provenance/classification correctness, the eight canonical Copilot answers, or GitHub synchronization — these are fixed contract requirements, not scope, and cutting them would mean the demo no longer satisfies `docs/requirements.md`.

---

## 7. 36-Hour Relative Schedule

Hours are **relative and approximate**, not a rigid calendar commitment (per the brief's own instruction not to force artificial hour allocations where dependencies make them unrealistic). Ranges reflect parallel tracks.

| Hour range | Track 1 (critical path) | Track 2 (parallel) |
| --- | --- | --- |
| 0–2 | M1 — stack selection & bootstrap | A1 — case design (starts immediately, no stack dependency) |
| 2–6 | M2 — walking skeleton, all 8 stages thin | A2 — core document/record generation |
| 6–9 | M4 — ingestion/extraction hardening starts | A3, A4 — CDR & transaction generation at scale |
| 9–13 | M5 — entity resolution | A5 — ground-truth authoring (needs A2–A4 done) |
| 13–18 | M6 — graph synthesis | I1 — dashboard/upload/status UI (once B1 contract stable, from ~hour 6) |
| 18–23 | M7 — analytics (E) and corroboration (F) in parallel | I2 — graph/profile/timeline/map/analytics UI (starts once D3 stable, ~hour 18) |
| 22–27 | M8 — Copilot | K1 — evaluation harness scaffolding (once A5 ground truth exists, ~hour 13) |
| 26–29 | M9 — report | I3 — Copilot/report UI (once G2/H2 stable) |
| 28–31 | M11 — integration hardening | I4 — visual evidence tooling/audit |
| 30–33 | M12 — evaluation (K2, K3) | — |
| 32–35 | M13 — rehearsal, fallback prep, final evidence capture (L1–L3) | — |
| 35–36 | L4 — presentation narrative; final GitHub sync verification | — |

This schedule reserves the final ~1–4 hours (M13) as dedicated stabilization/rehearsal time, per the M13 milestone's explicit rationale — feature work should not be scheduled through hour 36.

---

## 8. Agent Delegation Matrix

No AI vendor or specific model is assigned — roles are generic and intended for later delegation.

| Task ID | Workstream | Specialized AI Role | Dependencies | Parallelizable | Priority | Expected Artifact |
| --- | --- | --- | --- | --- | --- | --- |
| M1.1 | (gate) | Architecture Agent | M0 | No | Must-have | Architecture decision record + skeleton |
| A1 | A | Data Design Agent | M0 | Yes (with M1) | Must-have | Case manifest |
| A2 | A | Data Generation Agent | A1, M1 | No | Must-have | FIRs, suspects, core records |
| A3 | A | Data Generation Agent | A2, M1 | Yes (with A4) | Must-have | 1,000+ CDR records |
| A4 | A | Data Generation Agent | A2, M1 | Yes (with A3) | Must-have | 500+ transactions |
| A5 | A | Data Generation / Evaluation Agent | A1–A4 | No | Must-have | Ground truth (isolated) |
| B1 | B | Backend Pipeline Agent | M1, M2 | No | Must-have | Ingestion component |
| B2 | B | Backend Pipeline Agent | B1 | No | Must-have | Extraction component |
| B3 | B | Backend Pipeline Agent | B1, B2, M1 | No | Must-have | Provenance/confidence/error model |
| C1 | C | Entity Resolution Agent | B2 | No | Must-have | Candidate merge pairs |
| C2 | C | Entity Resolution Agent | C1 | No | Must-have | Resolved entities + review queue |
| C3 | C | Entity Resolution Agent | C2 | No | Must-have | Provenance-complete resolved entities |
| D1 | D | Graph Engineering Agent | M1, C3 | No | Must-have | Graph schema |
| D2 | D | Graph Engineering Agent | D1, C3 | No | Must-have | Constructed versioned graph |
| D3 | D | Graph Engineering Agent | D2 | No | Must-have | Graph query/exploration capability |
| E1 | E | Analytics Agent | D2 | Yes (with F1–F3) | Must-have (centrality) / Should-have (community, path) | Network signals |
| E2 | E | Analytics Agent | E1 | Yes (with F) | Should-have | Intermediary ranking |
| E3 | E | Analytics Agent | E1, E2 | Yes (with F) | Must-have | Classification guardrail |
| F1 | F | Corroboration Agent | B2, D2 | Yes (with E) | Must-have | Temporal timeline/overlaps |
| F2 | F | Corroboration Agent | B2, D2 | Yes (with E, F1) | Should-have | Spatial correlations |
| F3 | F | Corroboration Agent | B2, F1, F2 | Yes (with E) | Should-have | Contradiction findings |
| G1 | G | Copilot/LLM Integration Agent | D3, E1–E3, F1–F3, B2 | No | Must-have | Retrieval layer |
| G2 | G | Copilot/LLM Integration Agent | G1 | No | Must-have | Grounded answers (8 canonical questions) |
| G3 | G | Copilot/LLM Integration Agent | G2 | No | Should-have | Follow-up/reasoning modes |
| G4 | G | Copilot/LLM Integration Agent | G2, G3 | No | Must-have | Anti-hallucination guardrail |
| H1 | H | Reporting Agent | M6/M7 stable contracts | No | Must-have | Report content model |
| H2 | H | Reporting Agent | H1, D2/D3, E, F, G | No | Must-have | Generated report |
| H3 | H | Reporting Agent | H2 | No | Must-have | Rendered/exported report |
| I1 | I | Frontend/UX Agent | M1, B1 | Yes | Must-have | Dashboard/upload/status UI |
| I2 | I | Frontend/UX Agent | D3, E, F | Yes | Should-have (polish) / Must-have (function) | Graph/profile/timeline/map/analytics UI |
| I3 | I | Frontend/UX Agent | G, H | No | Must-have | Copilot/report UI |
| I4 | I | Frontend/UX Agent | I1–I3 | Yes | Must-have | Evidence capture tooling + audit |
| J1 | J | Integration Agent | M4–M9 | No | Must-have | Wired pipeline + contract tests |
| J2 | J | Integration Agent | J1 | No | Must-have | Provenance propagation verification |
| J3 | J | Integration Agent | J1, J2 | No | Must-have | Deterministic run + recovery procedure |
| K1 | K | Evaluation Agent | A5 | Yes | Must-have | Ground-truth comparison harness |
| K2 | K | Evaluation Agent | K1, M4–M9 | No | Must-have | Per-category evaluation results |
| K3 | K | Evaluation Agent | J1 | Yes | Stretch | Latency/throughput report |
| L1 | L | Demo/Presentation Agent | M9, M10, K2 | No | Must-have | Demo script |
| L2 | L | Demo/Presentation Agent | J3, L1 | No | Must-have | Fallback + reset mechanism |
| L3 | L | Demo/Presentation Agent | L1, L2, all milestones | No | Must-have | Final evidence capture |
| L4 | L | Demo/Presentation Agent | L1, L3, K2 | No | Must-have | Presentation narrative |

---

## 9. GitHub Progress Protocol

Every task in this blueprint inherits the project's existing hard invariant (`docs/requirements.md` §12, `docs/repository-governance.md`), unchanged:

```text
Implement → validate → commit → push immediately → verify remote synchronization
```

No task in §4 is complete merely because it works locally. This blueprint does not redefine or weaken this protocol.

## 10. Visual Evidence Protocol

Every major implementation task in §4 inherits the existing requirement (`docs/requirements.md` §11, `docs/progress/visual-evidence-convention.md`), unchanged: a real implementation screenshot, a side-by-side comparison where a reference/intended state exists, an interaction recording where interaction matters, and a Git commit reference — never fabricated or placeholder evidence labeled as real. This blueprint does not redefine or weaken this protocol; Task I4 exists specifically to keep it enforced in practice.

---

## 11. Global Definition of Done

Inherited from `docs/requirements.md` §13, applied to every task and milestone in this blueprint. A feature/task is complete only when, as applicable:

- implementation exists and satisfies its task card's Acceptance Criteria;
- its upstream contract (from `docs/contracts/agent-contracts.md` or this blueprint) is satisfied;
- local validation passes;
- required tests pass;
- provenance works end to end for the item;
- visual evidence is captured (real, not fabricated) where the task has an observable surface;
- documentation is updated;
- `docs/progress/implementation-ledger.md` reflects the true current status;
- a Git commit exists with an accurate message;
- the commit is pushed to GitHub;
- remote synchronization is verified.

A task lacking any applicable item above must not be marked `Completed` in the ledger.

---

## 12. Risk Register

| Risk | Probability | Impact | Mitigation | Fallback |
| --- | --- | --- | --- | --- |
| 18 GB RAM constraint exceeded by chosen stack/data volume | Medium | High — blocks development entirely | Validate memory footprint during M1 before committing to a stack; profile early against the full M3 dataset size, not just the M2 fixture | Reduce in-memory working set (streaming/batched processing); as an absolute last resort only, reduce demo-time data loaded per view while keeping the underlying dataset at full required scale |
| AI/model inference resource requirements exceed local capacity | Medium | High — blocks Copilot/extraction | Choose inference approach in M1 with the verified hardware in mind; test resource usage against the M2 fixture before scaling to M3 | Use a smaller/hosted inference option if local resources are insufficient, chosen in M1 |
| Synthetic data complexity makes the case unsolvable or trivial | Medium | High — undermines the entire demo's premise | Validate A1's manifest against the structural-property checklist before generating data (A2–A4); dry-run ground truth against the manifest before generating records | Simplify specific structural properties (e.g. fewer simultaneous contradictions) while preserving all fixed required volumes |
| Entity-resolution ambiguity causes over- or under-merging | Medium | Medium — corrupts graph and downstream analytics | Conservative confidence floor with a review queue (C2); test against ground truth early (M5, before full-scale hardening) | Manually correct known-bad merges in the review queue before the demo; document as a known limitation in L4 |
| Graph performance degrades at full dataset scale | Medium | Medium — slows or breaks downstream stages | Test D2 against realistic scale early (during M6, not deferred to M11); choose a graph representation validated against the RAM constraint | Reduce real-time graph computation scope for the live demo (pre-compute analytics) while keeping full-scale data intact |
| Copilot hallucination (fabricated citations/claims) | Medium–High | High — directly violates a core project requirement | G4's automated anti-hallucination guardrail; adversarial testing in G2/G4 before M8 is marked done | Constrain live-demo Copilot questions to the rehearsed canonical 8 if open-ended questions prove unreliable |
| Provenance loss at a stage boundary | Medium | High — violates `docs/requirements.md` §8 directly | J2's explicit trace test on a known item through the full pipeline | Add a re-derivation/repair step for the specific broken boundary; do not ship with a known provenance gap undisclosed |
| Integration failures between independently built stages | High (if M2 is skipped) / Low (if M2 is done as scheduled) | High — blocks the entire vertical slice | M2's walking skeleton exists specifically to surface this early; J1's contract-conformance tests | Fall back to the M2 fixture for the live demo if full-scale integration is not stable in time |
| Visual-demo instability (UI breaks live) | Medium | Medium — damages presentation credibility | L2's rehearsed fallback for every scripted step; two full rehearsals required before L4 | Use L3's pre-captured recordings/screenshots in place of a live interaction for the unstable step |
| Time overruns against the 36-hour plan | Medium–High | High — incomplete demo | §6's must-have/should-have/stretch prioritization and explicit scope-cut order; M2's early-integration strategy to avoid late surprises | Execute the scope-cut order in §6 §"Scope-Cut Order," never cutting the fixed must-have list |
| Public repository security (accidental secret/PII commit) | Low (given `docs/repository-governance.md` controls) | High — public exposure | Existing secret-scanning, push protection, and `.gitignore` controls (`docs/repository-governance.md`); repeat the P0.14-style secret scan before every commit throughout implementation | Immediately rotate/invalidate any exposed credential and follow standard incident remediation if a leak occurs |
| Dependency instability (an M1-chosen library/service breaks or changes) | Low–Medium | Medium | Pin exact dependency versions once M1 selects them; avoid unpinned "latest" dependencies | Roll back to the last known-good pinned version |
| Demo-day failure (unrelated environmental issue on the day) | Low–Medium | High — no second chance | L2's fallback mechanism; L3's pre-captured evidence as a presentable substitute; test the demo on the actual presentation hardware/network before L13 if possible | Present from L3's captured recordings/screenshots as a fully disclosed fallback, narrated live |

---

## 13. Scope Control

The following must **not** be allowed to consume core implementation time unless the critical path (§6 must-have list) is already working:

- **Unnecessary advanced analytics** beyond centrality/community/path already required by Workstream E — e.g. additional graph algorithms not tied to a canonical question or ground-truth signal.
- **Excessive UI polish** beyond functional correctness and the required visual-evidence capture — animation, theming, or layout refinement beyond what's needed to demonstrate the feature clearly.
- **Nonessential automation** — e.g. CI/CD pipelines, automated deployment, or tooling not required to build, run, and demo the system within the 36-hour window.
- **Unnecessary infrastructure** — e.g. production-style multi-environment setups, infra-as-code, or scaling infrastructure irrelevant to a single local/demo run.
- **Over-complex AI orchestration** — e.g. elaborate multi-agent runtime machinery for the Copilot beyond what Agent 6's contract requires (grounded retrieval + generation + guardrail).
- **Production-grade scalability** — the system must handle the fixed required dataset scale (5 FIRs, 8 suspects, 1,000+ CDRs, 500+ transactions) correctly; it does not need to handle arbitrarily larger hypothetical scale.

**Explicitly protected from scope cuts regardless of time pressure** (see §6): the required dataset scale, provenance/evidence-classification correctness, the eight canonical Copilot answers, and GitHub synchronization. These are existing project contract requirements, not discretionary scope.

The goal, per the project brief, is **a convincing, functioning investigation workflow** — not isolated technical sophistication in any one stage.

---

## 14. Explicit Non-Goals of This Document

- This document does not select a technology stack, framework, database, LLM provider, or orchestration approach.
- This document does not implement any application code, API, UI, or agent.
- This document does not generate the Operation DarkNet Delhi dataset.
- This document does not install any application dependency.
- This document does not create Docker application services.
- Any item in this document not directly traceable to `docs/requirements.md` or its five downstream contract documents is marked **Proposed** and should be revisited if it conflicts with a future clarification of those contracts.
