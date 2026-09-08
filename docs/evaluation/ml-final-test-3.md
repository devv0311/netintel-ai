# P6.27 — Frozen test #3, scored once. Decision: KEEP V2.

**Phase:** P6.27
**Data class:** REAL. GLEIF (CC0 1.0), Wikidata (CC0 1.0), SEC EDGAR (public domain).
**Instrument:** `evidence/ml/pair-dataset-final-test-3.json` — 17,442 pairs,
2,823 positives, 969 curated hard negatives, 2,812 subjects, 70 jurisdictions,
one partition. Leakage **PASS 13/13**, L13 = 0 subjects fitted on by any earlier
build.
**Selection freeze:** `ml-selection-freeze.md`, committed at `ff32e02`, before
any model scored this test.
**Resolution semantics changed:** **NONE.** `src/lib/resolution/` byte-identical
to `af22018`.

---

## 1. The result

| Model | TP | FP | Recall | Precision | F1 | False-merge rate | Hard-neg FM | **Unrelated merges** |
|---|---|---|---|---|---|---|---|---|
| **Shipped v2** (LR, 26 features) | 2,140 | 47 | 75.8% | 97.9% | 85.4% | 0.321% | 1.41% | **0** |
| Candidate **v2lf** (GBDT, 31 features) | 2,382 | 348 | 84.4% | 87.3% | 85.8% | 2.380% | 10.16% | **10** |
| Context v3lf (GBDT, 31 features) | 2,447 | 440 | 86.7% | 84.8% | 85.7% | 3.010% | 12.77% | **15** |
| Deterministic resolver (Tier B/B2) | 516 | 6 | 18.3% | 98.9% | 30.9% | 0.041% | 0.18% | 0 |

**The candidate buys +242 true positives with +301 false merges.** It makes more
new errors than corrections.

F1 does not show this — 85.8% against 85.4%, a candidate "win". That is
precisely why the freeze ruled F1 out in advance: a blended score treats a false
merge and a miss as interchangeable, and in investigative entity resolution they
are not. A false merge fuses two real companies into one node and every
downstream inference inherits it. A miss leaves two nodes a human can still join.

---

## 2. Decision

**KEEP V2.** Against the rule fixed in `ml-selection-freeze.md` §3:

- **(a) Net identity recovery improves — PASSES.** 2,382 against 2,140.
- **(b) False merges do not get qualitatively worse — FAILS, decisively.**
  The candidate merges **10 wholly unrelated companies**. The shipped model
  merges **zero**. Every one of the shipped model's 47 false merges is an
  identical-normalised-name collision or a shared-leading-token corporate-family
  pair — the P6.21.2 open question, not a defect.

The rule requires both. One fails, so the candidate does not ship.

This is the same standard on which P6.26 rejected v3, applied to a model I built
myself. Applying a weaker one here would have made that earlier rejection
retrospective theatre.

### What the candidate actually merged

```
0.9989  ČD – Telematika                    <=> UNI Telematika                [CZ/CZ]
0.9846  OLYMP                              <=> New Trading Generation        [SK/SK]
0.9846  EQUINOX CONSULTING                 <=> MAYA                          [SK/SK]
0.9733  Aichi Bank                         <=> インヴァスト証券株式会社          [JP/JP]
0.9733  Abbott Japan                       <=> 株式会社きらぼし銀行             [JP/JP]
0.9733  John Menzies                       <=> FirstGroup plc                [GB/GB]
```

`Abbott Japan` is a pharmaceutical subsidiary and `きらぼし銀行` is a bank. These
are not close calls, and they are not corporate families.

---

## 3. What the P6.27 features did achieve

The features are not the problem, and the same test says so clearly.

| Slice | n | Shipped v2 | Candidate v2lf | Deterministic resolver |
|---|---|---|---|---|
| **Different country** (cross-border) | 50 | **10.0%** | **76.0%** | 58.0% |
| Same country | 2,766 | 77.0% | 84.5% | 17.4% |
| **edgar × wikidata** | 24 | **29.2%** | **87.5%** | 75.0% |
| gleif × wikidata | 2,799 | 76.2% | 84.4% | 17.8% |

Cross-border recall goes from 10.0% to 76.0%, clearing the deterministic
resolver's 58.0% for the first time. This is the gap P6.25 first measured at
5.7%, P6.26 independently re-measured at 5.1%, and this test measures a third
time at 10.0% on wholly fresh data. **The feature work closes it.** The model
built on those features is still not shippable, and both statements are true at
once.

---

## 4. What went wrong, and it is not the feature set

**The comparison confounds two changes.** The shipped model is logistic
regression; both candidates are gradient-boosted trees, chosen automatically by
the existing E1–E7 ladder because GBDT beat logistic regression by 3.9 points of
validation recall. So "candidate v2lf" is *features + model family*, and this
test cannot separate them.

**Validation did not predict the failure, and the size of the miss is the
finding.** On its own validation partition the candidate showed a false-merge
rate of **0.13%**. On test #3 it is **2.380%** — eighteen times worse. The
shipped logistic model moved far less (validation 0.13% → test 0.321%). A tree
ensemble with 31 features and ~10k training pairs is fitting the validation
partition's negative distribution, and only an instrument it has never seen
reveals that.

This is a lesson about the ladder, not just this model: **E1–E7 select on
validation recall with a false-merge ceiling, and a ceiling measured on the
partition being selected on is not a ceiling.**

**The obvious next candidate was not eligible.** E2 logistic regression with the
P6.27 features reached 81.4% validation recall against the shipped model's
79.7% — the same feature gain, in the family that has proven stable here. It is
not scored in this document and must not be: the freeze fixes the candidate
before the test is read, and scoring an alternative now and shipping it would be
selection on the test set. It is the declared next step, and it needs a fourth
instrument.

---

## 5. Where the shipped model still fails

683 false splits, from its own error analysis:

| Class | n |
|---|---|
| no shared token | 336 |
| partial overlap | 304 |
| containment | 43 |

Representative, with scores against the 0.9774753387972909 threshold:

```
0.9768  Epigenomics AG                <=> Epigenomics AG              [US-2M/DE]
0.9768  ARNOLDO MONDADORI EDITORE SPA <=> Mondadori                   [IT/IT]
0.9762  Better Energy Væggerløse P/S  <=> Better Energy Væggerløse IVS [DK/DK]
0.9761  SBI新生信託銀行株式会社          <=> SBI Shinsei Bank & Trust     [JP/JP]
0.9722  Partenaires D'infrastructure  <=> YHU Infrastructure Partners  [CA-QC/CA]
```

The first row is the clearest statement of the residual defect: **two records
with an identical name, scored 0.9768, six ten-thousandths below the threshold,
and split** — because the publishers state different countries. 48 of the 683
false splits are cross-border. The jurisdiction-conflict feature is doing too
much work in the shipped model, and the P6.27 features are the measured
correction for it, waiting on a model family that does not trade it for 301
false merges.

And its 47 false merges remain what P6.25 and P6.26 both found: identical
normalised names (3) and shared-leading-token corporate families (44). Nothing
unrelated. The advisory disclaimer in `src/lib/ml/service.ts` already states
both this and the low-score blind spot, and remains accurate.

---

## 6. Status of every instrument after this document

| Dataset | Class |
|---|---|
| v1, v2, v3 | TRAIN (v2 also selection-exposed, v3 also corpus-design-exposed) |
| v4 | TRAIN — vocabulary and document-frequency mining only, never fitted on |
| frozen test #1 | SELECTION-EXPOSED — SPENT (P6.26) |
| frozen test #2 | SELECTION-EXPOSED — SPENT (P6.26) |
| **frozen test #3** | **SPENT as of this document.** Scored once on three models; used to decide. It is now a development instrument and must never again be quoted as unseen. |

The project once more has **no untouched instrument**. That is the expected cost
of reading one, it is recorded here at the moment it was incurred, and a fourth
test is the price of the next model decision.

---

## 7. Reproduction

```bash
npm run ml:legal-forms                       # mine vocabulary + DF from v2,v3,v4
npm run ml:test3:corpus -- --adopt-runs      # build test #3 (subject bucket "test")
npm run ml:test3:dataset
npm run ml:test3:leakage                     # expect PASS 13/13
npm run ml:test3                             # score shipped v2
npm run ml:test3:candidate                   # score candidate v2lf
```

Artifacts: shipped `cipher-er-pair-classifier.v2.json` weightsDigest
`6948e6bc…`, unchanged. Candidate `…v2lf.json` weightsDigest `b9a90ca9…`,
threshold 0.9708364394896696, retained in `models/` as the measured record of
this experiment — **not** wired into `service.ts`.
