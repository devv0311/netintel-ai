/**
 * P6.24.4 — the frozen held-out evaluation, run ONCE against the shipped
 * artifact, and the error analysis that comes with it.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/ml/evaluate-model.ts
 *
 * This is the first and only time the held-out partition is scored. The
 * model's parameters and its threshold were both fixed by
 * scripts/ml/train-model.ts against the validation partition, and
 * NOTHING here may change either: this script loads the artifact, scores,
 * and writes down what happened. If the result is disappointing, the
 * response is a new experiment recorded in the registry — never a new
 * threshold chosen here, which would silently turn the held-out set into
 * a second validation set and destroy the only unbiased number available.
 *
 * FALSE MERGES ARE REPORTED FIRST AND BROKEN OUT BY NEGATIVE CLASS,
 * because "1.2% false-merge rate" over a negative-heavy set can hide a
 * model that fails on precisely the pairs a human would find hardest.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildFeatures, deterministicPairDecision, FEATURE_NAMES, type FeatureRecord } from "@/lib/ml/features";
import { metricsAt, prAuc, rocAuc, type ScoredPair, type ThresholdMetrics } from "@/lib/ml/metrics";
import { artifactSha256, loadArtifact, scoreWithModel } from "@/lib/ml/model";

const ROOT = process.cwd();
const DATASET_PATH = "evidence/ml/pair-dataset.json";
const ARTIFACT_PATH = "models/cipher-er-pair-classifier.v1.json";
const OUT_DIR = "reports/ml";
const EVAL_PATH = path.join(OUT_DIR, "heldout-evaluation.json");
const ERRORS_PATH = path.join(OUT_DIR, "error-analysis.json");

const HELD_OUT = "test";

interface Pair {
  pairId: string;
  label: 0 | 1;
  labelClass: string;
  labelBasis: string;
  partition: string;
  subjectA: string;
  subjectB: string;
  aRef: string;
  bRef: string;
  aRegistry: string;
  bRegistry: string;
  aName: string;
  bName: string;
  sourcePairing: string;
  variation: string | null;
  scheme: string | null;
}

interface Dataset {
  datasetId: string;
  datasetVersion: string;
  featureRecords: Record<
    string,
    { name: string; officialName: string | null; aliases: string[]; jurisdiction: string | null; registry: string }
  >;
  pairs: Pair[];
  formerNameSlice: { pairId: string; subject: string; partition: string | null; aName: string; bName: string; variation: string }[];
}

const VARIATION_GROUPS: Record<string, string> = {
  identical: "exact / near-exact",
  case_only: "exact / near-exact",
  legal_suffix_or_punctuation: "legal suffix or punctuation",
  containment: "containment",
  partial_token_overlap: "partial token overlap",
  divergent: "divergent",
  script_variant: "transliteration / script variant",
};

function main(): void {
  const dataset = JSON.parse(readFileSync(path.join(ROOT, DATASET_PATH), "utf8")) as Dataset;
  const serialised = readFileSync(path.join(ROOT, ARTIFACT_PATH), "utf8");
  const artifact = loadArtifact(serialised);
  const sha256 = artifactSha256(serialised);

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

  const heldOut = dataset.pairs.filter((pair) => pair.partition === HELD_OUT);
  if (heldOut.length === 0) throw new Error("held-out partition is empty");

  interface Row {
    pair: Pair;
    a: FeatureRecord;
    b: FeatureRecord;
    modelScore: number;
    modelMerges: boolean;
    deterministicMerges: boolean;
    features: { name: string; value: number; contribution: number }[];
  }

  const rows: Row[] = heldOut.map((pair) => {
    const a = recordOf(pair.aRef);
    const b = recordOf(pair.bRef);
    const scored = scoreWithModel(artifact, a, b);
    return {
      pair,
      a,
      b,
      modelScore: scored.score,
      modelMerges: scored.wouldMerge,
      deterministicMerges: deterministicPairDecision(a, b),
      features: scored.features,
    };
  });

  const asScored = (subset: Row[], useModel: boolean): ScoredPair[] =>
    subset.map((row) => ({
      label: row.pair.label,
      score: useModel ? row.modelScore : row.deterministicMerges ? 1 : 0,
    }));

  const summarise = (subset: Row[], useModel: boolean): ThresholdMetrics =>
    metricsAt(asScored(subset, useModel), useModel ? artifact.decisionThreshold : 0.5);

  const modelOverall = summarise(rows, true);
  const baselineOverall = summarise(rows, false);
  const modelScored = asScored(rows, true);

  // ---- false merges, by negative class ----------------------------------
  const negativeClasses = ["hard_negative", "mined_hard_negative", "sampled_negative"];
  const falseMergeByClass = negativeClasses.map((labelClass) => {
    const subset = rows.filter((row) => row.pair.labelClass === labelClass);
    const modelFalse = subset.filter((row) => row.modelMerges).length;
    const baselineFalse = subset.filter((row) => row.deterministicMerges).length;
    return {
      labelClass,
      negatives: subset.length,
      modelFalseMerges: modelFalse,
      modelFalseMergeRate: subset.length === 0 ? 0 : modelFalse / subset.length,
      deterministicFalseMerges: baselineFalse,
      deterministicFalseMergeRate: subset.length === 0 ? 0 : baselineFalse / subset.length,
    };
  });

  // ---- positive-pair recovery, by slice ----------------------------------
  const positives = rows.filter((row) => row.pair.label === 1);
  const recoveryBy = (
    label: string,
    keyOf: (row: Row) => string | null,
  ): { dimension: string; slices: Record<string, { positives: number; model: number; deterministic: number; modelPct: string; deterministicPct: string }> } => {
    const slices: Record<string, { positives: number; model: number; deterministic: number; modelPct: string; deterministicPct: string }> = {};
    for (const row of positives) {
      const key = keyOf(row);
      if (key === null) continue;
      const entry = slices[key] ?? { positives: 0, model: 0, deterministic: 0, modelPct: "", deterministicPct: "" };
      entry.positives += 1;
      if (row.modelMerges) entry.model += 1;
      if (row.deterministicMerges) entry.deterministic += 1;
      slices[key] = entry;
    }
    for (const entry of Object.values(slices)) {
      entry.modelPct = `${((100 * entry.model) / entry.positives).toFixed(1)}%`;
      entry.deterministicPct = `${((100 * entry.deterministic) / entry.positives).toFixed(1)}%`;
    }
    return { dimension: label, slices };
  };

  const featureIndex = (name: string): number => FEATURE_NAMES.indexOf(name as (typeof FEATURE_NAMES)[number]);
  const valueOf = (row: Row, name: string): number => row.features[featureIndex(name)]?.value ?? 0;

  const breakdowns = [
    recoveryBy("name variation (ground-truth class)", (row) =>
      row.pair.variation ? VARIATION_GROUPS[row.pair.variation] ?? row.pair.variation : null,
    ),
    recoveryBy("source pairing", (row) => row.pair.sourcePairing),
    recoveryBy("abbreviation / acronym", (row) => (valueOf(row, "acronymMatch") === 1 ? "acronym match" : "no acronym match")),
    recoveryBy("name order", (row) =>
      valueOf(row, "sortedTokenMatch") === 1 && valueOf(row, "normalizedNameMatch") === 0
        ? "reordered tokens, same multiset"
        : "not a pure reordering",
    ),
    recoveryBy("legal suffix", (row) =>
      row.pair.variation === "legal_suffix_or_punctuation" ? "suffix or punctuation only" : "other",
    ),
    recoveryBy("script", (row) => (valueOf(row, "sameScript") === 1 ? "same script" : "different script")),
    recoveryBy("publisher aliases present", (row) =>
      valueOf(row, "aliasesEitherPresent") === 1 ? "at least one side has aliases" : "neither side has aliases",
    ),
    recoveryBy("jurisdiction", (row) =>
      valueOf(row, "jurisdictionBothKnown") === 0
        ? "not stated by both publishers"
        : valueOf(row, "jurisdictionCountryMatch") === 1
          ? "both stated, same country"
          : "both stated, different country",
    ),
  ];

  // ---- the error table ---------------------------------------------------
  const failureCategory = (row: Row): string => {
    if (row.pair.label === 1 && !row.modelMerges) {
      if (valueOf(row, "tokenJaccard") === 0) return "false_split_no_shared_token";
      if (valueOf(row, "sameScript") === 0) return "false_split_script_variant";
      if (valueOf(row, "orderedPrefixContainment") === 1) return "false_split_containment";
      return "false_split_partial_overlap";
    }
    if (row.pair.label === 0 && row.modelMerges) {
      if (row.pair.labelClass === "hard_negative" || row.pair.labelClass === "mined_hard_negative") {
        return valueOf(row, "normalizedNameMatch") === 1
          ? "false_merge_identical_normalised_name"
          : "false_merge_shared_leading_token";
      }
      return "false_merge_unrelated_pair";
    }
    return "correct";
  };

  const errorRows = rows
    .filter((row) => (row.pair.label === 1) !== row.modelMerges)
    .map((row) => ({
      pairId: row.pair.pairId,
      truth: row.pair.label === 1 ? "same_entity" : "different_entities",
      prediction: row.modelMerges ? "same_entity" : "different_entities",
      score: Number(row.modelScore.toFixed(4)),
      threshold: artifact.decisionThreshold,
      deterministicResult: row.deterministicMerges ? "merged" : "not merged",
      sources: row.pair.sourcePairing,
      entityCategory: row.pair.variation ?? row.pair.labelClass,
      labelClass: row.pair.labelClass,
      labelBasis: row.pair.labelBasis,
      failureCategory: failureCategory(row),
      fields: {
        aName: row.pair.aName,
        bName: row.pair.bName,
        aJurisdiction: row.a.jurisdiction ?? null,
        bJurisdiction: row.b.jurisdiction ?? null,
        aOfficialName: row.a.officialName ?? null,
        bOfficialName: row.b.officialName ?? null,
      },
      topFeatures: [...row.features]
        .sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution))
        .slice(0, 6)
        .map((feature) => ({ name: feature.name, value: Number(feature.value.toFixed(4)), contribution: Number(feature.contribution.toFixed(4)) })),
      recommendedNextAction:
        row.pair.label === 1
          ? "recall gap — candidate for a future feature or for human review; NEVER a ground-truth edit"
          : "precision gap — inspect before any threshold change; the deterministic resolver still governs the merge",
    }))
    .sort((a, b) => (a.truth === b.truth ? b.score - a.score : a.truth === "different_entities" ? -1 : 1));

  const errorCategoryCounts: Record<string, number> = {};
  for (const row of errorRows) errorCategoryCounts[row.failureCategory] = (errorCategoryCounts[row.failureCategory] ?? 0) + 1;

  // ---- previously known real failures ------------------------------------
  const knownFailureIds = ["EN-0001", "EN-0002", "EN-0003", "EN-0103", "EN-0124", "EN-0129", "EN-0130", "EN-0143"];
  const knownFailures = rows
    .filter((row) => knownFailureIds.includes(row.pair.pairId))
    .map((row) => ({
      pairId: row.pair.pairId,
      names: [row.pair.aName, row.pair.bName],
      truth: "different_entities",
      modelScore: Number(row.modelScore.toFixed(4)),
      modelMerges: row.modelMerges,
      deterministicMerges: row.deterministicMerges,
    }));

  // ---- former-name slice, scored but never trained on --------------------
  const formerNames = dataset.formerNameSlice.filter((entry) => entry.partition === HELD_OUT);

  const report = {
    evaluation: "P6.24.4 frozen held-out evaluation",
    dataClass: "REAL",
    ranAt: new Date().toISOString(),
    artifact: {
      path: ARTIFACT_PATH,
      sha256,
      modelId: artifact.modelId,
      modelVersion: artifact.modelVersion,
      experimentId: artifact.experimentId,
      modelKind: artifact.parameters.kind,
      decisionThreshold: artifact.decisionThreshold,
      thresholdPolicy: artifact.thresholdPolicy,
      gitCommit: artifact.gitCommit,
      datasetId: artifact.datasetId,
      datasetVersion: artifact.datasetVersion,
    },
    heldOut: {
      partition: HELD_OUT,
      pairs: rows.length,
      positives: positives.length,
      negatives: rows.length - positives.length,
      curatedHardNegatives: rows.filter((row) => row.pair.labelClass === "hard_negative").length,
      minedHardNegatives: rows.filter((row) => row.pair.labelClass === "mined_hard_negative").length,
      sampledNegatives: rows.filter((row) => row.pair.labelClass === "sampled_negative").length,
      subjects: new Set(rows.flatMap((row) => [row.pair.subjectA, row.pair.subjectB])).size,
    },
    headline: {
      model: {
        ...modelOverall,
        rocAuc: Number(rocAuc(modelScored).toFixed(4)),
        prAuc: Number(prAuc(modelScored).toFixed(4)),
        positivePairRecovery: `${modelOverall.truePositives}/${positives.length}`,
      },
      deterministicBaseline: {
        ...baselineOverall,
        rocAuc: null,
        prAuc: null,
        positivePairRecovery: `${baselineOverall.truePositives}/${positives.length}`,
        note:
          "The shipped resolver's Tier B/B2 rule replayed at pair level. NOT the 70.7% figure from the earlier " +
          "75-pair India-filtered corpus, which is a different dataset and not comparable.",
      },
      deltaRecallPoints: Number(((modelOverall.recall - baselineOverall.recall) * 100).toFixed(1)),
      deltaFalseMergeRatePoints: Number(((modelOverall.falseMergeRate - baselineOverall.falseMergeRate) * 100).toFixed(3)),
    },
    falseMergeByNegativeClass: falseMergeByClass,
    hardNegativeFalseMergeRate: (() => {
      const subset = rows.filter((row) => row.pair.labelClass === "hard_negative" || row.pair.labelClass === "mined_hard_negative");
      const model = subset.filter((row) => row.modelMerges).length;
      const deterministic = subset.filter((row) => row.deterministicMerges).length;
      return {
        denominator: subset.length,
        model,
        modelPct: `${((100 * model) / subset.length).toFixed(2)}%`,
        deterministic,
        deterministicPct: `${((100 * deterministic) / subset.length).toFixed(2)}%`,
      };
    })(),
    falseSplitRate: {
      model: `${modelOverall.falseNegatives}/${positives.length}`,
      modelPct: `${(modelOverall.falseSplitRate * 100).toFixed(2)}%`,
      deterministic: `${baselineOverall.falseNegatives}/${positives.length}`,
      deterministicPct: `${(baselineOverall.falseSplitRate * 100).toFixed(2)}%`,
    },
    breakdowns,
    previouslyKnownRealFailures: knownFailures,
    formerNameSlice: {
      note:
        "A former name is a TEMPORAL claim by a single authority. It is not an identity label, was never trained on, " +
        "and is reported here only so the number is visible.",
      pairs: formerNames.length,
    },
    errorCategoryCounts,
  };

  mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
  writeFileSync(path.join(ROOT, EVAL_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(
    path.join(ROOT, ERRORS_PATH),
    `${JSON.stringify({ evaluation: "P6.24.4 error analysis", ranAt: report.ranAt, artifactSha256: sha256, totalErrors: errorRows.length, errorCategoryCounts, rows: errorRows }, null, 2)}\n`,
    "utf8",
  );

  console.log(`held-out pairs ${rows.length}  positives ${positives.length}  negatives ${rows.length - positives.length}`);
  console.log(
    `baseline : P ${(baselineOverall.precision * 100).toFixed(1)}%  R ${(baselineOverall.recall * 100).toFixed(1)}%  ` +
      `F1 ${(baselineOverall.f1 * 100).toFixed(1)}%  FMR ${(baselineOverall.falseMergeRate * 100).toFixed(3)}%  ` +
      `recovery ${baselineOverall.truePositives}/${positives.length}`,
  );
  console.log(
    `model    : P ${(modelOverall.precision * 100).toFixed(1)}%  R ${(modelOverall.recall * 100).toFixed(1)}%  ` +
      `F1 ${(modelOverall.f1 * 100).toFixed(1)}%  FMR ${(modelOverall.falseMergeRate * 100).toFixed(3)}%  ` +
      `recovery ${modelOverall.truePositives}/${positives.length}  ` +
      `PR-AUC ${report.headline.model.prAuc}  ROC-AUC ${report.headline.model.rocAuc}`,
  );
  console.log("\nfalse merges by negative class:");
  for (const entry of falseMergeByClass) {
    console.log(
      `  ${entry.labelClass.padEnd(22)} n=${String(entry.negatives).padStart(5)}  ` +
        `model ${entry.modelFalseMerges} (${(entry.modelFalseMergeRate * 100).toFixed(2)}%)  ` +
        `deterministic ${entry.deterministicFalseMerges} (${(entry.deterministicFalseMergeRate * 100).toFixed(2)}%)`,
    );
  }
  console.log(`\nerrors: ${errorRows.length}`, errorCategoryCounts);
  console.log(`\nwrote ${EVAL_PATH}\nwrote ${ERRORS_PATH}`);
}

main();
