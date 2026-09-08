# P6.28 — Selection freeze for E2, written before test #4 exists

**Phase:** P6.28
**Status at the time of writing:** test #4 **has not been collected.** No
record of it exists on disk, no country has been swept for it, and no model
has scored anything it will contain.

> **OUTCOME, appended after the evaluation:** the rule below returned
> **SHIP E2**. The candidate passed (a) with 4,395 true positives against
> 4,378 and passed (b) decisively — **one** wholly-unrelated merge against the
> shipped model's **nine**, with 21 fewer false merges in total. The
> validation-to-test false-merge inflation §3.1 required was **×6.3** for the
> candidate against **×6.8** for the shipped model, so E2 does not show the
> v2lf failure mode. The Latvian measurement §5 pre-registered returned
> **nothing**: test #4 contains zero `sabiedriba` pairs. Results in
> `ml-final-test-4.md`. Nothing in this document was edited except this note;
> the rule stands as it was written.

This document fixes the candidate, its corpus, its features, its
hyperparameters, its seed, its threshold, the decision rule and the ship /
reject criteria **before the instrument that will judge them is built.** It is
committed in its own commit, ahead of both the collection commit and the
evaluation commit, so the ordering is provable from `git log` rather than
asserted — the same device the P6.27 country declaration and the P6.27
selection freeze used.

The predecessor document, `ml-selection-freeze.md`, remains exactly as
written. It is not superseded: its rule was applied, it returned KEEP V2, and
this document reuses that rule rather than inventing a friendlier one.

---

## 1. Why there is a fourth experiment at all

P6.27 read frozen test #3 once and it said something specific: **the P6.27
feature set works and the model family it was paired with does not.**

Cross-border recall moved 10.0% → 76.0% and `edgar × wikidata` 29.2% → 87.5%,
on data no model had seen. That is the gap P6.25 measured at 5.7%, P6.26
re-measured at 5.1% and test #3 measured a third time at 10.0%. The features
close it.

The same test also showed the candidate merging **ten pairs of wholly
unrelated companies** against the shipped model's zero, and buying its +242
true positives with +301 false merges. It failed criterion (b) and did not
ship.

Those two results are attributable to different things, and the P6.27
comparison **confounded them**: the shipped model is logistic regression, the
candidate was gradient-boosted trees, and the E1–E7 ladder had chosen GBDT
automatically on 3.9 points of validation recall. So "candidate v2lf" was
*features + model family* and test #3 could not separate them.

E2 — logistic regression on the same 31 features — is the experiment that
separates them. It differs from the **shipped** model in the feature set alone
and from the **rejected** candidate in the model family alone. Whatever test #4
says is therefore attributable, which is the entire reason to spend a fourth
instrument on it.

---

## 2. What is frozen

Everything below was chosen from the **train and validation partitions of the
v2 dataset only**. No frozen test contributed to any of it. Test #3 is spent
and was not re-read to produce a single value in this table; test #4 does not
exist yet.

### 2.1 Corpus

| | |
|---|---|
| Dataset | `evidence/ml/pair-dataset-v2.json` |
| sha256 | `e9467baaca06913e4a3c011f73789099d63032ed876489aa26a0145ca9d44e55` |
| datasetId / version | `cipher-er-pairs` / `2.0.0` |
| Split seed | `cipher-p6.25-pair-dataset-v2` |
| Source corpus | `evidence/expanded-v2/expanded-v2-anchored.corpus.json` (`7048c136…`) |
| Source ground truth | `evidence/expanded-v2/expanded-v2.ground-truth.json` (`c8434f1e…`) |
| Partitions read | `train` (3,121 pairs), `validation` (951 pairs) |
| Partition NOT read | `test` — never loaded by `scripts/ml/train-model.ts`, enforced by leakage check L10 |

**This is the same pinned corpus the shipped model was fitted on**, deliberately.
P6.26 already scored a corpus change (v3) against v2 on a frozen test and v3
lost — 82 fewer real pairs recovered, and 5 of its 25 false merges joined
wholly unrelated companies against 0 of 28 for v2. Changing corpus *and* model
family in the same experiment would rebuild the confound this experiment
exists to remove.

### 2.2 Preprocessing and features

| | |
|---|---|
| Feature set | P6.27, **31 trainable features** |
| Added over the shipped 26 | `coreNameMatch`, `coreTokenJaccard`, `coreTrigramDice`, `idfWeightedJaccard`, `maxSharedTokenIdf` |
| Name normalisation | `src/lib/resolution/name-normalization.ts`, byte-identical to `af22018` |
| Legal-form vocabulary | `src/lib/ml/legal-form-vocabulary.ts` (`53b440f7…`), reviewable copy `evidence/ml/legal-form-vocabulary.json` (`5ffbdc5e…`) |
| Vocabulary provenance | mined from v2 / v3 / v4 by `scripts/ml/mine-legal-forms.ts`; the miner **refuses any input path containing `final-test`** |
| Standardisation | per-feature mean / stddev, fitted on **TRAIN rows only** (leakage check L9) |

### 2.3 Model and hyperparameters

| | |
|---|---|
| Experiment | `E2-logistic-regression` |
| Family | logistic regression |
| learningRate | `0.5` |
| epochs | `4000` |
| l2 | `0.002` |
| positiveWeight | `4` |
| Seed | `20260904` |

These are the ladder's standing `LOGISTIC_OPTIONS`, unchanged. Nothing was
tuned for this experiment; that is the point of naming an existing rung rather
than adding one.

### 2.4 Selection mechanism

The ladder ranks candidates on validation recall. P6.27 measured what that
costs: it promoted E3 over E2 on 3.9 points of validation recall, and the
false-merge ceiling that was supposed to restrain E3 was measured **on the very
partition the ranking ran on**. Test #3 then found that ceiling to be eighteen
times looser than validation claimed (0.13% → 2.380%).

So E2 is **named, not ranked**. `scripts/ml/train-model.ts` gained
`--select-experiment`, which writes a named non-ablation experiment to the
artifact. Every rung still runs and every result is still recorded — E3 still
wins the validation ranking in this run and is still written to the registry
saying so. The flag changes which recorded experiment ships, and nothing else.
Ablations (E4, E5) remain ineligible and naming one fails the run.

### 2.5 Threshold and decision rule

| | |
|---|---|
| Decision threshold | **`0.9823449517890187`** |
| Chosen on | the **validation** partition |
| Policy | the threshold maximising F1 subject to a false-merge rate no higher than the deterministic resolver's on the same partition (0.0013), **and** no higher than that resolver's false-merge rate over the curated hard negatives alone (1/25 = 0.0400) |
| Decision rule | merge-advisory iff `score ≥ threshold` |

### 2.6 Artifact

| | |
|---|---|
| Path | `models/cipher-er-pair-classifier.v2lr.json` |
| modelVersion | `2.2.0` |
| **weightsDigest** | **`40d3ceee6ce99419dcd2b100abe1ad08a6e5edd8372fb69d1b1278b4e6eb78ac`** |
| Command | `npm run ml:e2:train` |
| Reproducibility | trained twice; `weightsDigest` and `decisionThreshold` identical, `createdAt` the only differing field |

`weightsDigest` is the reproducibility test, not `sha256`: the file's sha256
also moves with `createdAt` and `gitCommit`, which are provenance rather than
model.

### 2.7 Validation metrics — the only numbers that existed when this was written

| | |
|---|---|
| TP / FP / TN / FN | 144 / 1 / 773 / 33 |
| Precision | 99.31% |
| Recall | **81.36%** |
| F1 | 89.44% |
| False-merge rate | 0.129% |
| ROC-AUC / PR-AUC | 0.9931 / 0.9753 |

For orientation, from the same run's registry: shipped v2 (26 features)
reached 79.7% validation recall; the rejected v2lf (E3, 31 features) reached
85.3%; E2 reaches 81.4%.

**None of these numbers may be used to predict test #4, and the reason is
recorded in this very phase:** v2lf's validation false-merge rate of 0.13%
understated its test false-merge rate of 2.380% by a factor of eighteen. A
statistic measured on the partition being selected on is not a bound.

---

## 3. The decision rule, fixed now

Test #4 is scored **once**, on two models: the shipped `v2` and the candidate
`v2lr`. The rule is **carried forward from `ml-selection-freeze.md` §3
unchanged**, because it was written before test #3 was read, it was applied
against a model built in that phase, and weakening it now would make that
rejection retrospective theatre.

**SHIP E2** only if BOTH hold:

- **(a) Net identity recovery improves.** It recovers more true positives than
  the shipped model, each at its own frozen threshold.
- **(b) False merges do not get qualitatively worse.** The shipped model's
  false merges have been, on every instrument so far, identical-normalised-name
  collisions and shared-leading-token corporate-family pairs — the P6.21.2 open
  question rather than a defect. A candidate that introduces merges between
  **wholly unrelated** companies fails (b) even if it wins on (a).

**KEEP v2** if either fails.

**Aggregate F1 is not the criterion**, and P6.27 is the worked example of why:
v2lf won F1 85.8% against 85.4% while making 301 more false merges than the
model it lost to. In investigative entity resolution a false merge fuses two
real companies into one node and every downstream inference inherits it; a miss
leaves two nodes a human can still join. A blended score treats them as
interchangeable and they are not.

### 3.1 The additional diagnostic this experiment owes

P6.27's finding was not only about one model. It was that **the ladder's
false-merge ceiling is measured on the partition being selected on, and is
therefore not a ceiling.** E2's validation false-merge rate is 0.129% — the
same number v2lf showed before it inflated eighteenfold.

So the report must state E2's **validation-to-test false-merge inflation
factor** alongside the shipped model's, whatever the ship decision is. The
shipped logistic model's own inflation on test #3 was 0.13% → 0.321%, a factor
of about 2.5. If E2 inflates like v2lf did, that is a property of the ladder
worth recording even in a KEEP V2 outcome; if it inflates like v2 did, that is
evidence the family and not the features carried the P6.27 failure.

This is a **reporting obligation, not a ship criterion.** It cannot rescue a
candidate that fails (a) or (b), and it cannot sink one that passes both.

---

## 4. Identity definition in force

Unchanged, from `parent-subsidiary-policy.md` (P6.21.2): **same legal entity =
same LEI.** "Parent company", "subsidiary" and "controlled entity" remain
deliberately undefined and unused. A parent/subsidiary pair is therefore a
**negative**, and a model that merges one has made a false merge — but a false
merge of that class is materially less alarming than one between unrelated
companies, which is why criterion (b) distinguishes them rather than counting
them together.

P6.21.2's open items (whether to enable Policy B/C/D, add-on P, the 124
dangling targets) remain project-owner decisions and **do not block this
evaluation**, because none of them changes what "same legal entity" means.

---

## 5. The Latvian legal form, declared as a measurement and not a fix

P6.27 established that `sabiedrība` — Latvian for the "company" in "limited
liability company" — is too rare in the training corpora for corpus-level IDF
to identify as boilerplate. Re-mining with v4 put Latvian tokens into the
document-frequency table for the first time and **did not fix it**:
`sabiedriba` reaches df = 7 across 8,146 documents, so an IDF table scores it
as maximally rare, which is exactly backwards for a token that is a
jurisdiction's standard legal form.

E2 inherits this. It is a **known, declared, pre-registered limitation**, and
the obligation it creates is to *measure* it:

- Test #4's report must state how Latvian-language legal-form pairs behave
  under E2 and under the shipped model.
- **No heuristic may be invented after reading test #4**, and E2 must not be
  patched in response to what test #4 says about Latvian or anything else.
- If it remains a meaningful failure mode, it is recorded as future work
  **after** ML closure, not as an amendment to this experiment.

---

## 6. What must not happen after this point

- Test #4 must not be scored more than once per model.
- Neither the candidate, its corpus, its feature set, its hyperparameters, its
  seed nor its threshold may change in response to anything test #4 says. If
  E2 loses, the outcome is **KEEP V2 and ML closure** — not a retune.
- No third model may be added to the comparison after collection. The two
  models named in §3 are the whole of it. `v2lf` and `v3lf` were scored on
  test #3 and are not re-scored here; they are a spent experiment's record.
- **This is intended to be the final P6 model-selection experiment.** A fifth
  candidate requires a fifth instrument, and the only thing that reopens the
  question automatically is a reproducibility or correctness defect that
  invalidates this experiment itself — not a disappointing number.
