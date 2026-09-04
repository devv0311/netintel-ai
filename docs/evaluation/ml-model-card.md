# Model card — `cipher-er-pair-classifier` v2.0.0

**Artifact:** `models/cipher-er-pair-classifier.v2.json`
**sha256:** `8948a73fa3d5640a978eb80fd1dddd623bdf286c8a6ae03e8d63f0d37b706e22`  ·  **Trained at commit:** `6599c70e0a07b8383f914c11eacc2018212fd1ae`
**weightsDigest:** `6948e6bc6bb94b0aebe937fe0bd445e39b4c49e62cb456efa7eac742fde2f849`
**Experiment:** `E2-logistic-regression`
**Dataset:** `cipher-er-pairs` v2.0.0 **Seed:** 20260904
**Decision threshold:** 0.9774753387972909

> The **weightsDigest** is the reproducibility test, not the sha256. The
> file's own hash moves with `createdAt` and `gitCommit`, so two runs that
> produce bit-identical weights disagree on it. The digest covers
> everything except those two provenance fields; retraining from the same
> commit and dataset must reproduce it exactly. `loadArtifact` verifies it
> and refuses a mismatch.

---

## 1. What it does

Given two public records, it returns the probability that they denote the
same legal entity, from **name, jurisdiction and missingness evidence
only**. It reads no identifier — every label in this project is derived
from identifier agreement, so an identifier feature would be the answer
rather than evidence. Leakage checks L5 and L6 enforce this against both
the data and the source file.

## 2. What it is not

It is **not** a resolution tier. Nothing in `src/lib/resolution/` calls
it; that directory is byte-identical to `af22018`. The deterministic
resolver remains the sole authority on whether two records are merged.
This model produces an advisory `algorithmic_signal`, always displayed
with the deterministic verdict and every feature behind it.

**Why it stays advisory** is a number, not a caution — see §6.

## 3. Architecture

Logistic regression: learning rate 0.5, 4,000 epochs, L2 0.002, positive
class weight 4. Implemented in `src/lib/ml/train.ts` with no ML
dependency; the artifact is JSON and loads with `JSON.parse`.

**A linear model was chosen on evidence, and the evidence changed.** In
P6.24, on 1,044 training pairs, gradient-boosted trees beat logistic
regression 90.0% to 86.7% recall and shipped. On the 3× larger P6.25
training set the ordering reversed and stayed reversed through a capacity
sweep:

| Experiment | Model | Recall @ ceiling | F1 | PR-AUC | ROC-AUC |
| --- | --- | --- | --- | --- | --- |
| E1 | deterministic baseline | 28.2% | 43.9% | — | — |
| **E2** | **logistic regression** | **79.7%** | **88.4%** | 0.9712 | 0.9921 |
| E3 | GBDT (P6.24 settings) | 67.8% | 80.5% | 0.9729 | 0.9925 |
| E6 | GBDT, 300 rounds, depth 4 | 33.9% | 50.6% | 0.9583 | 0.9908 |
| E7 | GBDT, 500 rounds, depth 5 | 35.0% | 51.7% | 0.9611 | 0.9903 |

The tree rows score *higher* ROC-AUC and *lower* usable recall, which is
the signature of a model whose ranking is fine and whose scores are too
clumped near 1.0 for a false-merge-capped threshold to sit anywhere
useful. Adding capacity made it worse, not better. The linear model is
also the one whose every score decomposes into per-feature contributions,
which is what makes a suggestion auditable — so here the smaller, more
explainable model is simply also the better one.

## 4. Features

**26 trained features**, all symmetric — `f(a,b) = f(b,a)`, because "same
entity" is symmetric and an asymmetric feature would let the model learn
the arbitrary order the dataset builder emitted each pair in. Listed in
`src/lib/ml/features.ts`.

Largest-magnitude weights (standardised):

| Feature | Weight | Reading |
| --- | --- | --- |
| `bestVariantTrigramDice` | +1.55 | character overlap of the best-matching name variant |
| `firstTokenMatch` | −1.16 | a shared leading token *alone* is weak evidence — the hard-negative signature |
| `jurisdictionCountryMatch` | +1.13 | both publishers state the same country |
| `jurisdictionCountryConflict` | −1.12 | they state different ones — see §6, this is over-trusted |
| `orderedPrefixContainment` | +0.91 | one name is a prefix of the other |
| `legalFormConflict` | −0.46 | different legal forms (Inc. vs L.P.) |

Two features are new in P6.25 and exist to attack a specific measured
failure — corporate-family pairs, §6:

- **`legalFormConflict`** — the two names end in *different legal forms*.
  Read from the raw string before normalisation, because normalisation
  deliberately strips exactly this token: `SIMON PROPERTY GROUP, INC.` and
  `SIMON PROPERTY GROUP, L.P.` both normalise to `simon property group`,
  and they are an UPREIT and its operating partnership with different
  LEIs. Spellings of one form are grouped (`Limited` = `Ltd`) so they are
  not read as a disagreement.
- **`structuralTokenAsymmetry`** — one side carries a token naming a
  *role inside a group* (`Holding`, `Group`, `Finance`, `Pharma`) that the
  other lacks. It reads no relationship record and asserts nothing about
  whether a parent and its subsidiary are one entity; it says only that
  the two names describe different positions in a group.

One feature is **computed but excluded from training**:
`officialNameBothPresent`. Only Wikidata publishes an official name (531
of 3,282 records), so "both sides state one" is true exactly when both
records are Wikidata — a same-source pair, never a positive here. Leakage
check L12 caught it: true for 63 TRAIN rows, never once alongside a
positive. The official name itself is *not* excluded and remains real
evidence inside `bestVariantTrigramDice` and `anyVariantNormalizedMatch`.

## 5. Threshold policy

Chosen on the **validation** partition as the threshold maximising F1
subject to **two** ceilings, both set by the deterministic resolver's own
behaviour on the same pairs:

1. overall false-merge rate ≤ 0.00129 (1 of 774 negatives);
2. false-merge rate over **curated hard negatives alone** ≤ 0.04 (1 of 25).

The second ceiling is new in P6.25 and exists because the first is nearly
vacuous: hard negatives are 25 of 774 validation negatives, so a model can
merge several more of them while its overall rate barely moves. That was
measured, not feared — adding the two family features raised held-out
recall 2.5 points and hard-negative false merges from 9 to 12 with the
overall ceiling satisfied throughout.

The held-out and final-test partitions were not consulted.

## 6. Limitations — measured, on the final frozen test

Scored **once** on 5,257 pairs over 963 subjects that appear in no
partition of any earlier dataset (`reports/ml/final-test-evaluation.json`):

| | Deterministic resolver | This model |
| --- | --- | --- |
| Positive recovery | 434/892 (48.7%) | **682/892 (76.5%)** |
| Precision | 96.4% | 93.7% |
| Curated hard-negative false merges | 16/244 (6.6%) | **41/244 (16.8%)** |

**Every one of the 46 false merges is a corporate-family pair.** Not
most — all. `BARCLAYS PLC` / `BARCLAYS BANK PLC`, `ROLLS-ROYCE HOLDINGS
PLC` / `ROLLS-ROYCE PLC`, `AMUNDI` / `AMUNDI ASSET MANAGEMENT`,
`Virgin Australia` / `Virgin Australia Holdings`, `Renault` /
`RENAULT SAS`. The two family features moved this substantially but did
not close it.

This is exactly the **P6.21.2** question — whether a parent and its
subsidiary may ever be one entity — and it has not been decided.
Promoting this score to an authoritative merge would decide it by
accident, which is the single reason the model remains advisory.

**A second limitation, found on the same test and not yet addressed.**
The model recovers only 5.7% of cross-border positives (6 of 106) where
the resolver recovers 50.9%, and it is *worse than the baseline* on
edgar×wikidata pairs (32.8% vs 65.6%). The cause is a semantic mismatch
the jurisdiction features paper over: GLEIF's `jurisdiction` is the legal
jurisdiction of *incorporation* (Jersey, Cyprus, BVI) and EDGAR's is the
US state of incorporation, while Wikidata's P17 is the country the entity
is *associated with*. `CAPITAL COM SV INVESTMENTS LIMITED` (CY) and
`Capital.com` (AU) are one company incorporated offshore and operating
onshore, and `jurisdictionCountryConflict` reads that as evidence against
identity at weight −1.12.

This was found by reading the final test's breakdown, so **it must not be
fixed by tuning against that test** — doing so would spend the only
unbiased instrument available, which is the mistake P6.25 was partly
about correcting. The fix is to distinguish the two properties at
collection time and re-measure on a fresh test. See
[`ml-evaluation-and-error-analysis.md`](./ml-evaluation-and-error-analysis.md) §5.

## 7. Data

Real public-register records from three approved publishers, no synthetic
data, no manufactured name variants, every string the publisher's own:
Wikidata (CC0 1.0), GLEIF (CC0 1.0), SEC EDGAR (US public domain). See
[`ml-dataset-card.md`](./ml-dataset-card.md).

## 8. Reproducing this artifact

```
npm run ml:corpus && npm run ml:dataset && npm run ml:leakage && npm run ml:train
```

The `weightsDigest` above must match. Full instructions, including the
final-test evaluation, in [`ml-reproduction.md`](./ml-reproduction.md).
