/**
 * P6.24.3 — the experiment ladder, and the model artifact it produces.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/ml/train-model.ts
 *
 * READS ONLY THE TRAIN AND VALIDATION PARTITIONS. The held-out partition
 * is not loaded, not scored and not named anywhere in this file; it is
 * opened for the first and only time by scripts/ml/evaluate-model.ts,
 * after the model and its threshold are frozen. That is what "frozen"
 * means here and it is enforced by check L10 of the leakage gate, which
 * greps this file.
 *
 * THE LADDER, run in order and all four recorded whatever the outcome:
 *
 *   E1  the deterministic resolver's own pair-level rule, replayed
 *   E2  logistic regression on the 25 engineered features
 *   E3  gradient-boosted trees on the same features
 *   E4  E2 plus a registry-pairing feature — an ABLATION, never shipped,
 *       run to measure how much of any gain is an artefact of the labels
 *       having been built from cross-source agreement
 *
 * Selection is on VALIDATION and on a false-merge ceiling, not on F1
 * alone: the model may not merge two different companies more often than
 * the deterministic resolver already does. A model that cannot meet that
 * ceiling and still improve recall has not earned a threshold.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildFeatures,
  deterministicPairDecision,
  FEATURE_NAMES,
  TRAINABLE_FEATURE_NAMES,
  type FeatureRecord,
} from "@/lib/ml/features";
import {
  metricsAt,
  prAuc,
  rocAuc,
  selectThreshold,
  type ScoredPair,
  type ThresholdMetrics,
} from "@/lib/ml/metrics";
import {
  MODEL_ARTIFACT_FORMAT,
  artifactSha256,
  logitOf,
  serialiseArtifact,
  standardise,
  weightsDigest,
  type ModelArtifact,
  type ModelParameters,
} from "@/lib/ml/model";
import {
  applyStandardiser,
  fitStandardiser,
  trainGradientBoostedTrees,
  trainLogisticRegression,
  type TrainingExample,
} from "@/lib/ml/train";

const ROOT = process.cwd();

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

const DATASET_PATH = arg("dataset", "evidence/ml/pair-dataset.json");
const OUT_DIR = "reports/ml";
const MODEL_DIR = "models";
const REGISTRY_PATH = path.join(OUT_DIR, arg("registry", "experiment-registry.json"));
const ARTIFACT_PATH = path.join(MODEL_DIR, arg("artifact", "cipher-er-pair-classifier.v1.json"));
const MODEL_VERSION = arg("model-version", "1.0.0");

const SEED = 20260904;
const FIT_PARTITION = "train";
const SELECT_PARTITION = "validation";

const LOGISTIC_OPTIONS = { learningRate: 0.5, epochs: 4000, l2: 0.002, positiveWeight: 4 } as const;
interface BoostingOptions {
  rounds: number;
  learningRate: number;
  maxDepth: number;
  minSamplesPerLeaf: number;
  l2: number;
  positiveWeight: number;
}

const BOOSTING_OPTIONS: BoostingOptions = {
  rounds: 120,
  learningRate: 0.1,
  maxDepth: 3,
  minSamplesPerLeaf: 12,
  l2: 1,
  positiveWeight: 4,
};

interface Pair {
  pairId: string;
  label: 0 | 1;
  labelClass: string;
  partition: string;
  aRef: string;
  bRef: string;
  aRegistry: string;
  bRegistry: string;
  aName: string;
  bName: string;
  variation: string | null;
}

interface Dataset {
  datasetId: string;
  datasetVersion: string;
  seed: string;
  featureRecords: Record<
    string,
    { name: string; officialName: string | null; aliases: string[]; jurisdiction: string | null; registry: string }
  >;
  pairs: Pair[];
}

const gitCommit = (): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

function main(): void {
  const dataset = JSON.parse(readFileSync(path.join(ROOT, DATASET_PATH), "utf8")) as Dataset;

  const recordOf = (ref: string): FeatureRecord => {
    const record = dataset.featureRecords[ref];
    if (!record) throw new Error(`no feature projection for ${ref}`);
    return {
      name: record.name,
      officialName: record.officialName ?? undefined,
      aliases: record.aliases,
      jurisdiction: record.jurisdiction ?? undefined,
    };
  };
  const registryOf = (ref: string): string => dataset.featureRecords[ref]?.registry ?? "";

  const usable = dataset.pairs.filter((pair) => pair.partition === FIT_PARTITION || pair.partition === SELECT_PARTITION);
  const fitPairs = usable.filter((pair) => pair.partition === FIT_PARTITION);
  const selectPairs = usable.filter((pair) => pair.partition === SELECT_PARTITION);

  // Projected onto TRAINABLE_FEATURE_NAMES: a feature excluded there is
  // never computed into a training vector, so a new model cannot be fitted
  // on it even by accident. See EXCLUDED_FROM_NEW_MODELS for why.
  const trainableIndices = TRAINABLE_FEATURE_NAMES.map((name) =>
    (FEATURE_NAMES as readonly string[]).indexOf(name),
  );
  const vectorise = (pair: Pair, withRegistryFeature: boolean): number[] => {
    const all = buildFeatures(recordOf(pair.aRef), recordOf(pair.bRef)).values;
    const values = trainableIndices.map((index) => all[index] ?? 0);
    if (withRegistryFeature) values.push(registryOf(pair.aRef) === registryOf(pair.bRef) ? 1 : 0);
    return values;
  };

  const examplesFor = (pairs: Pair[], withRegistryFeature: boolean): TrainingExample[] =>
    pairs.map((pair) => ({ label: pair.label, features: vectorise(pair, withRegistryFeature) }));

  const classBalance = (pairs: Pair[]) => ({
    pairs: pairs.length,
    positives: pairs.filter((pair) => pair.label === 1).length,
    negatives: pairs.filter((pair) => pair.label === 0).length,
    hardNegatives: pairs.filter((pair) => pair.labelClass === "hard_negative").length,
    minedHardNegatives: pairs.filter((pair) => pair.labelClass === "mined_hard_negative").length,
    sampledNegatives: pairs.filter((pair) => pair.labelClass === "sampled_negative").length,
  });

  // ---- E1: the deterministic baseline ------------------------------------
  const deterministicScores = (pairs: Pair[]): ScoredPair[] =>
    pairs.map((pair) => ({
      label: pair.label,
      score: deterministicPairDecision(recordOf(pair.aRef), recordOf(pair.bRef)) ? 1 : 0,
    }));

  const baselineSelect = metricsAt(deterministicScores(selectPairs), 0.5);
  const baselineFit = metricsAt(deterministicScores(fitPairs), 0.5);

  // The ceiling every learned model must respect: it may not merge two
  // different entities MORE often than the deterministic resolver does on
  // the same partition. When the baseline makes no false merge at all, the
  // model is held to the same zero.
  const falseMergeCeiling = baselineSelect.falseMergeRate;

  // The SECOND ceiling, over curated hard negatives alone. The overall
  // ceiling is nearly vacuous on them: they are 25 of 774 validation
  // negatives, so a model can merge several more of them and barely move
  // the overall rate. Held to the deterministic resolver's own hard-negative
  // rate on the same pairs, which is the honest comparison.
  const deterministicSelectScores = deterministicScores(selectPairs);
  const hardNegativeCount = selectPairs.filter(
    (pair) => pair.label === 0 && pair.labelClass === "hard_negative",
  ).length;
  const deterministicHardNegativeMerges = selectPairs.filter(
    (pair, index) =>
      pair.label === 0 &&
      pair.labelClass === "hard_negative" &&
      (deterministicSelectScores[index] as ScoredPair).score >= 0.5,
  ).length;
  const hardNegativeCeiling =
    hardNegativeCount === 0 ? 1 : deterministicHardNegativeMerges / hardNegativeCount;

  interface Experiment {
    experimentId: string;
    model: string;
    featureSet: string;
    featureCount: number;
    hyperparameters: Record<string, number | string>;
    seed: number;
    trainingMillis: number;
    validation: {
      rocAuc: number | null;
      prAuc: number | null;
      selected: ThresholdMetrics;
      atFixedHalf: ThresholdMetrics;
    };
    parameters?: ModelParameters;
    shipped: boolean;
    note: string;
  }

  const experiments: Experiment[] = [];

  experiments.push({
    experimentId: "E1-deterministic-baseline",
    model: "deterministic normalised-name equality (src/lib/resolution/name-normalization.ts)",
    featureSet: "none — the shipped resolver's own Tier B/B2 rule, replayed at pair level",
    featureCount: 0,
    hyperparameters: {},
    seed: 0,
    trainingMillis: 0,
    validation: {
      rocAuc: null,
      prAuc: null,
      selected: baselineSelect,
      atFixedHalf: baselineSelect,
    },
    shipped: false,
    note:
      "Not a learned model and not tuneable. This is the number every other row must beat, measured on the same " +
      "pairs. It is deliberately NOT the 70.7% figure from the earlier India-filtered 75-pair corpus, which is a " +
      "different corpus and not comparable.",
  });

  /**
   * Zeroes the named features in place of removing them, so an ablation
   * keeps the same vector width, the same standardiser shape and the same
   * comparability against every other row of the ladder. A dropped column
   * would shift every index after it and quietly compare two different
   * feature sets.
   */
  const maskFeatures = (examples: TrainingExample[], names: readonly string[]): TrainingExample[] => {
    const indices = names.map((name) => {
      const index = TRAINABLE_FEATURE_NAMES.indexOf(name as (typeof TRAINABLE_FEATURE_NAMES)[number]);
      if (index < 0) throw new Error(`cannot mask unknown or untrainable feature ${name}`);
      return index;
    });
    return examples.map((example) => {
      const features = [...example.features];
      for (const index of indices) features[index] = 0;
      return { label: example.label, features };
    });
  };

  interface LearnedOptions {
    experimentId: string;
    model: "logistic_regression" | "gradient_boosted_trees";
    note: string;
    withRegistryFeature?: boolean;
    /** Features zeroed for this row only. Names an ablation, never the shipped model. */
    mask?: readonly string[];
    featureSetLabel?: string;
    boosting?: BoostingOptions;
  }

  const runLearned = (options: LearnedOptions): Experiment => {
    const { experimentId, model, note } = options;
    const withRegistryFeature = options.withRegistryFeature ?? false;
    const boostingOptions = options.boosting ?? BOOSTING_OPTIONS;
    const featureCount = TRAINABLE_FEATURE_NAMES.length + (withRegistryFeature ? 1 : 0);
    let trainExamples = examplesFor(fitPairs, withRegistryFeature);
    let validationExamples = examplesFor(selectPairs, withRegistryFeature);
    if (options.mask) {
      trainExamples = maskFeatures(trainExamples, options.mask);
      validationExamples = maskFeatures(validationExamples, options.mask);
    }

    // Fitted on the training rows and on nothing else.
    const standardiser = fitStandardiser(trainExamples, featureCount);
    const standardisedTrain = applyStandardiser(trainExamples, standardiser);

    const started = Date.now();
    const parameters: ModelParameters =
      model === "logistic_regression"
        ? trainLogisticRegression(standardisedTrain, featureCount, standardiser, LOGISTIC_OPTIONS)
        : trainGradientBoostedTrees(standardisedTrain, featureCount, standardiser, boostingOptions);
    const trainingMillis = Date.now() - started;

    const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
    // Identity-keyed, so the hard-negative ceiling addresses the very
    // objects selectThreshold iterates rather than matching by position.
    const hardNegativeScored = new Set<ScoredPair>();
    const scored: ScoredPair[] = validationExamples.map((example) => ({
      label: example.label,
      score: sigmoid(logitOf(parameters, standardise(example.features, standardiser.means, standardiser.stdDevs))),
    }));
    scored.forEach((entry, index) => {
      if ((selectPairs[index] as Pair).labelClass === "hard_negative") hardNegativeScored.add(entry);
    });

    return {
      experimentId,
      model,
      featureSet:
        options.featureSetLabel ??
        (withRegistryFeature
          ? `engineered-${TRAINABLE_FEATURE_NAMES.length} + sameRegistry (ablation)`
          : `engineered-${TRAINABLE_FEATURE_NAMES.length}`),
      featureCount,
      hyperparameters:
        model === "logistic_regression" ? { ...LOGISTIC_OPTIONS } : { ...boostingOptions },
      seed: SEED,
      trainingMillis,
      validation: {
        rocAuc: Number(rocAuc(scored).toFixed(4)),
        prAuc: Number(prAuc(scored).toFixed(4)),
        selected: selectThreshold(scored, falseMergeCeiling, {
          includes: (pair) => hardNegativeScored.has(pair),
          maxFalseMergeRate: hardNegativeCeiling,
          label: "curated hard negatives",
        }),
        atFixedHalf: metricsAt(scored, 0.5),
      },
      parameters,
      shipped: false,
      note,
    };
  };

  experiments.push(
    runLearned({
      experimentId: "E2-logistic-regression",
      model: "logistic_regression",
      note:
        "The simplest interpretable model the ladder allows. Every coefficient is readable and every score decomposes " +
        "into per-feature contributions, which is what makes a merge suggestion auditable.",
    }),
  );
  experiments.push(
    runLearned({
      experimentId: "E3-gradient-boosted-trees",
      model: "gradient_boosted_trees",
      note:
        "Tried because the failures this model exists to recover are interactions a linear model cannot express: a high " +
        "token overlap is evidence of identity ONLY when the pair does not also look like a shared-leading-token family.",
    }),
  );
  experiments.push(
    runLearned({
      experimentId: "E4-ablation-registry-pairing",
      model: "logistic_regression",
      withRegistryFeature: true,
      note:
        "ABLATION, NEVER SHIPPED. Every positive in this corpus is cross-source by construction while many negatives are " +
        "same-source, so `sameRegistry` predicts the label partly because of how the labels were BUILT. The gap between " +
        "this row and E2 is the size of that artefact, measured rather than assumed.",
    }),
  );
  experiments.push(
    runLearned({
      experimentId: "E5-ablation-no-jurisdiction",
      model: "logistic_regression",
      mask: ["jurisdictionBothKnown", "jurisdictionCountryMatch", "jurisdictionCountryConflict"],
      featureSetLabel: `engineered-${TRAINABLE_FEATURE_NAMES.length} minus the 3 jurisdiction features (ablation)`,
      note:
        "ABLATION, NEVER SHIPPED. P6.25 gave the Wikidata side a publisher-stated country for the first time, and " +
        "jurisdiction agreement immediately reached a standalone ROC-AUC of 0.85 on TRAIN. Some of that is real " +
        "evidence and some is an artefact of how sampled negatives are drawn: two randomly paired companies are " +
        "usually in different countries whether or not that is why they are different companies. The gap between this " +
        "row and E2 sizes the total contribution; the hard-negative false-merge rate in the held-out evaluation is " +
        "where the REAL part shows, because a curated hard negative is a genuine name collision rather than a random " +
        "pair.",
    }),
  );
  // ---- E6 / E7: the boosting hyperparameters, re-fitted for a 3x larger TRAIN
  //
  // The P6.24 settings (120 rounds, depth 3, 12 samples per leaf) were chosen
  // against 1,044 training pairs. TRAIN is now 3,121, and carried over
  // unchanged those settings underfit: E3 lost 13 points of recall to plain
  // logistic regression on the same features while scoring a HIGHER ROC-AUC,
  // which is the signature of a model whose ranking is fine and whose score
  // distribution is too clumped for a threshold to sit in. Re-fitting the
  // capacity to the new data size is the fair comparison; leaving it stale
  // and concluding "trees lost" would not be.
  experiments.push(
    runLearned({
      experimentId: "E6-gradient-boosted-trees-deeper",
      model: "gradient_boosted_trees",
      boosting: { rounds: 300, learningRate: 0.06, maxDepth: 4, minSamplesPerLeaf: 8, l2: 1, positiveWeight: 4 },
      note:
        "E3's capacity, re-fitted to the larger TRAIN: more rounds at a lower learning rate, one level deeper, and a " +
        "smaller leaf minimum. More rounds at a lower rate also spreads the score distribution, which is what a " +
        "false-merge-capped threshold needs in order to sit anywhere useful.",
    }),
  );
  experiments.push(
    runLearned({
      experimentId: "E7-gradient-boosted-trees-wide",
      model: "gradient_boosted_trees",
      boosting: { rounds: 500, learningRate: 0.04, maxDepth: 5, minSamplesPerLeaf: 6, l2: 2, positiveWeight: 4 },
      note:
        "The upper end of the capacity sweep, with the L2 penalty raised to pay for it. Recorded whatever the outcome: " +
        "if the extra capacity does not buy recall at the same false-merge ceiling, that is the evidence that the " +
        "smaller model is the right one, and it is worth having rather than assuming.",
    }),
  );

  // ---- selection ---------------------------------------------------------
  // Ablations are diagnostics and can never be shipped, however well they
  // score — that is the entire point of running them.
  const ABLATIONS = ["E4-ablation-registry-pairing", "E5-ablation-no-jurisdiction"];
  const candidates = experiments.filter(
    (experiment) => experiment.parameters && !ABLATIONS.includes(experiment.experimentId),
  );
  const ranked = [...candidates].sort((a, b) => {
    const aMetrics = a.validation.selected;
    const bMetrics = b.validation.selected;
    if (bMetrics.recall !== aMetrics.recall) return bMetrics.recall - aMetrics.recall;
    return bMetrics.f1 - aMetrics.f1;
  });
  const winner = ranked[0];
  if (!winner || !winner.parameters) throw new Error("no learned experiment produced parameters");

  // The smallest model that materially improves the objective wins ties.
  // A tree ensemble must beat logistic regression by more than a point of
  // recall at the same false-merge ceiling to justify being harder to explain.
  const logistic = candidates.find((experiment) => experiment.experimentId === "E2-logistic-regression");
  const boosted = candidates
    .filter((experiment) => experiment.model === "gradient_boosted_trees")
    .sort((a, b) => b.validation.selected.recall - a.validation.selected.recall)[0];
  let selected = winner;
  if (
    logistic &&
    boosted &&
    winner.experimentId === boosted.experimentId &&
    boosted.validation.selected.recall - logistic.validation.selected.recall < 0.01
  ) {
    selected = logistic;
  }
  selected.shipped = true;

  const base = {
    format: MODEL_ARTIFACT_FORMAT,
    modelId: "cipher-er-pair-classifier",
    modelVersion: MODEL_VERSION,
    experimentId: selected.experimentId,
    createdAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    datasetId: dataset.datasetId,
    datasetVersion: dataset.datasetVersion,
    seed: SEED,
    featureNames: [...TRAINABLE_FEATURE_NAMES],
    parameters: selected.parameters as ModelParameters,
    decisionThreshold: selected.validation.selected.threshold,
    thresholdPolicy:
      `Chosen on the ${SELECT_PARTITION} partition as the threshold maximising F1 subject to a false-merge rate no ` +
      `higher than the deterministic resolver's on the same partition (${falseMergeCeiling.toFixed(4)}), AND ` +
      `no higher than that resolver's false-merge rate over the CURATED HARD NEGATIVES alone ` +
      `(${deterministicHardNegativeMerges}/${hardNegativeCount} = ${hardNegativeCeiling.toFixed(4)}). ` +
      `The second ceiling exists because hard negatives are ${hardNegativeCount} of the partition's negatives, ` +
      `so an overall ceiling alone barely constrains the pairs a merge decision actually turns on. ` +
      `The held-out partition was not consulted.`,
    trainingHyperparameters: selected.hyperparameters,
    notes:
      "Pairwise same-entity classifier over name, jurisdiction and missingness features. Reads NO identifier: every " +
      "label in this project is derived from identifier agreement, so an identifier feature would be the answer, not " +
      "evidence. The deterministic resolver remains authoritative for merges; this score is advisory and is always " +
      "shown with its features.",
  } satisfies Omit<ModelArtifact, "weightsDigest">;

  // The digest is computed over the artifact WITHOUT it and then written
  // into the artifact, so it can be recomputed and compared by anyone
  // holding the file. See weightsDigest() for why the file's own sha256
  // cannot answer the reproducibility question.
  const artifact: ModelArtifact = { ...base, weightsDigest: weightsDigest(base) };

  const serialised = serialiseArtifact(artifact);
  mkdirSync(path.join(ROOT, MODEL_DIR), { recursive: true });
  writeFileSync(path.join(ROOT, ARTIFACT_PATH), serialised, "utf8");
  const sha256 = artifactSha256(serialised);

  const registry = {
    registry: "P6.24 experiment registry",
    ranAt: new Date().toISOString(),
    gitCommit: gitCommit(),
    dataset: { id: dataset.datasetId, version: dataset.datasetVersion, path: DATASET_PATH, seed: dataset.seed },
    partitionCounts: { train: fitPairs.length, validation: selectPairs.length },
    partitionsUsed: [FIT_PARTITION, SELECT_PARTITION],
    heldOutPartition: "NOT READ by this script. Opened only by scripts/ml/evaluate-model.ts.",
    classBalance: {
      [FIT_PARTITION]: classBalance(fitPairs),
      [SELECT_PARTITION]: classBalance(selectPairs),
    },
    baselineOnFitPartition: baselineFit,
    falseMergeCeiling,
    hardNegativeCeiling: {
      rate: hardNegativeCeiling,
      deterministicMerges: deterministicHardNegativeMerges,
      hardNegatives: hardNegativeCount,
      note:
        "Curated hard negatives only. A model may not merge genuine name collisions more often than the " +
        "deterministic resolver does on the same pairs.",
    },
    featureNames: TRAINABLE_FEATURE_NAMES,
    experiments: experiments.map(({ parameters, ...rest }) => ({
      ...rest,
      parameterSummary:
        parameters?.kind === "logistic_regression"
          ? {
              kind: parameters.kind,
              intercept: Number(parameters.intercept.toFixed(4)),
              weights: TRAINABLE_FEATURE_NAMES.map((name, index) => ({
                feature: name,
                weight: Number((parameters.weights[index] ?? 0).toFixed(4)),
              })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
            }
          : parameters
            ? { kind: parameters.kind, trees: parameters.trees.length, learningRate: parameters.learningRate }
            : null,
    })),
    shipped: {
      experimentId: selected.experimentId,
      artifactPath: ARTIFACT_PATH,
      artifactSha256: sha256,
      weightsDigest: artifact.weightsDigest,
      decisionThreshold: artifact.decisionThreshold,
    },
  };

  mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
  writeFileSync(path.join(ROOT, REGISTRY_PATH), `${JSON.stringify(registry, null, 2)}\n`, "utf8");

  console.log(`baseline (${SELECT_PARTITION}): recall ${(baselineSelect.recall * 100).toFixed(1)}%  precision ${(baselineSelect.precision * 100).toFixed(1)}%  falseMergeRate ${(baselineSelect.falseMergeRate * 100).toFixed(2)}%`);
  for (const experiment of experiments) {
    const m = experiment.validation.selected;
    console.log(
      `${experiment.shipped ? "*" : " "} ${experiment.experimentId.padEnd(30)} ` +
        `thr ${m.threshold.toFixed(4)}  P ${(m.precision * 100).toFixed(1)}%  R ${(m.recall * 100).toFixed(1)}%  ` +
        `F1 ${(m.f1 * 100).toFixed(1)}%  FMR ${(m.falseMergeRate * 100).toFixed(2)}%  ` +
        `PR-AUC ${experiment.validation.prAuc ?? "n/a"}  ROC-AUC ${experiment.validation.rocAuc ?? "n/a"}`,
    );
  }
  console.log(
    `\nshipped: ${selected.experimentId}\nartifact: ${ARTIFACT_PATH}\nsha256: ${sha256}` +
      `\nweightsDigest: ${artifact.weightsDigest}   <-- the reproducibility test; sha256 also moves with createdAt/gitCommit`,
  );
}

main();
