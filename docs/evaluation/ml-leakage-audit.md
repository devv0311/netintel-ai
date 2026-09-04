# Leakage audit — CIPHER entity-resolution model

**Gate:** `scripts/ml/leakage-audit.ts` **Result:** `reports/ml/leakage-audit.json`
**Verdict: PASS** (10 of 10 checks), re-verified independently by
`tests/unit/ml-dataset.test.ts`.

The gate runs before training and exits non-zero on any failure. It has
already failed once and forced a rebuild; §3 records that.

---

## 1. The leakage that would have been fatal, and how it is prevented

Every label in this project is derived from an identifier. A positive is
identifier AGREEMENT; a negative is identifier DISAGREEMENT. The label is
therefore a deterministic function of the identifiers.

It follows that **an identifier feature is not a feature — it is the
answer.** A model given `sharesLEI` would score 100% on every partition,
learn nothing about names, and be useless at the only job worth doing:
judging pairs where an identifier is absent, which is exactly where the
deterministic resolver fails.

Three independent barriers enforce this:

1. **Type.** `buildFeatures` accepts a `FeatureRecord`, which has four
   fields — `name`, `officialName`, `aliases`, `jurisdiction` — and no
   identifier field. The contract is enforced by the compiler.
2. **Data.** The anchored corpus physically withholds identifiers from
   748 of 1,245 records.
3. **Check.** L5 asserts the stored projection carries no identifier key;
   L6 greps `src/lib/ml/features.ts` for identifier accessors outside
   comments.

The OpenCorporates id is excluded on the same reasoning one step removed:
`ocid_agrees` is recorded as corroboration on positives and is
co-determined with LEI agreement.

## 2. The ten checks

| # | Check | Result |
|---|---|---|
| L1 | Subject disjointness | PASS — 756 subjects, 0 in more than one partition |
| L2 | Declared partition agrees with emitted pairs | PASS — 0 disagreements |
| L3 | Record disjointness | PASS — 1,240 records, 0 in more than one partition |
| L4 | No duplicated record pair | PASS — 4,053 distinct pairs, 0 repeats |
| L5 | Record projection carries no identifier field | PASS — only the four readable fields |
| L6 | Feature code reads no identifier | PASS — no accessor outside comments |
| L7 | No single feature separates the classes almost perfectly | PASS — every standalone ROC-AUC inside [0.01, 0.99] |
| L8 | No identical entity spans two partitions | PASS — 1 normalised name recurs across partitions, under DIFFERENT subjects |
| L9 | Standardiser fitted on TRAIN rows only | PASS |
| L10 | Training script never reads the held-out partition | PASS |

**On L7.** A feature that alone separates the classes almost perfectly is
the signature of target leakage. The strongest single features sit well
inside the band, which is what one expects when the label comes from
identifiers and the features come from names.

**On L8.** One normalised name occurs in more than one partition. Its
records belong to *different* subjects — two distinct legal entities that
share a name. That is the phenomenon the hard negatives exist to capture;
it is not leakage. The check distinguishes it from the same subject
appearing twice, which would be.

## 3. The failure the gate caught

On its first run L3 FAILED: `wikidata:EXP-0926` — Rocky Mountain
Chocolate — appeared in both validation and the held-out partition. That
single Wikidata record is a positive partner of three subjects: an LEI,
and two CIKs belonging to a predecessor filer and its successor.
Assigning those subjects independently put one record on both sides of
the wall.

The split was **invalidated and rebuilt**, not argued with. The builder
now joins any subjects reachable through a shared record before
assignment (4 such joins, plus 92 LEI/CIK scheme bridges). L3 passes on
the rebuilt split and `tests/unit/ml-dataset.test.ts` re-derives it
independently from the committed dataset.

## 4. Preprocessing and the frozen test

- Centring and scaling statistics are fitted on the TRAIN rows only
  (`fitStandardiser(trainExamples, …)`) and are stored inside the model
  artifact, so inference applies the same numbers the training saw.
- Every feature is otherwise parameter-free: no vocabulary, no IDF, no
  quantity estimated from the corpus.
- Model choice and threshold were both fixed against VALIDATION. The
  held-out partition is not read by `scripts/ml/train-model.ts` — L10
  greps the file — and is opened once, by
  `scripts/ml/evaluate-model.ts`, after the artifact is written.

## 5. Assessed, and deliberately NOT shipped: registry pairing

Every positive in the corpus is cross-source by construction, while many
negatives are same-source. `sameRegistry` therefore predicts the label
partly because of how the labels were BUILT.

It is measured rather than assumed. Experiment **E4** adds the feature to
the logistic model and is recorded in the registry:

| | validation recall at the false-merge ceiling |
|---|---|
| E2 logistic regression, 25 features | 86.7% |
| E4 the same, plus `sameRegistry` | 91.7% |

**Five points of the apparent gain are that artefact.** The feature is
excluded from the shipped model. This is the clearest reason to read the
held-out numbers as a lower bound on a real corpus rather than an
inflated one.

## 6. Residual risks, stated

- **Validation is small** — 60 positives and 4 curated hard negatives. A
  threshold chosen on it carries real variance, and the held-out result
  (3 false merges against the ceiling's implied 0) shows that variance
  materialising.
- **The corpus is one snapshot of three publishers.** Entity-disjointness
  is enforced within it; nothing here establishes generalisation to a
  fourth publisher or a later vintage.
- **Mined hard negatives are selected by name collision.** The selection
  rule is the ground truth's own and is applied identically in all three
  partitions, but it does shift the negative distribution toward hard
  cases relative to a uniform draw. The curated 146 are reported
  separately throughout for exactly this reason.
