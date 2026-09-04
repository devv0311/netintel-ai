# Held-out evaluation and error analysis — `cipher-er-pair-classifier` v1.0.0

**Reports:** `reports/ml/heldout-evaluation.json`, `reports/ml/error-analysis.json`
**Experiment registry:** `reports/ml/experiment-registry.json`
**Data class:** REAL throughout. No synthetic record is scored anywhere below.

The held-out partition was opened once, after the model and its threshold
were frozen against validation. No threshold was chosen here and none was
changed after seeing these numbers.

---

## 0. First, a correction to the brief this phase was given

The handoff states a deterministic baseline of ~70.7%. That figure is
real but belongs to a **different corpus**: the P6.16/P6.17 India-filtered
set of 75 pairs, where the classes normalisation already solves dominate.

On the 1,245-record cross-source corpus the shipped resolver measures
**40.7% (235/578)** corpus-wide (P6.19.4,
`reports/expanded/expanded-anchored-results.json`), and **44.4%
(158/356)** on the held-out partition used here. 44.4% is the number this
model is compared against, and using 70.7% would have understated the
improvement while comparing across incompatible datasets.

## 1. The experiment ladder

All four rows recorded, selection on validation, false-merge ceiling set
by the deterministic baseline on the same partition (0.00%).

| Experiment | Model | Threshold | P | R | F1 | FMR | PR-AUC | ROC-AUC |
|---|---|---|---|---|---|---|---|---|
| E1 | deterministic normalised-name equality | — | 100.0% | 43.3% | 60.5% | 0.00% | — | — |
| E2 | logistic regression, 25 features | 0.8000 | 100.0% | 86.7% | 92.9% | 0.00% | 0.9618 | 0.9806 |
| **E3** | **gradient-boosted trees** ✅ shipped | **0.8968** | **100.0%** | **90.0%** | **94.7%** | **0.00%** | **0.9709** | **0.9865** |
| E4 | E2 + `sameRegistry` — ablation, never shipped | 0.6847 | 100.0% | 91.7% | 95.7% | 0.00% | 0.9712 | 0.9892 |

E4 exists to price a construction artefact, not to be shipped: it is
worth about five recall points, and those five points are the labels
having been built from cross-source agreement. See the leakage audit §5.

## 2. Held-out headline

2,615 pairs — 356 positives, 2,259 negatives — over 376 subjects.

| Metric | Deterministic baseline | Model | Δ |
|---|---|---|---|
| **Positive-pair recovery** | **158/356 (44.4%)** | **317/356 (89.0%)** | **+44.7 pts** |
| Precision | 98.75% | 99.06% | +0.31 pts |
| Recall | 44.38% | 89.04% | +44.7 pts |
| F1 | 61.24% | 93.79% | +32.5 pts |
| **False-merge rate** | **0.089% (2/2,259)** | **0.133% (3/2,259)** | **+0.044 pts (one pair)** |
| False-split / unresolved rate | 55.62% (198/356) | 10.96% (39/356) | −44.7 pts |
| Hard-negative false-merge rate | 0.24% (2/835) | 0.36% (3/835) | +0.12 pts |
| ROC-AUC | — | 0.9822 | |
| PR-AUC | — | 0.9482 | |

**The honest reading: 159 additional true pairs recovered, at the cost of
one additional false merge.** That trade is stated plainly rather than
averaged away, and it is why the model ships as advisory.

## 3. False merges by negative class

| Class | Negatives | Model | Baseline |
|---|---|---|---|
| curated hard negative | 114 | **3 (2.63%)** | 2 (1.75%) |
| mined hard negative | 721 | 0 (0.00%) | 0 (0.00%) |
| sampled negative | 1,424 | 0 (0.00%) | 0 (0.00%) |

Every false merge either model makes is inside the 114 curated hard
negatives. On 2,145 other negatives both are perfect.

## 4. Positive-pair recovery by slice

**By name variation:**

| Class | Positives | Baseline | Model |
|---|---|---|---|
| exact / near-exact | 57 | 100.0% | 100.0% |
| legal suffix or punctuation | 101 | 100.0% | 100.0% |
| **containment** | 98 | **0.0%** | **100.0%** |
| **transliteration / script variant** | 15 | **0.0%** | **86.7%** |
| **partial token overlap** | 40 | **0.0%** | **72.5%** |
| **divergent** | 45 | **0.0%** | **42.2%** |

The baseline scores 0% on four classes by construction — normalised-name
equality cannot join names that are not equal after normalisation. The
model closes containment completely and makes real progress on the other
three.

**By source pairing:** `gleif × wikidata` 41.1% → 88.0% (292 pairs);
`edgar × wikidata` 59.4% → 93.8% (64 pairs).

**Other dimensions** (full tables in the JSON report): abbreviation /
acronym, name order, legal suffix, script, publisher aliases present, and
jurisdiction stated / matching / conflicting.

## 5. Error analysis — 42 rows

`reports/ml/error-analysis.json` carries one row per error with: pair,
truth, prediction, score, threshold, sources, entity category, failure
category, the relevant field values, the six highest-contribution
features, the deterministic result, and a recommended next action.

| Failure category | Count |
|---|---|
| `false_split_no_shared_token` | 28 |
| `false_split_partial_overlap` | 11 |
| `false_merge_shared_leading_token` | 3 |

### 5.1 The three false merges are one problem

| Pair | Names | Score | Deterministic |
|---|---|---|---|
| EN-0124 | `GENERTEL S.P.A.` / `Genertel` | 0.9994 | not merged |
| EN-0137 | `Cultura` / `Cultura Sparebank` | 0.9867 | not merged |
| EN-0129 | `BNP PARIBAS` / `BNP PARIBAS CARDIF POJIŠŤOVNA,` | 0.9853 | not merged |

All three are a group and one of its members. **This is the exact pair
shape P6.20.3 measured and P6.21.2 wrote a policy memo about.** GLEIF
publishes a Level-2 consolidation edge for pairs like these, and the
memo's Policy B — a non-merge constraint — would refuse them. P6.20.3
recorded that the relationship guard stops EN-0129 specifically.

That policy is one of four owner decisions that remain **unapproved**, so
this phase froze the semantics and used none of the 154 edges. The
consequence is measurable and is stated as the model's principal
bottleneck: **the entire false-merge residual is a decision the project
has not yet taken.**

### 5.2 The false splits are a data problem, not a model problem

26 of 39 are `divergent`: `LATVIJAS BANKA` / `Bank of Latvia`,
`Grolsche Bierbrouwerij Nederland B.V.` / `Grolsch`,
`SPORTSDIRECT.COM RETAIL LIMITED` / `Sports Direct`,
`Публичное акционерное общество "Мобильные ТелеСистемы"` / `Mobile
TeleSystems`. These are translations, trading names and short names with
no token in common. No string-similarity feature reaches them; they need
a different KIND of evidence — publisher aliases enabled as evidence
(P6.17.4 recommended against, undecided), official names, or
transliteration.

One row is a data-quality finding rather than a model failure: EP-0275
pairs `Feedzai-Consultoria e Inovação Tecnológica, S.A.` against the
literal string `Q111920377` — a Wikidata QID standing in for a label.

### 5.3 Previously known real failures, re-measured

| Pair | Deterministic | Model | Score |
|---|---|---|---|
| EN-0002 `ROCKY MOUNTAIN CHOCOLATE FACTORY INC` / `Rocky Mountain Chocolate Factory, Inc.` | **merges (wrong)** | correct | 0.674 |
| EN-0003 `GENERTEL S.P.A.` / `GENERTEL S.P.A.` | **merges (wrong)** | correct | 0.645 |
| EN-0103 `SIMON PROPERTY GROUP, INC.` / `SIMON PROPERTY GROUP, L.P.` | correct | correct | 0.759 |
| EN-0124 `GENERTEL S.P.A.` / `Genertel` | correct | **merges (wrong)** | 0.999 |
| EN-0129 `BNP PARIBAS` / `BNP PARIBAS CARDIF POJIŠŤOVNA,` | correct | **merges (wrong)** | 0.985 |
| EN-0130 `BNP Paribas` / `BNP PARIBAS CARDIF POJIŠŤOVNA,` | correct | correct | 0.620 |

The model repairs two of the shipped resolver's three known false merges
and introduces two of its own. The two it repairs are identical-name
cases the normaliser cannot tell apart; the two it introduces are the
consolidation shape of §5.1.

## 6. Ground truth was not altered

No label was changed, added or removed to improve any number here. Every
error row's recommended action is a feature change or a human review.

## 7. The bottleneck, named

If this model is to reduce false merges rather than trade them, the
binding constraint is **not** more data and **not** a bigger model. It is
P6.21.2 decision 2 (Policy A/B/C/D/E). A non-merge constraint from
publisher-stated consolidation would address 100% of the measured
false-merge residual, and it is measured at 0/578 true positives blocked.

The second constraint is evidence type, not volume: 26 of 39 false splits
are name pairs with no shared token, which needs alias or official-name
evidence — itself an open recommendation (P6.17.4) rather than a
modelling gap.
