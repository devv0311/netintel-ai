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

Measured on the **final frozen test** — 5,257 pairs over 963 subjects
that appear in no partition of any earlier dataset, collected after all
feature work and scored once:

| | Deterministic resolver | Model |
| --- | --- | --- |
| Positive-pair recovery | 434/892 (48.7%) | **682/892 (76.5%)** |
| Curated hard-negative false merges | 16/244 (6.6%) | **41/244 (16.8%)** |

The first row is why the model ships. The second is why it ships as a
suggestion: it is roughly two and a half times more likely than the
resolver to be wrong about precisely the pairs that are hard.

And the errors are one phenomenon, not forty-six. **Every** false merge
is a corporate-family pair — `BARCLAYS PLC` against `BARCLAYS BANK PLC`,
`ROLLS-ROYCE HOLDINGS PLC` against `ROLLS-ROYCE PLC`, `AMUNDI` against
`AMUNDI ASSET MANAGEMENT`, `Renault` against `RENAULT SAS`. At scores
≥0.98 no threshold separates them from true positives, so this is not
something calibration fixes.

P6.20.3 measured that GLEIF publishes a consolidation edge for pairs of
this shape, and P6.21.2's Policy B would refuse them — but Policy B is
one of four owner decisions that remain unapproved. Promoting this score
to a merge would settle that decision by accident, in code, without
anyone taking it. So it does not.

## 3. Modules

| Module | Responsibility |
|---|---|
| `src/lib/ml/similarity.ts` | string primitives — Levenshtein, Jaro-Winkler, trigram Dice, token set ops, script class |
| `src/lib/ml/features.ts` | the 27-feature vector (26 trainable), the leakage contract, and the deterministic pair rule replayed |
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
   at the point of use, not only in a document: it states the 16.8%
   against 6.6% hard-negative comparison and that every error was a
   corporate-family pair. A caution that gives the number is one a
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
  contracts are untouched, and the three pre-existing Playwright failures
  recorded in P6.23.2 are neither fixed nor re-baselined here.
- The API route's request and response shapes. Only the model behind it,
  the feature count in `evidence`, and the disclaimer text changed.
- No new dependency in `package.json`.

## 7. If the score is ever promoted to a merge

That is an owner decision and needs, at minimum: P6.21.2 decision 2
settled; a non-merge constraint from publisher-stated consolidation
enabled and measured; the threshold re-selected against the constraint;
and a resolution tier with its own confidence, its own decision-row type
and its own audit trail — none of which exists today.

P6.25 adds one measured prerequisite to that list. On the final frozen
test the model merges 16.8% of curated hard negatives against the
resolver's 6.6%, and **every** error is a corporate-family pair. Until
that gap closes, promotion would not merely pre-empt the policy decision
— it would make the product measurably worse at the one thing a resolver
must not get wrong.
