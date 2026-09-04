# Model card — `cipher-er-pair-classifier` v1.0.0

**Artifact:** `models/cipher-er-pair-classifier.v1.json`
**sha256:** `2c15204b85dee34063ddd4500eae42747a0362953dc4bf9627daba4cd97871f7`
**Experiment:** `E3-gradient-boosted-trees`
**Dataset:** `cipher-er-pairs` v1.0.0 **Seed:** 20260904
**Decision threshold:** 0.8967658267380015

---

## 1. What it does

Given two public records, it returns the probability that they denote the
same legal entity, from **name, jurisdiction and missingness evidence
only**. It reads no identifier.

## 2. What it is not

It is **not** a resolution tier. Nothing in `src/lib/resolution/` calls
it; that directory is byte-identical to `af22018`. The deterministic
resolver remains the sole authority on whether two records are merged.
This model produces an advisory `algorithmic_signal` and is always
displayed with the deterministic verdict and every feature behind it.

## 3. Architecture

Gradient-boosted regression trees on the logistic loss: 120 rounds, depth
3, learning rate 0.1, minimum 12 samples per leaf, L2 1, positive class
weight 4. Implemented in `src/lib/ml/train.ts` with no ML dependency; the
artifact is JSON and loads with `JSON.parse`.

Trees were chosen over logistic regression on evidence, not taste. The
failures this model exists to recover are interactions a linear model
cannot express — a high token overlap is evidence of identity *only when*
the pair does not also look like a shared-leading-token family. On
validation, at the same false-merge ceiling, logistic regression reached
86.7% recall and the ensemble 90.0%; the selection rule required the
ensemble to beat the simpler model by more than one point to justify
being harder to explain.

## 4. Features

25, all symmetric, all deterministic, listed in
`src/lib/ml/features.ts`: exact and normalised name match, any-variant
match, sorted-token match, token Jaccard and containment, ordered prefix
containment, first/last token match, Levenshtein ratio, Jaro-Winkler,
trigram Dice, best-variant Dice, length and token-count ratios,
single-token side, acronym match, same script, jurisdiction known /
match / conflict, official-name presence, alias presence, digit-set
conflict, Roman-numeral conflict.

**Excluded, with reasons:** every identifier (the label is derived from
them — see the leakage audit); the OpenCorporates id (co-determined with
LEI agreement); the ground-truth `variation` class (an annotation made
against the answer); registry pairing (an artefact of how the labels were
built — measured as ablation E4, worth ~5 recall points, not shipped).

## 5. Training data

162 positives, 882 negatives (28 curated hard, 206 mined hard, 648
sampled) over 284 subjects. Real records from GLEIF (CC0 1.0), Wikidata
(CC0 1.0) and SEC EDGAR (US public domain). No synthetic data. Training
time: under three seconds.

## 6. Held-out performance

356 positives and 2,259 negatives over 376 subjects, entity-disjoint from
training, scored **once**.

| | Deterministic baseline | This model |
|---|---|---|
| Positive-pair recovery | **158/356 (44.4%)** | **317/356 (89.0%)** |
| Precision | 98.8% | 99.1% |
| Recall | 44.4% | 89.0% |
| F1 | 61.2% | 93.8% |
| False-merge rate | 0.089% (2/2,259) | 0.133% (3/2,259) |
| False-split rate | 55.6% | 11.0% |
| Hard-negative false-merge rate | 0.24% (2/835) | 0.36% (3/835) |
| ROC-AUC | n/a | 0.9822 |
| PR-AUC | n/a | 0.9482 |

By name-variation class, recovery goes from 0% to 100% on containment
(98/98), 0% to 86.7% on script variants, 0% to 72.5% on partial token
overlap and 0% to 42.2% on divergent names, while exact and legal-suffix
classes stay at 100%.

## 7. Known failure modes

**Three false merges, and all three are the same thing.** `GENERTEL
S.P.A.`/`Genertel`, `Cultura`/`Cultura Sparebank`, `BNP PARIBAS`/`BNP
PARIBAS CARDIF POJIŠŤOVNA` — a group and one of its members, scored
0.985–0.999. P6.20.3 measured that GLEIF publishes a consolidation edge
for pairs of exactly this shape, and P6.21.2's Policy B would refuse
them. That policy is **not approved**, so the model cannot use it. The
model's entire false-merge residual is one frozen policy decision.

**Thirty-nine false splits**, 26 of them `divergent` — `LATVIJAS BANKA` /
`Bank of Latvia`, `Grolsche Bierbrouwerij Nederland B.V.` / `Grolsch`.
These are translations and short names with no shared token in either
direction. No string-similarity feature can reach them.

**It also repairs two known deterministic false merges:** EN-0002
(`ROCKY MOUNTAIN CHOCOLATE FACTORY INC` / `Rocky Mountain Chocolate
Factory, Inc.`) and EN-0003, which the normalised-name rule merges and
this model scores at 0.674 and 0.645, below threshold.

## 8. Intended use and out-of-scope use

**Intended:** ranking candidate same-entity pairs for a human, and
surfacing pairs the deterministic resolver leaves unjoined, always with
the score, the threshold, the model version and the feature evidence.

**Out of scope:** deciding a merge; any use where the score is displayed
as a fact; any subject type other than organisations; natural persons;
any judgement about wrongdoing.

## 9. Ethical and operational notes

- The output classification is `algorithmic_signal` — the project's
  existing vocabulary for a computed indication that is not a fact.
- Probabilistic predictions are never displayed as confirmed facts; the
  API response carries a disclaimer naming the group-and-member failure
  mode.
- Group-and-member pairs are the model's known bias and are stated at the
  point of use, not only here.

## 10. Provenance

Built from `evidence/ml/pair-dataset.json` v1.0.0 by
`scripts/ml/train-model.ts` at the commit recorded in the artifact's
`gitCommit`. Reproduce with `docs/evaluation/ml-reproduction.md`;
`tests/unit/ml-dataset.test.ts` re-scores the whole held-out partition
and asserts the committed counts exactly.
