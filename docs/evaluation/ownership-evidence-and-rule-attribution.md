# P6.20 — Ownership evidence, and what the rule table was actually costing

**Phase:** P6.20 (P6.20.1–P6.20.3)
**Data class:** REAL. GLEIF (SRC-002, CC0 1.0) and the expanded real corpus.
**Resolution semantics changed:** **NONE.** `src/lib/resolution/` is byte-identical
to `cf466a0` (`git diff cf466a0 -- src/lib/resolution/` is empty).
**Rules enabled:** **NONE.** Everything below is measurement.
**ML:** none started, none justified.

---

## 1. Why this phase happened at all

P6.19 closed with four decisions for the owner and a recommendation attached to
two of them:

> 1. Enable `officialName` as its own Tier-B evidence type — +95 pairs, zero cost *(recommended)*
> 2. Enable the dotted-legal-form fix and leading-article rule — +13, zero cost *(recommended)*

**Both "zero cost" readings were wrong, and the JSON P6.19 itself wrote says so.**
`reports/expanded/deterministic-ceiling.json` records hard-negative false merges of
3 for the shipped resolver, **4** under the official-name rule and **5** under
R1/R2 + official name. The prose reported the recall column and did not read
across to the precision column.

A count could not have settled it either way, which is the deeper problem. "4
false merges" does not say whether the fourth is a near-miss a guard should have
caught or a pair no rule could ever separate, and it does not say whether the +95
positives arrived through the evidence the rule claims to use. So the first thing
this phase built was attribution, not another rule.

## 2. P6.20.1 — which pairs, not how many

`scripts/rule-attribution.ts`. Measurement only: imports no resolver, runs no
pipeline, writes no database. It rebuilds each rule's merge graph with **labelled
edges** and reconstructs the path between every merged pair, so each merge can
name the exact key that caused it. A union-find alone loses that.

Measured against the same 578 positives and 146 hard negatives:

| Rule | Joined | Hard-negative false merges | vs shipped |
|---|---|---|---|
| shipped (today's Tier B2) | 249 (43.1%) | 3 | — |
| + dotted form & article (R1/R2) | 262 (45.3%) | **4** | +13 pairs, **+1 false merge** |
| + official name (P1448) | 344 (59.5%) | **4** | +95 pairs, **+1 false merge** |
| + R1, R2 and official name | 357 (61.8%) | **5** | +108 pairs, **+2 false merges** |
| + guarded prefix containment | 450 (77.9%) | **10** | +201 pairs, **+7 false merges** |

The two new false merges, named:

- **EN-0103** `SIMON PROPERTY GROUP, INC.` [LEI:529900GQL5X8H7AO3T64] ==
  `SIMON PROPERTY GROUP, L.P.` [LEI:MR92GTD0MJTTTTQDVG45] — introduced by R1.
- **EN-0124** `GENERTEL S.P.A.` [LEI:815600DEEE5337E9A213] == `Genertel`
  [LEI:549300EWN48Q47PAWX22] — introduced by the official name.

### EN-0103 is a rule defect, not bad luck

`stripDotted` consumes a trailing run of single letters whose concatenation is a
known legal form, so `l p` → removed. The shipped normaliser already strips a
trailing `inc`. Both names therefore reduce to `simon property group`, and **the
only token distinguishing a REIT from its operating partnership is the token the
rule removes.**

This is worth stating precisely because R1 was described as a defect fix. It is:
dotted and undotted spellings of a legal form genuinely should agree. But the
class of harm it extends is one the shipped resolver already has — `ENDESA` /
`ENDESA SA` (EN-0001) is the same failure without a single dot in it. **Legal-suffix
stripping conflates entities that differ only by legal form, and R1 widens the
blast radius rather than creating it.**

## 3. The observation that set up P6.20.2

The five pairs guarded containment newly merges are not a random sample of
strings:

| Pair | Names |
|---|---|
| EN-0071 | TELSTRA GROUP LIMITED / TELSTRA CORPORATION LIMITED |
| EN-0129, EN-0130 | BNP PARIBAS / BNP PARIBAS CARDIF POJIŠŤOVNA |
| EN-0137 | Cultura / Cultura Sparebank |
| EN-0143 | Kooperativa pojišťovna / Kooperativa |

Every one reads as a group and one of its members. That is a **hypothesis about
where the evidence lives**, not a matching idea: if these are ownership
relationships, the publisher that issued both LEIs may already state them.

## 4. P6.20.2 — the approved half of SRC-002 that was never requested

SRC-002 is registered as **"GLEIF LEI (Level 1 + Level 2)"**, status APPROVED,
CC0 1.0 — Level 2 needed no new approval. The adapter had `mapGleifRelationship`,
`normaliseGleifPredicate` and a `relations` parameter on `mapGleifRecord` since
an earlier phase.

**None of it could ever fire.** `collectGleif` called exactly one endpoint,
`/lei-records`, and no `/lei-records` payload contains a relationship record. The
pass-1 branch that maps relationships had no reachable input. **Relationship
coverage read 0 because nothing asked, not because GLEIF withholds the data.**

`collectGleif` now takes `withRelationships` and fetches two per-LEI
sub-resources, `direct-parent-relationship` and `ultimate-parent-relationship`.

Both are needed and neither substitutes for the other: BNP PARIBAS CARDIF
POJIŠŤOVNA's *direct* parent is BNP PARIBAS CARDIF, an intermediate holding
company sharing no distinguishing token with the group; its *ultimate* parent is
BNP PARIBAS. Collecting only the direct parent would have left the containment
question exactly as unanswerable as before.

There is deliberately **no** `direct-children`/`ultimate-children` collection.
Those endpoints are paged collections whose size is a property of the parent
rather than of the request, so they are not bounded by construction the way a
parent look-up is. The parent direction carries the same edges, stated from the
other end.

**HTTP 404 is the publisher's answer, not a failure.** GLEIF returns it for an
entity stating no parent of that kind, which is the common case. Treating it as a
fetch error would abort a run on its most ordinary result and would make "no
parent stated" indistinguishable from "we could not ask". It is counted and
reported separately.

### The bound, and why it is not question-begging

345 of the corpus's 661 distinct LEIs, chosen by `scripts/build-relationship-linkage-set.ts`.
The selection rule is a property of the **pair class**, fixed before any
relationship was fetched: every LEI appearing in a hard negative (111), a
containment positive (151), a partial-token-overlap positive (68) or a
**divergent** positive (64).

Divergent is in deliberately. It is the class where a parent edge is *not*
expected to help, and dropping it would leave a sample that could only make the
result look favourable. Excluded are identical, case-only, legal-suffix and
script-variant pairs, which already join or fail for reasons unrelated to
ownership.

**Collected:** 345 records, 5 manifests, all `direct-https`, raw payloads written
before anything derived and individually hashed. **82 LEIs state at least one
parent; 154 edges** (76 `is_directly_consolidated_by`, 78 `is_ultimately_consolidated_by`).

## 5. P6.20.3 — is a stated ownership edge a usable false-merge guard?

`scripts/relationship-evidence-study.ts`. The guard, stated as one predicate:

> Two records with **different** LEIs are *publisher-related* when GLEIF states a
> consolidation edge between them in either direction, or states that both
> consolidate up to the same ultimate parent.

An edge is evidence that the two are **two entities** — evidence *against*
merging, never for it. It is silent when both records carry the same LEI, which
is the positive case.

| Measurement | Result |
|---|---|
| Hard negatives carrying a publisher-stated relation | **33 / 146 (22.6%)** |
| True positives the guard would wrongly block | **0 / 578** |
| Random distinct-LEI control pairs related | **0 / 500 (0.0%)** |

The control set is a deterministic, seed-fixed sample drawn from the same
asked-for LEI population. **22.6% against 0.0% is the whole result**: the edges
are specific to exactly the pairs the corpus says must not merge, and they are
not a background property of any two companies.

The falsification test is the middle row. A guard that bought precision by
blocking true joins would be worse than nothing; it blocks none, and that is
measured over all 578 positives rather than argued from the definition.

### What it is worth against each rule

| Rule | False merges before | **after guard** | stopped |
|---|---|---|---|
| shipped | 3 | 3 | 0 |
| R1/R2 | 4 | 4 | 0 |
| official name | 4 | 4 | 0 |
| R1/R2 + official | 5 | 5 | 0 |
| **+ guarded prefix containment** | 10 | **7** | **3** (EN-0129, EN-0130, EN-0143) |

**The guard does not rescue guarded containment.** 7 false merges is still more
than double the shipped 3, and the two headline group pairs survive it:

- **EN-0071 Telstra.** GLEIF returns 404 for both parent relations on *both*
  LEIs. TELSTRA GROUP LIMITED carries a `reporting-exception` of
  `DIRECT_ACCOUNTING_CONSOLIDATION_PARENT` / `NO_KNOWN_PERSON` — it is the top of
  its own chain — but the edge from TELSTRA CORPORATION *up* to it is simply not
  published.
- **EN-0137 Cultura / Cultura Sparebank.** Neither LEI states any parent.

This is a genuine coverage limit of the publisher and is reported as one. It also
bounds the claim: ownership evidence explains **part** of the containment class,
not all of it.

## 6. What this changes about the residual

The containment class (160 positives, 0 joined today) has been treated as a
matching problem awaiting a looser matcher. The measurement says it is at least
partly a **relationship** problem: for 33 of the 146 hard negatives the publisher
already states why the two names are close and still different. For those pairs
the correct output is an **edge in the graph**, not a merge — and an edge is
something the schema already represents.

That is a different piece of work from raising a join rate, and it is not an ML
target. It is also the reason the parent/subsidiary policy (decision 4) has to be
taken before guarded containment (decision 3): until "parent" has a defined
output, "false merge" does not have a stable definition to measure against.

## 7. Validation

- **621/621 vitest** (615 before, **+6** pinning the Level 2 request path).
- `tsc --noEmit` clean, `eslint .` clean.
- **DarkNet Delhi: all 21 metric values re-measure identically.**
- `src/lib/resolution/` byte-identical to `cf466a0`.
- Cross-source, no-identifier and synthetic corpora untouched and still isolated.
- Provenance: 5 manifests, `direct-https`, every raw payload stored and hashed.

## 8. Decisions still open (unchanged in kind, now priced properly)

1. **`officialName` as a Tier-B evidence type** — +95 pairs, **+1 false merge**
   (EN-0124), not zero.
2. **Dotted legal form / leading article** — +13 pairs, **+1 false merge**
   (EN-0103), not zero, and EN-0103 is caused by the rule stripping the
   discriminating token.
3. **Guarded prefix containment** — +201 pairs, +7 false merges even with the
   ownership guard. Not recommended.
4. **Parent/subsidiary policy** — now has real evidence behind it (154 edges) and
   still has to be decided before 3.
5. **The ownership guard itself** — 22.6% precision signal, 0 recall cost, but it
   changes what the resolver may do, so it is not enabled here.
