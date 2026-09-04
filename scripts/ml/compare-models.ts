/**
 * P6.25.4 — the head-to-head, on pairs NEITHER model was fitted on.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/ml/compare-models.ts \
 *     --dataset evidence/ml/pair-dataset-v2.json \
 *     --models models/cipher-er-pair-classifier.v1.json,models/cipher-er-pair-classifier.v2.json \
 *     --fit-datasets evidence/ml/pair-dataset.json,evidence/ml/pair-dataset-v2.json
 *
 * WHY THIS SCRIPT EXISTS.
 *
 * The v1 and v2 held-out numbers cannot be compared with each other. They
 * are measured on different instruments: v2's frozen test has 6,692 pairs
 * against v1's 2,615, drawn from a corpus with 126 jurisdictions rather
 * than a handful and a far larger share of divergent names. v2's model
 * scoring a lower recall than v1's says nothing on its own, because a
 * harder exam produces lower marks from the same candidate.
 *
 * Nor can both models simply be run over the v2 held-out set. 847 of
 * those 6,692 pairs touch a subject the v1 model was FITTED on — they are
 * held out for v2 and are training data for v1 — and scoring v1 there
 * would credit it for recalling entities it had already seen.
 *
 * So the arena is the intersection: pairs in the evaluation dataset's
 * held-out partition whose subjects appear in NO declared fit partition
 * of ANY compared model. Both models are strangers to every pair scored
 * here, the deterministic resolver is replayed over the identical pairs
 * as the floor, and each model is applied at ITS OWN frozen threshold —
 * never a threshold re-picked here, which would make this a third
 * validation set.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildFeatures, deterministicPairDecision, type FeatureRecord } from "@/lib/ml/features";
import { metricsAt, prAuc, rocAuc, type ScoredPair } from "@/lib/ml/metrics";
import { artifactSha256, loadArtifact, scoreWithModel, weightsDigest } from "@/lib/ml/model";

const ROOT = process.cwd();

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};
const list = (name: string, fallback: string): string[] =>
  arg(name, fallback).split(",").map((v) => v.trim()).filter(Boolean);

const DATASET_PATH = arg("dataset", "evidence/ml/pair-dataset-v2.json");
const MODEL_PATHS = list("models", "models/cipher-er-pair-classifier.v1.json,models/cipher-er-pair-classifier.v2.json");
const FIT_DATASETS = list("fit-datasets", "evidence/ml/pair-dataset.json,evidence/ml/pair-dataset-v2.json");
const OUT_DIR = "reports/ml";
const OUT_PATH = path.join(OUT_DIR, arg("out", "model-comparison.json"));
const HELD_OUT = "test";

interface Pair {
  pairId: string;
  label: 0 | 1;
  labelClass: string;
  partition: string;
  subjectA: string;
  subjectB: string;
  aRef: string;
  bRef: string;
  aName: string;
  bName: string;
  sourcePairing: string;
  variation: string | null;
}

interface Dataset {
  datasetId: string;
  datasetVersion: string;
  featureRecords: Record<string, FeatureRecord>;
  pairs: Pair[];
}

function main(): void {
  const dataset = JSON.parse(readFileSync(path.join(ROOT, DATASET_PATH), "utf8")) as Dataset;

  // Every subject any compared model may have been fitted on.
  const fittedSubjects = new Set<string>();
  const fitProvenance: { dataset: string; subjects: number }[] = [];
  for (const fitPath of FIT_DATASETS) {
    const fit = JSON.parse(readFileSync(path.join(ROOT, fitPath), "utf8")) as Dataset;
    let added = 0;
    for (const pair of fit.pairs) {
      if (pair.partition === HELD_OUT) continue;
      for (const subject of [pair.subjectA, pair.subjectB]) {
        if (!fittedSubjects.has(subject)) {
          fittedSubjects.add(subject);
          added++;
        }
      }
    }
    fitProvenance.push({ dataset: fitPath, subjects: added });
  }

  const heldOut = dataset.pairs.filter((pair) => pair.partition === HELD_OUT);
  const arena = heldOut.filter(
    (pair) => !fittedSubjects.has(pair.subjectA) && !fittedSubjects.has(pair.subjectB),
  );
  const excluded = heldOut.length - arena.length;

  const recordOf = (ref: string): FeatureRecord => {
    const record = dataset.featureRecords[ref];
    if (!record) throw new Error(`no feature record for ${ref}`);
    return record;
  };

  const deterministic: ScoredPair[] = arena.map((pair) => ({
    label: pair.label,
    score: deterministicPairDecision(recordOf(pair.aRef), recordOf(pair.bRef)) ? 1 : 0,
  }));

  const negativesOfClass = (labelClass: string) =>
    arena.filter((pair) => pair.label === 0 && pair.labelClass === labelClass).length;

  const falseMergesByClass = (decide: (pair: Pair) => boolean) => {
    const classes = ["hard_negative", "mined_hard_negative", "sampled_negative"];
    return classes.map((labelClass) => {
      const negatives = negativesOfClass(labelClass);
      const merges = arena.filter(
        (pair) => pair.label === 0 && pair.labelClass === labelClass && decide(pair),
      ).length;
      return {
        labelClass,
        negatives,
        falseMerges: merges,
        falseMergeRate: negatives === 0 ? 0 : merges / negatives,
      };
    });
  };

  const rows = MODEL_PATHS.map((modelPath) => {
    const serialised = readFileSync(path.join(ROOT, modelPath), "utf8");
    const artifact = loadArtifact(serialised);
    const scored: ScoredPair[] = arena.map((pair) => ({
      label: pair.label,
      score: scoreWithModel(artifact, recordOf(pair.aRef), recordOf(pair.bRef)).score,
    }));
    const decide = (pair: Pair): boolean => {
      const index = arena.indexOf(pair);
      return (scored[index] as ScoredPair).score >= artifact.decisionThreshold;
    };
    // Recomputed rather than read back, so a stale recorded digest cannot
    // pass itself off as this file's contents.
    const recomputed = weightsDigest(artifact);
    return {
      artifactPath: modelPath,
      modelVersion: artifact.modelVersion,
      experimentId: artifact.experimentId,
      datasetVersionFittedOn: artifact.datasetVersion,
      decisionThreshold: artifact.decisionThreshold,
      artifactSha256: artifactSha256(serialised),
      weightsDigest: recomputed,
      weightsDigestRecordedInArtifact: artifact.weightsDigest ?? null,
      weightsDigestMatches: artifact.weightsDigest ? artifact.weightsDigest === recomputed : null,
      metrics: metricsAt(scored, artifact.decisionThreshold),
      rocAuc: Number(rocAuc(scored).toFixed(4)),
      prAuc: Number(prAuc(scored).toFixed(4)),
      falseMergeByNegativeClass: falseMergesByClass(decide),
    };
  });

  const positives = arena.filter((pair) => pair.label === 1).length;
  const report = {
    comparison: "P6.25.4 head-to-head on pairs neither model was fitted on",
    ranAt: new Date().toISOString(),
    evaluationDataset: { path: DATASET_PATH, id: dataset.datasetId, version: dataset.datasetVersion },
    arena: {
      heldOutPairs: heldOut.length,
      excludedBecauseAModelWasFittedOnTheSubject: excluded,
      scoredPairs: arena.length,
      positives,
      negatives: arena.length - positives,
      curatedHardNegatives: negativesOfClass("hard_negative"),
      minedHardNegatives: negativesOfClass("mined_hard_negative"),
      sampledNegatives: negativesOfClass("sampled_negative"),
      note:
        "Pairs from the evaluation dataset's held-out partition whose subjects appear in NO fit partition of any " +
        "compared model. Both models are strangers to every pair here; each is applied at its OWN frozen threshold.",
    },
    fitPartitionsExcluded: fitProvenance,
    deterministicBaseline: {
      metrics: metricsAt(deterministic, 0.5),
      falseMergeByNegativeClass: falseMergesByClass((pair) =>
        deterministicPairDecision(recordOf(pair.aRef), recordOf(pair.bRef)),
      ),
      note: "The shipped resolver's Tier B/B2 rule replayed at pair level over the identical pairs.",
    },
    models: rows,
  };

  mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
  writeFileSync(path.join(ROOT, OUT_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `arena: ${arena.length} pairs (${positives} positive), ` +
      `${excluded} of ${heldOut.length} held-out pairs excluded as fitted-on by some model`,
  );
  const b = report.deterministicBaseline.metrics;
  console.log(
    `deterministic  P ${(b.precision * 100).toFixed(1)}%  R ${(b.recall * 100).toFixed(1)}%  ` +
      `F1 ${(b.f1 * 100).toFixed(1)}%  FMR ${(b.falseMergeRate * 100).toFixed(3)}%`,
  );
  for (const row of rows) {
    const m = row.metrics;
    const hard = row.falseMergeByNegativeClass.find((c) => c.labelClass === "hard_negative");
    console.log(
      `${row.artifactPath.replace("models/", "").padEnd(34)} ` +
        `P ${(m.precision * 100).toFixed(1)}%  R ${(m.recall * 100).toFixed(1)}%  F1 ${(m.f1 * 100).toFixed(1)}%  ` +
        `FMR ${(m.falseMergeRate * 100).toFixed(3)}%  hardNegFMR ${((hard?.falseMergeRate ?? 0) * 100).toFixed(2)}%  ` +
        `PR-AUC ${row.prAuc}  digest ${row.weightsDigestMatches === false ? "MISMATCH" : "ok"}`,
    );
  }
  console.log(`\nwrote ${OUT_PATH}`);
}

main();
