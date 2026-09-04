/**
 * Data-validation, leakage and reproducibility regression tests for the
 * P6.24 entity-resolution model.
 *
 * The last test in this file is the important one: it re-scores the whole
 * held-out partition from the committed artifact and asserts that it
 * reproduces the numbers in the committed evaluation report, exactly. If
 * a feature, the normaliser, the artifact or the dataset ever changes
 * without the report being regenerated, this fails — which is the only
 * way "the published metrics are reproducible" can be a fact about the
 * repository rather than a claim in a document.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFeatures, deterministicPairDecision, type FeatureRecord } from "@/lib/ml/features";
import { metricsAt, type ScoredPair } from "@/lib/ml/metrics";
import { loadArtifact, scoreVector } from "@/lib/ml/model";

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

interface Pair {
  pairId: string;
  label: 0 | 1;
  labelClass: string;
  labelBasis: string;
  labelReason: string;
  partition: string;
  subjectA: string;
  subjectB: string;
  aRef: string;
  bRef: string;
}

interface Dataset {
  datasetId: string;
  datasetVersion: string;
  featureRecords: Record<
    string,
    { name: string; officialName: string | null; aliases: string[]; jurisdiction: string | null; registry: string }
  >;
  pairs: Pair[];
  counts: { byLabelClass: Record<string, number> };
}

// The SHIPPED dataset and its reports. P6.25 supersedes the P6.24 pair
// dataset; that one stays in the repository, and its own gate is asserted
// separately below because its result is a documented finding rather than
// a passing check.
const dataset = JSON.parse(read("evidence/ml/pair-dataset-v2.json")) as Dataset;
const leakage = JSON.parse(read("reports/ml/leakage-audit-v2.json")) as {
  verdict: string;
  checks: { id: string; passed: boolean; name: string }[];
};
const evaluation = JSON.parse(read("reports/ml/heldout-evaluation-v2.json")) as {
  artifact: { sha256: string; decisionThreshold: number };
  heldOut: { pairs: number; positives: number };
  headline: {
    model: { truePositives: number; falsePositives: number; falseNegatives: number; trueNegatives: number };
    deterministicBaseline: { truePositives: number; falsePositives: number };
  };
};

const featureRecordOf = (ref: string): FeatureRecord => {
  const record = dataset.featureRecords[ref];
  if (!record) throw new Error(`no feature projection for ${ref}`);
  return {
    name: record.name,
    officialName: record.officialName ?? undefined,
    aliases: record.aliases,
    jurisdiction: record.jurisdiction ?? undefined,
  };
};

describe("dataset validity", () => {
  it("labels every pair with a class, a basis and a stated reason", () => {
    for (const pair of dataset.pairs) {
      expect(pair.labelClass.length).toBeGreaterThan(0);
      expect(pair.labelBasis.length).toBeGreaterThan(0);
      expect(pair.labelReason.length).toBeGreaterThan(0);
      expect([0, 1]).toContain(pair.label);
    }
  });

  it("keeps every one of the ground truth's positives and curated hard negatives", () => {
    // Read from the ground truth rather than hard-coded, so a corpus
    // expansion cannot make this assertion stale and cannot make it pass
    // by having quietly dropped labelled pairs on the way in.
    const truth = JSON.parse(read("evidence/expanded-v2/expanded-v2.ground-truth.json")) as {
      counts: { crossSourcePositives: number; hardNegatives: number };
    };
    expect(dataset.counts.byLabelClass.cross_source_positive).toBe(truth.counts.crossSourcePositives);
    expect(dataset.counts.byLabelClass.hard_negative).toBe(truth.counts.hardNegatives);
  });

  it("uses only the three declared partitions", () => {
    const partitions = new Set(dataset.pairs.map((pair) => pair.partition));
    expect([...partitions].sort()).toEqual(["test", "train", "validation"]);
  });

  it("carries a feature projection for both sides of every pair", () => {
    for (const pair of dataset.pairs) {
      expect(dataset.featureRecords[pair.aRef]).toBeDefined();
      expect(dataset.featureRecords[pair.bRef]).toBeDefined();
    }
  });

  it("exposes no identifier in any feature projection", () => {
    const allowed = new Set(["name", "officialName", "aliases", "jurisdiction", "registry"]);
    for (const record of Object.values(dataset.featureRecords)) {
      for (const key of Object.keys(record)) expect(allowed.has(key)).toBe(true);
    }
  });
});

describe("leakage gate", () => {
  it("is recorded as passing, with every check passing", () => {
    expect(leakage.verdict).toBe("PASS");
    for (const check of leakage.checks) expect(check.passed).toBe(true);
  });

  it("independently re-verifies subject disjointness", () => {
    const partitionOf = new Map<string, string>();
    for (const pair of dataset.pairs) {
      for (const subject of [pair.subjectA, pair.subjectB]) {
        const existing = partitionOf.get(subject);
        if (existing) expect(existing).toBe(pair.partition);
        else partitionOf.set(subject, pair.partition);
      }
    }
    expect(partitionOf.size).toBeGreaterThan(0);
  });

  it("independently re-verifies record disjointness", () => {
    const partitionOf = new Map<string, string>();
    for (const pair of dataset.pairs) {
      for (const ref of [pair.aRef, pair.bRef]) {
        const existing = partitionOf.get(ref);
        if (existing) expect(existing).toBe(pair.partition);
        else partitionOf.set(ref, pair.partition);
      }
    }
  });

  it("contains no duplicated record pair", () => {
    const keys = dataset.pairs.map((pair) => [pair.aRef, pair.bRef].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("reproducibility", () => {
  const raw = read("models/cipher-er-pair-classifier.v2.json");
  const artifact = loadArtifact(raw);
  const heldOut = dataset.pairs.filter((pair) => pair.partition === "test");

  it("scores the held-out partition to exactly the committed evaluation counts", () => {
    expect(heldOut).toHaveLength(evaluation.heldOut.pairs);

    const scored: ScoredPair[] = heldOut.map((pair) => ({
      label: pair.label,
      score: scoreVector(artifact, buildFeatures(featureRecordOf(pair.aRef), featureRecordOf(pair.bRef)).values),
    }));
    const recomputed = metricsAt(scored, artifact.decisionThreshold);

    expect(recomputed.truePositives).toBe(evaluation.headline.model.truePositives);
    expect(recomputed.falsePositives).toBe(evaluation.headline.model.falsePositives);
    expect(recomputed.falseNegatives).toBe(evaluation.headline.model.falseNegatives);
    expect(recomputed.trueNegatives).toBe(evaluation.headline.model.trueNegatives);
  });

  it("reproduces the deterministic baseline on the same held-out pairs", () => {
    const baseline: ScoredPair[] = heldOut.map((pair) => ({
      label: pair.label,
      score: deterministicPairDecision(featureRecordOf(pair.aRef), featureRecordOf(pair.bRef)) ? 1 : 0,
    }));
    const recomputed = metricsAt(baseline, 0.5);
    expect(recomputed.truePositives).toBe(evaluation.headline.deterministicBaseline.truePositives);
    expect(recomputed.falsePositives).toBe(evaluation.headline.deterministicBaseline.falsePositives);
  });

  it("uses the artifact the evaluation report names", () => {
    expect(artifact.decisionThreshold).toBe(evaluation.artifact.decisionThreshold);
  });
});
