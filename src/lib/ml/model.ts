/**
 * P6.24 — the model artifact, its serialised form, and inference.
 *
 * A CIPHER model artifact is a JSON document. That is a deliberate
 * choice, not a limitation: it is diffable in review, it carries its own
 * provenance, it loads with `JSON.parse` and no framework, and the same
 * `scoreWithModel` runs in the evaluation script and in the application,
 * so "inference reproduces evaluation behaviour" is true by construction
 * rather than by testing two implementations against each other.
 *
 * The artifact is SELF-DESCRIBING. It states the feature names it was
 * trained on and in what order, and `scoreWithModel` refuses to run
 * against a feature list that does not match. A silently reordered
 * feature vector is the failure mode most likely to produce plausible
 * nonsense in production, so it is made impossible rather than unlikely.
 */

import { createHash } from "node:crypto";
import { FEATURE_NAMES, buildFeatures, type FeatureRecord } from "@/lib/ml/features";

export const MODEL_ARTIFACT_FORMAT = "cipher-er-model/1";

export interface LogisticRegressionParameters {
  readonly kind: "logistic_regression";
  /** Per-feature coefficients, in `featureNames` order. */
  readonly weights: readonly number[];
  readonly intercept: number;
  /** Training-set means used to centre each feature. Fitted on TRAIN only. */
  readonly featureMeans: readonly number[];
  /** Training-set standard deviations used to scale each feature. Fitted on TRAIN only. */
  readonly featureStdDevs: readonly number[];
}

/**
 * A gradient-boosted ensemble of shallow regression trees over the
 * standardised feature vector, predicting the logit. Included because
 * the deterministic failures this model exists to recover are
 * INTERACTIONS - a high token overlap means "same entity" only when the
 * pair does not also look like a shared-leading-token family - and a
 * linear model cannot express "A and not B" at all.
 */
export interface TreeNode {
  /** Index into `featureNames`, or -1 for a leaf. */
  readonly feature: number;
  readonly threshold: number;
  readonly left?: TreeNode;
  readonly right?: TreeNode;
  /** Leaf output, added to the logit. Present only when `feature` is -1. */
  readonly value?: number;
}

export interface GradientBoostedParameters {
  readonly kind: "gradient_boosted_trees";
  readonly baseLogit: number;
  readonly learningRate: number;
  readonly trees: readonly TreeNode[];
  readonly featureMeans: readonly number[];
  readonly featureStdDevs: readonly number[];
}

export type ModelParameters = LogisticRegressionParameters | GradientBoostedParameters;

export interface ModelArtifact {
  readonly format: typeof MODEL_ARTIFACT_FORMAT;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly experimentId: string;
  readonly createdAt: string;
  readonly gitCommit: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly seed: number;
  readonly featureNames: readonly string[];
  readonly parameters: ModelParameters;
  /** The threshold selected on VALIDATION. Inference must not invent its own. */
  readonly decisionThreshold: number;
  readonly thresholdPolicy: string;
  readonly trainingHyperparameters: Record<string, number | string>;
  readonly notes: string;
}

const sigmoid = (z: number): number => {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const expZ = Math.exp(z);
  return expZ / (1 + expZ);
};

/** Standardises a raw feature vector with the artifact's own TRAIN-fitted statistics. */
export function standardise(
  values: readonly number[],
  means: readonly number[],
  stdDevs: readonly number[],
): number[] {
  return values.map((value, index) => {
    const mean = means[index] ?? 0;
    const stdDev = stdDevs[index] ?? 0;
    return stdDev === 0 ? 0 : (value - mean) / stdDev;
  });
}

/** Probability that the two records denote the same entity, in [0, 1]. */
export function treeLogit(node: TreeNode, values: readonly number[]): number {
  let cursor = node;
  while (cursor.feature !== -1) {
    const value = values[cursor.feature] ?? 0;
    const next = value <= cursor.threshold ? cursor.left : cursor.right;
    if (!next) break;
    cursor = next;
  }
  return cursor.value ?? 0;
}

/** The model's logit for an already-standardised vector. */
export function logitOf(parameters: ModelParameters, standardised: readonly number[]): number {
  if (parameters.kind === "logistic_regression") {
    let z = parameters.intercept;
    for (let i = 0; i < standardised.length; i += 1) {
      z += (parameters.weights[i] ?? 0) * (standardised[i] ?? 0);
    }
    return z;
  }
  let z = parameters.baseLogit;
  for (const tree of parameters.trees) z += parameters.learningRate * treeLogit(tree, standardised);
  return z;
}

export function scoreVector(artifact: ModelArtifact, values: readonly number[]): number {
  if (values.length !== artifact.featureNames.length) {
    throw new Error(
      `feature vector has ${values.length} values but the artifact declares ${artifact.featureNames.length}`,
    );
  }
  const { featureMeans, featureStdDevs } = artifact.parameters;
  return sigmoid(logitOf(artifact.parameters, standardise(values, featureMeans, featureStdDevs)));
}

export interface ScoredRecordPair {
  readonly score: number;
  readonly threshold: number;
  readonly wouldMerge: boolean;
  readonly modelId: string;
  readonly modelVersion: string;
  /** Every feature and its value, so a score can always be explained. */
  readonly features: { readonly name: string; readonly value: number; readonly contribution: number }[];
}

/**
 * Scores two records and returns the score WITH the evidence behind it.
 *
 * `contribution` is the signed term this feature added to the logit. It
 * is what makes a score auditable: an investigator can see that a pair
 * scored 0.81 because the names share every token and neither carries a
 * conflicting jurisdiction, rather than being told a number and asked to
 * trust it.
 */
export function scoreWithModel(
  artifact: ModelArtifact,
  a: FeatureRecord,
  b: FeatureRecord,
): ScoredRecordPair {
  assertFeatureContract(artifact);
  const vector = buildFeatures(a, b);
  const { featureMeans, featureStdDevs } = artifact.parameters;
  const standardised = standardise(vector.values, featureMeans, featureStdDevs);
  const score = scoreVector(artifact, vector.values);
  // For a linear model the contribution is exact. For an ensemble there
  // is no per-feature term, so the field reports 0 and the ensemble's
  // explanation is the feature VALUES plus the split thresholds in the
  // artifact - stated rather than a made-up attribution.
  const contributionOf = (index: number): number =>
    artifact.parameters.kind === "logistic_regression"
      ? (artifact.parameters.weights[index] ?? 0) * (standardised[index] ?? 0)
      : 0;
  return {
    score,
    threshold: artifact.decisionThreshold,
    wouldMerge: score >= artifact.decisionThreshold,
    modelId: artifact.modelId,
    modelVersion: artifact.modelVersion,
    features: artifact.featureNames.map((name, index) => ({
      name,
      value: vector.values[index] ?? 0,
      contribution: contributionOf(index),
    })),
  };
}

/** Refuses an artifact whose feature contract does not match the code that would score with it. */
export function assertFeatureContract(artifact: ModelArtifact): void {
  if (artifact.format !== MODEL_ARTIFACT_FORMAT) {
    throw new Error(`unknown model artifact format "${artifact.format}"`);
  }
  if (artifact.featureNames.length !== FEATURE_NAMES.length) {
    throw new Error(
      `artifact declares ${artifact.featureNames.length} features; this build computes ${FEATURE_NAMES.length}`,
    );
  }
  artifact.featureNames.forEach((name, index) => {
    if (name !== FEATURE_NAMES[index]) {
      throw new Error(
        `feature ${index} is "${name}" in the artifact and "${FEATURE_NAMES[index]}" in this build`,
      );
    }
  });
  const parameters = artifact.parameters;
  const checks: (readonly [string, readonly number[]])[] = [
    ["featureMeans", parameters.featureMeans],
    ["featureStdDevs", parameters.featureStdDevs],
  ];
  if (parameters.kind === "logistic_regression") checks.push(["weights", parameters.weights]);
  for (const [label, array] of checks) {
    if (array.length !== artifact.featureNames.length) {
      throw new Error(`artifact ${label} has ${array.length} entries; expected ${artifact.featureNames.length}`);
    }
  }
}

/**
 * Canonical serialisation: keys sorted at EVERY depth, so the sha256 of
 * an artifact is a property of its content and not of the order the
 * training script happened to build the object in.
 *
 * Deliberately not `JSON.stringify(value, sortedTopLevelKeys, 2)`. A
 * replacer ARRAY is applied at every level, so it silently deletes any
 * nested key that does not appear in the top-level list — which drops
 * `parameters.weights`, `parameters.featureMeans` and the rest, and
 * writes an artifact that parses cleanly and cannot score anything.
 */
const canonicalise = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      sorted[key] = canonicalise(source[key]);
    }
    return sorted;
  }
  return value;
};

export function serialiseArtifact(artifact: ModelArtifact): string {
  return `${JSON.stringify(canonicalise(artifact), null, 2)}\n`;
}

export function artifactSha256(serialised: string): string {
  return createHash("sha256").update(serialised, "utf8").digest("hex");
}

/** Parses and validates an artifact document. Throws rather than returning a half-checked model. */
export function loadArtifact(json: string): ModelArtifact {
  const parsed = JSON.parse(json) as ModelArtifact;
  assertFeatureContract(parsed);
  if (!Number.isFinite(parsed.decisionThreshold)) throw new Error("artifact has no finite decisionThreshold");
  return parsed;
}
