# Identifier authority — policy proposal

**Status: PROPOSAL. Nothing here is implemented. No resolver or matching logic was
changed, and the numbers below are measurements of current behaviour, not of a fix.**

**Date:** 2026-09-03
**Occasion:** the single false merge in `docs/evaluation/cross-source-experiment.md`
**Decision owner:** project owner. §7 lists what needs answering; §8 lists what does not.

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
indistinguishable in the output from the 24 correct merges beside it. All of that is
now asserted in
`tests/unit/resolution.test.ts › Tier-A identifier bridging (characterization)`.

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
P6.4 documents the choice. Pinned by a characterization test so no future change removes
it silently.

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
