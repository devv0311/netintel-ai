# Label specification — CIPHER entity-resolution pairs

**Applies to all three datasets**, whose labelling rules are identical
character for character:

| Dataset | Positives | Curated hard neg | Mined hard neg | Sampled neg |
| --- | --- | --- | --- | --- |
| `cipher-er-pairs` v1.0.0 (superseded) | 578 | 146 | 1,017 | 2,312 |
| `cipher-er-pairs` v2.0.0 (shipped) | **1,711** | **477** | 1,732 | 6,844 |
| `cipher-er-pairs-final-test` v1.0.0 | **892** | **244** | 553 | 3,568 |

A corpus expansion that also moved the definition of a positive would be
two experiments wearing one name, and neither could be read afterwards.
So the rules below did not change; only the data they were applied to
did. Counts are given per dataset throughout.

The governing rule, from which everything else follows:

> **No label in this project is ever created from name similarity.**

Every label is a deterministic function of identifiers that publishers
state. Name similarity SELECTS which pairs are worth enumerating; it
never decides what they are.

---

## 1. Positive — `cross_source_positive`

**Definition.** Two records that two independent publishers each state
carry the same GLEIF-issued LEI, or the same SEC-issued CIK.

**Why this is proof and not inference.** ISO 17442 assigns exactly one
LEI to one legal entity; the SEC assigns exactly one CIK to one filer.
Two publishers arriving independently at the same identifier is agreement
between two authorities, not a similarity judgement of ours.

**Counts:** 578 (v1) / **1,711** (v2) / **892** (final test).
**Provenance:** `pairId`, `basis`, `sourcePairing` and
both `recordRef`s are carried on every pair, and the rule text itself is
copied into each row's `labelReason`.

**Not accepted as positive:** a shared OpenCorporates id (recorded as
corroboration, never a label); a shared name however exact; a publisher
alias; a consolidation relationship of any kind.

## 2. Hard negative — `hard_negative`

**Definition (inherited verbatim from the P6.19 ground truth).** Two
records that share an identifier scheme, **disagree** on its value, and
whose names actually collide — either they normalise to the same string,
or they share a leading token.

**Counts:** 146 (v1) / **477** (v2) / **244** (final test).

These are the pairs that punish a name-similarity model, and they are
kept as their own class through every report so no aggregate can hide
them.

## 3. Mined hard negative — `mined_hard_negative`

**Definition.** The rule in §2, with one restriction lifted.

`scripts/build-expanded-corpus.ts` enumerated leading-token families only
where the group had between 2 and 6 members
(`v.length > 1 && v.length <= 6`). Families larger than that — the `tata`
and `bank` shapes — were never enumerated, so the corpus contains real
hard negatives its own rule admits and its own enumeration skipped.

**Counts:** 1,017 (v1) / 1,732 (v2) / 553 (final test). Mined **after** partitions are fixed and **within** a
partition only, so no cross-partition pair can be created. The label
still comes from identifier disagreement; the name collision only selects
the pair. The original 146 keep their own class so every result can be
read on the curated set alone.

## 4. Sampled negative — `sampled_negative`

**Definition.** Two records whose subjects share an identifier scheme and
disagree on its value, drawn at random with a fixed seed, within a
partition, excluding any pair already labelled.

**Explicit evidence and reason,** stored on every row: *an LEI denotes
exactly one legal entity and a CIK exactly one SEC filer, so two records
carrying different values of the same scheme denote different entities.*

**Counts:** 2,312 (v1) / 6,844 (v2) / 3,568 (final test), at four per
positive per partition. This is the
operating distribution — most pairs an investigator could form are
unrelated — and it is what makes the false-merge rate meaningful.

## 5. Never comparable, therefore never labelled

A GLEIF record and an EDGAR record share no identifier scheme, because
EDGAR publishes no LEI. Such a pair is **not comparable**: nothing in the
data makes it same or different. 94 (v1) / 247 (v2) / 79 (final test)
name collisions fall here. They are
counted and excluded, never scored as either class.

## 6. Relationships are never identity

The following are **never** treated as evidence of same-entity, in labels
or in features:

- parent → **not identity**
- subsidiary → **not identity**
- controlled entity → **not identity**
- consolidation relationship (`is_directly_consolidated_by`,
  `is_ultimately_consolidated_by`) → **not identity**
- consolidation sibling (shared ultimate parent) → **not identity**

All collected GLEIF Level-2 edges are excluded from every dataset
entirely. P6.21.2 recorded four owner decisions on exactly this question
and none has been approved; the semantics are frozen, not guessed. Any
relationship label would be ambiguous under an undecided policy, so none
is used.

## 7. Ground truth is never edited to improve a metric

Every positive and hard negative is taken verbatim from its corpus's
ground-truth file, unmodified. The evaluation's error table exists to record disagreements
between the model and the labels; the recommended action on every row is
a feature or a review, and never a label change.

## 7a. A note on what the final test then measured

Excluding relationships from the labels does not make the question go
away, and P6.25 put a number on it: **all 46 false merges on the final
frozen test are corporate-family pairs** — `BARCLAYS PLC` against
`BARCLAYS BANK PLC`, `ROLLS-ROYCE HOLDINGS PLC` against `ROLLS-ROYCE
PLC`. The labels are not in doubt: these are distinct legal entities with
distinct publisher-issued identifiers, and the model is simply wrong about
them.

That is the P6.21.2 decision surfacing as a measurement rather than an
opinion, and it is the reason the model remains advisory. It changes
nothing here: no relationship became a label, and no label was softened
to make the number better.

## 8. Label provenance carried per row

Each pair stores `labelClass`, `labelBasis`, `labelReason` (the full rule
text), `sourcePairing`, both `recordRef`s, both subjects, the scheme
involved, and — for positives — the `variation` class, which is used for
slicing results and is never a feature.

One addition in v2, recorded explicitly in the ground truth's own
`labellingRules`: **the country a publisher states is a FEATURE field
only.** Agreement on it never creates a positive and disagreement never
creates a negative. (It is also not the same property across publishers —
see [`ml-dataset-card.md`](./ml-dataset-card.md) §5.)
