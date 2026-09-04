/**
 * P6.24 — training. Two learners, no dependencies, both deterministic
 * given a seed.
 *
 * There is no ML framework here on purpose. The models this problem
 * justifies are a regularised linear one and a small tree ensemble over
 * 25 engineered features and ~1,100 training pairs; a framework would
 * add a build dependency, a serialisation format the application cannot
 * read, and a source of version drift, in exchange for nothing. If a
 * later experiment ever justifies a model these cannot express, that is
 * the moment to take the dependency - on evidence, not in advance.
 */

import type { GradientBoostedParameters, LogisticRegressionParameters, TreeNode } from "@/lib/ml/model";

export interface TrainingExample {
  readonly features: readonly number[];
  readonly label: 0 | 1;
}

export interface Standardiser {
  readonly means: number[];
  readonly stdDevs: number[];
}

/**
 * Fits centring and scaling statistics. MUST be called on the training
 * partition alone: fitting on train+validation, or on the whole dataset,
 * leaks the evaluation distribution into the model and is the classic
 * quiet way to inflate a held-out score.
 */
export function fitStandardiser(examples: readonly TrainingExample[], featureCount: number): Standardiser {
  const means = new Array<number>(featureCount).fill(0);
  const stdDevs = new Array<number>(featureCount).fill(0);
  if (examples.length === 0) return { means, stdDevs };

  for (const example of examples) {
    for (let i = 0; i < featureCount; i += 1) means[i] = (means[i] ?? 0) + (example.features[i] ?? 0);
  }
  for (let i = 0; i < featureCount; i += 1) means[i] = (means[i] ?? 0) / examples.length;

  for (const example of examples) {
    for (let i = 0; i < featureCount; i += 1) {
      const delta = (example.features[i] ?? 0) - (means[i] ?? 0);
      stdDevs[i] = (stdDevs[i] ?? 0) + delta * delta;
    }
  }
  for (let i = 0; i < featureCount; i += 1) {
    const variance = (stdDevs[i] ?? 0) / examples.length;
    // A constant feature gets stdDev 0, and `standardise` maps it to 0 —
    // it carries no information and must not become an infinity.
    stdDevs[i] = variance > 0 ? Math.sqrt(variance) : 0;
  }
  return { means, stdDevs };
}

export function applyStandardiser(
  examples: readonly TrainingExample[],
  standardiser: Standardiser,
): TrainingExample[] {
  return examples.map((example) => ({
    label: example.label,
    features: example.features.map((value, index) => {
      const stdDev = standardiser.stdDevs[index] ?? 0;
      return stdDev === 0 ? 0 : (value - (standardiser.means[index] ?? 0)) / stdDev;
    }),
  }));
}

const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

export interface LogisticRegressionOptions {
  readonly learningRate: number;
  readonly epochs: number;
  /** L2 penalty. Not applied to the intercept, which carries the class prior. */
  readonly l2: number;
  /**
   * Weight applied to positive examples in the loss. The dataset is
   * deliberately negative-heavy (~4 negatives per positive) because that
   * is the operating regime; the weight lets the loss see a balanced
   * problem without resampling the data and losing the hard negatives.
   */
  readonly positiveWeight: number;
}

export function trainLogisticRegression(
  standardisedExamples: readonly TrainingExample[],
  featureCount: number,
  standardiser: Standardiser,
  options: LogisticRegressionOptions,
): LogisticRegressionParameters {
  const weights = new Array<number>(featureCount).fill(0);
  let intercept = 0;
  const n = standardisedExamples.length;
  if (n === 0) {
    return {
      kind: "logistic_regression",
      weights,
      intercept,
      featureMeans: standardiser.means,
      featureStdDevs: standardiser.stdDevs,
    };
  }

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const gradient = new Array<number>(featureCount).fill(0);
    let interceptGradient = 0;
    let weightSum = 0;

    for (const example of standardisedExamples) {
      let z = intercept;
      for (let i = 0; i < featureCount; i += 1) z += (weights[i] ?? 0) * (example.features[i] ?? 0);
      const prediction = sigmoid(z);
      const sampleWeight = example.label === 1 ? options.positiveWeight : 1;
      const error = (prediction - example.label) * sampleWeight;
      weightSum += sampleWeight;
      interceptGradient += error;
      for (let i = 0; i < featureCount; i += 1) {
        gradient[i] = (gradient[i] ?? 0) + error * (example.features[i] ?? 0);
      }
    }

    const scale = weightSum === 0 ? 0 : 1 / weightSum;
    intercept -= options.learningRate * interceptGradient * scale;
    for (let i = 0; i < featureCount; i += 1) {
      const penalised = (gradient[i] ?? 0) * scale + options.l2 * (weights[i] ?? 0);
      weights[i] = (weights[i] ?? 0) - options.learningRate * penalised;
    }
  }

  return {
    kind: "logistic_regression",
    weights,
    intercept,
    featureMeans: standardiser.means,
    featureStdDevs: standardiser.stdDevs,
  };
}

// --------------------------------------------------------------------------
// Gradient-boosted regression trees on the logistic loss.
// --------------------------------------------------------------------------

export interface GradientBoostingOptions {
  readonly rounds: number;
  readonly learningRate: number;
  readonly maxDepth: number;
  readonly minSamplesPerLeaf: number;
  readonly l2: number;
  readonly positiveWeight: number;
}

interface SplitCandidate {
  feature: number;
  threshold: number;
  gain: number;
}

/** Newton leaf value for the logistic loss: -sum(g) / (sum(h) + lambda). */
const leafValue = (gradients: number[], hessians: number[], indices: number[], l2: number): number => {
  let g = 0;
  let h = 0;
  for (const index of indices) {
    g += gradients[index] ?? 0;
    h += hessians[index] ?? 0;
  }
  return -g / (h + l2);
};

const nodeScore = (gradients: number[], hessians: number[], indices: number[], l2: number): number => {
  let g = 0;
  let h = 0;
  for (const index of indices) {
    g += gradients[index] ?? 0;
    h += hessians[index] ?? 0;
  }
  return (g * g) / (h + l2);
};

function bestSplit(
  examples: readonly TrainingExample[],
  gradients: number[],
  hessians: number[],
  indices: number[],
  featureCount: number,
  options: GradientBoostingOptions,
): SplitCandidate | null {
  const parentScore = nodeScore(gradients, hessians, indices, options.l2);
  let best: SplitCandidate | null = null;

  for (let feature = 0; feature < featureCount; feature += 1) {
    const values = [...new Set(indices.map((index) => examples[index]?.features[feature] ?? 0))].sort(
      (a, b) => a - b,
    );
    if (values.length < 2) continue;
    // Midpoints between observed values, capped so a continuous feature
    // does not make the search quadratic in the node size.
    const thresholds: number[] = [];
    const stride = Math.max(1, Math.floor(values.length / 32));
    for (let i = 0; i + 1 < values.length; i += stride) {
      thresholds.push(((values[i] as number) + (values[i + 1] as number)) / 2);
    }
    for (const threshold of thresholds) {
      const left: number[] = [];
      const right: number[] = [];
      for (const index of indices) {
        if ((examples[index]?.features[feature] ?? 0) <= threshold) left.push(index);
        else right.push(index);
      }
      if (left.length < options.minSamplesPerLeaf || right.length < options.minSamplesPerLeaf) continue;
      const gain =
        nodeScore(gradients, hessians, left, options.l2) +
        nodeScore(gradients, hessians, right, options.l2) -
        parentScore;
      if (gain > 0 && (!best || gain > best.gain)) best = { feature, threshold, gain };
    }
  }
  return best;
}

function growTree(
  examples: readonly TrainingExample[],
  gradients: number[],
  hessians: number[],
  indices: number[],
  depth: number,
  featureCount: number,
  options: GradientBoostingOptions,
): TreeNode {
  if (depth >= options.maxDepth || indices.length < 2 * options.minSamplesPerLeaf) {
    return { feature: -1, threshold: 0, value: leafValue(gradients, hessians, indices, options.l2) };
  }
  const split = bestSplit(examples, gradients, hessians, indices, featureCount, options);
  if (!split) {
    return { feature: -1, threshold: 0, value: leafValue(gradients, hessians, indices, options.l2) };
  }
  const left: number[] = [];
  const right: number[] = [];
  for (const index of indices) {
    if ((examples[index]?.features[split.feature] ?? 0) <= split.threshold) left.push(index);
    else right.push(index);
  }
  return {
    feature: split.feature,
    threshold: split.threshold,
    left: growTree(examples, gradients, hessians, left, depth + 1, featureCount, options),
    right: growTree(examples, gradients, hessians, right, depth + 1, featureCount, options),
  };
}

const predictTree = (node: TreeNode, features: readonly number[]): number => {
  let cursor = node;
  while (cursor.feature !== -1) {
    const next = (features[cursor.feature] ?? 0) <= cursor.threshold ? cursor.left : cursor.right;
    if (!next) break;
    cursor = next;
  }
  return cursor.value ?? 0;
};

export function trainGradientBoostedTrees(
  standardisedExamples: readonly TrainingExample[],
  featureCount: number,
  standardiser: Standardiser,
  options: GradientBoostingOptions,
): GradientBoostedParameters {
  const n = standardisedExamples.length;
  const sampleWeights = standardisedExamples.map((example) =>
    example.label === 1 ? options.positiveWeight : 1,
  );
  const weightedPositives = standardisedExamples.reduce(
    (sum, example, index) => sum + (example.label === 1 ? (sampleWeights[index] ?? 1) : 0),
    0,
  );
  const totalWeight = sampleWeights.reduce((sum, weight) => sum + weight, 0);
  const prior = totalWeight === 0 ? 0.5 : Math.min(Math.max(weightedPositives / totalWeight, 1e-6), 1 - 1e-6);
  const baseLogit = Math.log(prior / (1 - prior));

  const logits = new Array<number>(n).fill(baseLogit);
  const trees: TreeNode[] = [];
  const indices = Array.from({ length: n }, (_, index) => index);

  for (let round = 0; round < options.rounds; round += 1) {
    const gradients = new Array<number>(n).fill(0);
    const hessians = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      const p = sigmoid(logits[i] ?? 0);
      const weight = sampleWeights[i] ?? 1;
      gradients[i] = weight * (p - (standardisedExamples[i]?.label ?? 0));
      hessians[i] = weight * p * (1 - p);
    }
    const tree = growTree(standardisedExamples, gradients, hessians, indices, 0, featureCount, options);
    trees.push(tree);
    for (let i = 0; i < n; i += 1) {
      logits[i] =
        (logits[i] ?? 0) + options.learningRate * predictTree(tree, standardisedExamples[i]?.features ?? []);
    }
  }

  return {
    kind: "gradient_boosted_trees",
    baseLogit,
    learningRate: options.learningRate,
    trees,
    featureMeans: standardiser.means,
    featureStdDevs: standardiser.stdDevs,
  };
}
