/**
 * P6.25.6 — the model inside CIPHER.
 *
 * WHAT THIS IS NOT. It is not a resolution tier, it does not merge
 * anything, and no code path in `src/lib/resolution/` calls it. The
 * deterministic resolver remains the sole authority on whether two
 * records are one entity, and its semantics are byte-identical to
 * `af22018`. This module produces an ADVISORY SCORE and nothing else.
 *
 * WHY IT IS ADVISORY, IN THE NUMBERS THAT DECIDED IT.
 *
 * On the P6.25.5 FINAL frozen test — 5,257 pairs over 963 subjects that
 * appear in no partition of any earlier dataset, collected after the
 * feature work was finished, and scored once — the model recovers 76.5%
 * of real positive pairs against the deterministic resolver's 48.7%.
 * That is the case for having it.
 *
 * The case against promoting it is the same table's other column. Over
 * the 244 CURATED HARD NEGATIVES — genuine name collisions between
 * entities with different, publisher-issued identifiers — the model
 * suggests a merge for 41 of them, 16.8%, where the resolver merges 16,
 * 6.6%. It is roughly two and a half times more likely to be wrong about
 * precisely the pairs that are hard.
 *
 * And the errors are not scattered. Every one of the 46 false merges on
 * that test is a CORPORATE-FAMILY pair: BARCLAYS PLC against BARCLAYS
 * BANK PLC, ROLLS-ROYCE HOLDINGS PLC against ROLLS-ROYCE PLC, AMUNDI
 * against AMUNDI ASSET MANAGEMENT, Virgin Australia against Virgin
 * Australia Holdings, Renault against RENAULT SAS. These are exactly the
 * pairs P6.21.2 is about, and whether a parent and its subsidiary may
 * ever be one entity is an owner decision that has not been taken.
 * Promoting this score to a merge would take that decision by accident,
 * so it stays a suggestion until someone decides on purpose.
 *
 * So the contract here is deliberately narrow: a probability, the
 * threshold it is judged against, the model version that produced it,
 * and every feature value behind it. An investigator is shown a
 * SUGGESTION with its evidence, never a fact.
 */

import artifactDocument from "../../../models/cipher-er-pair-classifier.v2.json";
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
  "Known limitation, measured rather than asserted: on the final frozen test this model suggested a merge for " +
  "16.8% of genuine name collisions between DIFFERENT legal entities, against the resolver's 6.6%, and every one " +
  "of those errors was a corporate-family pair — a holding company against its operating company, a parent " +
  "against a named subsidiary. Treat a high score between two similar names in one corporate group as unproven. " +
  "The relationship policy that would govern such pairs (P6.21.2) is not yet decided.";

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
