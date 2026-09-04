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

## 1. The shipped model (`cipher-er-pairs` v2.0.0)

**Every `ml:*` script defaults to the SHIPPED pipeline.** The superseded
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
| Leakage verdict | **PASS 12/12** |
| Shipped experiment | `E2-logistic-regression`, recall 79.7%, threshold 0.9774753387972909 |
| **weightsDigest** | `6948e6bc6bb94b0aebe937fe0bd445e39b4c49e62cb456efa7eac742fde2f849` |

## 2. The final frozen test

```bash
npm run ml:final-test:corpus     # collected AFTER all feature work
npm run ml:final-test:dataset    # single partition: --all-test
npm run ml:final-test:leakage    # PASS 12/12, and 0 overlap with v1 or v2
npm run ml:final-test            # scored ONCE against the frozen artifact
```

Expected: 5,257 pairs / 892 positives / 244 curated hard negatives / 963
subjects; leakage **PASS 12/12**; model recall **76.5%** (682/892),
precision 93.7%, hard-negative false merges **41/244**; baseline recall
48.7% (434/892), hard-negative false merges 16/244.

## 3. The head-to-head

```bash
npm run ml:compare
```

Scores every model only on pairs whose subjects appear in no fit
partition of any compared model. On the final test that is all 5,257
pairs (0 excluded). Expected: v1 recall 2.7%, v2 recall 76.5%, both
`digest ok`.

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
