# Model card — `cipher-er-pair-classifier` v2.2.0

**Artifact:** `models/cipher-er-pair-classifier.v2lr.json`
**weightsDigest:** `40d3ceee6ce99419dcd2b100abe1ad08a6e5edd8372fb69d1b1278b4e6eb78ac`
**Experiment:** `E2-logistic-regression` — **named** ahead of the test, not ranked into place (see §3)
**Dataset:** `cipher-er-pairs` v2.0.0 (the same pinned corpus v2.0.0 was fitted on) **Seed:** 20260904
**Features:** 31 (the 26 of v2.0.0, plus the five P6.27 rarity features)
**Decision threshold:** 0.9823449517890187

**Supersedes v2.0.0** (`…v2.json`, weightsDigest `6948e6bc…`, threshold
0.9774753387972909, 26 features) as of P6.28. The two were scored **once**
against each other on frozen test #4 under a rule fixed before that test
existed; this one recovered 4,395 true pairs against 4,378 and made **one**
wholly-unrelated merge against **nine**. Full record in
[`ml-final-test-4.md`](./ml-final-test-4.md), rule in
[`ml-selection-freeze-e2.md`](./ml-selection-freeze-e2.md). The superseded
artifact is retained, still loads, and a test asserts it.

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

**In P6.28 the family was named rather than ranked, and the reason is
measured.** With the P6.27 features on the same corpus the ladder ranked
gradient-boosted trees first, on 3.9 points of validation recall (85.3% against
81.4%). P6.27 shipped that ranking to frozen test #3 and it merged ten pairs of
wholly unrelated companies; its validation false-merge rate of 0.13% understated
its test rate of 2.380% by **eighteen times**. A ceiling measured on the
partition being selected on is not a ceiling. So `--select-experiment` names the
rung that ships; every rung still runs and the registry still records that E3
won the ranking.

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

## 6. Limitations — measured, on frozen tests

### 6.0 This artifact, on frozen test #4 (P6.28) — its only measurement

Scored **once** on 40,004 pairs over 4,709 subjects appearing in no partition
of any of the seven earlier datasets, leakage PASS 13/13 with L13 = 0
(`reports/ml/final-test-4-evaluation-v2lr.json`):

| | Deterministic resolver | v2.0.0 (superseded) | **This model** |
| --- | --- | --- | --- |
| Positive recovery | 1,162/4,672 (24.9%) | 4,378/4,672 (93.7%) | **4,395/4,672 (94.1%)** |
| Precision | 99.6% | 93.4% | **93.8%** |
| False-merge rate | 0.014% | 0.877% | **0.818%** |
| Curated hard-negative false merges | 5/2,049 (0.24%) | 113/2,049 (5.51%) | **111/2,049 (5.42%)** |
| **Wholly unrelated merges** | 0 | **9** | **1** |
| Validation → test false-merge inflation | — | ×6.8 | **×6.3** |

**The eight merges this model corrected are all one failure.** Every one of
v2.0.0's nine wholly-unrelated merges paired a bare short name against a short
name carrying Slovak `s.r.o.` boilerplate — `DOL GROUP, s.r.o.` with `EEWS`,
`Facep s.r.o.` with `SWL` — scored on the boilerplate and pushed over the line
by jurisdiction agreement. That is the Slovak instance of the Latvian defect the
P6.27 features were built for, and the IDF-weighted features close eight of
nine of it.

**Three things this measurement does not establish**, all consequences of the
instrument and all stated in [`ml-final-test-4.md`](./ml-final-test-4.md) §4:

- **It is an easier distribution than test #3.** 91.6% of its positives are in
  the three easy variation classes against test #3's 67.6%, and it holds no
  non-Latin script at all. The 94.1% above is **not comparable** with the 75.8%
  v2.0.0 scored on test #3 — same model, harder test.
- **It barely tests cross-border.** 30 positives; this model recovers 5. P6.27
  measured the same features inside a tree ensemble at 76.0% on test #3, and 30
  pairs cannot say whether a linear model fails to exploit them across a border
  or whether the slice is simply too small. Unresolved, deliberately: settling
  it on test #3 after reading test #4 would be selection on a spent test.
- **The Latvian case is unmeasured.** Test #4 holds zero `sabiedriba` pairs and
  zero Latvian-jurisdiction pairs. The pre-registered measurement returned
  nothing and no heuristic was invented to compensate.

**This artifact has one frozen-test measurement. v2.0.0 has three.** It ships
because it won the only head-to-head either has had under a rule fixed in
advance — not because it is better understood.

### 6.1 The corporate-family limitation, unchanged and still the reason it stays advisory

286 of this model's 289 false merges on test #4 are corporate-family pairs — a
company against a same-named affiliate holding a different registration
(`SIHOTPARK B s.r.o.` / `SIHOTPARK`, `Mercurtrade` / `Mercurtrade Holding`).
The history below records the same finding on every earlier instrument.

### 6.2 History, on the tests v2.0.0 was measured against

Scored **once** on 5,257 pairs over 963 subjects that appear in no
partition of any earlier dataset (`reports/ml/final-test-evaluation.json`):

| | Deterministic resolver | This model |
| --- | --- | --- |
| Positive recovery | 434/892 (48.7%) | **682/892 (76.5%)** |
| Precision | 96.4% | 93.7% |
| Curated hard-negative false merges | 16/244 (6.6%) | **41/244 (16.8%)** |

**Every one of the 46 false merges is a corporate-family pair.** Not
most — all. On the second frozen test the same holds: **all 28** of this
model's false merges are corporate-family. `BARCLAYS PLC` / `BARCLAYS BANK PLC`, `ROLLS-ROYCE HOLDINGS
PLC` / `ROLLS-ROYCE PLC`, `AMUNDI` / `AMUNDI ASSET MANAGEMENT`,
`Virgin Australia` / `Virgin Australia Holdings`, `Renault` /
`RENAULT SAS`. The two family features moved this substantially but did
not close it.

This is exactly the **P6.21.2** question — whether a parent and its
subsidiary may ever be one entity — and it has not been decided.
Promoting this score to an authoritative merge would decide it by
accident, which is the single reason the model remains advisory.

**A second limitation, confirmed on a second untouched test, with a
known fix that is not shipped.** The model recovers only 5.7% of
cross-border positives (6 of 106) where the resolver recovers 50.9%, and
it is *worse than the baseline* on edgar×wikidata pairs (32.8% vs 65.6%).

P6.26 re-measured this on a second frozen test built from 40 country
queries disjoint from every prior collection (16,675 pairs, 1,792
positives, leakage PASS 13/13, **0 subjects fitted on by any earlier
build**). The gap reproduced independently: **5.1%** cross-border
recovery, 2 of 39.

**The cause stated here was wrong, and the real one is measured.** The
semantic mismatch below is real but accounts for **one** training pair.
The actual cause is distributional: in v2's training data
P(positive | different countries) is **1.0%** against **47.0%** for
same-country — a 48× likelihood ratio against identity, correctly learned
from a corpus holding 26 cross-border positives.

Collecting 340 real cross-border positives (NetEase KY/CN, Tencent KY/CN,
Elsevier NL/IT) and retraining closes it: **46.2% cross-border recovery**
against the resolver's 48.7%, and edgar×wikidata rises above the resolver
at 61.5%. That model is **not shipped**: it recovers 82 fewer real pairs
overall, and 5 of its 25 false merges are wholly unrelated entities
merged on shared spelled-out legal forms (`Sabiedrība ar ierobežotu
atbildību`), a worse failure class than the corporate-family pairs above.
Full record, both columns, in
[`ml-cross-border-experiment.md`](./ml-cross-border-experiment.md).

**P6.27 measured this a THIRD time, on a third frozen test, and the number
moved: 10.0%** (5 of 50 cross-border positives) against the deterministic
resolver's 58.0%. Three instruments, none of which the model was fitted
on, now put this model's cross-border recovery at 5.7%, 5.1% and 10.0%.
The weakness is not an artefact of any one test.

P6.27 also built the fix that P6.26 could not: deterministic legal-form
normalisation mined from training data, plus IDF-weighted name similarity
that reads token RARITY rather than token count. On test #3 those features
take cross-border recovery from **10.0% to 76.0%** — above the resolver for
the first time — and edgar×wikidata from 29.2% to 87.5%.

**That model is not shipped either, and the reason is a different one.** It
recovers 242 more real pairs and makes 301 more false merges, including
**10 between wholly unrelated companies** (`Abbott Japan` with a bank,
`John Menzies` with `FirstGroup plc`) where this model makes **zero**. The
failure is attributable to the model family rather than the features: the
experiment ladder auto-selected gradient-boosted trees, whose validation
false-merge rate of 0.13% understated its test rate of 2.380% by eighteen
times. Logistic regression with the same features reached 81.4% validation
recall against v2.0.0's 79.7% and was **not** scored on test #3 — doing so
after reading it would have been selection on the test set. Full record in
[`ml-final-test-3.md`](./ml-final-test-3.md).

**P6.28 executed that named next step on a fourth instrument, and it is the
model this card now describes.** E2 was frozen before test #4 was collected,
scored once against v2.0.0, and shipped: §6.0 above. The separation the
experiment was built for held — E2's validation-to-test false-merge inflation
is ×6.3 against v2.0.0's ×6.8 and v2lf's ×18.4 — so the P6.27 collapse belonged
to the model family and not to the feature set. **P6 ML model selection is
closed.**

The original diagnosis, kept because it is the thing that was tested:
GLEIF's `jurisdiction` is the legal jurisdiction of *incorporation*
(Jersey, Cyprus, BVI) and EDGAR's is the US state of incorporation, while
Wikidata's P17 is the country the entity is *associated with*.
`CAPITAL COM SV INVESTMENTS LIMITED` (CY) and `Capital.com` (AU) are one
company incorporated offshore and operating onshore, and
`jurisdictionCountryConflict` reads that as evidence against identity at
weight −1.12. GLEIF publishes the headquarters country alongside the
jurisdiction; comparing those instead resolves 1 of 642 training
positives. See also
[`ml-evaluation-and-error-analysis.md`](./ml-evaluation-and-error-analysis.md) §5.

## 7. Data

Real public-register records from three approved publishers, no synthetic
data, no manufactured name variants, every string the publisher's own:
Wikidata (CC0 1.0), GLEIF (CC0 1.0), SEC EDGAR (US public domain). See
[`ml-dataset-card.md`](./ml-dataset-card.md).

## 8. Reproducing this artifact

```
npm run ml:corpus && npm run ml:dataset && npm run ml:leakage
npm run ml:legal-forms          # the mined vocabulary and token document frequencies
npm run ml:e2:train             # E2 named, not ranked
```

The `weightsDigest` above must match; it was verified across two runs, with
`createdAt` the only field that moved. `npm run ml:train` still reproduces the
superseded v2.0.0 artifact and its own digest.

Full instructions, including the frozen-test evaluations, in
[`ml-reproduction.md`](./ml-reproduction.md); the P6.28 collection and scoring
sequence is in [`ml-final-test-4.md`](./ml-final-test-4.md) §7.
