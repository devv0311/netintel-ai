# Investigation Copilot (P5.8)

**Status**: Implemented and verified. The Investigation Copilot answers
an investigator's natural-language question, grounded exclusively in the
already-persisted **Operation DarkNet Delhi** case: the P5.2 evidence
items, communication events and locations, the P5.3 extracted records,
the P5.4 resolved entities and aliases, the P5.5 relationships, the
P5.6 analytical signals, and the P5.7 corroboration findings.

The Copilot reads only persisted state through the validated repository —
never a file, never an upload, never `evidence/ground-truth/`. The only
thing it writes is the on-disk LLM response cache (`src/lib/ai/cache.ts`);
it never writes a domain table. It implements Agent 6 of
`docs/contracts/agent-contracts.md`, and blueprint tasks G1 (grounded
retrieval), G2 (grounded answer generation), and G4 (anti-hallucination
guardrail). G3 (multi-turn follow-up) is **not** implemented — see
§11.

---

## 1. What the Copilot is — and is not

The load-bearing design decision is that **a model never contributes a
fact**:

- Every claim an answer can make is constructed in deterministic
  TypeScript (`src/lib/copilot/retrieval.ts`) from persisted records,
  and carries the evidence classification and confidence of the record
  it cites.
- A model is handed that finished claim set and asked for **wording**.
  It sees no database identifier — only pack-local handles (`C3`,
  `EV12`, `EN4`) — so it cannot echo an id back, mint one, relabel a
  classification, or invent a confidence.
- Its output is validated and guardrail-checked before it is used at
  all. Any failure discards the model wording entirely and the
  deterministic narration of the *same* claim set is served instead,
  with the reason disclosed on the response.

The Copilot does **not**:

- **guess.** A question whose subject matches no entity returns
  `insufficient_evidence`, naming the unmatched reference back to the
  investigator; a surface matching more than one entity returns
  `ambiguous` with the candidates and composes no answer at all —
  `retrieve_evidence` and `synthesize_answer` are reported as *skipped*,
  visibly, not run on a guess.
- **resolve a conflict.** Conflicting claims are reported as unresolved
  conflicts with both sources cited.
- **assert contact or causation.** A shared cell tower, a shared time
  window, a graph path and a centrality score are none of those things,
  and phrases that would claim otherwise are rejected at the output
  boundary rather than merely discouraged in the prompt.
- **re-derive earlier stages.** It does not re-resolve identities,
  re-synthesize the graph, or recompute analytics; it reads what those
  stages persisted.

---

## 2. The nine stages

| Stage | What it does |
| --- | --- |
| `parse_question` | Trims and length-checks the question (1–500 characters), and confirms the case has the derived intelligence to ground on. |
| `ground_entities` | Matches entity, alias and identifier references in the question against resolved entities; classifies the question's intent. |
| `retrieve_evidence` | Deterministic structured retrieval over persisted evidence, extracted records, entities/aliases, graph edges, analytical signals and corroboration findings. |
| `assemble_pack` | Builds the handle-addressed evidence pack — the only view of the case a model ever sees. |
| `build_claims` | Builds the grounded claim set; each claim's classification and confidence are carried over from the record it cites. Classification enforcement (§5) runs here, before any model call. |
| `synthesize_answer` | Wording only — Claude over the claim set, cached; the deterministic narration when no model is available. |
| `validate_response` | Validates against `CopilotResponseSchema` (the strict response contract). |
| `verify_citations` | Confirms every cited id resolves to a record that is actually persisted right now. |
| `result` | Assembles the structured `CopilotResult`. |

Stage progress is streamed as it really happens (`POST /api/copilot`
emits newline-delimited events); the UI's stage list is that stream,
not a timed animation.

---

## 3. Grounding a question

`src/lib/copilot/grounding.ts` matches the question against canonical
labels, alias values, location labels and identifier strings. It calls
no model and touches no database.

- **Unknown proper-name spans are claimed first.** A name-shaped span
  that matches no entity is recorded as an unknown reference *before*
  substring matching runs, so "Priya Sharma" can never be partially
  matched to a real "Sharma" and answered as if it were her.
- **A surface matching more than one entity stays ambiguous.** Asking
  about "account 000001" in this corpus matches `SYN-SH-000001`,
  `SYN-AC-000001` and `SYN-MA-000001`; the Copilot lists all three and
  composes nothing.
- **Ten intents** drive retrieval: `suspects_overview`,
  `relationship_between`, `financial_path`, `colocation_at_event`,
  `contradictions`, `structural_significance`, `intermediary_links`,
  `case_summary`, `entity_profile`, `open_question`. Classification is
  rule-based (keyword patterns), deterministic, and model-free.

---

## 4. Deterministic retrieval

`src/lib/copilot/retrieval.ts` builds the claim set. The parts worth
calling out:

- **Account-level money chains.** A financial question traverses
  *accounts*, not people. A person-level traversal collapses a mule
  chain into a single hop and hides exactly what the question is after;
  the account-level path (`findMoneyChain`) recovers the intermediate
  `SYN-MA-*` mule accounts and names them on the route.
- **Path finding for indirect relationships.** "What direct
  relationships exist between A and B?" answers *no direct edge exists
  in the synthesized graph at version V* when there is none — a
  statement about the graph, an Algorithmic Signal — and offers the
  real multi-hop route as a separate AI Inference claim. The route is
  the shortest path a deterministic BFS finds (neighbours visited in
  sorted relationship-id order); it is not necessarily the path a human
  analyst would call the "key" one (see §8).
- **Three independent conflict checks** — travel-speed contradictions
  in the corroboration findings, attribute disagreements between
  extracted records, and witness statements whose accounts cannot both
  hold. A pair of incompatible witness statements is an **Investigative
  Lead**, never an established contradiction.
- **Classification and confidence are carried, never assigned.** A
  claim built from an extracted record is an Observed Fact at that
  record's confidence; one built from a corroboration finding is a
  Corroborated Fact or an Algorithmic Signal exactly as P5.7 classified
  it; one built from a resolution decision is an AI Inference. The
  answer-level label is the **weakest** claim in the answer — the
  reading floor, never a headline. This ordering
  (`corroborated_fact > observed_fact > algorithmic_signal >
  ai_inference > investigative_lead`) is enforced as a schema
  refinement.

---

## 5. The anti-hallucination guardrail (G4)

`src/lib/copilot/verify.ts` implements blueprint task G4 as an
automated check on every answer, not a prompt-level instruction. It is
invoked at three pipeline stages (`build_claims`, `validate_response`,
`verify_citations`):

- **Classification enforcement** (`enforceClassifications`, at
  `build_claims`, before any model is involved):
  - a fact claim must cite at least one evidential record that is
    itself a fact;
  - a `corroborated_fact` claim additionally needs two or more distinct
    evidence items, or a corroboration finding that is itself
    corroborated (`docs/requirements.md` §7);
  - an `algorithmic_signal` claim must either cite a persisted
    signal/finding or be one the retrieval layer computed itself
    (`derivation: "derived"`);
  - a claim with no evidential citation may never be a fact. Citing an
    *entity* identifies the subject of a claim; it does not evidence
    it, so entities are deliberately not evidential support.
- **Model-output validation** (`validateModelAnswer`, at
  `synthesize_answer`): schema validation, unknown citation handles,
  inline-citation presence, **fabricated literals** (identifier-,
  name-, date- and phone-shaped tokens that appear in no retrieved
  record), and **unsupported contact/causation/certainty phrasing**
  ("met with", "were together", "made contact", "because of", "proves",
  "undoubtedly", …) unless a cited claim already said so in those
  terms — checked on the answer body *and* on every caveat.
- **Output-boundary citation resolution** (`assertCitationsResolve`, at
  `verify_citations`): every id the response cites — in a claim, in the
  flattened roll-ups, in `relatedViews`, in a conflict — must resolve
  to a record that is persisted at that moment.

A guardrail failure never "repairs" the answer: the model wording is
discarded whole and the deterministic narration is served with the
rejection listed on `derivation.rejections`. A **cache hit is
re-validated through exactly the same guardrails** as a fresh response,
so a hand-edited cache entry cannot smuggle an ungrounded answer past
them.

---

## 6. Synthesis, the response contract, and the cache

Two schemas live in `src/lib/copilot/contract.ts` and are deliberately
not the same object:

- `ModelAnswerSchema` — the only thing a model may return: prose plus
  pack-local citation handles. No identifiers, no classifications, no
  confidences, no provenance.
- `CopilotResponseSchema` — the validated response the API and the UI
  see: per-claim classification, per-claim confidence, and citations
  resolved into already-persisted record ids. It never inlines an
  evidence payload; it references ids the existing endpoints resolve.

Every model call goes through the LLM response cache (`src/lib/ai/cache.ts`,
`docs/architecture/technology-stack.md` §3), keyed on a composite of:

| Component | Value |
| --- | --- |
| model / model version | `claude-opus-5` (`AI_MODEL_BASELINE`) |
| prompt version | `copilot.system.v1` (`COPILOT_PROMPT_VERSION`) |
| output schema version | `copilot.answer.v1` (`COPILOT_SCHEMA_VERSION`) |
| normalized input | whitespace-/ordering-stable form of `system prompt + user prompt` |
| generation config | `{ maxTokens: 1500, temperature: 0, extra: { effort: "medium" } }` |

A model swap, a prompt edit, a schema tightening, or a generation-config
change must therefore **miss** the cache — editing `prompt.ts` or
`contract.ts` without bumping the version constant is a bug. Entries are
bucketed on disk by prompt version so a prompt edit's stale entries can
be swept by directory. Every stored entry carries the full metadata
table the contract mandates (`model`, `modelVersion`, `promptVersion`,
`schemaVersion`, `inputHash`, `response`, `createdAt`), and a lookup
whose stored metadata disagrees with the identity is refused rather than
served.

**With no `AI_PROVIDER_API_KEY` configured** — the default for this
repository, and the state every test and every committed screenshot was
produced in — the model is never called. The evidence, the citations,
the classifications and the confidences are identical; only the prose is
the deterministic narration (`src/lib/copilot/narrate.ts`, a pure
function of the claim set), and the UI says so on the answer
(`derivation.mode = "deterministic"`, a visible "AI narration
unavailable" notice, `getCopilotState().summary.modelConfigured =
false`). A model that reports insufficiency while a grounded claim set
exists has its wording discarded — it may not overrule the deterministic
ground.

---

## 7. The eight canonical questions (full corpus)

The suggested lines of enquiry are the eight questions the project
committed to in `docs/demo/demo-contract.md` §3
(`src/lib/copilot/summary.ts`, `buildSuggestions`). The three carrying
entity placeholders are bound from the **persisted graph**, never from
`evidence/ground-truth/`:

- **q2** — the first person pair (alphabetically by canonical label)
  with no direct edge but a real ≥2-hop route.
- **q3** — the person pair joined by the longest account-level transfer
  chain.
- **q7** — the strongest structural bridge *person*.

A question whose placeholder cannot be bound is omitted rather than
shown with a dangling name.

Against the full corpus — **1,820 evidence items, 1,996 extracted
records, 54 entities, 25 aliases, 196 relationships, 234 analytical
signals, 456 corroboration findings** — all eight answer, producing
roughly **65 grounded claims across ~225 cited records**:

| # | Question (bound form) | Claims | Cited | Answer classification | Grounding |
| --- | --- | --- | --- | --- | --- |
| q1 | Who are the primary suspects, and what aliases do they use? | 17 | 51 | Observed Fact (0.95) | fully grounded |
| q2 | What direct relationships exist between *A* and *B*? | 5 | 21 | AI Inference (0.70) | partially grounded |
| q3 | Is there a financial connection between *A* and *B*, and what is the transaction path? | 6 | 34 | AI Inference (0.70) | partially grounded |
| q4 | Are there suspects whose phone activity places them at a crime event's location and time? | 11 | 40 | Algorithmic Signal (1.00) | fully grounded |
| q5 | Are there contradictions between witness statements regarding the Karol Bagh warehouse? | 10 | 38 | Investigative Lead (0.50) | fully grounded |
| q6 | Which entity has the most significant structural role in the network, and why? | 5 | 10 | Algorithmic Signal (1.00) | fully grounded |
| q7 | Is there evidence connecting *X* to more than one principal suspect? | 3 | 10 | AI Inference (0.70) | fully grounded |
| q8 | Summarize the case: what is corroborated, what remains inference or lead? | 8 | 21 | AI Inference (0.70) | fully grounded |

Exact claim/citation counts for q2, q3 and q7 depend on the graph
version they are asked against (the bound entities can differ — see §8).
The invariant, asserted by test for every one: an `answered`,
schema-valid response whose every claim is cited, carries a real
classification, and resolves against persisted ids; or, for a question
the evidence cannot support, an explicit `insufficient_evidence`
response with no claims.

---

## 8. Canonical question coverage vs the ground-truth narrative

Ground truth (`evidence/ground-truth/…ground-truth.json`, held out —
loaded only by test/eval code, only after the pipeline has produced its
output) records, for each canonical question, the *narrative* answer the
case was designed to yield. For **q1, q3, q5 and q8** the deterministic,
evidence-only Copilot reproduces that narrative:

- **q1** — all 8 principal suspects, each with an alias from `aliasMap`;
  17 Observed-Fact claims, nobody added by inference.
- **q3** — the money-mule chain the case was designed to hide:
  `SYN-AC-000001 → SYN-MA-000001 → SYN-MA-000002 → SYN-MA-000003 →
  SYN-SH-000001`, named account by account rather than collapsed to a
  person-to-person hop, classified Algorithmic Signal / derived.
- **q5** — the W3/W7 contradiction about S5 (Vikram Singh) surfaced as
  an unresolved Investigative Lead, with both statements cited and
  neither preferred.
- **q8** — the corroborated fact / AI inference / algorithmic signal
  split, with the answer-level label the weakest of them.

For **q2, q4, q6 and q7** the Copilot's answer is fully grounded,
correctly classified, completely cited and free of any fabrication or
contact/causation claim — but it does **not** reproduce ground truth's
narrative, because an evidence-only deterministic retrieval legitimately
lands elsewhere:

| # | Ground-truth narrative | What the Copilot produces | Why |
| --- | --- | --- | --- |
| q2 | S3↔S7 connected *via X1 (Rahul Mehta)*, a shared phone contact | "no direct edge" + an indirect route via a different 2-hop path (e.g. via S2) | BFS returns the shortest path in sorted-id order, not a hand-picked "key" connector. |
| q4 | S5 placed at CS-01 at crime event C1 (CDR on SYN-CT-02 ~22:05) | the co-location corroboration findings **and** the crime-event records, side by side, not joined into "S5 was at the C1 scene" | retrieval surfaces both record sets; it does not perform the finding-to-crime-scene join. |
| q6 | X1 has the highest *betweenness* — the only vendor↔courier connector | the composite structural-prominence ranking's top node (a handset / S2), plus articulation-point signals | the ranking blends betweenness (35%), degree (35%) and a bridge score (30%); its #1 need not be #1 by betweenness alone. Correctly labelled "a property of the graph, not a finding about conduct". |
| q7 | X1 (Rahul Mehta) linked to S3 and S7 by recurring CDR calls | an answer about whichever bridge *person* binds (Rohan Malhotra, Vikram Singh, …), or — when asked about X1 directly — an honest `insufficient_evidence` | `retrieveIntermediaryLinks` is gated on the subject carrying a persisted `bridge` analytical signal; X1 carries none, so the contract-correct response is to say so, not to manufacture a link. |

**q7 binding is also non-deterministic across graph re-syntheses.**
`strongestBridgePerson` tie-breaks equally-strong bridge signals on the
signal id, which is content-addressed over the graph version — so the
same case data, synthesized twice, can bind q7 to a different bridge
person. Every such binding still yields a grounded, correct answer, but
the *question text shown* is not stable. (The abandoned first P5.8
attempt changed this tie-break to the subject's canonical label; that
change is not in the codebase.) This is recorded here and in §11 as a
known limitation, not fixed under this milestone.

Reconciling the deterministic pipeline's honest output with the
ground-truth narrative — scoring recall, precision and grounding — is
the evaluation harness's job (Workstream K / M12), not the Copilot's.

---

## 9. Provenance

Every response carries the project's six-field provenance
(`docs/requirements.md` §8) plus a derivation record:

| Field | Value |
| --- | --- |
| `method` | `copilot:<intent>:<synthesis mode>`, e.g. `copilot:suspects_overview:deterministic` |
| `source` | `investigation:<id>` |
| `location` | `graph_version:<v>` — the graph version the answer was computed against |
| `confidence` | The answer-level confidence (the weakest claim's) |
| `processingHistory` | Traces back through the graph version, retrieval, synthesis and validation (≥4 entries) |
| `timestamp` | When the answer was derived |
| `derivation` | `{ mode, model, modelVersion, promptVersion, schemaVersion, cache, rejections }` |

Each claim additionally carries its own citations into persisted
records — evidence items, extracted records, entities, relationships,
analytical signals, corroboration findings — shown in the UI as the
exact record ids, so an investigator can take any one of them to the
graph, analytics or corroboration screen ("Open in graph" / "Open in
analytics" / "Open in corroboration").

---

## 10. Ground-truth isolation

No module under `src/lib/copilot/` or `src/lib/ai/` imports the
ground-truth loader (`loadInvestigationGroundTruth`, `parseGroundTruth`),
addresses `evidence/ground-truth/`, or references a ground-truth-only
field name (`aliasMap`, `moneyMulePaths`, `hiddenConnections`,
`keyActors`, `expectedCopilotAnswers`, …). This is verified two ways in
`tests/unit/copilot.test.ts`: by a source-code scan over both
directories (doc comments stripped first), and by scanning the actual
claim set and narration produced by a full-corpus run for the same
forbidden strings. The held-out answer key stays held out
(`docs/data/ground-truth-spec.md` §2).

---

## 11. Error taxonomy

Expected failures are structured and user-safe — never a stack trace,
never a filesystem path, never a raw provider error string.

| Code | When |
| --- | --- |
| `NO_INVESTIGATION` | No investigation is loaded. |
| `NO_DERIVED_INTELLIGENCE` | The graph, analytics or corroboration has not been run against the current graph version. |
| `INVALID_QUESTION` | Empty, whitespace-only, or longer than 500 characters — refused rather than silently truncated. |
| `RETRIEVAL_FAILURE` | Retrieval could not complete. |
| `VALIDATION_FAILURE` | A composed answer failed the response contract, carried a classification its records do not support, or cited a record that does not resolve — the answer is **withheld**, and shown as withheld, never as an empty result. |
| `INTERNAL_ERROR` | Anything unexpected. Nothing is asserted and nothing is persisted. |

A **model** problem is deliberately not a service failure. The
deterministic claim set still answers the question, so a model outage
degrades the prose and nothing else. It is surfaced separately as
`MODEL_NOT_CONFIGURED`, `MODEL_REQUEST_FAILED` or
`MODEL_OUTPUT_REJECTED`, alongside the answer.

---

## 12. API surface

| Route | Returns |
| --- | --- |
| `POST /api/copilot` | Newline-delimited real stage events (`{ "type": "stage", … }`); the final line is `{ "type": "result", … }` carrying the `CopilotResult`. Never cached, Node runtime. |
| `GET /api/copilot` | The current `CopilotState` — readiness, corpus counts, `model` / `promptVersion` / `schemaVersion`, `modelConfigured`, and the bound suggested questions. |

---

## 13. UI workflow

```text
corroboration synthesized  →  the sidebar's "Ask a Question" entry enables
→  the command bar: ask the case, or pick one of its eight canonical
   lines of enquiry
→  watch the real nine-stage stream
→  an answer, in a fixed reading order:
     question → answer text → classification / confidence / grounding →
     supporting evidence → provenance / derivation → related graph /
     analytics / corroboration
→  expand a claim  →  its own classification, confidence, explanation
   and the exact persisted record ids it cites
→  expand provenance  →  model, prompt version, schema version, cache
   outcome, graph version, processing history
→  "Open in graph" / "Open in analytics" / "Open in corroboration"
→  ask about an entity the case does not contain  →  insufficient
   evidence, naming the unmatched reference
→  ask about "account 000001"  →  ambiguous, with all three candidates
→  ask about contradictions  →  both sides, reported, never resolved
```

The Copilot entry enables when **corroboration** completes, which is
exactly the point at which every stage Agent 6 grounds on has run.

---

## 14. Verified test results

- **`tests/unit/copilot.test.ts`** — 105 tests. Cache composite key
  (miss on every component; property-order stable; on-disk replay;
  tamper rejection); question grounding (canonical name, alias,
  ambiguous identifier tail, unknown reference, location, intent);
  graph-traversal primitives; grounded claim construction per intent;
  classification enforcement (adversarial: fact-on-inference,
  single-item corroborated_fact, uncited fact, non-derived signal);
  anti-hallucination guardrail (adversarial: fabricated person,
  identifier, date; unsupported contact, causation, certainty; unknown
  handle; caveat smuggling); response contract; output-boundary citation
  resolution (adversarial: hallucinated evidence-item and relationship
  ids); deterministic narration; synthesis fallback (no key, provider
  failure, model hallucination, clean-answer cache + replay, tampered
  replay); ground-truth isolation (source scan + output scan); the full
  Operation DarkNet Delhi corpus (readiness and scale, all 8 canonical
  questions answered / cited / classified, money-mule recovery,
  contradictions unresolved, insufficient evidence, ambiguity, empty and
  over-long question rejection, citation resolution, reproducibility,
  no contact/causation); and **ground-truth canonical coverage** — one
  test per canonical question against `expectedCopilotAnswers` +
  `aliasMap` / `moneyMulePaths` / `contradictions` / `keyActors`, plus a
  G1 retrieval-recall test over all eight bound questions.
- **`tests/e2e/investigation-zzz-copilot.spec.ts`** — 4 real-app tests,
  no mocked network, `AI_PROVIDER_API_KEY` unset (the degraded path):
  canonical Q&A with stages, per-claim classification, citations,
  provenance and cross-navigation into the Graph screen; ambiguity,
  insufficient evidence and contradictions surfaced not guessed; three
  canonical lines of enquiry in one session each classified on its own
  evidence; reload persistence and structured refusal of an over-long
  question. Zero browser console errors.
- `tsc --noEmit`, `eslint .`, `next build` all clean.

Visual evidence: `docs/progress/evidence/P5.8/` — 11 screenshots
(initial state with the eight bound questions and the "AI narration
unavailable" notice; a grounded answer with classification / confidence
/ per-claim badges; the nine-stage list; expanded claim citations;
provenance / derivation; ambiguity; insufficient evidence; contradiction
with unresolved conflicts; the three-question session). Captured by
`CAPTURE_EVIDENCE=1 npx playwright test investigation-zzz-copilot.spec.ts`
against the real running app.

---

## 15. What downstream milestones can rely on

- **P5.9 (dossier/report)** already consumes this: a validated
  `CopilotResponse` is a report-ready unit — per-claim classification,
  per-claim confidence, resolved citations into persisted records, and
  full provenance. Q&A is included as supporting material without
  re-deriving anything, and the dossier's deterministic-narration
  fallback is this Copilot's.
- **M12 (evaluation)** owns scoring the Copilot's grounded output
  against the ground-truth narrative, including the q2 / q4 / q6 / q7
  divergences in §8.

---

## 16. Limitations

- **Wording quality without a model key is plain.** The deterministic
  narration is accurate and complete but reads as a structured rundown
  rather than prose. That is the intended trade: correctness and
  offline reproducibility over fluency.
- **No multi-turn context (G3 not implemented).** Each question is
  answered independently; there is no conversational memory, so a
  follow-up must name its subject again. The four reasoning modes the
  G3 brief names (relationship, timeline, financial-flow, contradiction
  explanation) are reachable as single-shot intents, but a follow-up
  that refers back to a previous answer is not. `docs/implementation-blueprint.md`
  §6 lists Copilot follow-up/reasoning modes beyond direct Q&A as a
  documented scope-cut.
- **q7 binding is not stable across graph re-syntheses** (§8). The bound
  question still always yields a grounded, correct answer; the question
  text shown can change.
- **Narrative divergence on q2 / q4 / q6 / q7** (§8): the answers are
  grounded, cited and correctly classified, but do not reproduce the
  ground-truth narrative, because deterministic evidence-only retrieval
  legitimately lands on a different path / ranking / subject.
- **Intent classification is rule-based.** A question phrased far from
  the ten intents falls back to `open_question`, which retrieves an
  entity profile for whatever it could ground, and reports insufficient
  evidence rather than stretch.
- **No numeric aggregation.** The Copilot cites records; it does not
  compute new statistics over them beyond the traversals in §4.
