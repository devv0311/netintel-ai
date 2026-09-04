# Evaluation

How CIPHER's correctness is measured, and where each measurement lives.

> **This file was stale until P6.25.** It previously said evaluation was
> "Empty. No evaluation methodology has been defined." That had not been
> true since P6.16, and by P6.24 it was describing a directory holding a
> full leakage suite, a frozen held-out evaluation and a shipped model.
> A stale index is worse than no index — it tells a reader who trusts it
> that measurements they could have used do not exist.

---

## 1. The one rule everything here follows

**A label is created only by a shared authoritative identifier or an
explicit publisher assertion. Never by a name.**

Two records are the same entity because two publishers independently
state the same LEI (ISO 17442: one LEI, one legal entity) or the same SEC
CIK. They are different entities because they state *different values of
a scheme they share*. Everything else — a name that looks similar, a
jurisdiction that agrees, a model's own high score — is evidence to be
measured, never a label. See [`ml-label-specification.md`](./ml-label-specification.md).

Corollaries the codebase enforces rather than assumes:

- A pair sharing no identifier scheme (GLEIF publishes no CIK, EDGAR no
  LEI) is **NOT COMPARABLE** and is scored as neither positive nor
  negative. Getting this wrong once produced 117 false hard negatives and
  scored the resolver as failing for correctly resolving one company.
- A **former name** is a temporal claim by one authority, kept as its own
  class, never counted as cross-source agreement, never trained on.
- Consolidation, ownership and parent/subsidiary relationships are **not
  identity**. See [`parent-subsidiary-policy.md`](./parent-subsidiary-policy.md).

## 2. What is measured, and where

| Question | Document | Machine-readable |
| --- | --- | --- |
| What data exists, from whom, under what licence | [`ml-dataset-card.md`](./ml-dataset-card.md) | `evidence/expanded-v2/`, `evidence/final-test/` |
| What a label means and how each one was derived | [`ml-label-specification.md`](./ml-label-specification.md) | `*.ground-truth.json` |
| Could the model have cheated | [`ml-leakage-audit.md`](./ml-leakage-audit.md) | `reports/ml/leakage-audit*.json` |
| Which models were tried and why one shipped | [`ml-model-card.md`](./ml-model-card.md) | `reports/ml/experiment-registry-v2.json` |
| How well it actually does, and where it fails | [`ml-evaluation-and-error-analysis.md`](./ml-evaluation-and-error-analysis.md) | `reports/ml/final-test-*.json` |
| How to reproduce every number here | [`ml-reproduction.md`](./ml-reproduction.md) | — |
| How the model is exposed in the product | [`../architecture/ml-integration.md`](../architecture/ml-integration.md) | — |

Earlier deterministic-resolver studies, still valid and still referenced:
[`no-identifier-experiment.md`](./no-identifier-experiment.md),
[`real-world-generalisation-test.md`](./real-world-generalisation-test.md),
[`name-normalization-and-resolution-semantics.md`](./name-normalization-and-resolution-semantics.md),
[`ownership-evidence-and-rule-attribution.md`](./ownership-evidence-and-rule-attribution.md),
[`identifier-authority-policy.md`](./identifier-authority-policy.md).

## 3. The three datasets, and why there are three

They are **not** three attempts at one thing. Each has a different job,
and mixing them would destroy what the others measure.

| Dataset | Pairs | Role |
| --- | --- | --- |
| `cipher-er-pairs` v1.0.0 | 4,053 | The P6.24 dataset. **Superseded**, kept for the head-to-head. Fails leakage check L12 retrospectively — see below. |
| `cipher-er-pairs` v2.0.0 | 10,764 | What the shipped model was trained and selected on. Its test partition is a **development** test: it informed feature design and is no longer a clean exam. |
| `cipher-er-pairs-final-test` v1.0.0 | 5,257 | The **final frozen test**. 963 subjects, overlap with any partition of either dataset above: **0**. Collected after all feature work. Scored once. |

The published headline numbers come from the third. The second is
reported alongside it precisely because the gap between them is
informative.

## 4. Two findings that changed how this directory works

**Leakage check L7 cannot catch a one-way veto, and one got through.**
In the v1 dataset `jurisdictionBothKnown` was true for 0 of 222 positives
and 196 of 1,216 negatives — Wikidata published no jurisdiction, and
every positive was cross-source *with* Wikidata, so the flag meant
"same-source" and therefore "not a positive". Standalone ROC-AUC ≈ 0.42,
comfortably inside L7's band, because AUC averages over a distribution
and cannot see that one *value* is a categorical veto. **L12** now asks
that question directly. `reports/ml/leakage-audit.json` records the v1
dataset FAILING it, and that report is left as it stands.

**A frozen test can thaw when the corpus grows.** A subject reaches TEST
by its own designation *or* by contagion through its connected component,
and components move when records are added. Five P6.24 test subjects fell
into TRAIN and VALIDATION the first time the v2 corpus was built.
**L11** makes the freeze a ratchet across dataset versions.

## 5. Reading a number from this directory

Every figure in these documents is regenerable from committed artifacts
by the commands in [`ml-reproduction.md`](./ml-reproduction.md), and
`tests/unit/ml-dataset.test.ts` re-scores the evaluation partition from
the committed artifact and asserts it reproduces the committed report
exactly. If a feature, the normaliser, the artifact or the dataset
changes without the reports being regenerated, that test fails — which is
how "the published metrics are reproducible" stays a fact about the
repository rather than a claim in a document.

Two cautions when quoting:

- **Never compare a metric across datasets.** The v1, v2 and final-test
  partitions are different instruments; a lower number on a harder exam
  is not a worse model. The only fair comparison is
  `reports/ml/final-test-comparison.json`, which scores every model on
  identical pairs that none of them was fitted on.
- **The model is advisory.** It does not merge anything, and no code path
  in `src/lib/resolution/` calls it.
