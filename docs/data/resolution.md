# Entity Resolution Pipeline (P5.4)

**Status**: Implemented. This is the third real investigation workflow —
select extracted records → canonicalize identifier entities → cluster
person identities via shared identifiers → resolve every mention →
validate → attach provenance → persist, deterministically and
idempotently. It covers entity resolution only; graph synthesis,
topology analytics, spatial/temporal corroboration, the Copilot, and the
dossier are later milestones.

Everything resolved comes from the already-extracted, fully synthetic
**Operation DarkNet Delhi** corpus (`docs/data/corpus.md`,
`docs/data/extraction.md`). Resolution reads only already-persisted
extracted records — never a file, never `evidence/ground-truth/`.

---

## 1. What resolution is — and is not

Resolution determines which extracted entity mentions refer to the same
canonical real-world (synthetic) identity, per
`docs/contracts/agent-contracts.md` (Agent 2). It produces:

- **Canonical entities** (`entities` table, unchanged P4.2 shape) — one
  row per distinct identity: a phone number, an IMEI, a vehicle plate, a
  bank account, or a resolved person.
- **Aliases** (`aliases` table, unchanged P4.2 shape) — every non-canonical
  name variant or nickname belonging to a person entity.
- **Resolution decisions** (`resolution_decisions`, new table, P5.4) — one
  row per extracted record processed, recording exactly which canonical
  entity it was assigned to, why, with what confidence, and any
  conflicts — kept **deliberately distinct** from the entity itself so a
  reader can always answer "why is this specific mention here" without
  the canonical entity row needing to carry opaque justification text.

Resolution does **not**:

- infer relationships between two *different* canonical entities (a
  person↔phone edge, a communication link, a financial path) — that is
  graph synthesis, a later milestone;
- resolve or overwrite conflicting attributes (a witness's disputed
  vehicle colour, contradictory statements) — `Entity.attributes` is
  left empty by this stage precisely so no such judgment call is made;
- draw any investigative conclusion (culpability, mule-path membership);
- read any evidence beyond `entity_mention` and `relationship_mention`
  extracted records (plus one `attribute_mention` field, `note` — see
  §3). It never re-parses free text (a witness statement's `text`).

Every `ResolutionDecision` is classified **AI Inference**
(`docs/requirements.md` §7) — never Observed Fact. This is not a
special case for this implementation: the requirements document's own
definition of AI Inference names "entity resolution" explicitly ("a
conclusion produced by extraction, entity resolution, relationship
inference, or the Copilot that goes beyond directly observed evidence"),
so this holds however deterministic and rule-based the resolution logic
is. `Entity`/`Alias` rows themselves carry no classification field (same
as the existing P4.2 shape) — they are resolved *state*, not a
classified *claim*; the claim is the decision that produced them.

---

## 2. Demo workflow

```bash
npm install
npm run dev            # http://localhost:3000
```

1. Ingest, then extract the corpus (`docs/data/ingestion.md`,
   `docs/data/extraction.md`).
2. Once extraction is complete, the evidence workspace shows **Resolve
   entity identities** with a **Resolve Entities** button.
3. Click it. Watch the eight real resolution stages advance.
4. On completion the workspace shows **Entities resolved** with counts
   by entity kind (person/phone/IMEI/vehicle/bank account), and a
   representative, paginated list of resolved entities. Expanding an
   entity shows every resolution decision that produced it — each
   citing the exact extracted record it came from, its resolution type,
   confidence, classification, and any conflicts — making the chain
   **extracted fact → resolution decision → canonical entity** visible.
5. Reload the page — the resolved state stays. Click **Re-run
   resolution** — it reports the run is already complete.

---

## 3. Resolution algorithm

`src/lib/resolution/resolve.ts` — `resolveEntities(records, investigationId, resolvedAt)`
is a pure function over the full set of extracted records. Every
decision is justified by structural evidence explicitly present in the
records themselves — never fuzzy string similarity, never free-text
NLP, never ground truth.

### Phase 1 — canonicalize identifier entities

Every `entity_mention` with `mentionKind` ∈ {phone, imei, vehicle,
bank_account} is grouped by its exact `(kind, value)` pair (identifiers
are unique real-world values by the corpus's own design — no ambiguity
is possible). Each distinct group becomes one canonical `Entity`, with
one `resolution decision` (`resolutionType: "canonicalized_identifier"`,
confidence `1`) per contributing record. When the *same* identifier
value is independently stated by two different evidence items (e.g. a
vehicle plate named in both a FIR's `seizedVehicle` and its own
`vehicle_record`), both records canonicalize to the **same** entity —
this is the "cross-evidence identity support" case.

### Phase 2 — Tier A: cluster person mentions via shared identifiers

For every `entity_mention` with `mentionKind: "person"`, resolution
looks at **that mention's own evidence item** for sibling
`relationship_mention` records of type `has_phone`/`has_account`/
`has_vehicle` — the exact "SYN-PHONE-001 belongs to suspect_record
SYN-SUSPECT-001" pattern this milestone's brief calls a legitimate
observed-source fact. A deterministic union-find over
(mention, identifier-value) pairs groups every person mention that
shares an identifier, directly or transitively, into one cluster — this
is what merges a suspect's spelling-variant registry entries (which
each carry the same `linkedPhone`) with their canonical record.

A cluster's canonical label prefers a member whose own evidence item
does **not** carry a `note` field mentioning "variant" (a literal,
structured field the corpus's spelling-variant records carry — never
free text); ties break lexicographically, for full determinism.

Every other distinct name string in the cluster becomes an `Alias`, as
does every `has_alias` relationship value (nicknames/handles) from any
member's own evidence item — e.g. "Rohan Malhotra" keeps "R. Malhotra",
"Rohan M.", "Malhotra, Rohan" (spelling variants) and "RM", "Bhai",
"Silver Fox", "SilkFox" (nicknames) as aliases of one entity.

### Phase 3 — Tier B: resolve every remaining mention by exact name match

A person mention with **no** identifier evidence of its own (a FIR's
`accused` entry, a witness statement's `aboutNames` entry) is resolved
by its exact name string against every name known to a Tier-A cluster:

- **exactly one match** → merged (`resolutionType: "exact_name_match"`,
  confidence `0.6`) — this is how a FIR's bare "Vikram Singh" mention
  and a witness statement's "Vikram Singh" reference both resolve to the
  same accused suspect's entity, with no identifier evidence of their
  own.
- **zero matches** → the mention becomes its own new entity
  (`resolutionType: "new_entity"`, confidence `0.5`) — a single,
  uncorroborated mention (e.g. a communication intermediary named only
  in a witness statement).
- **two or more matches** → **left unmerged**. The mention becomes its
  own standalone entity, the decision is marked `status: "ambiguous"`
  (`resolutionType: "ambiguous_name_conflict"`, confidence `0.2` —
  strictly below `MERGE_CONFIDENCE_FLOOR = 0.5`, so it is never
  auto-applied as a merge per `docs/contracts/agent-contracts.md` Agent
  2), and `candidateEntityIds` records exactly which clusters it
  matched. This is the general safeguard that would keep two
  structurally-distinct same-name identities apart if the corpus ever
  surfaced both through structured fields — see §6.

Nothing in any phase builds a relationship between two *different*
canonical entities — that is graph synthesis's job.

---

## 4. Resolution counts (Operation DarkNet Delhi)

| Entity kind | Count |
| --- | --- |
| person | 10 (8 canonical suspects + 1 communication intermediary + 1 corpus self-reference artifact — see §6) |
| phone | 14 |
| imei | 14 |
| vehicle | 4 |
| bank_account | 12 |
| **Total entities** | **54** |

25 aliases; 85 resolution decisions (45 canonicalized identifiers, 10
shared-identifier merges, 23 exact-name matches, 7 new/isolated
entities); **0 ambiguous decisions** — the real corpus contains no
identifier-anchored name collision (see §6 for why, and how the
safeguard is proven anyway).

---

## 5. Provenance

Every `Entity`, `Alias`, and `ResolutionDecision` carries the full
six-field provenance object. For a `ResolutionDecision`:

- **source** — the id of the extracted record it was derived from (the
  decision's immediate upstream item — not the evidence item further
  back, which remains reachable via `processingHistory`).
- **location** — reused from that extracted record's own
  `provenance.location` (e.g. `suspect:S1#phones[0]`).
- **method** — `resolution:<resolutionType>`.
- **confidence** — resolution quality/certainty only, on a fixed scale
  (`canonicalized_identifier` 1, `shared_identifier_merge` 0.95,
  `new_entity` (from a cluster's own identifiers) 1, `exact_name_match`
  0.6, `new_entity` (an isolated, unlinked mention) 0.5,
  `ambiguous_name_conflict` 0.2) — never inflated by mention volume; a
  cluster merging ten mentions carries the same confidence as one
  merging two.
- **processingHistory** — the extracted record's own history
  (`["evidence_item:<id>", "extraction:<factType>"]`) with resolution's
  own step **appended**, never replacing it — `entity_item → extraction
  → resolution` stays fully reconstructable.
- **timestamp** — the real wall-clock instant the resolution run
  executed, shared by every row that run produces.

`Entity` provenance points to the cluster's primary contributing
record (the lexicographically-first member); the **complete** list of
every contributing mention, each with its own provenance, is
reconstructable by querying `resolution_decisions` for that
`canonicalEntityId` — satisfying
`docs/contracts/agent-contracts.md` Agent 2's requirement that a merge
never discard individual contributing-mention provenance.

---

## 6. Non-inference guarantees

Resolution is structurally incapable of inventing an identity link:
every decision is built from either (a) an identifier value explicitly
shared by two records' own evidence items, or (b) an exact string match
against a name a Tier-A cluster already carries — never a fuzzy score,
never a model judgment.

- **The two Vikram Singh cases.** Operation DarkNet Delhi's case design
  ( `src/lib/corpus/case-design.ts`) deliberately contains an accused
  enforcer ("Major") and an unrelated bystander, both named "Vikram
  Singh" — a deliberate look-alike pair `docs/data/ground-truth-spec.md`
  requires the system never merge. The bystander's name is embedded
  **only** in a witness statement's free-text `text` field
  (`aboutNames` for that statement is the placeholder `["W6"]`, not a
  name) — P5.3 extraction correctly never NLP-parses that field into a
  structured `entity_mention`, and resolution correctly never reads
  `attribute_mention` text either (§1, verified by a source-scan test).
  The result: only the accused enforcer's "Vikram Singh" exists as a
  structured mention anywhere, so all five of its mentions (a FIR
  entry, the suspect record, three witness `aboutNames` entries)
  correctly resolve to **one** canonical entity — not because the
  system "knows" there are two people, but because it never had cause
  to invent a second cluster from data that isn't there. This is
  proven, not assumed: `tests/unit/resolution.test.ts` asserts exactly
  one "Vikram Singh" entity with exactly five contributing decisions.
- **The general safeguard, proven adversarially.** Because the real
  corpus contains no *structurally*-present same-name collision, the
  `ambiguous_name_conflict` path cannot be exercised through the real
  running app. `tests/unit/resolution.test.ts` instead constructs a
  synthetic fixture — two distinct identifier-anchored "Test Person"
  clusters plus a third, bare "Test Person" mention — and asserts the
  bare mention is left unmerged, becomes its own third entity, is
  marked `ambiguous`, records both candidate entity ids, and carries
  confidence below the merge floor. This is the same mechanism that
  would protect a genuine future look-alike pair.
- **Contradictions survive untouched.** Resolution never reads or
  writes `attribute_mention` records beyond the single `note` field used
  for canonical-label tiebreaking (§3) — the FIR-vs-witness
  seized-vehicle-colour contradiction (`docs/data/extraction.md` §7)
  remains exactly as extraction left it.
- **Indirect relationships stay indirect.** Resolution creates no
  `relationships` table rows and no entity ever references another
  entity's id in its own `attributes` — a communication path through an
  intermediary (X1/Rahul Mehta) is never turned into a direct link or
  merge between the two suspects it bridges.
- **Spelling variants merge on evidence, not assumption.** A variant
  suspect record's own `note` field may literally read "registry
  spelling variant — same individual" — resolution reproduces that
  fact as an alias-selection signal (§3) but the merge itself is always
  justified independently by the shared phone/account/vehicle
  identifier, never by the note text alone.

---

## 7. Ground-truth isolation

`src/lib/resolution/` never imports the ground-truth loader or
addresses `evidence/ground-truth/`, and never references any
ground-truth-only field name (`expectedEntityMerges`, `hiddenConnections`,
`intendedConclusions`, `expectedCopilotAnswers`, `moneyMulePaths`,
`resolutionForbidden`, …) — verified by a source-scan test mirroring
`tests/unit/extraction.test.ts`'s.

---

## 8. Error taxonomy

| Code | Cause |
| --- | --- |
| `NO_INVESTIGATION` | Resolution was requested before any evidence was ingested. |
| `NO_EXTRACTED_RECORDS` | Resolution was requested before extraction had run. |
| `VALIDATION_FAILURE` | A candidate entity/alias/decision fails its Zod schema, or a provenance/classification invariant is violated. |
| `PERSISTENCE_FAILURE` | A repository write failed mid-persist (store may be partially populated; re-run to finish — already-written rows are skipped). |
| `INTERNAL_ERROR` | Any other unexpected error (details logged server-side only). |

---

## 9. Deterministic IDs & idempotency

- Identifier entities: `makeContentId("entity", [kind, value])`.
- Person cluster entities: `makeContentId("entity", ["person", sortedMemberRecordIds.join(",")])`
  — stable across runs since clustering itself is deterministic (fixed
  processing order, no randomness).
- Standalone (Tier-B) entities: `makeContentId("entity", ["person", mentionRecordId])`.
- Aliases: `makeContentId("alias", [entityId, aliasValue])`.
- Resolution decisions: `makeContentId("resolution_decision", [extractedRecordId])`
  — exactly one decision per extracted record processed.

First run creates everything; a repeat run finds every id already
present and writes nothing (`status: "already_resolved"`); a
partial-write retry (proven in `tests/unit/resolution.test.ts`) persists
only the rows still missing.

---

## 10. What P5.5 (graph synthesis) can rely on

- Every identity-bearing evidence type has a canonical `Entity` row —
  query `entities` by `kind`.
- A person entity's full name history is in `aliases` (`entityId` FK).
- The complete evidence trail for any entity is in `resolution_decisions`
  (`canonicalEntityId` FK) — every contributing extracted record, with
  its own resolution rationale and confidence.
- **No relationships exist yet.** `relationships` remains empty after
  this milestone — assembling person↔identifier and person↔person edges
  (with their own evidence classification and provenance) is graph
  synthesis's job, deliberately not started here.
- Ambiguous mentions are real, addressable entities too (never dropped)
  — a graph-synthesis or later stage that wants to treat them specially
  can filter `resolution_decisions` by `status: "ambiguous"`.
