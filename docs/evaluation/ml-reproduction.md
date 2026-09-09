# Reproducing every published ML number

Everything below runs from the committed repository. **No network access
is required** — the raw payloads are committed under `data/public/raw/`,
and every script reads from disk.

Node ≥ 22.13. No ML dependency: the model is JSON and the trainer is
plain TypeScript in `src/lib/ml/train.ts`.

---

## 0. What "reproduced" means here

Two artifacts trained from the same commit and dataset produce
**bit-identical weights** and **different file hashes**, because
`createdAt` and `gitCommit` are embedded and both are correct fields to
record. So:

- **`weightsDigest`** — sha256 of the artifact with those two provenance
  fields removed. **This is the equality test.** `loadArtifact` verifies
  it and refuses a mismatch.
- **`artifactSha256`** — identifies the exact bytes on disk. It moves
  between runs, by design.

Reports embed a `ranAt` timestamp for the same reason. When comparing a
regenerated report against the committed one, ignore `ranAt`,
`createdAt`, `gitCommit`, `builtAt` and `trainingMillis`; every other
field must match exactly.

## 0.1 The corpus reads a DECLARED run set, not the disk

Each corpus pins the collection runs it was built from:

- `evidence/expanded-v2/collection-runs.json` — 4 Wikidata, 14 GLEIF, 2 EDGAR
- `evidence/final-test/collection-runs.json` — 12 Wikidata, 16 GLEIF, 3 EDGAR

The builders read those runs and only those. This is load-bearing, and
it was added because its absence silently broke this document.

The loader used to read every run directory under
`data/public/raw/<src>`, which is correct exactly once — while a corpus
is being assembled and nothing depends on it yet. The P6.25 final test
was then collected into those same three directories. Re-running §1 from
a clean checkout therefore rebuilt the *training* corpus from 31 runs
instead of the 20 it was frozen from: 3,290 scorable records became
5,085, 1,711 positives became 2,604, and **417 of the final test's 973
subjects landed in TRAIN and VALIDATION.** Leakage checks L1–L13 all
still passed — a freshly-built split is internally disjoint whatever it
absorbed — so nothing would have reported it.

`tests/unit/ml-collection-runs.test.ts` asserts the pins. To extend a
corpus deliberately, pass `--adopt-runs`, which re-declares the pin from
disk; nothing else changes it.

## 1. The training corpus, and the superseded v2.0.0 artifact

> **`npm run ml:train` does not produce the shipped model.** It reproduces
> **v2.0.0**, which was superseded at P6.28. The shipped artifact is E2 / v2.2.0
> and is built in [§1.1](#11-the-shipped-model-e2--v220). Both are fitted on the
> same corpus, which is why this section comes first.

The base `ml:*` scripts build the corpus and the v2.0.0 artifact. The superseded
P6.24 chain is still reproducible under the `ml:v1:*` names (§4).

```bash
npm run ml:corpus      # 1. corpus + ground truth from the committed raw payloads
npm run ml:dataset     # 2. entity-disjoint pair dataset
npm run ml:leakage     # 3. leakage gate — MUST print PASS before training
npm run ml:train       # 4. the experiment ladder; reads train + validation only
```

Expected:

| | |
| --- | --- |
| Scorable records / positives / hard negatives | 3,290 / 1,711 / 477 |
| Partitions (train / validation / test) | 3,121 / 951 / 6,692 pairs |
| Leakage verdict | **PASS 13/13**, against BOTH frozen tests |
| Selected experiment | `E2-logistic-regression` (26 features), recall 79.7%, threshold 0.9774753387972909 |
| **weightsDigest** | `6948e6bc6bb94b0aebe937fe0bd445e39b4c49e62cb456efa7eac742fde2f849` |

## 1.1 The shipped model (E2 / v2.2.0)

The artifact the application imports. Same corpus as §1, same model family, same
seed — what differs is the **P6.27 feature set**, so the mined vocabulary must be
built before training. It is mined from the three **training** datasets only —
v2 (3,282 records), v3 (10,041) and v4 (5,683), 19,006 in total, each pinned by
sha256 in `evidence/ml/legal-form-vocabulary.json`. **No frozen test contributes
a token**, which is what keeps the features from reading the exam.

```bash
npm run ml:corpus && npm run ml:dataset && npm run ml:leakage   # as in §1
npm run ml:legal-forms   # mine legal-form vocabulary + token document frequencies
npm run ml:e2:train      # E2 NAMED, not ranked: --select-experiment E2-logistic-regression
```

Expected:

| | |
| --- | --- |
| Artifact | `models/cipher-er-pair-classifier.v2lr.json`, model version **2.2.0** |
| Experiment | `E2-logistic-regression`, `featureSet: engineered-31`, seed 20260904 |
| Hyperparameters | lr 0.5 · 4,000 epochs · L2 0.002 · positive weight 4 |
| Validation recall at the selected threshold | **81.4%** (144/177), precision 99.3% |
| Threshold | `0.9823449517890187` |
| **weightsDigest** | `40d3ceee6ce99419dcd2b100abe1ad08a6e5edd8372fb69d1b1278b4e6eb78ac` |
| Registry | `reports/ml/experiment-registry-v2lr.json` |

**`--select-experiment` names the rung that ships rather than ranking into it**,
and that is deliberate: at P6.27 the ladder auto-selected gradient-boosted trees
whose validation false-merge rate understated its test rate by eighteen times. A
ceiling measured on the partition being selected on is not a ceiling. Every rung
still runs and the registry still records what won the ranking. Why the family was
named ahead of the test: [`ml-selection-freeze-e2.md`](./ml-selection-freeze-e2.md).

## 2. The first frozen test

```bash
npm run ml:final-test:corpus     # collected AFTER all feature work
npm run ml:final-test:dataset    # single partition: --all-test
npm run ml:final-test:leakage    # PASS 13/13, and 0 overlap with v1 or v2
npm run ml:final-test            # scored ONCE against the frozen artifact
```

Expected: 5,257 pairs / 892 positives / 244 curated hard negatives / 963
subjects; leakage **PASS 13/13**; model recall **76.5%** (682/892),
precision 93.7%, hard-negative false merges **41/244**; baseline recall
48.7% (434/892), hard-negative false merges 16/244.

**Three subjects are shared with the v2 dataset, and the test was not
re-cut.** `CIK:1534701`, `CIK:1610520` and `CIK:823094` appear in v2's
`partitionOfSubject` map but contribute **zero v2 pairs**, so the model
was never trained on them. They reach this test as one side of three
`sampled_negative` pairs — 3 of 5,257 (0.06%), **0 positives**, and on a
negative class where both the model and the baseline make zero false
merges. Recall (682/892), precision and every hard-negative number above
are arithmetically unaffected. The exclusion that missed them read only
prior *pairs*; it now also reads prior `partitionOfSubject`, so a future
test cannot repeat it. This is recorded rather than repaired because
re-cutting a frozen test to remove three inert negatives would spend the
instrument to change no published number.

## 3. The head-to-head

```bash
npm run ml:compare
```

Scores every model only on pairs whose subjects appear in no fit
partition of any compared model. On the final test that is all 5,257
pairs (0 excluded). Expected: v1 recall 2.7%, v2 recall 76.5%, both
`digest ok`.

## 3.1 The P6.26 cross-border experiment and final test #2

Neither is shipped; both are reproducible, and the second frozen test is
the instrument that judged the first.

```bash
npm run ml:v3:corpus       # v2's runs + the targeted cross-border collection
npm run ml:v3:dataset
npm run ml:v3:leakage      # PASS 13/13
npm run ml:v3:train        # GBDT wins on 9,304 training pairs
npm run ml:v3:evaluate

npm run ml:final-test-2:corpus    # 40 countries disjoint from every prior collection
npm run ml:final-test-2:dataset
npm run ml:final-test-2:leakage   # PASS 13/13, L13 = 0 fitted on
npm run ml:final-test-2           # the SHIPPED v2 model, scored once
npm run ml:final-test-2:v3        # the P6.26 model, scored once
```

Expected — corpus v3: 10,055 scorable records, 5,139 positives, 1,774
hard negatives, 154 jurisdictions; dataset 32,808 pairs; shipped
experiment `E3-gradient-boosted-trees`, weightsDigest
`12df4c241d4547f9492471fd65f7f41ddb3c0bc0b99c5654fee5ac974e765a09`.

Expected — final test #2: 16,675 pairs, 1,792 positives, 716 curated hard
negatives, 1,794 subjects. **v2** recall 81.7% (1,464/1,792), 28 false
merges, cross-border 2/39; **v3** recall 77.1% (1,382/1,792), 25 false
merges, cross-border 18/39; baseline recall 19.3%.

Why v3 is not shipped, with both columns:
[`ml-cross-border-experiment.md`](./ml-cross-border-experiment.md).

## 3.2 Frozen tests #3 and #4

Test #4 is the instrument that selected the shipped model. Both are **spent** —
reproducing them re-derives published numbers; it does not restore an unseen test.

```bash
npm run ml:test3:corpus     # --subject-bucket test; disjoint from v4 by construction
npm run ml:test3:dataset
npm run ml:test3:leakage    # PASS 13/13, L13 = 0
npm run ml:test3            # shipped v2, scored once
npm run ml:test3:candidate  # the P6.27 GBDT candidate v2lf, scored once

npm run ml:test4:corpus     # declared before collection; excludes all seven prior datasets
npm run ml:test4:dataset
npm run ml:test4:leakage    # PASS 13/13, L13 = 0
npm run ml:test4            # v2.0.0, scored once
npm run ml:test4:candidate  # E2 / v2lr — the shipped model, scored once
```

Expected — **test #3**: 17,442 pairs, 2,823 positives, 969 curated hard negatives,
2,812 subjects, 70 jurisdictions. v2 recall 75.8% (2,140), **0** wholly unrelated
merges; v2lf recall 84.4% (2,382), **10**. Decision: KEEP V2
([`ml-final-test-3.md`](./ml-final-test-3.md)).

Expected — **test #4**: 40,004 pairs, 4,672 positives, 2,049 curated hard
negatives, 4,709 subjects, 25 countries. v2.0.0 recall 93.71% (4,378), 9 wholly
unrelated merges; **E2 recall 94.07% (4,395/4,672)**, precision 93.83%,
hard-negative false merges **111/2,049**, **1** wholly unrelated merge; baseline
recall 24.87% (1,162/4,672), hard-negative false merges 5/2,049. Decision: SHIP E2
([`ml-final-test-4.md`](./ml-final-test-4.md)).

The comparison across models on identical pairs is
`reports/ml/final-test-4-comparison.json`. What these numbers do **not**
establish — the easier distribution, the 30 cross-border positives, the zero
Latvian pairs — is `ml-final-test-4.md` §4, and must be quoted with them.

## 4. Reproducing the superseded P6.24 results

The P6.24 numbers remain reproducible from this same repository. The
underlying scripts were parameterised rather than rewritten, and the
`.ts` files still default to the P6.24 inputs — the `ml:v1:*` npm scripts
simply invoke them with no arguments.

```bash
npm run ml:v1:dataset   # rebuilds cipher-er-pairs v1.0.0 byte-identically but for `builtAt`
npm run ml:v1:leakage   # FAILS L12 — the finding, not a regression
npm run ml:v1:train     # v1 artifact; weights bit-identical to the committed one
npm run ml:v1:evaluate  # 2,615 pairs, recall 89.0%, precision 99.1%
```

`npm run ml:v1:leakage` **exits non-zero**. That is correct: the P6.24
dataset contains four one-way veto features (see
[`ml-leakage-audit.md`](./ml-leakage-audit.md)). It is kept under a
separate script name precisely so that a CI gate wired to `ml:leakage`
tests the shipped dataset and is not permanently red because of a
recorded historical finding.

Verified during the P6.25 audit: dataset, model weights and all four
evaluation reports regenerate exactly, differing only in embedded
timestamps.

## 5. Re-collecting the data from the publishers

Not required for reproduction, and **not** byte-reproducible — the
publishers' data changes. Provided so the collection is auditable.

```bash
# always run the dry-run gate first; it opens no socket
npm run collect:public -- --source wikidata --query companies-with-lei-enriched-v2 --limit 2000 --dry-run
npm run collect:public -- --source wikidata --query companies-with-lei-enriched-v2 --limit 2000

# per-country slices (final test): IN GB FR JP AU BR ZA SG
npm run collect:public -- --source wikidata --country GB --limit 500

# LEI/CIK linkage sets are DERIVED from an already-collected source, never hand-typed
npm run collect:public -- --source gleif --leis-from <path> --limit 500
npm run collect:public -- --source edgar  --ciks-from <path> --limit 400
```

Each run writes `data/public/raw/<source>/<retrievedAt>/` containing the
raw payloads, `manifest.json` (rawSha256 over the publisher's bytes,
endpoint, query, licence, channel, warnings) and the transformed
`public-records.json`.

## 6. The regression tests

```bash
npm run typecheck && npm run lint && npm test
```

`tests/unit/ml-dataset.test.ts` re-scores the evaluation partition from
the committed artifact and asserts it reproduces the committed report
exactly, and `tests/unit/ml-model.test.ts` asserts the superseded v1
artifact still loads and scores — which is what keeps the head-to-head in
§3 possible. If a feature, the normaliser, the artifact or a dataset
changes without the reports being regenerated, these fail. That is how
"the published metrics are reproducible" stays a fact about the
repository rather than a claim in a document.
