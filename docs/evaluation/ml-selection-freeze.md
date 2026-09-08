# P6.27 — Selection freeze, written before test #3 was scored

**Phase:** P6.27
**Status at the time of writing:** test #3 is built, leakage-audited PASS 13/13,
and **has not been scored by any model.**

This document fixes the candidate, the threshold and the decision rule before
a single number comes back from the untouched test. It is committed in its own
commit, ahead of the evaluation commit, so the ordering is provable from
`git log` rather than asserted — the same device the country declaration used.

---

## 1. What was trained

Both candidates use the P6.27 feature set (31 trainable features: the 26 the
shipped model uses, plus `coreNameMatch`, `coreTokenJaccard`, `coreTrigramDice`,
`idfWeightedJaccard`, `maxSharedTokenIdf`). Both were selected inside their own
dataset's validation partition by the existing experiment ladder E1–E7.

| Artifact | Corpus | Model | Features | Threshold | Validation R / P / FMR | weightsDigest |
|---|---|---|---|---|---|---|
| `cipher-er-pair-classifier.v2.json` (**shipped**) | v2 | E2 logistic regression | 26 | 0.9774753387972909 | 79.7% / — / — | `6948e6bc…` |
| `cipher-er-pair-classifier.v2lf.json` (**candidate**) | v2 | E3 gradient-boosted trees | 31 | 0.9708364394896696 | 85.3% / 99.3% / 0.13% | `b9a90ca9…` |
| `cipher-er-pair-classifier.v3lf.json` (context only) | v3 | E3 gradient-boosted trees | 31 | 0.9481230784070942 | 83.0% / 99.5% / 0.09% | `3d70f913…` |

---

## 2. Why the candidate is the v2-corpus model, decided without test #3

**The two candidates' validation numbers cannot be compared with each other.**
They come from different validation partitions — v2's and v3's — and v3 was not
built to exclude v2's subjects, so v3lf may well have been fitted on the very
records v2's validation partition holds. Reading 85.3% against 83.0% as a
ranking would be reading noise at best and leakage at worst. This is stated
because it is the sort of comparison that gets made silently.

So the candidate is chosen on three grounds that do not require a common set,
and none of them is a number from test #3:

1. **It isolates the variable.** The shipped model is v2-trained. A v2-trained
   candidate differs from it in the feature set and nothing else, so whatever
   test #3 says is attributable to the P6.27 features. A v3-trained candidate
   would confound the feature change with a corpus change.

2. **The corpus change was already measured and already rejected.** P6.26 scored
   v3 against v2 on frozen test #2: v3 recovered **82 fewer real pairs**
   (1,382 against 1,464 of 1,792) and its false merges were qualitatively worse
   — 5 of 25 joined wholly unrelated companies, against 0 of 28 for the shipped
   model. That evidence stands even though the instrument that produced it is
   now spent.

3. **v3's corpus is design-exposed.** It was collected against a failure the
   model was observed to have. That is legitimate for training data and it is a
   poor basis for the model a product ships.

`v3lf` is therefore **reported for context and is not eligible to ship in this
phase.** If it looks better on test #3, that is an observation to carry into a
later phase with its own fresh instrument — not a licence to switch, because
switching on that basis is selection on the test set.

---

## 3. The decision rule, fixed now

Test #3 is scored **once**, on two models: the shipped `v2` and the candidate
`v2lf`. The rule:

**SHIP the candidate** only if BOTH hold:
- **(a) Net identity recovery improves.** It recovers more true positives than
  the shipped model at each model's own frozen threshold.
- **(b) False merges do not get qualitatively worse.** The shipped model's false
  merges on test #2 were *all* corporate-family pairs — genuinely related
  entities, which is the P6.21.2 open question rather than a defect. A candidate
  that introduces merges between **wholly unrelated** companies fails (b) even
  if it wins on (a). This is the exact ground on which v3 was rejected in
  P6.26, and applying a weaker standard now would make that rejection
  retrospective theatre.

**KEEP v2** if either fails.

Aggregate F1 is **not** the criterion. In investigative entity resolution a
false merge fuses two real companies into one node and every downstream
inference inherits it; a miss leaves two nodes that a human can still join.
The two errors are not interchangeable and a single blended score would treat
them as though they were.

---

## 4. Identity definition in force

Unchanged, from `parent-subsidiary-policy.md` (P6.21.2): **same legal entity =
same LEI.** "Parent company", "subsidiary" and "controlled entity" remain
deliberately undefined and unused. A parent/subsidiary pair is therefore a
**negative**, and a model that merges one has made a false merge — but a
false merge of that class is materially less alarming than one between
unrelated companies, which is why criterion (b) distinguishes them rather than
counting them together.

---

## 5. What must not happen after this point

- Test #3 must not be scored more than once per model.
- Neither the candidate, its feature set, nor its threshold may change in
  response to anything test #3 says. If the candidate loses, the outcome is
  **KEEP V2** and a documented next step — not a retune.
- If a retune is later justified, it needs a **fourth** instrument. Test #3
  will be spent the moment its results are read, and this document will be
  updated to say so.
