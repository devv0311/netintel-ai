# Evaluation and error analysis — `cipher-er-pair-classifier` v2.0.0

**Artifact:** `models/cipher-er-pair-classifier.v2.json`
**weightsDigest:** `6948e6bc6bb94b0aebe937fe0bd445e39b4c49e62cb456efa7eac742fde2f849`
**Threshold:** 0.9774753387972909 (fixed on validation, never re-picked here)

Machine-readable: `reports/ml/final-test-evaluation.json`,
`reports/ml/final-test-error-analysis.json`,
`reports/ml/final-test-comparison.json`.

---

## 1. Which number is the headline, and why

**The final frozen test.** 5,257 pairs over 963 subjects that appear in
no partition of any earlier dataset, collected after all feature work was
finished, scored once.

The v2 *development* test is reported beside it and is **not** the
headline. It stopped being a clean exam when its errors informed feature
design — selection never touched it, but design did. The gap between the
two is itself one of the findings.

**Never compare a metric across datasets.** These are different
instruments; a lower number on a harder exam is not a worse model. The
only fair cross-model comparison is §4, which scores every model on
identical pairs none of them was fitted on.

## 2. Final frozen test — the headline

892 positives, 4,365 negatives (244 curated hard, 553 mined, 3,568
sampled), 46 jurisdictions.

| | Deterministic resolver | Model | Δ |
| --- | --- | --- | --- |
| Positive-pair recovery | 434/892 (48.7%) | **682/892 (76.5%)** | **+27.8 pts** |
| Precision | 96.4% | 93.7% | −2.7 pts |
| F1 | 64.7% | 84.2% | +19.5 pts |
| False-merge rate (all negatives) | 0.37% | 1.05% | +0.68 pts |
| **Curated hard-negative false merges** | **16/244 (6.6%)** | **41/244 (16.8%)** | **+10.2 pts** |
| ROC-AUC / PR-AUC | — | 0.9754 / 0.9327 | |

Both columns are the result. The recall is why the model exists; the
hard-negative column is why it is advisory and not authoritative.

For reference, the development test (same model, easier instrument):
recall 74.7%, precision 98.3%, hard-negative false merges 12/351 (3.4%).
The final test is harder in a specific, real way — see §5.

## 3. Error analysis — 256 errors, and one of them is a category

| Category | Count |
| --- | --- |
| `false_split_partial_overlap` | 130 |
| `false_split_no_shared_token` | 56 |
| `false_split_containment` | 23 |
| `false_split_script_variant` | 1 |
| **`false_merge_shared_leading_token`** | **40** |
| **`false_merge_identical_normalised_name`** | **6** |

### 3.1 The false merges are one phenomenon, not forty-six

**Every one of the 46 false merges is a corporate-family pair.** Not
most — all, verified by inspection of the full list:

| Score | A | B |
| --- | --- | --- |
| 0.997 | `BARCLAYS PLC` | `BARCLAYS BANK PLC` |
| 0.992 | `ROLLS-ROYCE HOLDINGS PLC` | `ROLLS-ROYCE PLC` |
| 0.998 | `RELX GROUP PLC` | `RELX PLC` |
| 0.987 | `AMUNDI` | `AMUNDI ASSET MANAGEMENT` |
| 0.996 | `Virgin Australia` | `Virgin Australia Holdings` |
| 0.997 | `RENAULT` | `RENAULT SAS` |
| 0.994 | `CHRISTIAN DIOR COUTURE` | `CHRISTIAN DIOR` |
| 0.989 | `DE LA RUE HOLDINGS LIMITED` | `DE LA RUE LIMITED` |
| 0.995 | `AIR TAHITI NUI` | `AIR TAHITI` |

These are distinct legal entities with distinct, publisher-issued
identifiers, and the model scores them ≥0.98. That is not a calibration
problem to be threshold-tuned away: at these scores no usable threshold
separates them from true positives.

**It is the P6.21.2 question with a number attached.** Whether a parent
and its subsidiary may ever be one entity is an owner decision that has
not been taken, and this project does not take it. The two P6.25 features
(`legalFormConflict`, `structuralTokenAsymmetry`) attack the *name*
evidence for these pairs without asserting any policy — they moved the
result substantially and did not close it.

### 3.2 The false splits are mostly the resolver's floor, not a regression

209 of 210 missed positives are cases the deterministic resolver also
misses — `partial_token_overlap` and `no_shared_token` are pairs where the
two publishers' names genuinely share little surface. The model recovers
26.7% and 49.4% of those classes respectively against the resolver's 0.0%.

## 4. Head-to-head — the only fair cross-model comparison

`scripts/ml/compare-models.ts` scores every model on pairs whose subjects
appear in **no fit partition of any compared model**. On the final test
that is all 5,257 pairs; 0 were excluded.

| | Precision | Recall | F1 | Hard-neg FMR | PR-AUC |
| --- | --- | --- | --- | --- | --- |
| Deterministic resolver | 96.4% | 48.7% | 64.7% | 6.6% | — |
| P6.24 model (v1) | 96.0% | **2.7%** | 5.2% | 0.41% | 0.9335 |
| **P6.25 model (v2)** | 93.7% | **76.5%** | 84.2% | 16.8% | 0.9327 |

**The v1 row is the P6.24 model's real generalisation, and it is a
finding.** 2.7% recall at its own frozen threshold with PR-AUC 0.93 —
ranking intact, operating point gone. Blanking one field restores it from
3/400 to 344/400 on a sample of positives. That field is `jurisdiction`:
in the v1 corpus `jurisdictionBothKnown` was true for 0 of 222 positives
and 196 of 1,216 negatives, because Wikidata published none and every
positive was cross-source *with* Wikidata. The model learned "both sides
state a jurisdiction" ⇒ "same-source" ⇒ "not a positive", correctly for
that corpus and catastrophically for any other. Leakage check **L12** now
catches this class of artefact; see [`ml-leakage-audit.md`](./ml-leakage-audit.md).

Note the two PR-AUCs are near-identical (0.9335 vs 0.9327). The v1 model
ranks about as well as v2 and is simply unusable at its threshold — which
is why PR-AUC alone is never the acceptance criterion here.

## 5. Generalisation breakdowns, including where the model loses

Positive recovery on the final test, by slice.

**By name variation:**

| Slice | n | Model | Resolver |
| --- | --- | --- | --- |
| exact / near-exact | 283 | 92.2% | 100.0% |
| legal suffix or punctuation | 151 | 78.8% | 100.0% |
| containment | 163 | 85.9% | 0.0% |
| transliteration / script variant | 105 | 87.6% | 0.0% |
| partial token overlap | 105 | 26.7% | 0.0% |
| divergent | 85 | 49.4% | 0.0% |

**By script:** same script 75.1% vs resolver 55.2%; **different script
86.8% vs 0.0%** (106 positives — the largest script-variant slice this
project has measured).

**By source pairing — and here the model loses:**

| Slice | n | Model | Resolver |
| --- | --- | --- | --- |
| gleif × wikidata | 828 | 79.8% | 47.3% |
| **edgar × wikidata** | **64** | **32.8%** | **65.6%** |

**By jurisdiction — the same cause:**

| Slice | n | Model | Resolver |
| --- | --- | --- | --- |
| both stated, same country | 763 | 86.1% | 47.6% |
| **both stated, different country** | **106** | **5.7%** | **50.9%** |
| not stated by both | 23 | 82.6% | 73.9% |

### The cause, and why it is not being fixed here

`jurisdiction` conflates two different properties. GLEIF publishes the
legal jurisdiction of **incorporation**; EDGAR publishes the US state of
incorporation; Wikidata P17 is the country the entity is **associated
with**. So a cross-source "conflict" frequently means *incorporated
offshore, operating onshore* rather than *different entities*:

| A (GLEIF) | B (Wikidata) | Reality |
| --- | --- | --- |
| `CAPITAL COM SV INVESTMENTS LIMITED` (CY) | `Capital.com` (AU) | one company |
| `INTERNATIONAL WORKPLACE GROUP PLC` (JE) | `IWG plc` (GB) | one company |
| `MEDICLINIC GROUP LIMITED` (GB) | `Mediclinic International` (ZA) | one company |
| `FITCH RATINGS, INC.` (US-NY) | `Fitch Group` (GB) | one company |

`jurisdictionCountryConflict` carries weight −1.12, so the model treats
this as strong evidence against identity. On a corpus where Wikidata had
no jurisdiction at all this feature was inert; the final test, collected
by country, is enriched in exactly these cases and exposes it.

**This was found by reading the final test, so fixing it by tuning
against that test is not available.** Doing so would spend the only
unbiased instrument the project has — the precise mistake §1 describes.
The fix is to distinguish the two properties at collection time (record
*what kind* of jurisdiction claim each publisher makes) and re-measure on
a fresh frozen test. That is the top-priority next experiment.

## 6. What would change the verdict

- **The corporate-family false merges** need either the P6.21.2 policy
  decision or evidence that name-only features can separate a holding
  company from its operating company. Until one of those exists, the
  model cannot be promoted past advisory.
- **The jurisdiction semantics fix** (§5) should recover most of the 100
  lost cross-border positives and the edgar×wikidata deficit.
- Both require a **new frozen test**, since the current one has now been
  read.
