# Dossier / Report Pipeline (P5.9)

**Status**: Implemented. This is the seventh and final investigation
workflow of the core user journey — load persisted case state → assemble
the case summary and evidence inventory → assemble key entities and key
relationships → assemble analytical signals and corroboration → assemble
contradictions and investigative leads → collect supported Copilot
material → compose the report, its classification census and its
limitations → validate against the dossier contract → verify every
finding resolves to a persisted record → persist → return a structured
result.

It implements blueprint Workstream H (tasks H1 content model, H2
generation and traceability enforcement, H3 rendering surface) and the
"Investigation Copilot → Dossier / Report" stage of
`docs/requirements.md` §4.

Everything the report contains comes from the already-persisted, fully
synthetic **Operation DarkNet Delhi** investigation. The dossier reads
only persisted rows through the validated repository layer and reuses
the existing P5.8 Copilot service for its excerpts — never a file, never
an upload, never `evidence/ground-truth/`.

---

## 1. What the dossier is — and is not

The dossier is an **assembly**, not an analysis. It runs no new
computation over the case: every substantive finding in it is read off a
row an earlier stage already persisted, and it carries that row's own
classification and confidence forward unchanged.

This distinction is the whole design. A reporting stage that could
re-derive or re-label anything would be a second, unaccountable analysis
sitting downstream of the accountable one. So the dossier:

- **never classifies anything itself** — it copies the source row's
  label;
- **never promotes a claim** — an Algorithmic Signal stays an
  Algorithmic Signal, an AI Inference stays an AI Inference, a
  contradiction stays a contradiction, and a lead stays a lead;
- **never invents** an entity, an edge, a citation, an id, or a finding;
- **never asserts** anything it cannot trace to a persisted row;
- **never reads ground truth**, so it cannot mark its own work.

## 2. Inputs

| Input | Source | Used for |
| --- | --- | --- |
| Investigation | `investigations` | Case identity, status |
| Evidence sources / items | `evidence_sources`, `evidence_items` (P5.2) | Evidence inventory |
| Extracted records | `extracted_records` (P5.3) | Fact-level references |
| Entities, aliases | `entities`, `aliases` (P5.4) | Key entities |
| Resolution decisions | `resolution_decisions` (P5.4) | Merge rationale; ambiguity leads |
| Locations | `locations` (P5.2) | Spatial anchors on findings |
| Communication events | `communication_events` (P5.2) | Corroboration supporting rows |
| Relationships | `relationships` (P5.5) | Key relationships; conflict leads |
| Analytical signals | `analytical_signals` (P5.6) | Analytical signals; entity ranking |
| Corroboration findings | `corroboration_findings` (P5.7) | Corroboration; contradictions |
| Copilot answers | `askCopilot()` (P5.8), live | Copilot-supported material |
| Graph version | `graph:<investigation>` marker (P5.5) | The exact state the report describes |

Analytical signals and corroboration findings are filtered to the
**current graph version** before anything is assembled, exactly as
`src/lib/corroboration/summary.ts` and `src/lib/copilot/load.ts` already
filter. Stale derived intelligence is never reported.

Generation requires the graph, analytics **and** corroboration to have
run against the current graph version. A report that silently omitted
them would understate the case rather than describe it, so a missing
upstream stage is a structured `NO_DERIVED_INTELLIGENCE` failure, not a
thinner report.

## 3. Report structure

Twelve sections, in this order. Four are narrative apparatus and carry
notes rather than findings; the schema enforces that they carry no
findings at all.

| # | Section | Source stage | Carries |
| --- | --- | --- | --- |
| 1 | Case summary | P5.2–P5.7 | Notes only |
| 2 | Evidence inventory | P5.2 | One finding per evidence source |
| 3 | Key entities | P5.4 + P5.6 | Top entities by the P5.6 investigative ranking |
| 4 | Key relationships | P5.5 | Strongest-evidenced edges |
| 5 | Analytical signals | P5.6 | Bridges, communities, centrality |
| 6 | Spatial & temporal corroboration | P5.7 | Non-contradiction findings |
| 7 | Contradictions | P5.7 | Detected conflicts, unresolved |
| 8 | Investigative leads & human verification | P5.4, P5.5, P5.7 | Ambiguities, edge conflicts, contradictions |
| 9 | Copilot-supported material | P5.8 | Excerpts + their per-claim findings |
| 10 | Provenance & traceability | P5.9 | Notes only |
| 11 | Classification & confidence | P5.9 | Notes only |
| 12 | Limitations & non-conclusions | P5.9 | Notes only |

### Selection limits

A dossier is a briefing, not a database dump: an investigator cannot
read 1,820 evidence rows, and a report that tried would bury the
findings that matter. Each section reports the strongest N of its kind
in a documented deterministic order, and **states the full population it
was drawn from**, so nothing is silently dropped:

| Section | Limit | Order |
| --- | --- | --- |
| Key entities | 12 | P5.6 ranking, then entity id |
| Key relationships | 15 | Classification strength → evidence count → event count → id |
| Analytical signals | 15 | Bridge → community → centrality, then score, then id |
| Corroboration | 15 | Classification strength → evidence count → id |
| Contradictions | 20 | Implied speed descending, then id |
| Leads | 15 | Ambiguities → edge conflicts → contradictions, each by id |
| Copilot claims | 6 per question | Classification strength, then claim handle |

Per-finding reference lists are capped at 25 ids each, always the
lexicographically first, with the total stated in the explanation. The
full sets stay one click away on the Evidence, Graph, Analytics and
Corroboration screens.

## 4. Classification

Every finding carries exactly one of the five classifications from
`docs/requirements.md` §7, copied from its source row. Which
classifications a section may carry is fixed structurally in
`SECTION_ALLOWED_CLASSIFICATIONS` (`src/lib/domain/dossier.ts`) — a
Zod refinement, not a convention:

| Section | Permitted |
| --- | --- |
| Evidence inventory | `observed_fact` |
| Key entities | `ai_inference` |
| Key relationships | `observed_fact`, `corroborated_fact`, `ai_inference` |
| Analytical signals | `algorithmic_signal` |
| Corroboration | `corroborated_fact`, `algorithmic_signal` |
| Contradictions | `algorithmic_signal` |
| Investigative leads | `investigative_lead` |
| Copilot material | any of the five (the claim's own) |
| Narrative sections | none — they carry no findings |

A classification upgrade is therefore not a bug to be caught in review;
it fails validation and no report is written.

**Key entities are `ai_inference` and cannot be anything else.** An
entity is entity resolution's conclusion about identity, which
`docs/requirements.md` §7 defines as AI Inference however deterministic
the matching rule was.

### Wording follows classification

Established-fact phrasing is reserved for Observed and Corroborated
Facts. Every other classification is attributed to the system that
produced it — "the system infers…", "the system computes…", "Verify…",
"Flagged…" — and the unit suite asserts it, so a future edit cannot
quietly make an inference read like a fact.

Confidence is kept separate from classification throughout: the
classification says what kind of claim this is, the confidence says how
sure the system is of it. A high confidence never upgrades an inference
into a fact. On an Investigative Lead the confidence describes how
firmly the system flags the item as worth checking — never how likely
anything is to be true.

## 5. Provenance

Every finding carries the six required fields from
`docs/requirements.md` §8, and the upstream row's own processing history
is **carried forward and appended to**, never replaced:

```text
evidence_item:evidence_item_17917b3…
  → extraction:phone_named
  → resolution:canonicalized_identifier
  → analytics:ranking:analytical_signal_5370b0e…
  → dossier:assemble
```

Every finding also cites the persisted rows it rests on, by id, across
ten reference kinds (evidence sources, evidence items, extracted
records, entities, locations, resolution decisions, communication
events, relationships, analytical signals, corroboration findings). It
never inlines a copy of an evidence payload — a copy cannot be
re-checked against the store and would drift the moment anything
upstream changed.

Reference kinds are kept separate because several upstream fields are
deliberately heterogeneous: the P5.6 analysis graph carries **locations
as nodes alongside entities**, so a community's members or a signal's
target may be either, and a P5.7 finding's `supportingRecordIds` mixes
communication events with extracted records. Ids are partitioned by the
deterministic `kind_` prefix `src/lib/domain/ids.ts` stamps on every
identifier. Filing them under one array would make an id that cannot
resolve look as though it had — the exact class of untraceable claim the
report exists to make impossible.

### Traceability enforcement

Before anything is written, `src/lib/dossier/verify.ts` checks that
every finding is classified with a label its section permits, cites at
least one persisted record, has every cited id resolve against the live
store, and carries complete provenance ending at `dossier:assemble`.

Any failure aborts the **whole report** and names the offending
findings. Blueprint H2 requires generation to "fail loudly (not
silently)" and to "not emit a report with any unclassified or
untraceable claim": a dossier that quietly dropped a contradiction would
be worse than no dossier.

This is not theatre. Writing the check before running the full corpus
caught two real modelling errors on the first real run — location ids
filed as entity ids, and communication-event ids filed as
extracted-record ids — that a laxer check would have shipped as
plausible-looking but unresolvable citations.

## 6. Determinism & idempotency

`assembleDeterministicSections()` is a pure function of the persisted
snapshot plus a caller-supplied `generatedAt`. There is no `Date.now()`,
no randomness, no model call, and no iteration over an unordered
structure without an explicit sort.

**Report identity** is a SHA-256 digest over the report body —
investigation id, graph version, every section's kind/title/summary/
notes, every finding id, and the limitations — joined with ASCII
record/unit/group separators that cannot occur in any of the values:

```text
reportVersion = dossier.v1.<first 12 hex of digest>
id            = dossier_<first 20 hex of sha256(investigationId graphVersion digest)>
```

Finding ids are themselves content-addressed over the rows they were
assembled from, so any real upstream change changes the digest.

**Excluded from the digest on purpose:**

- `generatedAt` and every provenance timestamp — when a report is
  regenerated the wall clock has moved, but the case has not, and it is
  the case the identity describes;
- the Copilot excerpts — their wording depends on whether a model was
  reachable, which is a property of the environment rather than of the
  evidence.

**Idempotency** follows from the id: `src/lib/dossier/persist.ts` looks
the id up and skips the write if it already exists. So a first
generation creates the row, a regeneration over unchanged state reuses
it and returns `already_generated` with `{created: 0, skipped: 1}`, and
the marker keeps pointing at the **original** generation time — the
report was reused, not rewritten.

Reports are never updated in place. A dossier is a point-in-time
statement about a case; rewriting one would destroy the record of what
was reported when.

**A new graph version produces a new report**, never a silent overwrite
of one describing a state that no longer exists.

Note that whether an AI provider key is configured *does* affect the
digest, because the report's stated limitations differ between the two
cases. That is intended: the report says something different about
itself, so it is a different report. Within a fixed environment,
regeneration is exactly idempotent.

### Staleness

A report is stamped with the graph version it describes. Once graph
synthesis runs again, the previous report becomes **stale**: it is kept
for audit, `GET /api/dossier` reports `status: "stale"`, and the UI
banners it rather than presenting it as current.

## 7. Contradiction handling

Contradictions are **reported and left unresolved**. The dossier does
not decide which of two conflicting sources is correct, and including a
contradiction is not a judgement against either source.

- Every contradiction is an **Algorithmic Signal**, enforced by both the
  P5.7 corroboration contract and this section's permitted set. A
  flagged inconsistency is never itself a fact.
- Both conflicting source records are cited; neither is presumed
  correct and neither is discarded.
- Each contradiction is **also** raised in the leads section as a
  human-verification item, because someone has to settle it.
- When no contradiction is detected, the section says so as *the result
  of a check that ran* — explicitly distinguished from not having
  checked.

Source-level conflict flags recorded elsewhere in the pipeline (on graph
edges, and on ambiguous resolution decisions) are surfaced as
**Investigative Leads**, not reclassified as contradictions. Only P5.7
detects contradictions, and the report does not promote a warning flag
into one.

## 8. Copilot material & the no-key path

The dossier asks the existing P5.8 Copilot three fixed questions, drawn
from the canonical set in `docs/demo/demo-contract.md` §3 (questions 1,
6 and 8 — the three with no case-specific entity placeholder, which
keeps the question set deterministic):

1. Who are the primary suspects in this case, and what aliases do they use?
2. Which entity in this case has the most significant structural role in the network, and why?
3. Summarize the case: what has been corroborated, and what remains only an inference or a lead?

**Generation never requires a live Claude request.** The Copilot already
degrades to deterministic narration of the same deterministically
retrieved, guardrail-checked claim set when no `AI_PROVIDER_API_KEY` is
configured. With no key:

- every deterministic section is completely unaffected;
- excerpts still carry real grounded claims, real citations, real
  classifications and real confidences — only the wording is
  deterministic;
- that fact is recorded on **every** excerpt (`synthesisMode`,
  `aiSynthesized: false`, and a note), in the Copilot section's own
  notes, in `aiSynthesisNote` on the report, and in the limitations;
- **no fake AI output is produced.** Nothing is invented to fill the gap.

If the Copilot cannot be consulted at all, the excerpt is recorded as
`unavailable` **with its reason** and contributes no findings. A Copilot
failure is a warning, never a generation failure: the deterministic
sections are the report, and this is supporting material attached to it.

Nothing is re-worded, re-classified or strengthened. An excerpt keeps
the Copilot's own grounding status, per-claim classification, per-claim
confidence, citations and provenance. If the Copilot said the evidence
was insufficient, the dossier says so too.

## 9. Full-corpus results (Operation DarkNet Delhi)

Generated at commit `165777f` with no AI provider key:

| Metric | Value |
| --- | --- |
| Sections | 12 |
| Findings | 104 |
| Evidence sources / items | 6 / 1,820 |
| Entities / relationships | 54 / 196 |
| Analytical signals | 234 |
| Corroboration findings | 456 |
| Contradictions | 12 |
| Leads | 12 |
| Copilot excerpts | 3 |
| Resolved references | 1,311 |

Classification census: 12 Observed Fact, 33 Corroborated Fact, 34
Algorithmic Signal, 13 AI Inference, 12 Investigative Lead.

## 10. Error taxonomy

Every failure is a structured, user-safe `DossierError`. None carries a
stack trace, a filesystem path, a provider string, or a secret.

| Code | Meaning |
| --- | --- |
| `NO_INVESTIGATION` | No investigation loaded. |
| `NO_GRAPH` | The case graph has not been synthesized. |
| `NO_DERIVED_INTELLIGENCE` | Analytics and/or corroboration have not run against the current graph version. |
| `INSUFFICIENT_EVIDENCE` | Nothing substantive to report — distinct from "assembled, found nothing". |
| `VALIDATION_FAILURE` | The assembled report failed the dossier contract. Nothing written. |
| `TRACEABILITY_FAILURE` | A finding could not be classified or traced. The whole report is withheld. |
| `PERSISTENCE_FAILURE` | Writing failed. Nothing partial was written. |
| `INTERNAL_ERROR` | Anything unexpected, reported generically. |

## 11. API surface

| Route | Behaviour |
| --- | --- |
| `POST /api/dossier` | Runs generation, streaming newline-delimited `DossierEvent`s as each of the eleven stages completes. Final line is always `{"type":"result",…}`. Idempotent. |
| `GET /api/dossier` | The server-derived `DossierState`: `not_available` (with reason) / `pending` / `generated` / `stale`. |
| `GET /api/dossier/report` | The full report plus resolved reference labels and a `stale` flag. Optional `?id=`. 404 when nothing has been generated. |

All are Node-runtime, `force-dynamic`, `no-store`.

## 12. UI workflow

The **Dossier** entry under Reporting enables once corroboration
completes — the point at which every stage the report describes exists.

The screen has a distinct surface for each state: unavailable (with the
upstream reason), ready-to-generate, generating (the real eleven-stage
stream), generated, stale, and a structured failure.

The rendered report preserves classification and traceability
**visibly** — blueprint H3 forbids rendering a "clean" version that
drops the labels for presentation polish. Every finding shows its own
classification badge and confidence inline, and expands to:

- its explanation and what its classification means;
- the exact persisted ids it rests on, resolved to readable labels;
- its full six-field provenance including the processing chain;
- buttons into the Evidence, Graph, Analytics and Corroboration screens
  for the ids it cites.

**Reload preserves the report** because the report is persisted, not
held in component state: the screen re-reads it from
`GET /api/dossier/report` on mount. **Regeneration is idempotent**, and
the screen says so explicitly rather than appearing to do nothing.

No export functionality is built. No existing contract requires one —
blueprint H3 leaves the format to the stack decision and is satisfied by
a rendered, reviewable in-app report.

## 13. Limitations

Stated in the report itself, not only here — a report with no stated
limits overstates itself, and the schema requires the list to be
non-empty:

- The case is entirely synthetic. No real investigation, individual,
  agency or record is represented or implied.
- The report is decision support for a human reviewer. It establishes
  nothing on its own and is not a finished investigative conclusion.
- It describes what the system extracted, resolved, connected, computed
  and corroborated — not that the underlying evidence is true.
- Entity identities are inferences.
- Analytical signals describe graph structure and can never be read as
  evidence of conduct.
- Co-location and temporal overlap are not contact, association, or
  causation.
- Contradictions are reported, not resolved.
- The report describes one graph version and becomes stale when the
  graph is re-synthesized.
- Sections show the strongest findings of their kind, with the full
  population stated; nothing was discarded, only not printed.
- Ground truth is held out of the reporting path.

## 14. Demo procedure

1. `npm run dev`, open `http://localhost:3000`.
2. **Start ingestion** → **Extract Evidence** → **Resolve Entities** →
   **Synthesize Graph** → **Run Analytics** → **Run Corroboration**.
3. The **Dossier** entry under Reporting enables. Open it.
4. **Generate dossier** — watch the real eleven-stage stream.
5. Show the header: report version, graph version, the classification
   census, the synthetic-data indicator and the human-verification
   disclaimer.
6. Scroll the twelve sections. Point out that a Corroborated Fact and an
   AI Inference do not read alike.
7. Expand a **contradiction** — it is an Algorithmic Signal, cites both
   conflicting records, and is reported rather than resolved.
8. Expand a **key entity** — show the full provenance chain back to the
   source evidence item, then click **Graph** to land on that entity.
9. Return to the Dossier and **reload the page** — the report is still
   there, same version.
10. **Regenerate dossier** — the note says it was reused; the report
    version, finding count and generation time are unchanged.
11. Point out the Copilot section: with no API key it is deterministic
    narration of the same grounded claims, and the report says so.

Every step above is asserted end to end in
`tests/e2e/investigation-zzz-dossier.spec.ts`, and the visual evidence
is in `docs/progress/evidence/P5.9/`.
