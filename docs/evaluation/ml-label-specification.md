# Label specification — CIPHER entity-resolution pairs

**Applies to:** `evidence/ml/pair-dataset.json` v1.0.0

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

**Count:** 578. **Provenance:** `pairId`, `basis`, `sourcePairing` and
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

**Count:** 146 — 141 under LEI, 5 under CIK; 3 by normalised-name
collision, 143 by shared leading token.

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

**Count:** 1,017. Mined **after** partitions are fixed and **within** a
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

**Count:** 2,312, at four per positive per partition. This is the
operating distribution — most pairs an investigator could form are
unrelated — and it is what makes the false-merge rate meaningful.

## 5. Never comparable, therefore never labelled

A GLEIF record and an EDGAR record share no identifier scheme, because
EDGAR publishes no LEI. Such a pair is **not comparable**: nothing in the
data makes it same or different. 94 name collisions fall here. They are
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

All 154 collected GLEIF Level-2 edges are excluded from this dataset
entirely. P6.21.2 recorded four owner decisions on exactly this question
and none has been approved; the semantics are frozen, not guessed. Any
relationship label would be ambiguous under an undecided policy, so none
is used.

## 7. Ground truth is never edited to improve a metric

The 578 positives and 146 hard negatives are the P6.19 ground truth,
unmodified. The evaluation's error table exists to record disagreements
between the model and the labels; the recommended action on every row is
a feature or a review, and never a label change.

## 8. Label provenance carried per row

Each pair stores `labelClass`, `labelBasis`, `labelReason` (the full rule
text), `sourcePairing`, both `recordRef`s, both subjects, the scheme
involved, and — for positives — the P6.19 `variation` class, which is used
for slicing results and is never a feature.
