# P6.28 — Frozen test #4, scored once. Decision: SHIP E2.

**Phase:** P6.28
**Data class:** REAL. GLEIF (CC0 1.0), Wikidata (CC0 1.0), SEC EDGAR (public domain).
**Instrument:** `evidence/ml/pair-dataset-final-test-4.json` — 40,004 pairs,
4,672 positives, 2,049 curated hard negatives, 4,709 subjects, 25 countries,
one partition. Leakage **PASS 13/13**, L13 = 0 subjects fitted on by any
earlier build, against all seven prior datasets.
**Declared before collection:** `evidence/final-test-4/collection-declaration.json`, `13db272`.
**Selection frozen before the test existed:** `ml-selection-freeze-e2.md`, `b079b3f`.
**Collected before scoring:** `18a6d5c`.
**Resolution semantics changed:** **NONE.** `src/lib/resolution/` byte-identical to `af22018`.
**ML integrated into the resolver:** **NO.** Still advisory-only.

---

## 1. The result

| Model | TP | FP | TN | FN | Precision | Recall | F1 | FMR | **Unrelated merges** |
|---|---|---|---|---|---|---|---|---|---|
| Shipped **v2** (LR, 26 features) | 4,378 | 310 | 35,022 | 294 | 93.39% | 93.71% | 93.55% | 0.877% | **9** |
| Candidate **E2 / v2lr** (LR, 31 features) | **4,395** | **289** | **35,043** | **277** | **93.83%** | **94.07%** | **93.95%** | **0.818%** | **1** |
| Deterministic resolver (Tier B/B2) | 1,162 | 5 | 35,327 | 3,510 | 99.57% | 24.87% | 39.79% | 0.014% | 0 |

False-positive rate = FMR (both are false merges over the 35,332 negatives).
False-negative rate: v2 6.29%, E2 5.93%.
ROC-AUC 0.9939 → 0.9952; PR-AUC 0.9763 → 0.9825.

**E2 recovers 17 more true pairs AND makes 21 fewer false merges.** There is no
trade here to weigh: it is better on both axes at once, which is not what the
P6.27 candidate did and is the reason the decision is short.

### False merges by negative class

| Negative class | n | v2 | E2 |
|---|---|---|---|
| curated hard negative (genuine name collision) | 2,049 | 113 (5.51%) | 111 (5.42%) |
| mined hard negative (shared leading token) | 14,595 | 188 (1.29%) | 177 (1.21%) |
| **sampled negative (nothing in common)** | 18,688 | **9 (0.048%)** | **1 (0.005%)** |

---

## 2. Decision

**SHIP E2.** Against the rule fixed in `ml-selection-freeze-e2.md` §3, which is
the P6.27 rule carried forward word for word:

- **(a) Net identity recovery improves — PASSES.** 4,395 against 4,378.
- **(b) False merges do not get qualitatively worse — PASSES, and improves.**
  The candidate merges **one** pair of wholly unrelated companies. The shipped
  model merges **nine**.

Both hold, so the candidate ships. The rule was written to reject a candidate
and did so once already; applied to a candidate that satisfies it, it ships one.

**F1 is still not the criterion**, and it is worth saying so in the case where
F1 happens to agree. P6.27's candidate won F1 while making 301 extra false
merges. E2 wins F1 while making 21 fewer. The second is a reason to ship and the
first was not, and the difference is visible only in the error breakdown.

### What the eight corrected merges were

Every one of the shipped model's nine wholly-unrelated merges is the same
failure, and it is the failure the P6.27 features were built for:

```
v2 0.9849  DOL GROUP, s.r.o.   <=> EEWS       [SK/SK]   E2: correctly split
v2 0.9844  Facep s.r.o.        <=> SWL        [SK/SK]   E2: correctly split
v2 0.9833  GEOFER, s.r.o.      <=> NLC        [SK/SK]   E2: correctly split
v2 0.9809  Dagi s.r.o.         <=> LOVEX      [SK/SK]   E2: correctly split
v2 0.9804  R.P.M. s.r.o.       <=> DELCO      [SK/SK]   E2: correctly split
v2 0.9793  ORRI                <=> Hasada s.r.o.  [SK/SK]   E2: correctly split
v2 0.9785  Vitalis, s.r.o.     <=> DONE       [SK/SK]   E2: correctly split
v2 0.9784  MINI-comp s.r.o.    <=> SWL        [SK/SK]   E2: correctly split
v2 0.9871  CV2                 <=> Tmlg s. r. o.  [SK/SK]   E2: 0.9825, STILL MERGED
```

One side carries `s.r.o.` and the other does not. The shipped model's
similarity features read a short bare name against a short name plus Slovak
boilerplate and score the pair on the boilerplate; the jurisdiction agreement
then pushes it over the line. `DOL GROUP, s.r.o.` against `EEWS` scored 0.9849
on `jaroWinkler` 0, `bestVariantTrigramDice` 0.3846 and
`jurisdictionCountryMatch` 1.

This is the **Slovak instance of the Latvian defect P6.27 was named after**, on
data no model had seen, and the IDF-weighted features close eight of nine of it.
E2 introduced **no new** unrelated merges: the one it keeps is one v2 also made.

### The diagnostic §3.1 of the freeze required

P6.27's real finding was that a false-merge ceiling measured on the partition
being selected on is not a ceiling. Both models' thresholds were selected at the
same validation ceiling of 0.129%.

| Model | validation FMR | test #4 FMR | inflation |
|---|---|---|---|
| v2 | 0.129% | 0.877% | **×6.8** |
| E2 | 0.129% | 0.818% | **×6.3** |
| *v2lf (GBDT), for reference, on test #3* | *0.129%* | *2.380%* | ***×18.4*** |

**E2 does not show the v2lf failure mode.** It inflates slightly less than the
model it replaces. That is the evidence that the P6.27 collapse belonged to the
model family and not to the feature set — which is precisely what this
experiment was constructed to separate, and the separation holds.

The inflation is still nearly sevenfold for both models. Validation remains a
bad predictor of unseen false-merge behaviour in this project, and the fix for
that is a fresh instrument, not a better ceiling.

---

## 3. Where the gain is, by slice

| Slice | n (pos) | v2 recall | E2 recall | neg | v2 FM | E2 FM |
|---|---|---|---|---|---|---|
| domestic (both stated, same country) | 4,642 | 94.2% | **94.6%** | 21,370 | 310 | **288** |
| cross-border (both stated, different country) | **30** | 10.0% | **16.7%** | 13,962 | 0 | 1 |
| legal-form-sensitive (forms differ, or one side has none) | 1,967 | 95.3% | **95.7%** | 11,875 | 55 | **46** |
| boilerplate asymmetry (one side keeps a form the other lacks) | 1,905 | 96.2% | **96.6%** | 10,718 | 54 | **45** |
| aliases present on at least one side | 1,286 | 89.4% | **89.7%** | 10,333 | 98 | **93** |

By name-variation class:

| Class | n | v2 | E2 |
|---|---|---|---|
| containment | 3,123 | 98.7% | **98.9%** |
| exact / near-exact | 782 | 98.7% | **98.8%** |
| legal suffix or punctuation | 380 | 97.6% | **97.9%** |
| partial token overlap | 194 | 39.2% | **45.9%** |
| **divergent** | 193 | **40.4%** | 36.8% |

**E2 is worse on one slice**, the hardest: seven fewer of the 193 divergent-name
pairs. It is better on the other four, and much better on partial token overlap.
Recorded because a result reported only where it flatters is not a measurement.

---

## 4. What this test does NOT measure, stated before anyone quotes it

Test #4 is larger than test #3 and **easier**, and it is narrower where the
project's hardest question lives. All three follow mechanically from the two
declared rules — the country list inherited unchanged, and freshness enforced on
the subject — and none of them was a choice made after seeing a number. They are
limitations of the instrument, and they bound what the decision above can claim.

**It is an easier distribution than test #3.**

| Positive class | test #3 | test #4 |
|---|---|---|
| the three easy classes (containment, exact, legal-suffix) | 67.6% | **91.6%** |
| divergent + partial token overlap | 27.9% | **8.3%** |
| transliteration / script variant | 4.5% | **0%** |

That is why aggregate recall reads 93.7% here against 75.8% on test #3 for the
**same shipped model**. **The two numbers are not comparable and neither is a
correction of the other.** The head-to-head inside test #4 is unaffected: both
models scored the same 40,004 pairs once.

**It is jurisdictionally narrow.** 25 countries, and 82% of its records are SK
or CZ. The reason is structural: the unseen tail only exists in countries whose
earlier sweep was row-limit-bound, and those are the countries Wikidata covers
most densely. A test built to contain only what nothing has seen inherits the
shape of what is left.

**It barely tests cross-border, which was P6.27's headline.** 30 cross-border
positives against test #3's 50. E2 recovers 5 of 30. P6.27 measured the same
feature set inside a **tree ensemble** at 76.0% cross-border on test #3, and
this test cannot tell whether the linear model fails to exploit those features
across a border or whether 30 pairs is simply too few to say. **Both readings
are available and this document does not choose between them.** E2 was not
scored on test #3 to settle it, and must not be: test #3 is spent, and scoring
an alternative on a spent test after seeing this one is the exact move both
freezes were written to prevent.

**The Latvian measurement the freeze pre-registered returns nothing.** Test #4
contains **zero** pairs carrying the `sabiedriba` token and **zero** with a
Latvian jurisdiction on either side. The obligation was to measure it and the
honest result is that this instrument cannot: Latvia holds 293 LEI-bearing
entities in the declared universe and the earlier sweeps consumed them. The
Slovak `s.r.o.` merges in §2 are the same *failure class* and the features close
them, which is evidence about the mechanism and **not** a measurement of
Latvian. Recorded as future work; no heuristic was invented for it.

**E2 has exactly one frozen-test measurement.** v2 has three. E2 wins the only
head-to-head either of them has had under a rule fixed in advance, and that is
the basis for shipping it — not a claim that it is better understood.

---

## 5. Where the shipped model still fails

277 false splits and 289 false merges. The dominant error class is unchanged
from every earlier test and is not a defect under the labels in force:

| Class | n |
|---|---|
| false merge — shared leading token (corporate family) | 286 |
| false merge — identical normalised name | 2 |
| false merge — wholly unrelated | 1 |
| false split — partial overlap | 122 |
| false split — no shared token | 122 |
| false split — containment | 33 |

Representative false merges, all corporate families under the P6.21.2 identity
definition (different LEIs, so **negatives**):

```
0.9998  KMV BEV SK s. r. o.          <=> KMV BEV SK        [SK/SK]
0.9988  SIHOTPARK B s.r.o.           <=> SIHOTPARK         [SK/SK]
0.9988  Mercurtrade                  <=> Mercurtrade Holding [SK/SK]
0.9987  DATATHERM EU, spol. s r.o.   <=> DATATHERM         [SK/SK]
```

Representative false splits, against the 0.9823449517890187 threshold:

```
0.9822  VIA PRIBINA, A.S.                <=> GRANVIA, A. S.                  [SK/SK]
0.9820  DIRECT LINE INSURANCE LIMITED    <=> Direct Line                     [GB/GB]
0.9820  Gemeindewerke Stockelsdorf Ge…   <=> Gemeindewerke Stockelsdorf      [DE/DE]
0.9820  EMB Energie Brandenburg GmbH     <=> EMB Energie Mark Brandenburg    [DE/DE]
0.9820  Liga proti rakovine Slovenskej…  <=> League Against Cancer Slovakia  [SK/SK]
0.9812  CREASTRIPE j. s. a. v likvidácii <=> CREASTRIPE j. s. a.             [SK/SK]
```

Two things are visible here and both are old news measured again. The
liquidation marker `v likvidácii` is boilerplate the mined vocabulary does not
hold, so it splits a company from itself. And `League Against Cancer Slovakia`
against its Slovak name is a translation pair, which no feature in the set
attempts.

---

## 6. Status of every instrument after this document

| Dataset | Class |
|---|---|
| v1, v2, v3 | TRAIN (v2 also selection-exposed, v3 also corpus-design-exposed) |
| v4 | TRAIN — vocabulary and document-frequency mining only |
| frozen tests #1, #2, #3 | SELECTION-EXPOSED — SPENT |
| **frozen test #4** | **SPENT as of this document.** Scored once on two models; used to decide. It is now a development instrument and must never again be quoted as unseen. |

The project has **no untouched instrument**, which is the honest state after any
model decision and the price of having made one.

---

## 7. Reproduction

```bash
npm run ml:legal-forms                                   # vocabulary + DF from v2,v3,v4
npm run ml:e2:train                                      # E2, weightsDigest 40d3ceee
bash scripts/sweep-country-pages.sh \
  evidence/final-test-4/collection-declaration.json \
  evidence/final-test-4/sweep-log.jsonl                  # 108 countries, ordered pages
bash scripts/resolve-fresh-counterparts.sh               # GLEIF + EDGAR for fresh subjects
npm run ml:test4:corpus -- --adopt-runs
npm run ml:test4:dataset
npm run ml:test4:leakage                                 # expect PASS 13/13, L13 = 0
npm run ml:test4                                         # score shipped v2
npm run ml:test4:candidate                               # score candidate E2
node --import ./scripts/eval-resolve.mjs \
  scripts/ml/final-test-4-breakdown.ts                   # the comparison table
```

Shipped artifact after this phase: `cipher-er-pair-classifier.v2lr.json`,
modelVersion `2.2.0`, experimentId `E2-logistic-regression`, 31 features,
weightsDigest `40d3ceee…`, threshold `0.9823449517890187`. The superseded
`…v2.json` (weightsDigest `6948e6bc…`) is retained, still loadable, and is
covered by a test that says so.
