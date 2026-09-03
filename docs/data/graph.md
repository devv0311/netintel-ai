# Graph Synthesis Pipeline (P5.5)

**Status**: Implemented. This is the fourth real investigation workflow —
load resolved entities → load extracted records → map evidence to
canonical entities → construct relationship candidates → validate
endpoints → construct deterministic edges → attach provenance → persist
graph relationships → build/rebuild the in-memory graph → return a
structured result. It covers graph synthesis only; topology analytics,
spatial/temporal corroboration, the Copilot, and the dossier are later
milestones.

Everything synthesized comes from the already-resolved, fully synthetic
**Operation DarkNet Delhi** corpus (`docs/data/corpus.md`,
`docs/data/extraction.md`, `docs/data/resolution.md`). Graph synthesis
reads only already-persisted resolved entities, extracted records, and
locations — never a file, never `evidence/ground-truth/`, and never a
new identity-resolution decision.

---

## 1. What graph synthesis is — and is not

Graph synthesis assembles P5.4's canonical entities and P5.3's extracted
records into a queryable, provenance-complete investigative graph, per
`docs/contracts/agent-contracts.md` (Agent 3). It produces:

- **Relationships** (`relationships` table, the one table this milestone
  actually populates) — one row per deterministic graph edge: source
  entity, target entity, relationship type, direction, evidence
  classification, full six-field provenance, the evidence-item ids and
  extracted-record ids that justify the edge, any conflicts, and
  kind-specific aggregate attributes (call/transaction count, first/last
  observed timestamp, total amount, currency).

Graph synthesis does **not**:

- create `locations`, `communication_events`, or `financial_transactions`
  rows — those three tables are already fully populated at **P5.2
  ingestion time**, directly from the corpus manifest
  (`src/lib/corpus/load.ts`, `src/lib/ingestion/persist.ts`), using their
  own deterministic ids (`makeContentId("location", [label,
  locationType])`, etc.) computed long before entity resolution or graph
  synthesis ever run. Graph synthesis only **reads** the already-
  persisted `Location[]` to resolve a CDR event's cell tower to its real,
  existing location id — see §6 for the bug this distinction fixed.
- recreate identity resolution — it never clusters mentions, never
  invents a canonical entity, and never merges two names because they
  look similar. Every person-entity endpoint is resolved either via the
  same-evidence-item sibling lookup P5.4's own clustering used, or via a
  bounded, exact-match lookup against P5.4's **already-computed**
  canonical registry (`entities.canonicalLabel` ∪ `aliases.aliasValue`).
  Zero or multiple matches → the contribution is dropped with a warning,
  never guessed.
- invent a relationship unsupported by evidence, or assert a direct link
  where the evidence only supports an indirect one (see §6).
- draw any investigative conclusion (culpability, "suspicious" structure,
  money-mule status) — even the derived person↔person edges (§3) are
  built by mechanically chaining two already-observed facts, never by
  judging their significance.

Every `Relationship` is classified per `docs/requirements.md` §7:
`observed_fact` (exactly one contributing evidence item), `corroborated_
fact` (two or more distinct contributing evidence items), or
`ai_inference` (a derived person↔person edge — combining an ownership
fact with an event fact into a claim about two *people* communicating or
transacting goes beyond either fact alone, however deterministic the
chaining rule is — the same rationale P5.4 documents for
`ResolutionDecision`). Graph synthesis never emits `algorithmic_signal`
or `investigative_lead` — those belong to later milestones.

---

## 2. Demo workflow

```bash
npm install
npm run dev            # http://localhost:3000
```

1. Ingest, extract, then resolve the corpus (`docs/data/ingestion.md`,
   `docs/data/extraction.md`, `docs/data/resolution.md`).
2. Once resolution is complete, the evidence workspace shows
   **Synthesize the investigative graph** with a **Synthesize Graph**
   button.
3. Click it. Watch the ten real graph-synthesis stages advance.
4. On completion the workspace shows **Graph synthesized** with node
   counts by kind and edge counts by relationship type, and the
   sidebar's **Graph** entry becomes clickable — live, without a page
   reload.
5. Open **Graph**. The screen shows the full (bounded) network, a
   node-kind / edge-type filter row, a "jump to entity" picker, and a
   "Focus on selection" neighborhood view. Selecting a node shows its
   label, aliases, attributes, provenance, and every connected entity
   (each with a magnifier to inspect that specific relationship).
   Selecting a relationship shows its type, direction, classification,
   confidence, aggregate attributes, any conflicts, and the full list of
   source `extracted_records` that justify it — the "why does this edge
   exist" answer.
6. Reload the page — the synthesized graph stays. Click **Re-run graph
   synthesis** — it reports the run is already complete.

---

## 3. Graph synthesis algorithm

`src/lib/graph/build.ts` — `synthesizeGraph(entities, aliases, decisions,
records, locations, investigationId, synthesizedAt)` is a pure function
over already-persisted state. Every edge is justified by structural
evidence explicitly present in the extracted records themselves — never
fuzzy string similarity, never free-text NLP, never ground truth.

### Endpoint resolution — two paths, deliberately kept separate

- **Path A — same-evidence-item sibling lookup** (deterministic, no
  guessing): a `has_phone`/`has_account`/`has_vehicle` relationship
  mention's "subject" is the person named by that **same** evidence
  item's own person entity mention — found via `resolution_decisions`,
  exactly mirroring how P5.4's Tier-A clustering itself read these same
  sibling records (`src/lib/resolution/resolve.ts`).
- **Path B — canonical-registry lookup** (bounded, exact-match only): a
  `phone_subscriber`/`account_held_by`/`vehicle_registered_to`
  relationship mention's target person has no sibling entity mention in
  its own evidence item — the only way to resolve it is to look up its
  name string against `entities.canonicalLabel` ∪ `aliases.aliasValue`.
  Zero or multiple matches → dropped with a warning.

`phone_bound_to_imei`/`imei_bound_to_phone` are normalized to a single
phone→imei `ownership` direction regardless of which record stated it,
so both aggregate into the same edge. `has_alias`/`alias_of` never
produce a graph edge — that is resolution's job (P5.4), already done.

### Direct edges (from a single fact type)

| Relationship type | Source evidence | Direction |
| --- | --- | --- |
| `ownership` | `has_phone`/`has_account`/`has_vehicle`, `phone_bound_to_imei`/`imei_bound_to_phone`, `vehicle_registered_to`, `account_held_by`, `phone_subscriber` | person/phone → identifier |
| `communication` | `cdr_event` → `event_mention` (`eventKind: "communication"`) | caller phone → callee phone |
| `financial` | `financial_transaction_record` → `event_mention` (`eventKind: "financial_transaction"`) | from-account → to-account |
| `co_location` | the same `communication` event, cross-referenced to a real `Location` row via its cell tower | phone ↔ location (undirected) |

A CDR event's `cellTower` field names a location by its **short source
key** (e.g. `"SYN-CT-01"`), never by `location_record`'s human-readable
`label`. `build.ts` bridges this by also indexing every already-
persisted `Location` by the bare key extracted from its own
`location_record` entity mention's `data.recordRef` field (e.g.
`"location:SYN-CT-01"` → `"SYN-CT-01"`) — see §6 for why this matters.

### Derived edges (chaining two fact types — always `ai_inference`)

When both endpoints of a `communication` or `financial` edge have a
resolvable owning person (via an `ownership` edge already constructed in
the same run), a second, derived person↔person edge of the same
relationship type is added — confidence fixed at `0.7`
(`CONFIDENCE.derivedPersonEdge`), always classified `ai_inference`. If
either endpoint's owner cannot be resolved (see §6 — money-mule
intermediaries), no derived edge is added; only the direct,
identifier-level edge exists.

### Aggregation

Every relationship_mention/event_mention is aggregated into **at most
one** edge per `(relationshipType, sourceEntityId, targetEntityId)`
triple — repeated evidence corroborates an existing edge (raising its
`evidenceItemIds` count, which upgrades `observed_fact` to
`corroborated_fact`) rather than creating duplicate edges.
`attributes.eventCount`/`firstObservedAt`/`lastObservedAt`/
`totalDurationSeconds`/`totalAmount`/`currency` are aggregated across
every contributing event.

---

## 4. Graph counts (Operation DarkNet Delhi)

| Node kind | Count |
| --- | --- |
| person | 10 |
| phone | 14 |
| imei | 14 |
| vehicle | 4 |
| bank_account | 12 |
| location | 14 |
| **Total nodes** | **68** |

| Edge type | Count |
| --- | --- |
| ownership | 38 |
| communication | 69 |
| co_location | 63 |
| financial | 26 |
| **Total edges** | **196** |

By classification: 156 `corroborated_fact`, 2 `observed_fact`, 38
`ai_inference` (the derived person↔person communication/financial
edges).

---

## 5. Provenance

Every `Relationship` carries the full six-field provenance object
(`docs/requirements.md` §8):

- **source** — the lexicographically-first contributing extracted
  record's id.
- **location** — that record's own `provenance.location`.
- **method** — `graph:<kind>` (e.g. `graph:ownership:has_phone`,
  `graph:communication`, `graph:communication_inferred`,
  `graph:financial_inferred`, `graph:co_location`).
- **confidence** — `1` for direct edges, `0.7` for derived person↔person
  edges — never inflated by evidence volume (a corroborated edge backed
  by 50 CDR events carries the same confidence as one backed by 2).
- **processingHistory** — the primary contributing record's own history,
  with `"graph:edge_constructed"` appended, never replacing it —
  `evidence_item → extraction → graph` stays fully reconstructable.
- **timestamp** — the real wall-clock instant the synthesis run
  executed, shared by every relationship that run produces.

`evidenceItemIds`/`extractedRecordIds` list **every** contributing
evidence item / extracted record, sorted — the full "why does this edge
exist" trail, resolvable via `GET /api/graph/edges/[id]`.

---

## 6. Non-inference and indirection guarantees

Graph synthesis is structurally incapable of inventing a relationship or
shortcutting an indirect connection: every edge is built from either (a)
a same-evidence-item sibling record, (b) an exact-match lookup against
P5.4's already-resolved registry, or (c) a directly-stated event record
— never a fuzzy score, never a model judgment, never a peek at ground
truth.

- **The hidden S1↔S4 connection stays structurally indirect.** No
  relationship row ever directly links Rohan Malhotra (S1) and Farhan
  Qureshi (S4) — neither a communication edge (no CDR record ever shows
  their phones calling each other) nor a financial edge (no transaction
  record ever moves funds directly between their accounts) exists
  between them. The connection is only *recoverable* by traversing the
  real financial chain (§below) and the shared cell-tower co-location —
  proven in `tests/unit/graph.test.ts` via a breadth-first search that
  finds S4 reachable from S1 only after multiple hops.
- **The money-mule chain is represented through real account entities
  only, never a synthetic "money mule" edge.** `financial` edges exist
  for `Rohan Malhotra's account → Sunil Gupta's account → Pooja Rani's
  account → Ashok Kumar's account → Farhan Qureshi's account`, with
  transaction counts/amounts aggregated from the real, jittered-around-
  target transaction volumes the corpus generator produced (never an
  exact hardcoded count — `src/lib/corpus/generate.ts` applies random
  spread around each designed flow's target). **Superseded (P6.2).** This section previously recorded that the
  money-mule intermediaries (Sunil Gupta, Pooja Rani, Ashok Kumar)
  *never receive a canonical `person` entity at all*, because they never
  appear in their own `suspect_record`. That was a description of an
  extraction gap, not a design requirement, and it conflicted with
  `evidence/ground-truth/…` which has always listed M1/M2/M3 among
  `expectedEntityMerges`. The evaluation harness measured the conflict as
  `er.mentionCoverage` 39/46.

  Extraction now emits a person `entity_mention` from every field that
  NAMES a person — a phone's `subscriberName`, an account's `holderName`,
  a vehicle's `registeredTo`, an alias's `primaryName`
  (`src/lib/extraction/extract.ts`, `personMention()`). **The mules now
  do receive person entities**, and coverage is 46/46.

  The invariant that mattered here is unchanged: graph synthesis still
  invents nothing. The derived person↔person `financial` edge logic still
  requires both endpoints to have a resolvable owning person, and every
  person entity it sees traces back to a field of a source record.

  A consequence to be aware of when reading the graph: because each mule
  is named in a phone record and an account record with no shared
  identifier between them and no `suspect_record` to anchor them, the
  resolver produces **two** person entities per mule rather than one.
  That is a resolver limitation (Tier A finds no shared identifier; Tier B
  does not apply to a mention that carries identifier evidence of its
  own), not a graph-synthesis one. It is quantified in
  `docs/evaluation/resolver-failure-analysis.md`. This is the
  intended, honest behavior: the chain is real and traceable through
  accounts, exactly as the requirements demand, without pretending to a
  identity profile the evidence never supports.
- **Misleading, low-value relationships stay noise.** Three synthetic
  service numbers (a food-delivery hotline, a dental-clinic reception, a
  radio-cab dispatch — `NOISE_NUMBERS` in the case design) appear as
  callers/callees in CDR records but never get their own `phone_record`,
  so they never canonicalize as phone entities — graph synthesis
  correctly produces **zero** communication edges for these calls,
  proven against the real corpus (not just a hand-built fixture).
- **Vikram Singh remains a single, correctly-separated canonical
  entity.** As documented in `docs/data/resolution.md` §6, only the
  accused enforcer's "Vikram Singh" ever becomes a structured mention;
  graph synthesis operates on P5.4's entity set unchanged and adds real
  ownership edges (phone/account/vehicle) to that one entity — it never
  creates a second one.
- **A real bug this design distinction caught.** During manual
  verification, graph synthesis was initially (incorrectly) creating its
  *own* `Location` candidates from `location_record` entity mentions,
  hashed as `makeContentId("location", [label])` — one part short of
  ingestion's own `makeContentId("location", [label, locationType])`.
  This produced a **second**, differently-hashed row for every one of
  the 14 real-world locations (28 instead of 14), because graph
  synthesis was treating a table it must only *read* as one it owned.
  `src/lib/graph/build.ts` now takes the already-persisted `Location[]`
  as an input and never constructs a new one; `tests/unit/graph.test.ts`
  asserts the exact count (`locations.length === 14`) as a regression
  guard.

---

## 7. Ground-truth isolation

`src/lib/graph/` never imports the ground-truth loader or addresses
`evidence/ground-truth/`, and never references any ground-truth-only
field name (`expectedEntityMerges`, `hiddenConnections`,
`intendedConclusions`, `expectedCopilotAnswers`, `moneyMulePaths`,
`resolutionForbidden`, `recoverableBy`, `aliasMap`, …) — verified by a
source-scan test mirroring `tests/unit/resolution.test.ts`'s. Every
structural property described in §6 above (the hidden connection, the
mule chain, the noise numbers) was discovered and verified by *reading
persisted evidence*, never by consulting the ground-truth answer key
during implementation review.

---

## 8. Error taxonomy

| Code | Cause |
| --- | --- |
| `NO_INVESTIGATION` | Graph synthesis was requested before any evidence was ingested. |
| `NO_RESOLVED_ENTITIES` | Graph synthesis was requested before entity resolution had run. |
| `NO_EXTRACTED_RECORDS` | Graph synthesis was requested before extraction had run (unreachable via the normal pipeline order, since resolution itself requires extracted records — defensive). |
| `VALIDATION_FAILURE` | A candidate relationship fails its Zod schema, or a provenance/classification/endpoint invariant is violated. |
| `PERSISTENCE_FAILURE` | A repository write failed mid-persist (store may be partially populated; re-run to finish — already-written rows are skipped). |
| `INTERNAL_ERROR` | Any other unexpected error (details logged server-side only). |

---

## 9. Deterministic IDs & idempotency

- Relationships: `makeContentId("relationship", [relationshipType,
  sourceEntityId, targetEntityId])` — one id per aggregated edge; stable
  across runs since the aggregation itself is deterministic (fixed
  processing order over already-deterministic inputs, no randomness).
- Locations/communication events/financial transactions are **not**
  created here — see §1. Their ids are P5.2 ingestion's own
  (`src/lib/corpus/load.ts`).

First run creates every relationship; a repeat run finds every id
already present and writes nothing (`status: "already_synthesized"`); a
partial-write retry (proven in `tests/unit/graph.test.ts`) persists only
the rows still missing.

---

## 10. What downstream milestones can rely on

- **P5.6 (topology analytics)** — every relationship carries
  `classification`/`confidence`/`attributes`, sufficient for
  degree/centrality weighting; the in-memory graph
  (`src/lib/graph/runtime.ts`, `buildGraphFromRows`) is a deterministic,
  reconstructable `graphology` projection of `entities` ∪ `locations` ∪
  `relationships`, ready for `graphology-metrics`/`-communities-louvain`/
  `-shortest-path` to consume directly — no adapter needed.
- **P5.7 (spatial/temporal corroboration)** — `communication_events`/
  `financial_transactions` (P5.2's rows, read-only from graph synthesis)
  carry per-event `occurredAt`/`durationSeconds`/`cellLocationId`, and
  every `co_location` edge already identifies which phone was near which
  real `Location` and when (`attributes.firstObservedAt`/
  `lastObservedAt`) — the raw material P5.7 needs, not yet analyzed for
  correlation/contradiction here.
- **P5.8 (Copilot)** — `GET /api/graph/nodes/[id]` and
  `GET /api/graph/edges/[id]` give citable, resolvable node/edge/evidence
  references (never a raw name, never an id the model invents) — the
  same "the model never mints an identifier" guarantee the stack
  contract requires end to end.

## 11. Limitations

- `crime_event` records are deliberately out of scope for this
  milestone — they carry no clean structured person-entity endpoint on
  the record itself (a crime event names a FIR number and a scene, not
  an accused list); wiring that in would require a FIR-to-accused
  cross-reference hop this milestone does not attempt.
- The graph screen's sigma.js canvas uses a simple deterministic
  circular layout (no force-directed layout algorithm) — adequate at
  this node/edge count, per `docs/architecture/stack-contract.md`'s
  instruction not to add a new dependency beyond the approved stack.
