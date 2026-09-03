# Identifier authority — policy proposal

**Status: APPROVED AND IMPLEMENTED (P6.15), 2026-09-03.**

§1–§6 are the analysis and the options as they were put to the project owner, kept
unedited so the decision record shows what was actually chosen from. **§9 is what was
built**, and it is the authority on current behaviour. §7's open questions are answered
in §9.6.

**Date:** 2026-09-03
**Occasion:** the single false merge in `docs/evaluation/cross-source-experiment.md`
**Decided by:** project owner, 2026-09-03 — Option 2 with Option 3 as its fallback.

---

## 1. What actually happened

`falseMergeRate 4.0% (1/25)`, and the merge did not come from a name.

```
entity_fea633b49ede17c28390
  LEI:253400DR5QSH8MEGZZ11   Публичное акционерное общество "Юнипро"   (RU, GLEIF)
  LEI:98450016D1DA0D640356   UNIPRO                                     (GLEIF)
  wikidata:Q188087           Unipro                                     (Wikidata)
```

**Mechanism, confirmed in code and pinned by test.** `resolve.ts` Tier A does this:

```ts
for (const idValue of identifierValues) {
  uf.union(`mention:${mention.id}`, `id:${idValue}`);
}
```

A mention is unioned with *every* identifier its own evidence item states. Union-find is
transitive, so **the mention becomes a bridge between all of them**. Wikidata item
Q188087 states two different LEIs, so:

```
GLEIF-A ──LEI:2534…── Q188087 ──LEI:9845…── GLEIF-B
```

Two unrelated legal entities, one component, one entity. It is reported as
`shared_identifier_merge`, `status: "resolved"`, confidence ≥ 0.9, and **zero warnings** —
indistinguishable in the output from the 24 correct merges beside it.

*(That behaviour was pinned by characterization tests while this was a proposal. Those
tests failed the moment the policy landed — which is what they were for — and were
rewritten as the specification suite described in §9.)*

**Two facts that constrain any fix:**

- **This is not a name problem.** The two GLEIF names share nothing. Fuzzy matching,
  embeddings and LLM adjudication all operate on names and would not have touched this;
  loosening name matching would only add failures on top of it.
- **Provenance quality is not identifier authority.** The registry already rates both
  sources `provenance_quality: HIGH` (Wikidata 8/10, GLEIF 9/10) — and correctly, since
  Wikidata statements do carry references and revision ids. A source can be
  high-quality and still be repeating an identifier it does not issue. **No existing
  registry column would have prevented this**, so this is a new axis rather than a
  threshold to tighten.

## 2. The proposal in one sentence

> Authority is a property of a **(source, identifier scheme)** pair — the body that
> *issues* a scheme is authoritative for it, everyone else is making a cross-reference —
> and a cross-reference may **join** an entity but may never **bridge** two of them.

Wikidata is fully authoritative for `WIKIDATA:Q188087`: it mints QIDs. It is
non-authoritative for `LEI:…`, which GLEIF issues. Today the resolver treats both as
identical evidence. That single distinction is what separates the 24 correct merges from
the 1 wrong one, and it is derivable from the registry rather than hand-ranked.

## 3. Where authority should live

The registry is already the runtime gate (`registry.ts` reads
`docs/data-research/source-registry.csv` at call time, so revoking a source is a CSV
edit rather than a code change). Authority belongs in the same place:

| Proposed column | SRC-001 Wikidata | SRC-002 GLEIF |
|---|---|---|
| `issues_identifier_schemes` | `WIKIDATA` | `LEI` |

Everything else a source states is, by construction, a cross-reference. No ranking table,
no scores, no per-pair matrix to maintain: a source either issues a scheme or it does
not.

## 4. The six cases

Case A is the observed failure. B, C and E are current behaviour that must not regress —
they are stated so a fix cannot quietly break them.

### A. Conflicting identifiers of one scheme, from one record — **OBSERVED, CAUSES THE FAILURE**

`wikidata:Q188087` states `LEI:2534…` **and** `LEI:9845…`. An LEI denotes exactly one
legal entity (ISO 17442), so at most one can be right. Today both are believed and
bridged.

Rate on real data: **1 of 25 Wikidata records (4%)**.

Note the adapter already does the right thing here and deliberately stops short: it keeps
both values, chooses between them nowhere, and warns. The decision was left to
resolution. This is that decision.

### B. Multiple identifiers of *different* schemes, from one record — **MUST KEEP WORKING**

`wikidata:Q188087` also states `WIKIDATA:Q188087`. A record carrying both its own QID and
an LEI is exactly how cross-source joining works at all: **25 of 25 pairs joined this
way**. Any policy that suppresses multi-identifier records wholesale destroys the
experiment's only positive result. The trigger must be *same scheme, conflicting values*,
never *more than one identifier*.

### C. Same scheme, same value, different records — **THE GOOD CASE, MUST KEEP WORKING**

GLEIF `LEI:X` ↔ Wikidata `LEI:X`. 25/25, `identifierMatchRate 100%`. Untouched.

### D. Conflicting identifiers across sources

GLEIF states `LEI:X` for a record; Wikidata states `LEI:Y` for what it calls the same
company. Not directly observed as a merge failure, but the underlying error is measured:
**4 of 26 (15.4%)** Wikidata-supplied LEIs resolve to entities in the wrong jurisdiction
(RU, JP, NL, US-DE) from a query filtered `P17 = India`. The identifiers Wikidata
supplies are wrong at a rate of roughly one in six.

Under the proposal, GLEIF's own LEI on a GLEIF record is authoritative and Wikidata's LEI
is a cross-reference, so the conflict resolves in GLEIF's favour and the cross-reference
is recorded, not obeyed.

### E. Identifier collision across schemes — **ALREADY PREVENTED**

An LEI and a QID that happen to share characters must not merge. Extraction already
scheme-qualifies every value (`LEI:x` vs `WIKIDATA:x`), which is what prevents it, and
P6.4 documents the choice. Pinned by test case (e) so no future change removes it
silently.

Same value, same scheme, genuinely different entities cannot occur for LEI, which is
globally unique by construction. It becomes live only if a weaker scheme is admitted, and
is a reason to be careful about which schemes are ever trusted for merging.

### F. Non-authoritative identifiers generally

The general form of A and D. A cross-reference is a *claim that two things are the same*,
made by a third party. That is precisely the claim entity resolution exists to make, so
accepting it uncritically outsources the system's core judgement to whoever edited a
Wikidata statement.

## 5. Flag vs merge — reuse what already exists

The codebase already contains the right pattern, one tier up. When a name matches ≥2
distinct identifier-anchored entities, Tier B does **not** pick one:

```
resolutionType: "ambiguous_name_conflict"
status:         "ambiguous"
candidateEntityIds: [...]      conflicts: ["…"]
confidence:     0.2            // below the merge floor; never auto-applied
```

— it creates a standalone entity, records both candidates, and warns.

**The proposal is to give Tier A the same treatment it already gives Tier B**, under
`resolutionType: "ambiguous_identifier_conflict"`. No new vocabulary, no new confidence
band, no new UI concept: the ambiguity machinery, the `conflicts[]` field, the sub-merge
confidence and the warning path all exist and are already exercised by tests.

That symmetry is itself an argument. The resolver's stated principle is that ambiguity is
"flagged, never force-merged". Tier A is currently the one place that principle is not
applied — not by decision, but because identifiers were assumed authoritative and no
counter-example existed until now.

## 6. Options for Case A — **the decision to make**

Applies only when one record states ≥2 conflicting values of a scheme. B/C/E are
unaffected by all four.

| | Option | Behaviour | Effect on the observed corpus |
|---|---|---|---|
| **1** | **Don't bridge** *(recommended)* | The record still joins each identifier's cluster individually, but stops being a transitive connector between them. | The two GLEIF entities stay separate. Q188087 attaches to one of them and the choice is arbitrary — which is the objection to this option. |
| **2** | **Authority-ranked** | A cross-reference may join an existing cluster; it may never bridge two. An authoritative identifier bridges normally. | Same separation, principled rather than arbitrary, and generalises to Case D. More to implement, and needs the registry column in §3. |
| **3** | **Flag, merge nothing** | The conflicted record becomes its own entity, `ambiguous_identifier_conflict`, both candidates recorded. | Two correct GLEIF entities plus one flagged Wikidata record. Loses a real join; loses nothing true. |
| **4** | **Status quo** | Accept bridging. | 4% false merge on cross-source data, silent and at full confidence. |

**Recommendation: Option 2, with Option 3 as its fallback** — authority-ranked, and where
authority cannot decide, flag rather than guess. Option 2 alone is the principled rule;
Option 3 is what it should do when the rule runs out. Together they generalise to Case D,
they need no new concepts beyond the registry column, and they keep the system's existing
promise that ambiguity is surfaced rather than resolved by fiat.

**These are projections, not measurements.** Nothing is implemented, so no option has
been run against the corpus. Whichever is chosen should be measured on the existing
cross-source corpus before it is believed.

## 7. Decisions required

1. **Which option in §6.** The recommendation is 2-with-3, but this is a judgement about
   whether a missed join or a wrong join is the worse failure for an investigative tool,
   and that is yours.
2. **Does `ambiguous_identifier_conflict` need to reach the UI**, or is a decision row and
   a warning enough for now? Tier B's equivalent is already surfaced.
3. **Add `issues_identifier_schemes` to the source registry?** It is a schema change to a
   governance artefact, and §3's design assumes it.
4. **Which schemes may ever merge?** LEI is globally unique and safe. QID identifies a
   Wikidata *item*, which is not always one legal entity. Worth an explicit allowlist
   rather than trusting any scheme an adapter emits.
5. **`rel.precision` / `rel.recall` and the evaluation baseline.** Every option changes
   entity counts on cross-source data. The synthetic DarkNet Delhi corpus has no
   `public_record` items and so should be unaffected — but that must be re-measured and
   confirmed, not assumed, before any option is merged.

## 8. Explicitly out of scope

- **No fuzzy matching, embeddings, LLM adjudication or ML.** The observed failure is an
  identifier failure; none of these would have prevented it, and loosening name matching
  would add failures.
- **No change to Tier B.** It never fired on real data
  (`exactNameMatchRate 0%`, `byteIdenticalNamePairs 0%`) and the four name-variation
  hypotheses remain untested.
- **No no-identifier corpus yet.** That is the experiment that would test names, and it
  is deliberately not started.
- **No resolver change in this document.** Proposal only.

---

# 9. As built (P6.15)

## 9.1 What was approved

Option **2 with 3 as fallback**: authority-ranked identifiers, falling back to flag /
no-merge wherever authority cannot establish identity safely.

## 9.2 The rule, as implemented

`src/lib/resolution/identifier-authority.ts` is the whole policy, and it is pure:

- **`MERGEABLE_IDENTIFIER_SCHEMES = { LEI }`.** Only LEI may establish identity in
  Tier A. An LEI denotes exactly one legal entity (ISO 17442) and is globally unique.
- **A Wikidata QID never merges.** A QID identifies a Wikidata *item* — merged, split and
  repurposed by editors, and capable of carrying several LEIs, which is precisely the
  shape that caused the failure. QIDs remain source-local identity and context.
- **A record asserting two or more distinct values of one mergeable scheme is merged on
  NONE of them**, and is flagged `ambiguous_identifier_conflict`. Every value is
  withheld, not just the extras: keeping the first would make identity depend on payload
  ordering, and keeping either would be a guess carrying a merge's confidence.
- **Schemes are isolated.** An LEI conflict does not suppress a clean value of another
  scheme, and two QIDs are not a conflict at all — a scheme that cannot merge cannot
  bridge anything.
- **Unqualified values never merge**, because an unqualified value could collide across
  schemes.

The policy governs **`has_identifier` only** — the registry identifiers a `public_record`
states about its own subject. Phone, account and vehicle identifiers keep their existing
behaviour exactly; a person holding two phones is still merged on both, because
multi-valued is only a contradiction for a scheme where one value denotes one subject.
That scoping is what makes the DarkNet Delhi result provably unchanged rather than
hopefully unchanged.

## 9.3 Flag, not merge — reusing what existed

Phase 2b of `resolveEntities` gives Tier A the treatment Tier B already gave an ambiguous
name: a standalone entity, `status: "ambiguous"`, `CONFIDENCE.ambiguousConflict` (0.2,
below the merge floor), the entities it *would* have merged into recorded in
`candidateEntityIds`, a human-readable `conflicts[]` naming the authority position, and a
warning. No new vocabulary and no UI redesign — the decision row and warning path already
existed and are already rendered.

Conflicted records are withheld from **Tier B as well**. A record whose own identifiers
contradict each other has not become better evidence by having a name, and letting it
merge on the name instead would rebuild the same wrong link through a lower-confidence
door. There is a test for exactly that.

## 9.4 Measured effect

Real cross-source corpus, 51 records, unchanged data:

| | before (P6.14) | after (P6.15) |
|---|---|---|
| **falseMergeRate** | **4.0% (1/25)** | **0.0% (0/27)** |
| crossSourceJoinRate | 100.0% (25/25) | 96.0% (24/25) |
| identifierMatchRate | 100.0% (25/25) | 96.0% (24/25) |
| aliasMatchRate | 100.0% (28/28) | 96.4% (27/28) |
| unresolvedRate | 0.0% (0/51) | 2.0% (1/51) |
| fragmentationRate | 0.0% (0/26) | 3.8% (1/26) |
| provenanceCompleteness | 100.0% | 100.0% (669/669) |
| `ambiguous_identifier_conflict` | — | 1 |

The four metrics that got "worse" are all the same record — Q188087 — no longer being
merged on a claim it contradicts itself about. That is the intended outcome, and the
join it lost was wrong.

**One caveat, stated because the number would otherwise flatter the change.**
`fragmentationRate 3.8%` is **not** a resolver defect. The ground truth keys subjects by
the first LEI on a record, so Q188087 was assigned `LEI:253400…` — a claim the resolver
now correctly refuses to trust. The "fragmented subject" is the ground truth inheriting
Wikidata's contradiction. It was deliberately **not** corrected: editing ground truth to
match a resolver is circular, and the artefact is more honest left visible.

Operation DarkNet Delhi, all 21 metrics: **identical**, including
`rel.precision 100.0%`, `rel.recall 51.2%`, `rel.f1 67.7%` and
`provenance.completeness 100%`. Snapshot counts identical (61 entities, 191
relationships). The GLEIF-only pilot is also unchanged — no GLEIF record states two LEIs.

## 9.5 Governance

`issues_identifier_schemes` was added to `docs/data-research/source-registry.csv`
(SRC-002 → `LEI`, SRC-001 → `WIKIDATA`). The CSV is the decision record; the constants in
`identifier-authority.ts` are its executable form, and
`tests/unit/identifier-authority.test.ts` fails if the two drift or if any scheme is
claimed by two issuers.

## 9.6 §7's questions, answered

1. **Which option** — 2 with 3 as fallback. Built.
2. **UI** — existing decision row plus warning. No redesign.
3. **Registry column** — added.
4. **Which schemes may merge** — LEI only; QID explicitly excluded. Widening the set is a
   governance change and a test asserts the current contents.
5. **Evaluation baseline** — re-measured, not assumed. Identical.

Still open, and untouched by this work: the `IS_FUND-MANAGED_BY` graph modelling decision
(`real-data-pilot.md` §3.2).

