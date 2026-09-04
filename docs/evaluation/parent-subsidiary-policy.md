# P6.21 — Parent/subsidiary policy: a decision memo

**Phase:** P6.21.2 (memo only)
**Data class:** REAL. GLEIF (SRC-002, CC0 1.0), Level 1 + Level 2, and the
expanded real corpus. No synthetic data is used, cited or mixed in anywhere
below. Operation DarkNet Delhi appears only where its *schema* collides with
the question, and never as a measurement.
**Resolution semantics changed:** **NONE.** `src/lib/resolution/` is
byte-identical to `a00cdf3`.
**Graph semantics changed:** **NONE.**
**Rules enabled:** **NONE.** Everything below is measurement and options.
**ML:** none started, none justified, none proposed.

This memo answers decision 4 of P6.20 §8. It does not implement it. It stops
at a recommendation and a list of things only the project owner can decide.

---

## 0. Baseline this memo is written against

Reproduced before anything was read or written, on commit `a00cdf3`:

| Check | Result |
|---|---|
| `vitest run` | **621 / 621 passed**, 24 files |
| `tsc --noEmit` | clean |
| `eslint .` | clean |
| Corpus | 1,245 records, **578** real positive pairs, **146** hard negatives |
| Level-2 collection | 345 LEIs asked, **82** stating ≥1 parent, **154** edges |
| Shipped resolver false merges | **3** (EN-0001, EN-0002, EN-0003) |

One environment note, because it changes how the number must be read: the
suite **cannot** be run from the desktop-mounted working copy. SQLite writes
fail there — the mount forbids `unlink`, which SQLite needs for its journal
files — and the suite reports 52 spurious failures as a result. Both the
baseline above and every re-run in this phase were executed from a local copy
of the identical tree. The 52 failures are a property of the mount, not of the
code, and no measurement in this memo depends on the database at all.

---

## 1. The current relationship model, in three layers

A publisher-stated relationship passes through three representations before it
would reach a user, and **each layer weakens or drops it**. That is the thing
to see first, because most of the policy question is about which layer the
decision belongs to.

### Layer 1 — the record schema (`src/lib/domain/public-record.ts`)

```ts
PublicRecordRelationSchema = {
  predicate: string,                 // adapter-normalised publisher predicate
  targetRegistryRecordId: string,    // the PUBLISHER's id for the other end
}
```

Two properties are load-bearing and were chosen deliberately:

- `predicate` is **free text, not an enum**. A new publisher's relation type is
  data, not a schema change. Nothing validates it against a vocabulary, which
  also means nothing prevents a future adapter from inventing one.
- `targetRegistryRecordId` is *"the publisher's id for the other end — never a
  CIPHER entity id."* The schema therefore **cannot express a resolved link**.
  A relation names a record in the publisher's namespace; whether we hold that
  record, and whether it is the same entity as one of ours, is a separate
  question the schema refuses to answer.

There is no field for relationship *direction beyond the predicate*, no field
for a percentage, no field for a period of validity, and no field for the
publisher's stated *absence* of a relationship.

### Layer 2 — extraction (`src/lib/extraction/extract.ts`)

Each `relations[]` entry becomes one `relationship_mention` fact:

```
kind: "relationship_mention", path: "relations[i]", type: "registry_relation"
  relationshipType: <the publisher predicate>
  subject:          <this record's registryRecordId>
  observedValue:    <the target registryRecordId>
```

Fully provenanced, and still entirely in the publisher's namespace. The
comment above it is explicit that this is not a link: *"no cross-record link is
made: `relations[]` records the publisher's own id for the other end, never a
CIPHER entity id."*

### Layer 3 — graph synthesis (`src/lib/graph/build.ts`) — where it stops

`RELATIONSHIP_TYPES` is `communication | financial | co_location | family |
associate | ownership | other`. `is_directly_consolidated_by` and
`is_ultimately_consolidated_by` match none of them, fall through to the default
branch, and are **skipped with a warning**:

> `Unsupported relationship_mention type "..." on <id>; skipped.`

This is not an oversight; the code says why, and the reason is the right one:

> *"inventing a type or folding it into `ownership` here would assert a claim
> the publisher did not make."*

**And `ownership` is genuinely not available.** In this codebase `ownership`
already means *person → identifier* — `has_phone`, `has_account`,
`has_vehicle`, `phone_bound_to_imei`, `vehicle_registered_to`. Thirty-eight of
Operation DarkNet Delhi's 196 edges are that. Routing corporate consolidation
into the same enum value would give one edge type two incompatible meanings and
would silently change what the existing synthetic evaluation's 38 `ownership`
edges mean.

**Net effect today: all 154 edges are collected, provenanced, extracted, and
then dropped at the graph boundary.** Nothing in resolution reads them either —
`resolve.ts` reads identifiers (Tier A, LEI only) and names (Tier B/B2), never
`relations`.

### What resolution currently means by identity

- **Tier A** merges on a shared identifier, and `MERGEABLE_IDENTIFIER_SCHEMES`
  is `{ LEI }` only. An LEI denotes exactly one legal entity (ISO 17442).
- **Identifier authority** (P6.15.1, approved 2026-09-03): authority belongs to
  the *(source, scheme)* pair; a cross-reference may corroborate an identity but
  may never establish or override one. Conflicts are **flagged, never bridged**.
- **Tier B / B2** merge identifier-less mentions on exact and normalised name.

So the resolver's operative definition of "same entity" is already: *the same
LEI, as stated by GLEIF*. Everything in this memo has to be consistent with
that, because it is approved policy.

---

## 2. What the 154 edges actually establish

All figures recomputed from `evidence/expanded/gleif-level2.public-records.json`
and the stored raw payloads. They reproduce P6.20 exactly.

### 2.1 Shape

| Measure | Value |
|---|---|
| Edges | **154** |
| Predicates present | exactly **two** |
| `is_directly_consolidated_by` | 76 |
| `is_ultimately_consolidated_by` | 78 |
| LEIs stating ≥1 parent | 82 of 345 asked |
| Asked LEIs stating **no** parent | **263** |
| Distinct parents named | 85 |
| LEIs stating **both** direct and ultimate | 72 |
| …of those, direct **==** ultimate (parent is the top) | **55** |
| …of those, direct **≠** ultimate (a real intermediate holding) | **17** |
| Reciprocal edges (a→b and b→a) | **0** |
| Chains inside the collected set (a named parent that itself names one) | **0** |

### 2.2 The finding that matters most for graph construction

| | |
|---|---|
| Edges whose target we **hold a record for** | **30 of 154 (19.5%)** — 18 distinct pairs |
| Edges pointing at an LEI we hold **no record for** | **124 of 154 (80.5%)** — 72 distinct LEIs |

**Four out of five edges name a company that is not in the corpus.** Any policy
that puts consolidation into the graph has to answer what the other end of
those 124 edges *is*: a stub node minted from an LEI and nothing else, a
dropped edge, or a new collection. That is a decision, and it is not a small
one — it is the difference between a graph with 18 real corporate pairs in it
and a graph with 72 new single-attribute nodes.

Of the 30 both-ends-held edges, **20 share at least one name token and 10 share
none** (`aktsiaselts A. Le Coq` → `Olvi Oyj`; `T-MOBILE POLSKA SPÓŁKA AKCYJNA`
→ `DEUTSCHE TELEKOM AG`). **16 of the 30 cross a jurisdiction boundary.** Name
similarity is therefore *not* a proxy for the relationship, in either
direction — which is the direct answer to constraint 5 of the brief.

### 2.3 The 33 hard negatives are two relations, not one

P6.20 measured "publisher-related" as a single predicate and reported
**33 / 146 (22.6%)** against a **0 / 500 (0.0%)** control. Decomposed:

| Shape | Count | Example |
|---|---|---|
| **Directed** — one record consolidates the other | **20** | `CARLSBERG A/S` ↔ `Carlsberg Sverige Aktiebolag` |
| **Sibling** — both consolidate up to the same ultimate parent | **13** | `T-MOBILE US, INC.` ↔ `T-MOBILE POLSKA SPÓŁKA AKCYJNA` |

There are **9 sibling groups** among the collected LEIs, covering 20 LEIs, the
largest with 3 members. A sibling relation is a *different fact* from a parent
relation: neither entity stands above the other, and the shared parent may not
be in the corpus at all. Collapsing the two into one flag was correct for
measuring a guard; it is **not** adequate for a graph edge, because the two
would draw different pictures.

By source pairing the 33 split `gleif × wikidata` 14, `wikidata × wikidata` 11,
`gleif × gleif` 8 — the effect is not an artefact of one publisher.

### 2.4 What the predicates do and do not say

GLEIF Level 2 publishes **accounting consolidation** relationships. The
predicate is literally *"is directly consolidated by"* — X's financials are
consolidated into Y's under the applicable accounting standard.

That is **not** the same claim as any of these, and the data contains none of
them:

- **not** an ownership percentage — no percentage is published or stored;
- **not** legal control — consolidation and control diverge in both directions
  (joint ventures, non-consolidating majority holdings, variable-interest
  entities);
- **not** "parent company" in the everyday or company-law sense;
- **not** a *current* fact with a stated validity period — the record carries
  an `observedAt`, nothing more.

Constraint 6 of the brief — *do not invent a relationship type unsupported by
the source evidence* — has a precise consequence here: **any type or label the
project adds must be named for consolidation, not for ownership or control.**
Naming it `owns` or `parent_of` would be a fabrication in the schema itself,
and would be indistinguishable from real ownership data if such data were ever
added.

### 2.5 New this phase: the publisher is far less silent than P6.20 recorded

This is measured from **payloads already on disk**. No request was made, no
collection was broadened, and nothing was re-fetched.

Every GLEIF Level-1 record carries a `relationships` block that says, per
parent kind, whether the entity has a **relationship record** or a **reporting
exception**. Across the 345 asked LEIs:

| Level-1 payload advertises | Count |
|---|---|
| a parent **relationship-record** | **82** — exactly the 82 that produced the 154 edges |
| a parent **reporting-exception** | **251** |
| neither link | **12** |

The 82 reconciles exactly with P6.20's edge count, which is a useful
consistency check on the whole collection.

**The 251 changes the reading of P6.20 §5.** That section reported the Telstra
and Cultura cases as *"a genuine coverage limit of the publisher"* on the basis
of an HTTP 404. The 404 is accurate — there is no *relationship* record — but
it is not the publisher's whole answer. Checked individually:

| Entity | LEI | direct-parent | ultimate-parent |
|---|---|---|---|
| TELSTRA GROUP LIMITED | `894500WRW54CVN62K416` | reporting-exception | reporting-exception |
| TELSTRA CORPORATION LIMITED | `PCTXNQGRJVR3OG33JG65` | reporting-exception | reporting-exception |
| CULTURA SPAREBANK | `5967007LIEEXZXFBIG54` | reporting-exception | reporting-exception |
| BNP PARIBAS | `R0MUWSFPU8MPRO8K5P83` | reporting-exception | reporting-exception |

For all four, GLEIF **published a reason** at
`/lei-records/<lei>/{direct,ultimate}-parent-reporting-exception`, an endpoint
this project has never called. The reason codes are a small closed vocabulary
(`NO_LEI`, `NON_CONSOLIDATING`, `NO_KNOWN_PERSON`, and similar). P6.20's own
prose already quotes Telstra's as
`DIRECT_ACCOUNTING_CONSOLIDATION_PARENT` / `NO_KNOWN_PERSON`, so the fact was
known; what was not recorded is that it is **systematically available for 251
of the 345 asked LEIs** and is fetchable under the same approved source and
licence, one bounded request per LEI.

The correction to the record is narrow and should be stated plainly:

> P6.20 §5's "genuine coverage limit of the publisher" is **partly** a coverage
> limit and **partly** an un-asked endpoint. GLEIF does not publish an edge
> from TELSTRA CORPORATION up to TELSTRA GROUP — that part stands. But it does
> publish, for both, a statement that no consolidating parent exists and why,
> and this project has not asked for it.

**Also un-asked:** 9 of the 345 carry `successor-entity` links (13 across all
608 Level-1 payloads on disk). A successor relation is the one GLEIF relation
that is potentially **identity-preserving** — it is how a register expresses
that an entity continued as another after a merger or reorganisation. It is
noted here and deliberately left undecided; see §7.

---

## 3. Identity-preserving vs identity-distinguishing

This is the classification the brief asks for, and it is short.

| Relation | Class | Why |
|---|---|---|
| Same LEI, two publishers | **Identity-preserving** | ISO 17442: one LEI = one legal entity. This is Tier A, already approved, and is what all 578 positives are. |
| `is_directly_consolidated_by` | **Identity-distinguishing** | Both ends hold distinct LEIs *by construction* — GLEIF issues one per legal entity and will not issue an edge from an entity to itself. A stated edge is positive evidence of **two** entities. |
| `is_ultimately_consolidated_by` | **Identity-distinguishing** | Same, one level higher. |
| Shared ultimate parent (sibling) | **Identity-distinguishing** | Two distinct LEIs both consolidating into a third. Neither is above the other. |
| Reporting exception | **Neither** | A statement that *no parent exists*. It says nothing about whether two records are the same entity. Useful context; not identity evidence. |
| HTTP 404 / not asked | **Neither** | Absence of an answer. Must never be read as either. |
| `successor-entity` | **Possibly identity-preserving — undecided** | Not collected, not measured, not proposed here. |

The single most important line for the resolver: **a consolidation edge is
evidence *against* a merge and can never be evidence *for* one.** P6.20
measured that in the only way that could falsify it — the guard blocks
**0 of 578** true positives — and it holds by construction as well as by
measurement, because a positive is two publishers stating the *same* LEI and
the guard only ever fires on *different* LEIs.

---

## 4. Definitions the product should adopt

Proposed for approval. These are wording decisions with consequences, not
descriptions of code that exists.

| Term | Proposed meaning in CIPHER | Established by |
|---|---|---|
| **Same legal entity** | Two records carrying the same LEI, from any publisher, subject to the identifier-authority policy. | Tier A. Already approved. Unchanged. |
| **Consolidating parent (direct)** | The entity into whose financial statements this entity is directly consolidated, **as GLEIF states it**. | `is_directly_consolidated_by`. 76 edges. |
| **Ultimate consolidating parent** | The top of that consolidation chain, as GLEIF states it. | `is_ultimately_consolidated_by`. 78 edges. |
| **Consolidation sibling** | Two distinct entities naming the same ultimate consolidating parent. | Derived, from two edges. 13 hard-negative pairs, 9 groups. |
| **Parent company** | **Not defined. Not used.** | — |
| **Subsidiary** | **Not defined. Not used.** | — |
| **Controlled entity** | **Not defined. Not used.** | — |
| **Ownership relationship** | **Not defined for organisations.** `ownership` remains person → identifier. | — |
| **Related entity** | An umbrella for *any* publisher-stated relation between two distinct entities. Deliberately weak; carries no direction and no semantics. | Any of the above. |

Three of these are refusals, and each is deliberate. "Parent company",
"subsidiary" and "controlled entity" are legal and economic concepts that the
collected evidence does not establish (§2.4). Defining them now, on
consolidation data, would put a claim in the schema that no source supports,
and every later reader would take the schema at its word.

---

## 5. Candidate policies

Five, from least to most invasive. Each is stated as what it changes, followed
by its exact measured effect.

### Policy A — Status quo
Collect and provenance relationships; drop them at the graph boundary; resolver
never reads them.

### Policy B — Negative constraint only (the P6.20 guard, enabled)
Relationship evidence becomes a **non-merge constraint** in resolution. Two
records with different LEIs that GLEIF relates are marked as *distinct
entities*, and no name rule may merge them. No graph edge. No new type.

### Policy C — Graph edge only
Add a new, honestly named relationship type — `consolidation`, directed,
child → parent, with the exact GLEIF predicate preserved as an attribute. The
resolver is untouched. Requires deciding the 124 dangling targets.

### Policy D — B **and** C
The constraint and the edge, as one coherent statement: *these are two
entities, and here is the relation between them.*

### Policy E — Relationship implies identity (merge parent with subsidiary)
Named only to be measured and rejected. **This is exactly what constraint 4 of
the brief forbids**, and the corpus prices it.

### Add-on P — Collect reporting exceptions
Independent of A–E. One bounded request per LEI to
`{direct,ultimate}-parent-reporting-exception`, same approved source, same
licence, same 404-is-an-answer discipline. Turns "no edge" into "no parent, and
here is the publisher's reason" for 251 of 345.

---

## 6. Exact effects

Every number is measured against the 578 positives / 146 hard negatives, at the
shipped resolver.

| | **A** status quo | **B** constraint | **C** edge | **D** both | **E** merge |
|---|---|---|---|---|---|
| **Entity resolution** | unchanged | new negative constraint; nothing new merges | unchanged | as B | consolidation merges entities |
| **False merges (shipped rules)** | **3** | **3** | 3 | **3** | **≥ 33** (all publisher-related hard negatives, incl. 13 sibling pairs) |
| **False merges (+guarded containment)** | 10 | **7** | 10 | **7** | ≥ 33 |
| **True positives blocked** | 0 | **0 / 578** (measured) | 0 | **0** | 0 |
| **Recall** | unchanged | **unchanged** — the guard fires only on different LEIs | unchanged | unchanged | inflated by definition, not by evidence |
| **Precision** | baseline | unchanged on shipped rules; **+3 pairs** protected once containment is considered | unchanged | same as B | **collapses** |
| **Graph construction** | 154 edges dropped, 154 warnings | still dropped | +18 real corporate pairs (30 edges); **124 edges need a decision** | same as C | entities disappear by merging |
| **Fragmentation** | 82 entities with un-surfaced relations | unchanged | reduced *visually*, not by merging | unchanged | eliminated by destroying distinctions |
| **Evidence semantics** | intact | **strengthened** — a publisher statement finally constrains something | intact **only if** the type is named for consolidation | intact | **broken**: consolidation silently becomes identity |
| **DarkNet Delhi** | unchanged | unchanged (guard reads LEIs; the synthetic corpus has none) | unchanged **only if** a new type is added rather than reusing `ownership` | unchanged | unchanged |

Three rows deserve to be read twice.

**Policy E costs at least 30 false merges.** It takes the shipped resolver from
3 to at least 33 — an eleven-fold increase — and 13 of those merges would fuse
two *siblings*, entities with no relation to each other except a shared parent.
`T-MOBILE US, INC.` and `T-MOBILE POLSKA SPÓŁKA AKCYJNA` would become one
company. This is the measurement that closes the question.

**Policy B's benefit on the shipped resolver is zero**, and the memo should not
pretend otherwise. The guard stops 0 of the 3 current false merges. Its entire
measured value — 3 pairs stopped — appears only *if* guarded prefix containment
is later enabled, and P6.20 already recommends against that. What B actually
buys today is **structural**: it establishes that publisher-stated relations
constrain resolution at all, which is the prerequisite for judging any future
recall rule against a stable definition of "false merge". P6.20 §6 makes
exactly this argument for sequencing decision 4 before decision 3.

**Policy C's headline number is 18, not 154.** Eighteen distinct corporate
pairs would appear in the graph. The other 124 edges point at entities the
corpus does not contain.

---

## 7. Recommendation

**Adopt Policy D — the negative constraint and the graph edge — with the
`consolidation` type named for what GLEIF publishes, and adopt add-on P first.**

In implementation order, and this order matters:

1. **Add-on P (collect reporting exceptions).** Bounded — one request per LEI,
   at most 690 for both kinds across the 345, and 251 are known to exist. It is
   the cheapest item here and it repairs the record: it separates *"the
   publisher says there is no parent"* from *"we did not ask"* for 73% of the
   asked set, and it corrects P6.20 §5. It requires no schema decision about
   identity, no resolver change, and no new source approval. Doing it first
   means the policy below is decided against a complete picture of what GLEIF
   actually says.
2. **Policy B, narrowly.** Enable the guard as a non-merge constraint only:
   *two records with different LEIs that GLEIF states a consolidation relation
   between, in either direction, or that both consolidate into the same
   ultimate parent, are distinct entities and may not be merged by any name
   rule.* Recall cost is measured at 0/578. It never merges anything, so it
   cannot introduce a false merge.
3. **Policy C, once the dangling-target question is answered.** New
   `RELATIONSHIP_TYPES` member `consolidation`, directed child → parent, the
   GLEIF predicate preserved verbatim in `attributes`, and the direct/ultimate
   distinction preserved rather than flattened. `ownership` is **not** reused.
   Siblings are **not** an edge — they are two edges to a shared parent, and
   should be derived for display, never stored as a fact GLEIF did not state.

**Against Policy E, unreservedly.** It is forbidden by the brief, it is
contradicted by ISO 17442, and it costs at least 30 false merges on real data.

**Against reusing `ownership`**, and against `parent_of` / `owns` / `controls`
as type names. The evidence is consolidation. The name must be too.

---

## 8. What requires explicit project-owner approval

Nothing below has been done. Each is a decision, not a task.

1. **The definitions in §4** — in particular the three deliberate refusals
   ("parent company", "subsidiary", "controlled entity" are *not* defined and
   *not* used). This is the semantic decision the brief asks for.
2. **Policy choice: A, B, C, D or E.** Recommended: **D**, staged as §7.
3. **Add-on P** — collecting `{direct,ultimate}-parent-reporting-exception`.
   This is a *new endpoint on an already-approved source*, so it needs the same
   yes/no P6.20's Level-2 collection got. Bounded at ≤ 690 requests.
   ⚠ It is a collection step; the brief forbids broadening public-data
   collection without approval, so it is listed here and **not** performed.
4. **The 124 dangling targets** — required before Policy C can be built. Three
   options, and they are not equivalent:
   - *drop* — build only the 18 both-ends-held pairs; the graph understates the
     structure but contains nothing unsupported;
   - *stub node* — mint an organisation node from an LEI with no name and no
     record; 72 new nodes whose only attribute is an identifier;
   - *collect* — fetch the 72 parent LEIs as Level-1 records. Bounded and
     cheap, but it is again broadened collection and needs approval.
5. **Whether a resolution-blocking constraint may come from a source other than
   an identifier.** Policy B is the first time a *relationship* would change
   what the resolver may do. The identifier-authority policy governs identifiers
   only; this extends the same idea to relations and should be recorded as its
   own governance decision, not folded in silently.
6. **`successor-entity`** — 9 in the asked set, 13 on disk. Potentially the one
   identity-*preserving* GLEIF relation. **No recommendation is offered**: it
   has not been collected or measured, and guessing at it would be exactly the
   error P6.20 corrected. Flagged so it is not lost.
7. **The correction to P6.20 §5** (§2.5 above) — whether to amend that document
   in place or record the correction here and cross-reference it.

---

## 9. Validation

- `vitest run` — **621 / 621**, before and after the P6.21.1 rename.
- `tsc --noEmit` clean; `eslint .` clean.
- `src/lib/resolution/` byte-identical to `a00cdf3`. `src/lib/graph/` likewise.
- Every figure in §2 recomputed from the stored artifacts and raw payloads; the
  82 / 154 / 578 / 146 / 33 / 0-of-500 figures reproduce P6.20 exactly.
- The §2.5 figures (82 / 251 / 12, and the four named entities) are derived from
  Level-1 payloads **already on disk**. No request was issued in this phase.
- No synthetic data, no DarkNet Delhi measurement, and no ML anywhere.
