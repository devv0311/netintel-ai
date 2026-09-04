# CIPHER entity-resolution pair dataset — data card

**Dataset id:** `cipher-er-pairs` **Version:** 1.0.0
**Data class:** REAL. No synthetic data, no Operation DarkNet Delhi record,
no manufactured name, no model-generated label.
**Artifact:** `evidence/ml/pair-dataset.json`
**Built by:** `scripts/ml/build-pair-dataset.ts` (P6.24.1)
**Seed:** `cipher-p6.24-pair-dataset-v1`

---

## 1. What the dataset is

4,053 record PAIRS drawn from 1,240 real public records, each labelled
same-entity or different-entities. The unit of learning is the pair, not
the record, because the question the model answers is a question about
two records.

## 2. Sources

Nothing was collected for this phase. Both inputs already existed in the
repository, and both are derived from raw payloads written before
anything derived, hashed individually, and retained.

| Source | Registry | Licence | Channel | Records |
|---|---|---|---|---|
| SRC-001 | Wikidata | CC0 1.0 | `direct-https` | 648 |
| SRC-002 | GLEIF LEI (Level 1 + Level 2) | CC0 1.0 | `direct-https` | 497 |
| SRC-006 | SEC EDGAR | US Government work / public domain | `direct-https` | 100 |

Raw payload directories, recorded in the ground truth's `builtFrom` and
carried into the dataset:

- Wikidata `data/public/raw/SRC-001/2026-09-04T03-07-48-927Z`
- GLEIF `data/public/raw/SRC-002/2026-09-04T03-08-22-399Z`
- EDGAR `data/public/raw/SRC-006/2026-09-04T03-09-43-738Z`

All three are `APPROVED` or `APPROVED_WITH_RESTRICTIONS` in
`docs/data-research/source-registry.csv`. **No ambiguously licensed
source is present.** No source outside those three was read. No
personal data: only the company-level block of EDGAR is used, and no
natural person is collected by any adapter.

## 3. Immediate inputs

```
evidence/expanded/expanded-anchored.corpus.json   1,245 records (P6.19)
evidence/expanded/expanded.ground-truth.json      labels + provenance (P6.19)
```

The **anchored** corpus is used deliberately. It masks every non-GLEIF
record behind a surrogate id and withholds its identifiers, so for 748 of
1,245 records the identifier the label is derived from is not merely
unused by the model — it is physically absent from the record the model
sees.

## 4. Composition

| Class | Count | Label |
|---|---|---|
| `cross_source_positive` | 578 | same entity |
| `hard_negative` (curated by P6.19) | 146 | different entities |
| `mined_hard_negative` | 1,017 | different entities |
| `sampled_negative` | 2,312 | different entities |
| **Total** | **4,053** | |

| Partition | Pairs | Positives | Curated HN | Mined HN | Sampled neg | Subjects | Records |
|---|---|---|---|---|---|---|---|
| train | 1,044 | 162 | 28 | 206 | 648 | 284 | 426 |
| validation | 394 | 60 | 4 | 90 | 240 | 96 | 146 |
| **test (frozen)** | **2,615** | **356** | **114** | **721** | **1,424** | **376** | **668** |

The test partition is unusually large (64% of pairs) and that is a
consequence, not a choice: the P6.19 ground truth had already reserved
302 of 580 subjects as `heldout_evaluation` by a fixed hash, and this
phase honours that reservation rather than redrawing it. See §6.

## 5. Fields the model may read

`name`, `officialName`, `aliases`, `jurisdiction`. Nothing else. The
record projection stored in the dataset contains no identifier field of
any kind and the leakage gate asserts it (check L5).

Field coverage across the 1,245 records: `name` 100%, `status` 48.0%,
`jurisdiction` 46.7%, `aliases` 25.5%, `officialName` 17.5%. Jurisdiction
is absent from every Wikidata record in the anchored corpus, so the
jurisdiction features are mostly a missingness signal on the
`gleif x wikidata` pairs that dominate the positives. This is a stated
limitation, not an oversight.

## 6. Splits

**Unit: the subject** — a GLEIF-issued LEI or an SEC-issued CIK — never
the pair.

Subjects are grouped into 603 connected components before assignment, so
that no labelled pair can straddle a boundary. Three kinds of edge join
subjects into a component:

1. a curated hard negative, whose two endpoints are two subjects;
2. a **scheme bridge** — 92 records state both an LEI and a CIK, which
   makes `LEI:x` and `CIK:y` two names for one entity;
3. a **record bridge** — 4 joins where one record is a positive partner
   of more than one subject. The Wikidata record for Rocky Mountain
   Chocolate is a positive against an LEI subject *and* two CIK subjects
   (a predecessor filer and its successor). Without this the single
   record landed in two partitions at once; the leakage gate caught it
   and the split was rebuilt.

Assignment rule, in order:

- any component touching a subject the P6.19 ground truth marked
  `heldout_evaluation` → **test**, in whole (270 of 603 components);
- the remaining components → **train** / **validation**, 75/25 by seeded
  shuffle.

Sampled and mined negatives are drawn **within a partition only**, after
assignment, so they cannot introduce a cross-partition pair.

## 7. Dataset classes and what each is for

| Class | TRAIN | VALIDATION | TEST | RUNTIME |
|---|---|---|---|---|
| `cipher-er-pairs` train partition | fits model parameters | — | — | — |
| `cipher-er-pairs` validation partition | — | model choice + threshold | — | — |
| `cipher-er-pairs` test partition | — | — | one frozen evaluation | — |
| former-name slice (79 pairs) | never | never | reported only | — |
| Operation DarkNet Delhi (SRC-019) | **never** | **never** | **never** | demo corpus only |
| live records via `POST /api/ml/pair-score` | — | — | — | inference input |

Operation DarkNet Delhi is synthetic and is registered EVALUATION ONLY.
It contributed nothing to this dataset and is not represented as real
investigative data anywhere.

## 8. What was deliberately excluded

- **The 154 GLEIF Level-2 consolidation edges.** Not a label, not a
  feature, not a filter. P6.21.2's four policy decisions are unresolved
  and consolidation is not identity; the semantics are frozen rather than
  guessed. This is the single largest deliberate omission and §5 of the
  evaluation report shows exactly what it costs.
- **11 undetermined records** stating two or more distinct LEIs.
- **79 former-name pairs** — a temporal claim by one authority, not
  cross-source agreement. Kept as a reported slice, never trained on.
- **94 name collisions that are not comparable** (GLEIF × EDGAR, which
  share no identifier scheme). Neither positive nor negative.

## 9. Transformations applied

1. Ground-truth `recordRef` resolved through the surrogate map to the
   anchored corpus record.
2. Subject derived from the record's single publisher-stated LEI, else its
   single CIK.
3. Components built, partitions assigned (§6).
4. Pairs emitted; mined and sampled negatives drawn within partitions.
5. Record projection reduced to the four readable fields (§5).

No name was altered, normalised or invented in the dataset itself.
Normalisation happens only inside feature computation, using the
resolver's own `normalizeName`.

## 10. Reproduction

`docs/evaluation/ml-reproduction.md`. The build is deterministic: same
inputs and same seed give a byte-identical dataset.
