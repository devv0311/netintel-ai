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

On the frozen held-out partition the model recovers 317 of 356 real
positive pairs against the deterministic resolver's 158 — and makes three
false merges where the resolver makes two. All three are a group and one
of its members: `GENERTEL S.P.A.`/`Genertel`, `Cultura`/`Cultura
Sparebank`, `BNP PARIBAS`/`BNP PARIBAS CARDIF POJIŠŤOVNA`.

P6.20.3 measured that GLEIF publishes a consolidation edge for pairs of
this shape, and P6.21.2's Policy B would refuse them — but Policy B is
one of four owner decisions that remain unapproved. Promoting this score
to a merge would settle that decision by accident, in code, without
anyone taking it. So it does not.

## 3. Modules

| Module | Responsibility |
|---|---|
| `src/lib/ml/similarity.ts` | string primitives — Levenshtein, Jaro-Winkler, trigram Dice, token set ops, script class |
| `src/lib/ml/features.ts` | the 25-feature vector, the leakage contract, and the deterministic pair rule replayed |
| `src/lib/ml/metrics.ts` | precision/recall/F1, ROC-AUC, PR-AUC, false-merge and false-split rates, threshold selection under a ceiling |
| `src/lib/ml/train.ts` | logistic regression and gradient-boosted trees; no dependency |
| `src/lib/ml/model.ts` | artifact type, canonical serialisation, sha256, `loadArtifact`, `scoreWithModel` |
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
  evidence: { name, value, contribution }[],   // all 25 features
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
4. **The disclaimer names the known failure mode** — group-and-member
   pairs — at the point of use, not only in a document.

## 5. Versioning and the artifact

The artifact declares the feature names it was trained on, in order.
`assertFeatureContract` refuses to score if this build computes a
different list or a different order — a silently reordered feature vector
is the failure most likely to produce plausible nonsense in production, so
it is made impossible rather than unlikely.

`scoreWithModel` is the single scoring path, used identically by
`scripts/ml/evaluate-model.ts` and by the API route. "Inference
reproduces evaluation behaviour" is therefore a property of the system,
not a claim tested across two implementations.

## 6. What did not change

- No resolution semantics, no graph semantics, no data model.
- No UI. The e2e suite's `data-testid`, accessible-name and label
  contracts are untouched, and the three pre-existing Playwright failures
  recorded in P6.23.2 are neither fixed nor re-baselined here.
- No new dependency in `package.json`.

## 7. If the score is ever promoted to a merge

That is an owner decision and needs, at minimum: P6.21.2 decision 2
settled; a non-merge constraint from publisher-stated consolidation
enabled and measured; the threshold re-selected against the constraint;
and a resolution tier with its own confidence, its own decision-row type
and its own audit trail — none of which exists today.
