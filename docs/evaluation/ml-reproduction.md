# Reproducing the CIPHER entity-resolution model

One documented path, from source verification to inference. Every step is
deterministic; no step collects data or reaches the network.

---

## 0. The whole path, in four commands

```bash
npm run ml:dataset    # §2  build the dataset
npm run ml:leakage    # §4  the gate — exits non-zero on any failure
npm run ml:train      # §5  E1-E4, writes the artifact
npm run ml:evaluate   # §6  the frozen held-out evaluation
```

The sections below give the same steps with their raw invocations, the
expected output of each, and how to verify the sources and the artifact.

## 0b. Pinned versions

Node 22.x · TypeScript 6.0.3 · Vitest 4.1.11 · Next 16.3.4 (see
`package.json`; `package-lock.json` pins the tree). No ML dependency: the
learners are in `src/lib/ml/train.ts`.

Seeds: dataset `cipher-p6.24-pair-dataset-v1` (string, hashed to a
mulberry32 state); training `20260904`.

> **Environment note.** The suite cannot run from a desktop-mounted
> working copy: SQLite needs `unlink` for its journal files and the mount
> forbids it, producing spurious failures. Run tests from a local copy of
> the tree. Nothing in the ML pipeline itself uses SQLite.

## 1. Verify the sources

Raw payloads are immutable, written before anything derived, and hashed
individually in a per-retrieval `manifest.json`.

```bash
ls data/public/raw/SRC-001/2026-09-04T03-07-48-927Z/manifest.json   # Wikidata, CC0 1.0
ls data/public/raw/SRC-002/2026-09-04T03-08-22-399Z/manifest.json   # GLEIF,    CC0 1.0
ls data/public/raw/SRC-006/2026-09-04T03-09-43-738Z/manifest.json   # EDGAR,    US public domain
```

Each manifest records `sourceId`, `retrievedAt`, the exact endpoint, the
channel (`direct-https`) and a sha256 per payload. Licence and registry
status are in `docs/data-research/source-registry.csv`.

**Redistribution.** The raw payloads are retained in-repo under CC0 1.0
and US public domain, so no acquisition step is needed. If a payload ever
has to be re-fetched, the manifest's endpoint plus its sha256 is the
verification path — re-fetch, hash, compare, and treat a mismatch as a
new vintage rather than the same data.

## 2. Build the dataset

```bash
node --import ./scripts/eval-resolve.mjs scripts/ml/build-pair-dataset.ts
```

Reads the two P6.19 artifacts, writes `evidence/ml/pair-dataset.json`.
Expected: 4,053 pairs — 578 positives, 146 curated hard negatives, 1,017
mined hard negatives, 2,312 sampled negatives; train 1,044 / validation
394 / test 2,615; 0 positives and 0 hard negatives dropped.

## 3. Labels

No separate step: labels are emitted by §2 and every pair carries
`labelClass`, `labelBasis` and the full `labelReason` text. The rules are
specified in `docs/evaluation/ml-label-specification.md`.

## 4. Leakage checks and splits

```bash
node --import ./scripts/eval-resolve.mjs scripts/ml/leakage-audit.ts
```

Writes `reports/ml/leakage-audit.json` and **exits non-zero on any
failure**. Expected verdict: PASS, 10 of 10. Splits are produced by §2;
the gate verifies them rather than creating them.

## 5. Train

```bash
node --import ./scripts/eval-resolve.mjs scripts/ml/train-model.ts
```

Reads only train and validation. Runs E1–E4, writes
`reports/ml/experiment-registry.json` and the artifact
`models/cipher-er-pair-classifier.v1.json`. Under three seconds.

Expected validation line for the shipped row:
`E3-gradient-boosted-trees  thr 0.8968  P 100.0%  R 90.0%  F1 94.7%  FMR 0.00%`

## 6. Evaluate on the frozen partition

```bash
node --import ./scripts/eval-resolve.mjs scripts/ml/evaluate-model.ts
```

Writes `reports/ml/heldout-evaluation.json` and
`reports/ml/error-analysis.json`. Expected:
`model P 99.1%  R 89.0%  F1 93.8%  FMR 0.133%  recovery 317/356`.

This script never chooses a threshold. It reads the one in the artifact.

## 7. The artifact

`models/cipher-er-pair-classifier.v1.json`, sha256
`2c15204b85dee34063ddd4500eae42747a0362953dc4bf9627daba4cd97871f7`.

```bash
shasum -a 256 models/cipher-er-pair-classifier.v1.json
```

Keys are sorted at every depth, so the hash is a property of the content.
It loads with `loadArtifact()` and `JSON.parse` alone — no training code
in the path.

## 8. Inference

In the application:

```bash
curl -s localhost:3000/api/ml/pair-score -H 'content-type: application/json' \
  -d '{"a":{"name":"BANCO SANTANDER S.A.","jurisdiction":"ES"},"b":{"name":"Santander Group"}}'
```

Returns the score, the threshold, `suggestsSameEntity`, the
`algorithmic_signal` classification, the model version, the deterministic
resolver's own verdict, all 25 feature values, and a disclaimer.

## 9. Verify the whole chain

```bash
npx vitest run tests/unit/ml-features.test.ts tests/unit/ml-model.test.ts tests/unit/ml-dataset.test.ts
```

38 tests. The decisive one re-scores the entire held-out partition from
the committed artifact and asserts it reproduces the committed evaluation
counts exactly — so if a feature, the normaliser, the artifact or the
dataset changes without the reports being regenerated, the suite fails.
