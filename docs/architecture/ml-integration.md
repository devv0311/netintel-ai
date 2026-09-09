# CIPHER ML integration

**Status: shipped as an ADVISORY SIGNAL. Not a resolution tier.**

---

## 1. The boundary, stated first

`src/lib/resolution/` is byte-identical to `af22018`. No tier, threshold,
rule or confidence changed. Nothing in the resolver imports anything from
`src/lib/ml/`, and the dependency does not exist in the other direction
either except for one import: the model's feature code uses the
resolver's own `normalizeName`, so the two cannot drift apart in how they
read a name.

The deterministic resolver decides merges. The model produces a score.

## 2. Why it stays advisory

The shipped artifact is **E2 / v2.2.0** (`models/cipher-er-pair-classifier.v2lr.json`,
31 trainable features), selected at P6.28 under a rule frozen before the test
that judged it existed. Measured **once** on frozen test #4 — 40,004 pairs over
4,709 subjects appearing in no partition of any of the seven earlier datasets,
declared before collection and collected before scoring
(`reports/ml/final-test-4-evaluation-v2lr.json`):

| | Deterministic resolver | Model |
| --- | --- | --- |
| Positive-pair recovery | 1,162/4,672 (24.9%) | **4,395/4,672 (94.1%)** |
| Curated hard-negative false merges | 5/2,049 (0.24%) | **111/2,049 (5.42%)** |
| Wholly unrelated merges | 0 | **1** |

The first row is why the model ships. The second is why it ships as a suggestion:
it is roughly twenty times more likely than the resolver to be wrong about
precisely the pairs that are hard.

And the errors are one phenomenon, not 289. **286 of its 289 false merges are
corporate-family pairs** — a company against a same-named affiliate carrying a
different registration (`SIHOTPARK B s.r.o.` / `SIHOTPARK`, `Mercurtrade` /
`Mercurtrade Holding`). At scores above the threshold no calibration separates
them from true positives.

P6.20.3 measured that GLEIF publishes a consolidation edge for pairs of this
shape, and P6.21.2's Policy B would refuse them — but Policy B is one of the
owner decisions that remain unapproved. Promoting this score to a merge would
settle that decision by accident, in code, without anyone taking it. So it does not.

> **Scope of this table.** It is the model's only measurement, and the
> instrument's limits are reported with it, not after it: test #4 is an *easier*
> distribution than test #3, holds 30 cross-border positives and **zero** Latvian
> pairs. Full record — including what this measurement does **not** establish —
> in [`../evaluation/ml-final-test-4.md`](../evaluation/ml-final-test-4.md) §4 and
> [`../evaluation/ml-model-card.md`](../evaluation/ml-model-card.md) §6.
> Those two documents are canonical for every ML figure; this one is canonical
> only for the integration boundary.

## 3. Modules

| Module | Responsibility |
|---|---|
| `src/lib/ml/similarity.ts` | string primitives — Levenshtein, Jaro-Winkler, trigram Dice, token set ops, script class |
| `src/lib/ml/features.ts` | the 32-name feature vector (**31 trainable** — `officialNameBothPresent` is computed and excluded), the leakage contract, and the deterministic pair rule replayed |
| `src/lib/ml/metrics.ts` | precision/recall/F1, ROC-AUC, PR-AUC, false-merge and false-split rates, threshold selection under an overall **and** a hard-negative ceiling |
| `src/lib/ml/train.ts` | logistic regression and gradient-boosted trees; no dependency |
| `src/lib/ml/model.ts` | artifact type, canonical serialisation, sha256, `weightsDigest`, `loadArtifact`, `scoreWithModel` |
| `src/lib/ml/service.ts` | the application-facing surface; wraps a score in its classification and evidence |
| `src/app/api/ml/pair-score/route.ts` | `POST` — stateless, no database, no resolution |

## 4. The contract at the point of use

`suggestSameEntity(a, b, deterministicVerdict)` returns:

```ts
{
  score: number,                       // probability in [0,1]
  threshold: number,                   // from the artifact, never invented here
  suggestsSameEntity: boolean,         // a SUGGESTION, never a merge
  classification: "algorithmic_signal", // the project's existing vocabulary
  modelId, modelVersion, experimentId, datasetVersion,
  evidence: { name, value, contribution }[],   // every feature the artifact declares
  deterministicVerdict: "would merge" | "would not merge",
  disclaimer: string
}
```

Four properties are load-bearing:

1. **The classification is `algorithmic_signal`**, the same class the
   corroboration engine gives a spatiotemporal contradiction. Reusing the
   existing ladder of evidence keeps one vocabulary in the product rather
   than two, and it is structurally impossible for a model output to be
   labelled `observed_fact` or `corroborated_fact`.
2. **The score never travels without its features.** A caller cannot get
   the number without the evidence for it.
3. **The deterministic verdict is always beside it**, and is passed in
   rather than recomputed, so a caller cannot display a score next to a
   verdict it disagrees with.
4. **The disclaimer names the known failure mode with its measurement**
   at the point of use, not only in a document: it states the model's
   hard-negative false-merge rate against the resolver's, and that the error
   class is corporate-family pairs. A caution that gives the number is one a
   reviewer can act on; one that gestures at a risk is not.

## 5. Versioning and the artifact

The artifact declares the feature names it was trained on, and scoring
projects the computed vector onto that declaration **by name**.

This changed in P6.25 and the reason matters. The contract used to be
positional — identical list, identical order — which meant that dropping
one leaky feature would have invalidated every artifact ever trained, and
with it the ability to measure a new model against the one it replaces.
That comparison is exactly how the P6.24 model's 2.7% real-world recall
was discovered. So the contract selects by name, and a model fitted on 25
features and one fitted on 26 both score correctly from the same build.

A name-based contract needs a different guard, because `featureNames` and
`parameters` must now agree as a unit: re-labelling the name list alone
would silently re-map every weight and score confidently wrong. Every
artifact therefore carries a **`weightsDigest`** — sha256 over everything
except `createdAt` and `gitCommit` — which `loadArtifact` verifies and
refuses on mismatch. It doubles as the reproducibility test, since the
file's own sha256 moves with those two provenance fields and cannot
answer "did this training run reproduce?".

`assertFeatureContract` still refuses an unknown feature name, a
duplicate, or an empty set.

`scoreWithModel` is the single scoring path, used identically by
`scripts/ml/evaluate-model.ts` and by the API route. "Inference
reproduces evaluation behaviour" is therefore a property of the system,
not a claim tested across two implementations.

## 6. What did not change

- No resolution semantics, no graph semantics, no data model.
- No UI. The e2e suite's `data-testid`, accessible-name and label
  contracts are untouched by the ML work. (The three pre-existing Playwright
  failures P6.23.2 recorded were later resolved at their own cause in P6.29 —
  stale spec constants plus one masked resolution-label defect — with nothing in
  `src/lib/ml/`, `models/` or `src/lib/resolution/` touched. See
  [`../progress/README.md`](../progress/README.md) §2.)
- The API route's request and response shapes. Only the model behind it,
  the feature count in `evidence`, and the disclaimer text changed.
- No new dependency in `package.json`.

## 7. If the score is ever promoted to a merge

That is an owner decision and needs, at minimum: P6.21.2 decision 2
settled; a non-merge constraint from publisher-stated consolidation
enabled and measured; the threshold re-selected against the constraint;
and a resolution tier with its own confidence, its own decision-row type
and its own audit trail — none of which exists today.

There is one measured prerequisite on top of those. On frozen test #4 the
model merges **5.42%** of curated hard negatives against the resolver's
**0.24%**, and 286 of its 289 false merges are corporate-family pairs. Until
that gap closes, promotion would not merely pre-empt the policy decision — it
would make the product measurably worse at the one thing a resolver must not
get wrong.
