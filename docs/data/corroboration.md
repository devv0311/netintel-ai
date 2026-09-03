# Spatial & Temporal Corroboration Pipeline (P5.7)

**Status**: Implemented. This is the sixth real investigation workflow —
load graph state and observable activity → build a deterministic
activity index → compute spatial corroboration (co-location, haversine
proximity) → compute temporal corroboration (shared time windows) →
compute spatiotemporal corroboration (repeated overlap + travel-speed
contradictions) → classify each finding → validate → attach provenance
→ persist → return a structured result. It covers spatial/temporal
corroboration only; the Copilot and the dossier are later milestones.

Everything compared comes from the already-persisted, fully synthetic
**Operation DarkNet Delhi** investigation: the P5.2 communication
events, the P5.3 extracted event mentions, the P5.4 resolved entities,
the P5.5 synthesized graph, and the P5.2 locations. Corroboration
reads only already-persisted observable state and the graph-synthesis
completion marker — never a file, never `evidence/ground-truth/`, and
never an invented coordinate or timestamp.

---

## 1. What corroboration is — and is not

Corroboration computes deterministic spatial and temporal correlations
over persisted evidence, per Agent 5 (`docs/contracts/agent-contracts.md`).
It produces five finding types:

- **`spatial_co_location`** — two subjects (persons where an ownership
  edge resolves the phone/account to one, otherwise the identifier
  entity) each with **≥ 2** recorded activity events at the **same**
  persisted location. A single incidental tower ping is not "activity
  at" a place in a corroboration sense.
- **`spatial_proximity`** — two **distinct** persisted case locations
  within the documented distance threshold (**1 000 m**), at least one
  carrying recorded activity. Always an **algorithmic signal** — it is
  a statement about the *locations*, never that any entity was at both
  or that two entities were together.
- **`temporal_co_occurrence`** — two subjects each active within the
  documented time window (**30 minutes**) of each other, contributed by
  **≥ 2 distinct evidence items** (a co-occurrence carried by a single
  record — e.g. the two ends of one call — is just that record, never a
  corroboration signal and is not emitted).
- **`repeated_spatiotemporal_overlap`** — a subject pair active at the
  **same** location **within the window** on **≥ 2 separate occasions**.
  The headline "these two repeatedly overlapped in space and time"
  signal.
- **`spatiotemporal_contradiction`** — one subject placed at two
  locations whose separation implies a travel speed above the
  documented plausibility ceiling (**55 m/s ≈ 198 km/h**). Both source
  records are cited; neither is presumed correct. Always an
  **algorithmic signal** — a flagged inconsistency is never itself a
  fact.

Corroboration does **not**:

- recreate identity resolution, graph synthesis, or invent a
  relationship, coordinate, or timestamp — every computation reads
  persisted rows exactly as earlier stages wrote them.
- claim **contact or causation** from timing, or claim two entities
  were **together** from a shared cell tower or geographic proximity.
  Every persisted `explanation` string and every UI surface says so
  explicitly ("a timing correlation only — never a claim of causation
  or contact"; "not a claim that the two were physically together";
  "it does not assert that any entity was at both").
- **silently resolve a contradiction** in favour of one source — the
  conflict itself is the finding, with both placements cited.

---

## 2. Classification — corroborated fact vs algorithmic signal

Every finding carries exactly one of **two** classifications, a strict
subset of `docs/requirements.md` §7's five-value taxonomy:

| Classification | When |
| --- | --- |
| **`corroborated_fact`** | A spatial/temporal co-occurrence independently attested by **two or more distinct evidence items**. Independent agreement raises an Observed Fact to a Corroborated Fact (§7: "…or by spatial/temporal corroboration"). |
| **`algorithmic_signal`** | An algorithmically-derived pattern: a haversine proximity between two distinct locations, a single-occurrence temporal co-occurrence, or a travel-speed contradiction. It describes the data; it is not itself a claim about the world. |

`observed_fact`, `ai_inference`, and `investigative_lead` are **never**
valid here. This is enforced at three layers: the domain schema
(`CorroborationFindingSchema` restricts `classification` to a two-value
enum, refines that a `corroborated_fact` must cite ≥ 2 evidence items,
and that a `spatiotemporal_contradiction` is always an
`algorithmic_signal`), `src/lib/corroboration/verify.ts`'s
`assertProvenance` (re-checks every invariant before persistence), and
a serialized-output scan for every forbidden classification literal.

---

## 3. Demo workflow

```bash
npm install
npm run dev            # http://localhost:3000
```

1. Ingest, extract, resolve, synthesize the graph, then run analytics
   (`docs/data/ingestion.md` … `docs/data/analytics.md`).
2. Once analytics is synthesized, the evidence workspace shows
   **Corroborate spatially & temporally** with a **Run Corroboration**
   button.
3. Click it. Watch the ten real corroboration stages advance.
4. On completion the workspace shows **Corroboration synthesized** with
   spatial / temporal / repeated-overlap / contradiction counts and the
   corroborated-fact vs algorithmic-signal split, and the sidebar's
   **Corroboration** entry becomes clickable — live, without a page
   reload.
5. Open **Corroboration**. The screen shows an overview strip, a
   corroborated-fact / algorithmic-signal filter, tabs for **Entity
   pairs**, **Spatial**, **Temporal**, **Repeated overlaps**, and
   **Contradictions**, a timeline for the temporal views, side-by-side
   conflicting placements for contradictions, and a detail panel that
   always shows the finding's classification, the metric that produced
   it, the full provenance chain, and the exact source evidence-item
   and observable-record ids. Selecting an entity pair cross-filters
   every tab; **View in graph** hands off to the Graph screen focused
   on that entity's neighborhood.
6. Reload the page — the synthesized corroboration stays. Click **Re-run
   corroboration** — it reports the run is already complete.

---

## 4. Algorithm

`src/lib/corroboration/build.ts` — `synthesizeCorroboration(entities,
locations, relationships, communicationEvents, records, investigationId,
graphVersion, analyzedAt)` is a pure function over already-persisted
state.

### Activity index

`buildActivityIndex` unifies two observable sources into a single
sorted list of activity events `{ subjectId, identifierEntityId,
locationId, at, channel, evidenceItemId, recordId }`:

- **`communication_events`** (P5.2) — the authoritative per-call
  record. Each row carries the caller/callee phone numbers, the
  instant, the resolved `cellLocationId` (a real `locations.id`), and
  provenance whose `source` is the originating evidence item. Each
  resolvable endpoint becomes one activity event.
- extracted **`event_mention`** records of kind `financial_transaction`
  (P5.3) — the only place a transaction's account linkage survives
  (`financial_transactions` stores no account ids). Contributes
  timing-only activity (a wire transfer has no location).

Phone/account identifier entities are rolled up to the **owning person**
via P5.5 `ownership` edges (first edge by id wins, mirroring
`src/lib/graph/build.ts`), so a finding is about people wherever the
graph resolves one, and about the handset/account otherwise. Events are
sorted by `(at, subjectId, recordId, channel)` — the index is
byte-identical regardless of input row order.

### Spatial

- **Co-location** — group located activity by location, then by
  subject; for every unordered subject pair where **each** subject has
  ≥ 2 events at that location, emit a finding. `corroborated_fact` iff
  the union of both subjects' contributing evidence items is ≥ 2
  (which, given each subject already needs 2 events, it always is for
  the real corpus — a degenerate single-record dataset would still
  degrade to `algorithmic_signal`).
- **Proximity** — `haversineMeters` (IUGG mean Earth radius, rounded to
  whole metres — the "existing approved project approach" per
  `docs/architecture/stack-contract.md`, no PostGIS, no geo
  dependency) between every unordered pair of persisted case locations;
  emit when the distance is `> 0` and `≤ 1 000 m` and at least one side
  has recorded activity. Provenance cites both locations' own
  `provenance.source` plus the active side's activity evidence.

### Temporal

- **Co-occurrence** — for every unordered subject pair, a forward
  sliding window over each subject's time-sorted events finds every
  `(a, b)` instance within 30 minutes. Emitted only when ≥ 2 distinct
  evidence items contribute; `corroborated_fact` iff there are ≥ 2
  distinct occurrences, else `algorithmic_signal`. `value` exposes
  `occurrenceCount`, `minGapSeconds`, `distinctDayCount`,
  `distinctEvidenceItemCount`, and the channels involved.

### Spatiotemporal

- **Repeated overlap** — for a subject pair, restrict to shared
  locations, cross-join within each shared location, keep instances
  within the window, de-dupe by `(aRecordId, bRecordId)`. Emit one
  finding per `(pair, location)` with `≥ 2` distinct overlaps.
  `corroborated_fact` iff ≥ 2 distinct evidence items contribute.
- **Contradiction** — for each subject, walk consecutive located
  events; when two consecutive events at different locations imply a
  speed `> 55 m/s` (`distance / elapsed`, `Infinity` for a same-instant
  jump), emit a finding. De-duped per `(subject, location pair)`
  keeping the highest implied speed. Always `algorithmic_signal`.

### Deterministic ids & idempotency

`makeContentId("corroboration_finding", [findingType, …sorted
entityIds, …sorted locationIds, window.start ?? "", window.end ?? "",
graphVersion])` — every finding id includes the graph version it was
computed against, so re-synthesizing the graph (a new graph version)
naturally produces a **different** id set rather than silently shadowing
stale corroboration. First run creates every finding; a repeat run
against the **same graph version** writes nothing (`status:
"already_synthesized"`); a partial-write retry persists only the rows
still missing (all proven in `tests/unit/corroboration.test.ts`).

### Thresholds

| Constant | Value | Meaning |
| --- | --- | --- |
| `SPATIAL_PROXIMITY_METERS` | `1000` | Two case locations this close may fall within one tower's coverage. |
| `TEMPORAL_WINDOW_SECONDS` | `1800` (30 min) | Two events within this are "co-occurring". |
| `REPEATED_OCCURRENCE_MIN` | `2` | Occasions a pair must overlap for the pattern to be "repeated". |
| `MAX_PLAUSIBLE_SPEED_MPS` | `55` (≈ 198 km/h) | Implied point-to-point speed above this is a contradiction. |

All four are fixed, documented constants — not tunable or learned —
consistent with the project's deterministic-first design throughout the
pipeline.

---

## 5. Full-corpus results (Operation DarkNet Delhi)

| Metric | Count |
| --- | --- |
| Activity events compared | 3,332 |
| Subjects considered | 15 |
| Located sites with activity | 8 (all cell towers) |
| `spatial_co_location` findings | 260 (all corroborated_fact) |
| `spatial_proximity` findings | 3 (all algorithmic_signal) |
| `temporal_co_occurrence` findings | 105 (102 corroborated_fact, 3 algorithmic_signal) |
| `repeated_spatiotemporal_overlap` findings | 76 (all corroborated_fact) |
| `spatiotemporal_contradiction` findings | 12 (all algorithmic_signal) |
| **Total persisted findings** | **456** — 438 corroborated facts, 18 algorithmic signals |

The corroborated:algorithmic ratio is deliberately lopsided: the
synthetic network operates tightly within a handful of Delhi sectors,
so its dense CDR stream genuinely places most active subject pairs at a
shared tower across two or more independent call records — which is, by
`docs/requirements.md` §7's definition, corroboration. The 18
algorithmic signals (3 proximity, 3 single-occasion temporal, 12
travel-speed contradictions) are the findings that most need
investigator scrutiny, and the screen's classification filter surfaces
them in one click.

- The three proximity signals are the case's crime scenes / residences
  sitting within a tower's plausible footprint — e.g. the **Karol Bagh
  warehouse** crime scene is 979 m from tower CT-02 (heavy activity),
  and residence ADDR-02 is 201 m from CT-03.
- The 12 contradictions are all implausibly-fast tower-to-tower hops
  for a single phone (e.g. Rohan Malhotra placed at CT-01 then CT-05,
  13 km apart, 181 s apart → ~72 m/s), surfaced from the raw CDR stream
  without consulting any answer key — reported as inconsistencies, not
  resolved.

---

## 6. Provenance

Every `CorroborationFinding` carries the full six-field provenance
object (`docs/requirements.md` §8):

- **source** — the sorted-minimum contributing evidence-item id (or an
  entity/location id for a finding that cites none directly, which
  never happens for the real corpus).
- **location** — `graph_version:<graphVersion>` — which exact graph
  state this finding was computed against.
- **method** — `corroboration:<algorithm>` (`corroboration:spatial_co_location`,
  `corroboration:haversine_proximity`, `corroboration:temporal_window`,
  `corroboration:repeated_spatiotemporal_overlap`,
  `corroboration:travel_speed_contradiction`).
- **confidence** — `1` for every finding. A deterministic
  spatial/temporal computation has no uncertainty of its own to
  express — confidence here answers "how faithfully was this
  computed", exactly as `docs/data/analytics.md` §5 establishes. The
  *strength* of a finding is carried by `value.distinctEvidenceItemCount`
  / `occurrenceCount`, exposed alongside every result, never folded
  into a single opaque number.
- **processingHistory** — `["graph:synthesized:<graphVersion>",
  "corroboration:<method>"]` — traces back through the graph version
  to P5.5's own synthesis.
- **timestamp** — the real wall-clock instant the run executed.

Beyond provenance, every finding also carries `evidenceItemIds` (every
distinct source `evidence_items.id` compared) and `supportingRecordIds`
(the `communication_events.id` / `extracted_records.id` values
compared). `value` references **ids only** — never an inline copy of an
evidence record — so tracing "why does this finding exist" means
resolving those ids back through the P5.2/P5.3 stores. `verify.ts`
asserts that every cited evidence-item id resolves to a real persisted
`evidence_items` row and every entity/location endpoint resolves to a
real persisted row.

---

## 7. Ground-truth isolation

`src/lib/corroboration/` never imports the ground-truth loader or the
corpus case-design module, never addresses `evidence/ground-truth/`,
and never references any ground-truth-only field name
(`expectedEntityMerges`, `hiddenConnections`, `moneyMulePaths`,
`intendedConclusions`, `expectedCopilotAnswers`, `resolutionForbidden`,
`recoverableBy`, `aliasMap`, `temporalCorrelations`,
`spatialCorrelations`, `HIDDEN_CONNECTION`, `TEMPORAL_CORRELATIONS`,
`CONTRADICTIONS`, …) — verified by a source-scan test mirroring
`tests/unit/analytics.test.ts`'s, plus a second test scanning the
actual **persisted finding output** of a full-corpus run for the same
forbidden strings. Every structural claim in §5 above was discovered by
reading persisted evidence and running the real algorithm, never by
consulting the ground-truth answer key.

---

## 8. Error taxonomy

| Code | Cause |
| --- | --- |
| `NO_INVESTIGATION` | Corroboration was requested before any evidence was ingested. |
| `NO_GRAPH` | Corroboration was requested before graph synthesis had run (or the graph marker/relationships are missing). |
| `INSUFFICIENT_SPATIAL_TEMPORAL_DATA` | There is no spatial or temporal activity to compare — no communication event or dated transaction resolved to a known entity. Reported distinctly from "checked, nothing found" (Agent 5's contract). |
| `VALIDATION_FAILURE` | A candidate finding fails its Zod schema, or a provenance / classification / graph-version / endpoint invariant is violated. |
| `PERSISTENCE_FAILURE` | A repository write failed mid-persist (store may be partially populated; re-run to finish — already-written rows are skipped). |
| `INTERNAL_ERROR` | Any other unexpected error (details logged server-side only). |

"Checked, no contradiction found" is **not** an error — it is a
successful `synthesized` result with zero contradiction findings, shown
in the UI as "No contradictions detected — checked, none found."

---

## 9. API surface

| Route | Returns |
| --- | --- |
| `POST /api/corroboration` | Newline-delimited real stage events; final line is the `CorroborationResult`. |
| `GET /api/corroboration` | The current `CorroborationState` (`not_available` / `pending` / `synthesized`). |
| `GET /api/corroboration/findings` | A paginated page of findings, filterable by `?kind`, `?type`, `?classification`, `?entityId`. Each item carries id-resolved entities/locations, the window, the metric `value`, the method, the explanation, the classification, the full provenance, and the cited evidence-item / record ids. |
| `GET /api/corroboration/findings/[id]` | One finding's full detail. |
| `GET /api/corroboration/pairs` | Entity pairs with repeated overlap — per pair, the spatial / temporal / repeated-overlap / contradiction counts, how many are corroborated facts, and the contributing finding ids, strongest-corroboration first. |

---

## 10. What downstream milestones can rely on

- **P5.8 (Copilot)** — `GET /api/corroboration/findings` and
  `/findings/[id]` give citable, resolvable corroboration/contradiction
  claims (a co-location, a repeated overlap, a travel-speed conflict)
  the Copilot can quote with a real finding id and its exact evidence
  references — never a correlation it invents itself.
- **P5.9 (dossier/report)** — the corroborated-fact findings give the
  report a ready-made "spatial evidence" and "timeline" section, and
  the 12 contradictions a ready-made "contradictions" section, each
  already correctly classified per §7 and each citing both conflicting
  sources.

## 11. Limitations

- Only communication events carry a location, so spatial findings are
  cell-tower-based; the case's witness/FIR locations
  (warehouse, farmhouse, residences) contribute to `spatial_proximity`
  but never to co-location or repeated overlap, because no CDR ever
  names them.
- Financial activity is timing-only (a wire transfer has no location),
  so it can produce `temporal_co_occurrence` but never a spatial or
  spatiotemporal finding.
- `spatial_co_location`'s window is the min→max span of all contributing
  events, so a long-running co-location reports a wide window; the
  time-bounded question is answered by `repeated_spatiotemporal_overlap`.
- Contradiction detection walks **consecutive** located events per
  subject only — the tightest, most defensible conflict — and does not
  enumerate every implausible pair.
