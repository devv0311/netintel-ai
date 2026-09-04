# Leakage audit

`scripts/ml/leakage-audit.ts` runs **before** any training and fails
loudly. Every check is a hard assertion with a printed verdict; a FAIL
exits non-zero and the split is rebuilt, not argued with.

```
npm run ml:leakage                                        # v1 (superseded) — FAILS L12, deliberately
node --import ./scripts/eval-resolve.mjs scripts/ml/leakage-audit.ts \
  --dataset evidence/ml/pair-dataset-v2.json --out leakage-audit-v2.json \
  --prior-datasets evidence/ml/pair-dataset.json,evidence/ml/pair-dataset-final-test.json   # v2 — PASS 13/13
node --import ./scripts/eval-resolve.mjs scripts/ml/leakage-audit.ts \
  --dataset evidence/ml/pair-dataset-final-test.json --out leakage-audit-final-test.json \
  --prior-datasets evidence/ml/pair-dataset.json,evidence/ml/pair-dataset-v2.json   # PASS 13/13
```

| Dataset | Verdict | Report |
| --- | --- | --- |
| `cipher-er-pairs` v1.0.0 (superseded) | **FAIL — L12** | `reports/ml/leakage-audit.json` |
| `cipher-er-pairs` v2.0.0 (shipped) | **PASS 13/13** | `reports/ml/leakage-audit-v2.json` |
| `cipher-er-pairs-final-test` v1.0.0 | **PASS 13/13** | `reports/ml/leakage-audit-final-test.json` |

The v1 FAIL is left in the repository as it stands. It is a finding about
a shipped model, and regenerating it into a pass would delete the
evidence.

---

## The checks

| ID | Asserts |
| --- | --- |
| L1 | **Subject disjointness** — the split unit appears in one partition only. |
| L2 | **Declared partition agrees with emitted pairs.** |
| L3 | **Record disjointness** — a record reachable from two partitions is the same entity in both. |
| L4 | **Pair uniqueness** — no unordered record pair twice. |
| L5 | **No identifier field** in the record projection the model sees. |
| L6 | **No identifier accessor** in `src/lib/ml/features.ts`, checked against the source. |
| L7 | **Single-feature AUC** — no feature alone separates the classes almost perfectly (band [0.01, 0.99]). |
| L8 | **Cross-partition identity** — no subject is one entity in two partitions. |
| L9 | **Standardiser fitted on TRAIN rows only.** |
| L10 | **Test untouched** — the training script never references the test partition, checked by grep. |
| L11 | **The frozen test is a ratchet** *(new in P6.25)*. |
| L12 | **No trainable feature value is a one-way veto** *(new in P6.25)*. |
| L13 | **Nothing in a frozen test was fitted on before** *(new in P6.26)*. |

L1–L10 are unchanged from P6.24. L11, L12 and L13 exist because each
caught a real defect that the others could not.

## L11 — a frozen test can thaw when the corpus grows

A subject reaches TEST either by its own `heldout_evaluation` designation
**or by contagion through its connected component**, and component
boundaries move when records are added.

The first v2 build dropped five subjects out of the P6.24 frozen test —
four into TRAIN, one into VALIDATION. Nothing in L1–L10 could see it: the
new split is internally disjoint, and disjointness says nothing about what
an *earlier* frozen test contained.

L11 reads every declared prior dataset and asserts that no subject its
test partition held appears in this dataset's train or validation. The v2
corpus builder additionally reads the P6.24 pair dataset back and promotes
every subject that partition actually held (74 of them) to
`heldout_evaluation`, making the promotion permanent rather than a side
effect of a component boundary that can move again.

**A subject that has once been frozen can never enter TRAIN.**

## L12 — a one-way veto, which L7 provably cannot catch

In the P6.24 dataset:

| Feature | =1 in TRAIN | Alongside a positive |
| --- | --- | --- |
| `jurisdictionBothKnown` | 134 | **0** |
| `jurisdictionCountryMatch` | 59 | **0** |
| `jurisdictionCountryConflict` | 75 | **0** |
| `officialNameBothPresent` | 38 | **0** |

Wikidata published no jurisdiction, and every positive was cross-source
*with* Wikidata, so "both sides state a jurisdiction" meant "same-source"
and therefore "not a positive". The model learned it — correctly for that
corpus, and catastrophically for any other: its recall on unseen pairs is
2.7%. Only Wikidata publishes an official name, making
`officialNameBothPresent` the same artefact in different clothes.

**L7 could not have caught this and cannot be tuned to.** It rates a
feature by standalone ROC-AUC and passes anything in [0.01, 0.99]. A
one-way indicator firing on 16% of one class and 0% of the other scores
≈0.42 — comfortably inside the band — because AUC averages over the whole
distribution and cannot see that one *value* is a categorical veto. That
is the wrong statistic for this failure, not a badly chosen band.

L12 asks the question directly: **is there a binary feature value which,
with at least 30 TRAIN rows of support, never co-occurs with one of the
labels?** It is audited over the *trainable* feature set, since a feature
excluded from training cannot be learned from.

The response was not to delete evidence. Wikidata now publishes a real
country (P17 → P297), which broke the jurisdiction proxy by making the
field genuinely informative; `officialNameBothPresent` — a pure
missingness flag with no other content — is excluded from training, while
the official name itself still feeds the variant comparisons where it is
real evidence.

## L13 — the ratchet only ran in one direction

L11 asks whether a subject an **earlier** test froze has reached **this**
train or validation. Nothing asked the converse: whether a subject an
earlier build actually **fitted on** has reached **this** test. A test
that fails the converse is measuring memorisation and reporting
generalisation, which is the failure the whole suite exists to prevent —
and it was unchecked.

L13 asks it, and it is **enforced only on a frozen test** — a dataset
that is one test partition and nothing else. On a training dataset's
held-out partition it reports rather than fails, because that partition
never claimed to be unseen: v2's held-out partition contains **75
subjects the P6.24 build fitted on**, which is not a defect but the
measured reason the final test exists.

The frozen final test returns **0**.

## Extra guarantees for the final frozen test — and one exception

Exclusion is applied at the **record** level, not the pair level.
Filtering only labelled pairs was tried first and left 1,563 of 2,520
subjects in place, because mined and sampled negatives are *derived* from
whatever records the corpus holds — the positives were clean and the
negatives were not.

**Three subjects nevertheless got through, and this document previously
claimed zero.** `CIK:1534701`, `CIK:1610520` and `CIK:823094` appear in
the v2 dataset's `partitionOfSubject` map; the exclusion scanned prior
*pairs*, and these three carry no v2 pairs, so it never saw them. They
reach the final test as one side of three `sampled_negative` pairs.

Exactly what that costs, measured rather than asserted:

| | |
| --- | --- |
| Final-test pairs touching one of them | 3 of 5,257 (0.06%) |
| Positives affected | **0** of 892 |
| v2 training/validation pairs they contributed | **0** — the model never saw them |
| Model false merges on `sampled_negative` | 0 (baseline: 0) |

Recall (682/892), precision, and every hard-negative figure are
arithmetically unaffected. **The test was not re-cut**, and that is a
decision, not an oversight: re-cutting a frozen instrument to remove
three inert negatives would change no published number while destroying
the one property that makes the instrument worth having. The condition is
now asserted by L13 instead of assumed by a comment — and L13 passes,
because the subjects were never fitted on, which is the distinction that
actually matters.

## What the suite still does not check

- **Development-decision contamination.** No automated check can see that
  a human read a test partition's errors and changed a feature. That
  happened to the v2 development test, is recorded in
  [`ml-evaluation-and-error-analysis.md`](./ml-evaluation-and-error-analysis.md),
  and was handled by collecting a new frozen test rather than by
  redefining what "frozen" means.
- **Publisher-side correlation.** If two publishers copy each other, an
  identifier agreement is less independent than it looks. Not currently
  measurable from what they publish.
