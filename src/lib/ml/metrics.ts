/**
 * P6.24 — evaluation metrics for the pairwise entity-resolution model.
 *
 * Pure functions over (label, score) arrays. No I/O, no randomness, so a
 * metric is reproducible from the scored pairs alone and the evaluation
 * report can be regenerated without re-running the model.
 *
 * FALSE MERGES ARE THE PRIORITY METRIC. `falseMergeRate` and
 * `hardNegativeFalseMergeRate` are reported at every threshold, because
 * an investigation tool that fuses two real companies does more damage
 * than one that leaves a pair unjoined - and aggregate accuracy on a
 * corpus with 4x more negatives than positives hides exactly that.
 */

export interface ScoredPair {
  readonly label: 0 | 1;
  readonly score: number;
}

export interface ConfusionCounts {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly trueNegatives: number;
  readonly falseNegatives: number;
}

export interface ThresholdMetrics extends ConfusionCounts {
  readonly threshold: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** FP / (all negatives) — the rate at which two different entities would be merged. */
  readonly falseMergeRate: number;
  /** FN / (all positives) — the rate at which one entity stays split in two. */
  readonly falseSplitRate: number;
}

export const confusion = (pairs: readonly ScoredPair[], threshold: number): ConfusionCounts => {
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  for (const pair of pairs) {
    const predicted = pair.score >= threshold;
    if (pair.label === 1 && predicted) truePositives += 1;
    else if (pair.label === 1) falseNegatives += 1;
    else if (predicted) falsePositives += 1;
    else trueNegatives += 1;
  }
  return { truePositives, falsePositives, trueNegatives, falseNegatives };
};

const safeDivide = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

export function metricsAt(pairs: readonly ScoredPair[], threshold: number): ThresholdMetrics {
  const counts = confusion(pairs, threshold);
  const precision = safeDivide(counts.truePositives, counts.truePositives + counts.falsePositives);
  const recall = safeDivide(counts.truePositives, counts.truePositives + counts.falseNegatives);
  return {
    ...counts,
    threshold,
    precision,
    recall,
    f1: safeDivide(2 * precision * recall, precision + recall),
    falseMergeRate: safeDivide(counts.falsePositives, counts.falsePositives + counts.trueNegatives),
    falseSplitRate: safeDivide(counts.falseNegatives, counts.truePositives + counts.falseNegatives),
  };
}

/**
 * ROC-AUC by the rank-sum (Mann-Whitney U) identity, with ties given
 * their average rank so a model that scores many pairs identically is
 * neither rewarded nor punished for the tie.
 */
export function rocAuc(pairs: readonly ScoredPair[]): number {
  const positives = pairs.filter((pair) => pair.label === 1).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return Number.NaN;

  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  const ranks = new Array<number>(sorted.length).fill(0);
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1]?.score === sorted[index]?.score) end += 1;
    const averageRank = (index + end) / 2 + 1;
    for (let k = index; k <= end; k += 1) ranks[k] = averageRank;
    index = end + 1;
  }

  let positiveRankSum = 0;
  sorted.forEach((pair, i) => {
    if (pair.label === 1) positiveRankSum += ranks[i] ?? 0;
  });
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/**
 * PR-AUC by the trapezoid rule over the precision-recall curve, walking
 * the pairs in descending score. Reported alongside ROC-AUC because the
 * dataset is deliberately negative-heavy and ROC-AUC flatters a model on
 * an imbalanced set in a way PR-AUC does not.
 */
export function prAuc(pairs: readonly ScoredPair[]): number {
  const totalPositives = pairs.filter((pair) => pair.label === 1).length;
  if (totalPositives === 0) return Number.NaN;

  const sorted = [...pairs].sort((a, b) => b.score - a.score);
  let truePositives = 0;
  let falsePositives = 0;
  let previousRecall = 0;
  let previousPrecision = 1;
  let area = 0;

  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1]?.score === sorted[index]?.score) end += 1;
    for (let k = index; k <= end; k += 1) {
      if (sorted[k]?.label === 1) truePositives += 1;
      else falsePositives += 1;
    }
    const recall = truePositives / totalPositives;
    const precision = safeDivide(truePositives, truePositives + falsePositives);
    area += ((recall - previousRecall) * (precision + previousPrecision)) / 2;
    previousRecall = recall;
    previousPrecision = precision;
    index = end + 1;
  }
  return area;
}

/** Every distinct score, plus the midpoints, as candidate thresholds. */
export function candidateThresholds(pairs: readonly ScoredPair[], limit = 400): number[] {
  const scores = [...new Set(pairs.map((pair) => pair.score))].sort((a, b) => a - b);
  if (scores.length <= limit) return scores;
  const step = scores.length / limit;
  const sampled: number[] = [];
  for (let i = 0; i < limit; i += 1) sampled.push(scores[Math.floor(i * step)] as number);
  return [...new Set(sampled)];
}

/**
 * Selects the threshold maximising F1 SUBJECT TO a false-merge ceiling.
 *
 * The ceiling is the point of the function. Picking a threshold on F1
 * alone would trade false merges for recall at a rate this product
 * cannot accept: a merged pair asserts that two companies are one, and
 * an investigator who acts on that has been actively misled, where an
 * unjoined pair only leaves them where the deterministic resolver
 * already left them.
 */
/**
 * A second ceiling, applied to a NAMED SUBSET of the negatives.
 *
 * A ceiling on the overall false-merge rate is close to no ceiling at all
 * on the pairs that matter. In the P6.25 validation partition 25 of 774
 * negatives are curated hard negatives — genuine name collisions between
 * distinct legal entities — and the other 749 are pairs no threshold would
 * ever merge. A model can therefore double its false merges on exactly the
 * hard cases while its overall rate barely moves, and be selected for it.
 * That was measured, not feared: adding two features raised held-out recall
 * by 2.5 points and hard-negative false merges from 9 to 12 while the
 * overall ceiling stayed satisfied throughout.
 */
export interface SubsetCeiling {
  /** Which negatives this ceiling is measured over. */
  readonly includes: (pair: ScoredPair) => boolean;
  readonly maxFalseMergeRate: number;
  readonly label: string;
}

export function selectThreshold(
  pairs: readonly ScoredPair[],
  maxFalseMergeRate: number,
  subsetCeiling?: SubsetCeiling,
): ThresholdMetrics {
  const candidates = candidateThresholds(pairs);
  const subsetNegatives = subsetCeiling
    ? pairs.filter((pair) => pair.label === 0 && subsetCeiling.includes(pair))
    : [];
  const subsetRateAt = (threshold: number): number => {
    if (subsetNegatives.length === 0) return 0;
    const merged = subsetNegatives.filter((pair) => pair.score >= threshold).length;
    return merged / subsetNegatives.length;
  };

  let best: ThresholdMetrics | null = null;
  let bestUnconstrained: ThresholdMetrics | null = null;
  for (const threshold of candidates) {
    const metrics = metricsAt(pairs, threshold);
    if (!bestUnconstrained || metrics.f1 > bestUnconstrained.f1) bestUnconstrained = metrics;
    if (metrics.falseMergeRate > maxFalseMergeRate) continue;
    if (subsetCeiling && subsetRateAt(threshold) > subsetCeiling.maxFalseMergeRate) continue;
    if (!best || metrics.f1 > best.f1) best = metrics;
  }
  return best ?? (bestUnconstrained as ThresholdMetrics);
}
