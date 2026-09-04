/**
 * P6.24.5 — the model inside CIPHER.
 *
 * WHAT THIS IS NOT. It is not a resolution tier, it does not merge
 * anything, and no code path in `src/lib/resolution/` calls it. The
 * deterministic resolver remains the sole authority on whether two
 * records are one entity, and its semantics are byte-identical to
 * `af22018`. This module produces an ADVISORY SCORE and nothing else.
 *
 * WHY IT IS ADVISORY AND WILL STAY THAT WAY UNTIL SOMEONE DECIDES
 * OTHERWISE. On the frozen held-out partition the model recovers 89.0%
 * of real positive pairs against the deterministic resolver's 44.4% —
 * and makes three false merges where the resolver makes two. All three
 * are `GENERTEL S.P.A.`/`Genertel`, `Cultura`/`Cultura Sparebank` and
 * `BNP PARIBAS`/`BNP PARIBAS CARDIF POJISTOVNA`: group-and-member pairs
 * that P6.20.3 already showed GLEIF publishes a consolidation edge for,
 * and that P6.21.2's still-unapproved Policy B would refuse. Promoting
 * this score to a merge before that decision is taken would settle the
 * decision by accident.
 *
 * So the contract here is deliberately narrow: a probability, the
 * threshold it is judged against, the model version that produced it,
 * and every feature value behind it. An investigator is shown a
 * SUGGESTION with its evidence, never a fact.
 */

import artifactDocument from "../../../models/cipher-er-pair-classifier.v1.json";
import { type FeatureRecord } from "@/lib/ml/features";
import { assertFeatureContract, scoreWithModel, type ModelArtifact } from "@/lib/ml/model";

/**
 * How a model output must be labelled everywhere it is shown.
 *
 * `algorithmic_signal` is the project's existing vocabulary for a
 * computed indication that is not a fact — the same class the
 * corroboration engine gives a spatiotemporal contradiction. Reusing it
 * rather than inventing an "ml_prediction" class keeps one ladder of
 * evidence in the product instead of two.
 */
export const ML_SUGGESTION_CLASSIFICATION = "algorithmic_signal" as const;

let cached: ModelArtifact | null = null;

/** The shipped artifact, validated against this build's feature contract. */
export function pairClassifier(): ModelArtifact {
  if (!cached) {
    const artifact = artifactDocument as unknown as ModelArtifact;
    assertFeatureContract(artifact);
    cached = artifact;
  }
  return cached;
}

export interface PairSuggestion {
  /** Probability in [0,1] that the two records denote the same entity. */
  readonly score: number;
  readonly threshold: number;
  /** True when the score clears the threshold. A SUGGESTION, never a merge. */
  readonly suggestsSameEntity: boolean;
  readonly classification: typeof ML_SUGGESTION_CLASSIFICATION;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly experimentId: string;
  readonly datasetVersion: string;
  /** Every feature and what it contributed, so the score can be audited. */
  readonly evidence: { readonly name: string; readonly value: number; readonly contribution: number }[];
  /** The deterministic resolver's own verdict, always shown beside the score. */
  readonly deterministicVerdict: "would merge" | "would not merge";
  readonly disclaimer: string;
}

const DISCLAIMER =
  "Algorithmic signal, not a finding. This score is a model's estimate from name and jurisdiction evidence only; " +
  "it reads no identifier and it does not merge anything. The deterministic resolver remains authoritative. " +
  "Known limitation: group-and-member pairs such as a bank and its insurance subsidiary can score highly, and the " +
  "relationship policy that would exclude them (P6.21.2) is not yet decided.";

/**
 * Scores one candidate pair.
 *
 * `deterministic` is passed in rather than recomputed so that a caller
 * which already has the resolver's verdict cannot end up displaying a
 * different one beside the score.
 */
export function suggestSameEntity(
  a: FeatureRecord,
  b: FeatureRecord,
  deterministic: boolean,
): PairSuggestion {
  const artifact = pairClassifier();
  const scored = scoreWithModel(artifact, a, b);
  return {
    score: scored.score,
    threshold: scored.threshold,
    suggestsSameEntity: scored.wouldMerge,
    classification: ML_SUGGESTION_CLASSIFICATION,
    modelId: artifact.modelId,
    modelVersion: artifact.modelVersion,
    experimentId: artifact.experimentId,
    datasetVersion: artifact.datasetVersion,
    evidence: scored.features,
    deterministicVerdict: deterministic ? "would merge" : "would not merge",
    disclaimer: DISCLAIMER,
  };
}
